/**
 * The A031 fabric suite: envelope round trips, idempotency discipline
 * (replay no-ops + conflicts), the fail-closed publish/offer gates via
 * commands, the event log and the observability dump.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createExpertListing } from './listing.js';
import { createCommercialOffer } from './offer.js';
import { createEngagement } from './engagement.js';
import { createReview } from './review.js';
import { ExpertMarketplaceFabric } from './fabric.js';
import { ExpertMarketplacePool } from './pool.js';
import { MARKETPLACE_EXPERTS_ERROR_CODES } from './errors.js';
import {
  D,
  EXPERT,
  FOREIGN_TENANT,
  MapCertificationRecordStore,
  MapExpertRecordStore,
  MapReleaseRecordStore,
  CUSTOMER,
  T,
  TENANT,
  registeredRelease,
  satisfiedCertification,
  fixtureProfile,
  fixtureQualification,
} from './test-support.js';

const CORR = 'corr-a031-fabric';
const IDEM = 'idem-a031-fabric';

async function buildFabric() {
  const profile = await fixtureProfile();
  const qualification = await fixtureQualification();
  const store = new MapExpertRecordStore()
    .addProfile(profile)
    .addQualification(qualification);
  const fabric = new ExpertMarketplaceFabric(new ExpertMarketplacePool(), {
    expertRecords: store,
    releases: new MapReleaseRecordStore().add(registeredRelease()),
    certifications: new MapCertificationRecordStore().add(satisfiedCertification()),
  });
  const listing = await createExpertListing({
    listingId: 'listing-ada-review',
    tenant: TENANT,
    expertId: EXPERT,
    headline: 'Senior Rust code review, evidence-backed',
    description: 'Qualified code-review engagements.',
    profileRef: profile.digest,
    cardRef: qualification.card.digest,
    qualificationProofs: [
      { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
    ],
    capabilityRefs: [
      { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: D.capability },
    ],
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
    ],
    jurisdictions: [{ country: 'US' }],
    declaredAt: T.listingDeclared,
  });
  fabric.registerListing(listing);
  return { fabric, listing, store, profile, qualification };
}

describe('ExpertMarketplaceFabric commands', () => {
  let built: Awaited<ReturnType<typeof buildFabric>>;

  beforeEach(async () => {
    built = await buildFabric();
  });

  it('publishes a listing through the REAL gate with an envelope round trip', async () => {
    const { fabric, listing } = built;
    const result = await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(result.record.transition).toBe('publish');
    expect(result.gate.proofs).toHaveLength(1);
    expect(result.event.kind).toBe('event');
    expect(result.event.schema).toContain('marketplace-experts');
    expect(result.event.schema).toContain('1.0.0');
    expect(fabric.pool.currentListingStatus(listing.digest)).toBe('listed');
  });

  it('replays publish idempotently (same key + same command = no-op)', async () => {
    const { fabric, listing } = built;
    const first = await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const replay = await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(replay.record.digest).toBe(first.record.digest);
    expect(fabric.listEvents()).toHaveLength(1);
  });

  it('rejects a different command under the same idempotency key (conflict)', async () => {
    const { fabric, listing } = built;
    await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    await expect(
      fabric.publishListing(
        { listingRef: listing.digest, at: T.review },
        { correlationId: CORR, idempotencyKey: IDEM },
      ),
    ).rejects.toMatchObject({
      code: MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    });
  });

  it('fails CLOSED when the qualification gate cannot verify evidence (absent store)', async () => {
    const bare = new ExpertMarketplaceFabric();
    const { listing } = built;
    bare.registerListing(listing);
    await expect(
      bare.publishListing(
        { listingRef: listing.digest, at: T.publish },
        { correlationId: CORR, idempotencyKey: 'idem-bare' },
      ),
    ).rejects.toMatchObject({ code: MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE });
    expect(bare.pool.currentListingStatus(listing.digest)).toBe('draft');
  });

  it('rejects publish of an UNREGISTERED listing', async () => {
    const { fabric } = built;
    await expect(
      fabric.publishListing(
        { listingRef: 'e'.repeat(64), at: T.publish },
        { correlationId: CORR, idempotencyKey: 'idem-missing' },
      ),
    ).rejects.toMatchObject({ code: MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND });
  });

  it('walks unlist → delist with terminal finality', async () => {
    const { fabric, listing } = built;
    await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    await fabric.transitionListing(
      { listingRef: listing.digest, transition: 'unlist', at: T.offerDeclared },
      { correlationId: CORR, idempotencyKey: 'idem-unlist' },
    );
    expect(fabric.pool.currentListingStatus(listing.digest)).toBe('unlisted');
    await fabric.transitionListing(
      { listingRef: listing.digest, transition: 'delist', at: T.complete, note: 'retired from marketplace' },
      { correlationId: CORR, idempotencyKey: 'idem-delist' },
    );
    expect(fabric.pool.currentListingStatus(listing.digest)).toBe('delisted');
    await expect(
      fabric.transitionListing(
        { listingRef: listing.digest, transition: 'relist', at: T.review },
        { correlationId: CORR, idempotencyKey: 'idem-relist-late' },
      ),
    ).rejects.toMatchObject({ code: MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION });
  });

  it('records offers (with the body-backed gate) and withdraws them', async () => {
    const { fabric, listing } = built;
    const offer = await createCommercialOffer({
      offerId: 'offer-body-backed',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: listing.digest,
      kind: 'body-backed-service',
      headline: 'Agent-backed regression triage under expert supervision',
      rate: { currency: 'USD', amountMinor: 90_000, unit: 'per-task' },
      minNoticeHours: 48,
      maxDurationHours: 24,
      availability: [],
      backingReleaseRef: D.release,
      validFrom: T.offerFrom,
      validUntil: T.offerUntil,
      declaredAt: T.offerDeclared,
    });
    const recorded = await fabric.recordOffer(
      { offer },
      { correlationId: CORR, idempotencyKey: 'idem-offer' },
    );
    expect(recorded.backingGate?.certifications[0]?.verdict).toBe('satisfied');
    expect(recorded.event.schema).toContain('offer-recorded-event');

    const withdrawn = await fabric.withdrawOffer(
      { offerRef: offer.digest, at: T.complete, note: 'capacity withdrawn' },
      { correlationId: CORR, idempotencyKey: 'idem-withdraw' },
    );
    expect(withdrawn.record.transition).toBe('withdraw');
    expect(fabric.pool.currentOfferStatus(offer.digest)).toBe('withdrawn');
  });

  it('runs the engagement lifecycle + review through commands', async () => {
    const { fabric, listing } = built;
    await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const offer = await createCommercialOffer({
      offerId: 'offer-review-session',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: listing.digest,
      kind: 'code-review',
      headline: 'One 60-minute Rust review session',
      rate: { currency: 'USD', amountMinor: 12_500, unit: 'per-session' },
      minNoticeHours: 24,
      maxDurationHours: 48,
      availability: [],
      validFrom: T.offerFrom,
      validUntil: T.offerUntil,
      declaredAt: T.offerDeclared,
    });
    await fabric.recordOffer({ offer }, { correlationId: CORR, idempotencyKey: 'idem-offer' });

    const engagement = await createEngagement({
      engagementId: 'engagement-0001',
      tenant: TENANT,
      listingRef: listing.digest,
      offerRef: offer.digest,
      expertId: EXPERT,
      customer: CUSTOMER,
      scopeNote: 'Review PR #42.',
      scheduledFor: T.engagementScheduled,
      requestedAt: T.engagementRequested,
    });
    await fabric.requestEngagement(
      { engagement },
      { correlationId: CORR, idempotencyKey: 'idem-engage' },
    );
    await fabric.transitionEngagement(
      { engagementRef: engagement.digest, transition: 'accept', at: T.accept },
      { correlationId: CORR, idempotencyKey: 'idem-accept' },
    );
    await fabric.transitionEngagement(
      { engagementRef: engagement.digest, transition: 'complete', at: T.complete },
      { correlationId: CORR, idempotencyKey: 'idem-complete' },
    );
    const review = await createReview({
      reviewId: 'review-0001',
      tenant: TENANT,
      engagementRef: engagement.digest,
      listingRef: listing.digest,
      expertId: EXPERT,
      customer: CUSTOMER,
      rating: 4,
      text: 'Thorough review, actionable feedback.',
      reviewedAt: T.review,
    });
    const reviewed = await fabric.recordReview(
      { review },
      { correlationId: CORR, idempotencyKey: 'idem-review' },
    );
    expect(reviewed.review.verdict).toBe('positive');
    expect(fabric.pool.listingStats(listing.digest).averageRating).toBe(4);
  });

  it('searches through the query envelope round trip', async () => {
    const { fabric, listing } = built;
    await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const searched = await fabric.searchMarketplace(
      { tenant: TENANT, evaluatedAt: T.search, sort: 'recent' },
      { correlationId: CORR },
    );
    expect(searched.query.kind).toBe('query');
    expect(searched.response.kind).toBe('response');
    expect(searched.result.cards).toHaveLength(1);
    expect(searched.result.cards[0]?.listingRef).toBe(listing.digest);
    // Cross-tenant search sees nothing.
    const foreign = await fabric.searchMarketplace(
      { tenant: FOREIGN_TENANT, evaluatedAt: T.search },
      { correlationId: CORR },
    );
    expect(foreign.result.totalMatches).toBe(0);
  });

  it('maintains the append-only event log + observability dump', async () => {
    const { fabric, listing } = built;
    await fabric.publishListing(
      { listingRef: listing.digest, at: T.publish },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    const kinds = fabric.listEventKinds();
    expect(kinds).toContain('listing-published');
    const dump = fabric.describe();
    expect(dump.listings).toBe(1);
    expect(dump.listingStatusRecords).toBe(1);
    expect(dump.events).toBe(1);
    expect(dump.runKeys).toBe(1);
  });
});
