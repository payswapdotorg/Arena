/**
 * The A031 domain suite: listing construction + the qualification publish
 * gate (positive + adversarial), pool discipline, commercial offers
 * (terms + the body-backed gate), engagements (tenant checks, notice/
 * duration, lifecycle terminal finality), reviews (completion gating,
 * one-per-engagement, derived verdicts) and the search engine (tenant
 * isolation, filters, sorts, aggregates, truncation).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createExpertListing,
  createListingStatusRecord,
  verifyListingGate,
} from './listing.js';
import { createCommercialOffer, verifyOfferBackingGate } from './offer.js';
import { createEngagement, createEngagementTransition } from './engagement.js';
import { createReview } from './review.js';
import { ExpertMarketplacePool } from './pool.js';
import { ExpertMarketplaceEngine } from './engine.js';
import { createMarketplaceQuery } from './query.js';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import {
  CUSTOMER,
  D,
  EXPERT,
  EXPERT_B,
  FOREIGN_TENANT,
  MapCertificationRecordStore,
  MapExpertRecordStore,
  MapReleaseRecordStore,
  registeredRelease,
  satisfiedCertification,
  T,
  TENANT,
  fixtureProfile,
  fixtureQualification,
} from './test-support.js';

async function expectRejects(run: () => unknown, code: string): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MarketplaceExpertsError);
  expect((caught as MarketplaceExpertsError).code).toBe(code);
}

/** Build the standard positive fixture: published profile + qualified record + card. */
async function standardFixture() {
  const profile = await fixtureProfile();
  const qualification = await fixtureQualification();
  const store = new MapExpertRecordStore()
    .addProfile(profile)
    .addQualification(qualification);
  const listing = await createExpertListing({
    listingId: 'listing-ada-review',
    tenant: TENANT,
    expertId: EXPERT,
    headline: 'Senior Rust code review, evidence-backed',
    description: 'Qualified code-review engagements with verified work products.',
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
  return { profile, qualification, store, listing };
}

describe('expert listing construction', () => {
  it('creates a draft listing with a deterministic digest', async () => {
    const { listing } = await standardFixture();
    expect(listing.status).toBe('draft');
    expect(listing.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(listing)).toBe(true);
    const again = await standardFixture();
    expect(again.listing.digest).toBe(listing.digest);
  });

  it('rejects listings without qualification proofs (unqualified cannot list)', async () => {
    const { profile, qualification } = await standardFixture();
    await expectRejects(
      () =>
        createExpertListing({
          listingId: 'listing-empty',
          tenant: TENANT,
          expertId: EXPERT,
          headline: 'x',
          description: 'x',
          profileRef: profile.digest,
          cardRef: qualification.card.digest,
          qualificationProofs: [],
          declaredAt: T.listingDeclared,
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING,
    );
  });

  it('rejects duplicate proofs for one claim (closed sets only)', async () => {
    const { profile, qualification } = await standardFixture();
    const proof = {
      claimRef: qualification.claim.digest,
      recordRef: qualification.record.digest,
    };
    await expectRejects(
      () =>
        createExpertListing({
          listingId: 'listing-dup',
          tenant: TENANT,
          expertId: EXPERT,
          headline: 'x',
          description: 'x',
          profileRef: profile.digest,
          cardRef: qualification.card.digest,
          qualificationProofs: [proof, proof],
          declaredAt: T.listingDeclared,
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING,
    );
  });

  it('rejects invalid identity/tenant/timestamp fields', async () => {
    const { profile, qualification } = await standardFixture();
    const base = {
      listingId: 'listing-x',
      expertId: EXPERT,
      headline: 'x',
      description: 'x',
      profileRef: profile.digest,
      cardRef: qualification.card.digest,
      qualificationProofs: [
        { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
      ],
      declaredAt: T.listingDeclared,
    };
    await expectRejects(
      () => createExpertListing({ ...base, tenant: 'Bad Tenant' } as never),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY,
    );
    await expectRejects(
      () => createExpertListing({ ...base, tenant: TENANT, declaredAt: '2026-09-04' }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TIMESTAMP,
    );
    await expectRejects(
      () => createExpertListing({ ...base, tenant: TENANT, profileRef: 'not-a-digest' }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_DIGEST,
    );
  });
});

describe('the A007 qualification publish gate', () => {
  it('passes for a published profile + in-force qualified record (positive)', async () => {
    const { listing, store } = await standardFixture();
    const report = await verifyListingGate(listing, T.publish, store);
    expect(report.profileStatus).toBe('published');
    expect(report.cardMatched).toBe(true);
    expect(report.proofs).toHaveLength(1);
    expect(report.proofs[0]?.inForce).toBe(true);
    expect(report.proofs[0]?.recordStatus).toBe('qualified');
  });

  it('rejects when NO expert profile is registered (fail-closed)', async () => {
    const { listing } = await standardFixture();
    await expectRejects(
      () => verifyListingGate(listing, T.publish, new MapExpertRecordStore()),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });

  it('rejects a DRAFT (unpublished) profile', async () => {
    const draftProfile = await fixtureProfile({ status: 'draft' });
    const qualification = await fixtureQualification();
    const store = new MapExpertRecordStore()
      .addProfile(draftProfile)
      .addQualification(qualification);
    const listing = await createExpertListing({
      listingId: 'listing-draft-profile',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'x',
      description: 'x',
      profileRef: draftProfile.digest,
      cardRef: qualification.card.digest,
      qualificationProofs: [
        { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
      ],
      declaredAt: T.listingDeclared,
    });
    await expectRejects(
      () => verifyListingGate(listing, T.publish, store),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });

  it('rejects an UNQUALIFIED record (weakened evidence)', async () => {
    const profile = await fixtureProfile();
    const qualification = await fixtureQualification({ weaken: true });
    expect(qualification.record.status).not.toBe('qualified');
    const store = new MapExpertRecordStore()
      .addProfile(profile)
      .addQualification(qualification);
    const listing = await createExpertListing({
      listingId: 'listing-unqualified',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'x',
      description: 'x',
      profileRef: profile.digest,
      cardRef: qualification.card.digest,
      qualificationProofs: [
        { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
      ],
      declaredAt: T.listingDeclared,
    });
    await expectRejects(
      () => verifyListingGate(listing, T.publish, store),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });

  it('rejects a LAPSED qualification (out of force at publish time)', async () => {
    const profile = await fixtureProfile();
    const qualification = await fixtureQualification({ lapse: true });
    const store = new MapExpertRecordStore()
      .addProfile(profile)
      .addQualification(qualification);
    const listing = await createExpertListing({
      listingId: 'listing-lapsed',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'x',
      description: 'x',
      profileRef: profile.digest,
      cardRef: qualification.card.digest,
      qualificationProofs: [
        { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
      ],
      declaredAt: T.listingDeclared,
    });
    await expectRejects(
      () => verifyListingGate(listing, T.publish, store),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });

  it('rejects a TAMPERED qualification record (digest mismatch)', async () => {
    const { listing, qualification, store } = await standardFixture();
    const tampered = {
      ...qualification.record,
      note: 'tampered after signing' as never,
    };
    store.addRecord(tampered);
    await expectRejects(
      () => verifyListingGate(listing, T.publish, store),
      MARKETPLACE_EXPERTS_ERROR_CODES.TAMPERED,
    );
  });

  it('rejects a proof belonging to a DIFFERENT expert (identity theft probe)', async () => {
    const profile = await fixtureProfile();
    const foreign = await fixtureQualification({ expertId: EXPERT_B });
    const store = new MapExpertRecordStore().addProfile(profile).addQualification(foreign);
    const listing = await createExpertListing({
      listingId: 'listing-stolen-proof',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'x',
      description: 'x',
      profileRef: profile.digest,
      cardRef: foreign.card.digest,
      qualificationProofs: [
        { claimRef: foreign.claim.digest, recordRef: foreign.record.digest },
      ],
      declaredAt: T.listingDeclared,
    });
    await expectRejects(
      () => verifyListingGate(listing, T.publish, store),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });
});

describe('pool registration discipline', () => {
  let pool: ExpertMarketplacePool;
  let fixture: Awaited<ReturnType<typeof standardFixture>>;

  beforeEach(async () => {
    pool = new ExpertMarketplacePool();
    fixture = await standardFixture();
  });

  it('registers listings idempotently by digest', () => {
    pool.registerListing(fixture.listing);
    pool.registerListing(fixture.listing);
    expect(pool.listListings()).toHaveLength(1);
  });

  it('rejects identity conflicts (same identity, different digest)', async () => {
    pool.registerListing(fixture.listing);
    const other = await createExpertListing({
      listingId: 'listing-ada-review',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'CHANGED headline - different digest',
      description: 'x',
      profileRef: fixture.profile.digest,
      cardRef: fixture.qualification.card.digest,
      qualificationProofs: [
        {
          claimRef: fixture.qualification.claim.digest,
          recordRef: fixture.qualification.record.digest,
        },
      ],
      declaredAt: T.listingDeclared,
    });
    expect(() => pool.registerListing(other)).toThrowError(MarketplaceExpertsError);
    try {
      pool.registerListing(other);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT,
      );
    }
  });

  it('rejects supersession of an UNREGISTERED listing', async () => {
    const superseding = await createExpertListing({
      listingId: 'listing-ada-review',
      tenant: TENANT,
      expertId: EXPERT,
      headline: 'v2',
      description: 'x',
      profileRef: fixture.profile.digest,
      cardRef: fixture.qualification.card.digest,
      qualificationProofs: [
        {
          claimRef: fixture.qualification.claim.digest,
          recordRef: fixture.qualification.record.digest,
        },
      ],
      supersedes: '0'.repeat(64),
      declaredAt: T.listingDeclared,
    });
    expect(() => pool.registerListing(superseding)).toThrowError(MarketplaceExpertsError);
  });

  it('applies listing transitions through the closed table with terminal finality', async () => {
    pool.registerListing(fixture.listing);
    const publish = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'publish',
      at: T.publish,
    });
    pool.registerListingStatusRecord(publish);
    expect(pool.currentListingStatus(fixture.listing.digest)).toBe('listed');

    const unlist = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'unlist',
      at: T.offerDeclared,
    });
    pool.registerListingStatusRecord(unlist);
    expect(pool.currentListingStatus(fixture.listing.digest)).toBe('unlisted');

    const relist = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'relist',
      at: T.publish,
    });
    pool.registerListingStatusRecord(relist);
    expect(pool.currentListingStatus(fixture.listing.digest)).toBe('listed');

    const delist = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'delist',
      at: T.complete,
    });
    pool.registerListingStatusRecord(delist);
    expect(pool.currentListingStatus(fixture.listing.digest)).toBe('delisted');

    // Terminal: any further transition fails.
    const after = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'relist',
      at: T.review,
    });
    expect(() => pool.registerListingStatusRecord(after)).toThrowError(
      MarketplaceExpertsError,
    );
    try {
      pool.registerListingStatusRecord(after);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION,
      );
    }
  });

  it('rejects unlist from draft (closed table)', async () => {
    pool.registerListing(fixture.listing);
    const unlist = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: TENANT,
      transition: 'unlist',
      at: T.publish,
    });
    expect(() => pool.registerListingStatusRecord(unlist)).toThrowError(
      MarketplaceExpertsError,
    );
  });

  it('rejects cross-tenant listing transitions (rule 11)', async () => {
    pool.registerListing(fixture.listing);
    const foreign = await createListingStatusRecord({
      listingRef: fixture.listing.digest,
      tenant: FOREIGN_TENANT,
      transition: 'publish',
      at: T.publish,
    });
    expect(() => pool.registerListingStatusRecord(foreign)).toThrowError(
      MarketplaceExpertsError,
    );
  });
});

describe('commercial offers', () => {
  let pool: ExpertMarketplacePool;
  let fixture: Awaited<ReturnType<typeof standardFixture>>;

  beforeEach(async () => {
    pool = new ExpertMarketplacePool();
    fixture = await standardFixture();
    pool.registerListing(fixture.listing);
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'publish',
        at: T.publish,
      }),
    );
  });

  const offerInput = {
    offerId: 'offer-review-session',
    tenant: TENANT,
    expertId: EXPERT,
    listingRef: '' as string,
    kind: 'code-review' as const,
    headline: 'One 60-minute Rust review session',
    rate: { currency: 'USD', amountMinor: 12_500, unit: 'per-session' as const },
    minNoticeHours: 24,
    maxDurationHours: 4,
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
    validFrom: T.offerFrom,
    validUntil: T.offerUntil,
    declaredAt: T.offerDeclared,
  };

  it('creates an active offer with deterministic digest', async () => {
    const offer = await createCommercialOffer({
      ...offerInput,
      listingRef: fixture.listing.digest,
    });
    expect(offer.status).toBe('active');
    expect(offer.digest).toMatch(/^[0-9a-f]{64}$/);
    pool.registerOffer(offer);
    expect(pool.offersForListing(fixture.listing.digest)).toHaveLength(1);
    expect(pool.activeOffersForListing(fixture.listing.digest, T.search)).toHaveLength(1);
  });

  it('rejects invalid commercial terms (adversarial)', async () => {
    const base = { ...offerInput, listingRef: fixture.listing.digest };
    await expectRejects(
      () => createCommercialOffer({ ...base, rate: { ...base.rate, amountMinor: -1 } }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () => createCommercialOffer({ ...base, rate: { ...base.rate, currency: 'usd' } }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () =>
        createCommercialOffer({
          ...base,
          rate: { ...base.rate, unit: 'per-fortnight' as never },
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () => createCommercialOffer({ ...base, maxDurationHours: 0 }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () => createCommercialOffer({ ...base, minNoticeHours: -5 }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () =>
        createCommercialOffer({
          ...base,
          validFrom: T.offerUntil,
          validUntil: T.offerFrom,
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
    await expectRejects(
      () =>
        createCommercialOffer({
          ...base,
          availability: [{ recurrence: 'daily', startUtc: '16:00', endUtc: '08:00' }],
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS,
    );
  });

  it('requires backingReleaseRef IFF kind is body-backed-service (closed discipline)', async () => {
    const base = { ...offerInput, listingRef: fixture.listing.digest };
    await expectRejects(
      () =>
        createCommercialOffer({
          ...base,
          kind: 'body-backed-service' as never,
        }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER,
    );
    await expectRejects(
      () => createCommercialOffer({ ...base, backingReleaseRef: D.release }),
      MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER,
    );
    const backed = await createCommercialOffer({
      ...base,
      kind: 'body-backed-service' as never,
      backingReleaseRef: D.release,
    });
    expect(backed.backingReleaseRef).toBe(D.release);
  });

  it('runs the body-backed gate: satisfied A023 evidence passes (positive)', async () => {
    const offer = await createCommercialOffer({
      ...offerInput,
      listingRef: fixture.listing.digest,
      kind: 'body-backed-service' as never,
      backingReleaseRef: D.release,
    });
    const report = await verifyOfferBackingGate(
      offer,
      new MapReleaseRecordStore().add(registeredRelease()),
      new MapCertificationRecordStore().add(satisfiedCertification()),
    );
    expect(report).not.toBeNull();
    expect(report?.certifications).toHaveLength(1);
    expect(report?.certifications[0]?.verdict).toBe('satisfied');
  });

  it('body-backed gate fails closed: unresolved release / non-registration / not-satisfied verdict', async () => {
    const offer = await createCommercialOffer({
      ...offerInput,
      listingRef: fixture.listing.digest,
      kind: 'body-backed-service' as never,
      backingReleaseRef: D.release,
    });
    // Unresolved release.
    await expectRejects(
      () =>
        verifyOfferBackingGate(
          offer,
          new MapReleaseRecordStore(),
          new MapCertificationRecordStore(),
        ),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
    // A retirement record, not a registration.
    await expectRejects(
      () =>
        verifyOfferBackingGate(
          offer,
          new MapReleaseRecordStore().add({
            digest: D.release,
            kind: 'release-retirement',
            channel: null,
            gate: null,
          }),
          new MapCertificationRecordStore(),
        ),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
    // Cited certification does not resolve.
    await expectRejects(
      () =>
        verifyOfferBackingGate(
          offer,
          new MapReleaseRecordStore().add(registeredRelease()),
          new MapCertificationRecordStore(),
        ),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
    // Cited certification carries a not-satisfied verdict.
    await expectRejects(
      () =>
        verifyOfferBackingGate(
          offer,
          new MapReleaseRecordStore().add(registeredRelease()),
          new MapCertificationRecordStore().add({
            digest: D.certification,
            verdict: 'not-satisfied',
            grantedLevel: null,
          }),
        ),
      MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
    );
  });

  it('withdraws offers with terminal finality', async () => {
    const offer = await createCommercialOffer({
      ...offerInput,
      listingRef: fixture.listing.digest,
    });
    pool.registerOffer(offer);
    const { createOfferStatusRecord } = await import('./offer.js');
    const withdrawal = await createOfferStatusRecord({
      offerRef: offer.digest,
      tenant: TENANT,
      transition: 'withdraw',
      at: T.complete,
    });
    pool.registerOfferStatusRecord(withdrawal);
    expect(pool.currentOfferStatus(offer.digest)).toBe('withdrawn');
    const second = await createOfferStatusRecord({
      offerRef: offer.digest,
      tenant: TENANT,
      transition: 'withdraw',
      at: T.review,
    });
    expect(() => pool.registerOfferStatusRecord(second)).toThrowError(
      MarketplaceExpertsError,
    );
  });

  it('rejects offers for unregistered listings', async () => {
    const offer = await createCommercialOffer({ ...offerInput, listingRef: 'f'.repeat(64) });
    expect(() => pool.registerOffer(offer)).toThrowError(MarketplaceExpertsError);
  });
});

describe('engagements', () => {
  let pool: ExpertMarketplacePool;
  let fixture: Awaited<ReturnType<typeof standardFixture>>;
  let offerDigest: string;

  beforeEach(async () => {
    pool = new ExpertMarketplacePool();
    fixture = await standardFixture();
    pool.registerListing(fixture.listing);
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'publish',
        at: T.publish,
      }),
    );
    const offer = await createCommercialOffer({
      offerId: 'offer-review-session',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: fixture.listing.digest,
      kind: 'code-review',
      headline: 'One 60-minute Rust review session',
      rate: { currency: 'USD', amountMinor: 12_500, unit: 'per-session' },
      minNoticeHours: 24,
      maxDurationHours: 48,
      availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
      validFrom: T.offerFrom,
      validUntil: T.offerUntil,
      declaredAt: T.offerDeclared,
    });
    pool.registerOffer(offer);
    offerDigest = offer.digest;
  });

  const engagementInput = {
    engagementId: 'engagement-0001',
    tenant: TENANT,
    listingRef: '' as string,
    offerRef: '' as string,
    expertId: EXPERT,
    customer: CUSTOMER,
    scopeNote: 'Review PR #42 for unsafe transmutes.',
    scheduledFor: T.engagementScheduled,
    requestedAt: T.engagementRequested,
  };

  it('records an engagement request (positive)', async () => {
    const engagement = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
    });
    pool.registerEngagement(engagement);
    expect(pool.currentEngagementStatus(engagement.digest)).toBe('requested');
  });

  it('DENIES cross-tenant engagements loudly (rule 11)', async () => {
    const engagement = await createEngagement({
      ...engagementInput,
      tenant: FOREIGN_TENANT,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
    });
    expect(() => pool.registerEngagement(engagement)).toThrowError(MarketplaceExpertsError);
    try {
      pool.registerEngagement(engagement);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION,
      );
    }
  });

  it('rejects engagements that violate notice/duration terms', async () => {
    // Notice: scheduled only 1 hour after request (offer requires 24).
    const tooSoon = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
      scheduledFor: '2026-09-06T10:00:00.000Z',
    });
    expect(() => pool.registerEngagement(tooSoon)).toThrowError(MarketplaceExpertsError);
    // Duration: scheduled beyond the offer max duration window.
    const tooLong = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
      scheduledFor: '2026-10-15T09:00:00.000Z',
    });
    expect(() => pool.registerEngagement(tooLong)).toThrowError(MarketplaceExpertsError);
  });

  it('rejects engagements against withdrawn or foreign-listing offers', async () => {
    const { createOfferStatusRecord } = await import('./offer.js');
    pool.registerOfferStatusRecord(
      await createOfferStatusRecord({
        offerRef: offerDigest,
        tenant: TENANT,
        transition: 'withdraw',
        at: T.engagementRequested,
      }),
    );
    const engagement = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
    });
    expect(() => pool.registerEngagement(engagement)).toThrowError(MarketplaceExpertsError);
  });

  it('walks the full lifecycle requested → accepted → completed with terminal finality', async () => {
    const engagement = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
    });
    pool.registerEngagement(engagement);
    const accept = await createEngagementTransition({
      engagementRef: engagement.digest,
      tenant: TENANT,
      transition: 'accept',
      at: T.accept,
    });
    pool.registerEngagementTransition(accept);
    expect(pool.currentEngagementStatus(engagement.digest)).toBe('accepted');
    const complete = await createEngagementTransition({
      engagementRef: engagement.digest,
      tenant: TENANT,
      transition: 'complete',
      at: T.complete,
    });
    pool.registerEngagementTransition(complete);
    expect(pool.currentEngagementStatus(engagement.digest)).toBe('completed');
    // Terminal: decline after complete fails.
    const late = await createEngagementTransition({
      engagementRef: engagement.digest,
      tenant: TENANT,
      transition: 'decline',
      at: T.review,
    });
    expect(() => pool.registerEngagementTransition(late)).toThrowError(
      MarketplaceExpertsError,
    );
    try {
      pool.registerEngagementTransition(late);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION,
      );
    }
  });

  it('rejects invalid transitions from the table (decline from accepted)', async () => {
    const engagement = await createEngagement({
      ...engagementInput,
      listingRef: fixture.listing.digest,
      offerRef: offerDigest,
    });
    pool.registerEngagement(engagement);
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagement.digest,
        tenant: TENANT,
        transition: 'accept',
        at: T.accept,
      }),
    );
    const decline = await createEngagementTransition({
      engagementRef: engagement.digest,
      tenant: TENANT,
      transition: 'decline',
      at: T.complete,
    });
    expect(() => pool.registerEngagementTransition(decline)).toThrowError(
      MarketplaceExpertsError,
    );
  });
});

describe('reviews', () => {
  let pool: ExpertMarketplacePool;
  let fixture: Awaited<ReturnType<typeof standardFixture>>;
  let engagementDigest: string;

  beforeEach(async () => {
    pool = new ExpertMarketplacePool();
    fixture = await standardFixture();
    pool.registerListing(fixture.listing);
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'publish',
        at: T.publish,
      }),
    );
    const offer = await createCommercialOffer({
      offerId: 'offer-review-session',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: fixture.listing.digest,
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
    pool.registerOffer(offer);
    const engagement = await createEngagement({
      engagementId: 'engagement-0001',
      tenant: TENANT,
      listingRef: fixture.listing.digest,
      offerRef: offer.digest,
      expertId: EXPERT,
      customer: CUSTOMER,
      scopeNote: 'Review PR #42.',
      scheduledFor: T.engagementScheduled,
      requestedAt: T.engagementRequested,
    });
    pool.registerEngagement(engagement);
    engagementDigest = engagement.digest;
  });

  const reviewInput = {
    reviewId: 'review-0001',
    tenant: TENANT,
    engagementRef: '' as string,
    listingRef: '' as string,
    expertId: EXPERT,
    customer: CUSTOMER,
    rating: 5,
    text: 'Outstanding review depth; caught two unsafe transmutes.',
    reviewedAt: T.review,
  };

  it('rejects reviews of NON-completed engagements (the review gate)', async () => {
    const review = await createReview({
      ...reviewInput,
      engagementRef: engagementDigest,
      listingRef: fixture.listing.digest,
    });
    expect(() => pool.registerReview(review)).toThrowError(MarketplaceExpertsError);
    try {
      pool.registerReview(review);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE,
      );
    }
  });

  it('accepts a review of a COMPLETED engagement; derives the verdict', async () => {
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'accept',
        at: T.accept,
      }),
    );
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'complete',
        at: T.complete,
      }),
    );
    const review = await createReview({
      ...reviewInput,
      engagementRef: engagementDigest,
      listingRef: fixture.listing.digest,
    });
    expect(review.verdict).toBe('positive');
    pool.registerReview(review);
    expect(pool.listingStats(fixture.listing.digest)).toEqual({
      engagements: 1,
      completed: 1,
      reviews: 1,
      averageRating: 5,
    });
  });

  it('rejects a SECOND, different review of the same engagement (one-per-engagement)', async () => {
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'accept',
        at: T.accept,
      }),
    );
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'complete',
        at: T.complete,
      }),
    );
    pool.registerReview(
      await createReview({
        ...reviewInput,
        engagementRef: engagementDigest,
        listingRef: fixture.listing.digest,
      }),
    );
    const second = await createReview({
      ...reviewInput,
      reviewId: 'review-0002',
      rating: 1,
      text: 'different review of the same engagement',
      engagementRef: engagementDigest,
      listingRef: fixture.listing.digest,
    });
    expect(() => pool.registerReview(second)).toThrowError(MarketplaceExpertsError);
    try {
      pool.registerReview(second);
    } catch (error) {
      expect((error as MarketplaceExpertsError).code).toBe(
        MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT,
      );
    }
  });

  it('rejects reviews by a NON-matching customer (impersonation probe)', async () => {
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'accept',
        at: T.accept,
      }),
    );
    pool.registerEngagementTransition(
      await createEngagementTransition({
        engagementRef: engagementDigest,
        tenant: TENANT,
        transition: 'complete',
        at: T.complete,
      }),
    );
    const impostor = await createReview({
      ...reviewInput,
      customer: 'customer-impostor',
      engagementRef: engagementDigest,
      listingRef: fixture.listing.digest,
    });
    expect(() => pool.registerReview(impostor)).toThrowError(MarketplaceExpertsError);
  });

  it('rejects ratings outside the closed vocabulary and derives verdicts', async () => {
    await expect(
      createReview({ ...reviewInput, engagementRef: 'a'.repeat(64), listingRef: 'b'.repeat(64), rating: 6 }),
    ).rejects.toThrowError(MarketplaceExpertsError);
    await expect(
      createReview({ ...reviewInput, engagementRef: 'a'.repeat(64), listingRef: 'b'.repeat(64), rating: 0 }),
    ).rejects.toThrowError(MarketplaceExpertsError);
    const negative = await createReview({
      ...reviewInput,
      rating: 1,
      engagementRef: 'a'.repeat(64),
      listingRef: 'b'.repeat(64),
    });
    expect(negative.verdict).toBe('negative');
    const neutral = await createReview({
      ...reviewInput,
      rating: 3,
      engagementRef: 'a'.repeat(64),
      listingRef: 'b'.repeat(64),
    });
    expect(neutral.verdict).toBe('neutral');
  });
});

describe('the search engine', () => {
  it('enforces tenant isolation FIRST (cross-tenant listings are invisible)', async () => {
    const pool = new ExpertMarketplacePool();
    const fixture = await standardFixture();
    pool.registerListing(fixture.listing);
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'publish',
        at: T.publish,
      }),
    );
    const engine = new ExpertMarketplaceEngine();
    const foreign = await engine.search(
      pool,
      createMarketplaceQuery({ tenant: FOREIGN_TENANT, evaluatedAt: T.search }),
    );
    expect(foreign.cards).toHaveLength(0);
    expect(foreign.totalMatches).toBe(0);
    const own = await engine.search(
      pool,
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search }),
      fixture.store,
    );
    expect(own.cards).toHaveLength(1);
    expect(own.cards[0]?.expertId).toBe(EXPERT);
    expect(own.cards[0]?.inForceProofs[0]?.inForce).toBe(true);
  });

  it('hides unlisted/delisted listings and applies filters + sorts', async () => {
    const pool = new ExpertMarketplacePool();
    const fixture = await standardFixture();
    pool.registerListing(fixture.listing);
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'publish',
        at: T.publish,
      }),
    );
    const offer = await createCommercialOffer({
      offerId: 'offer-review-session',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: fixture.listing.digest,
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
    pool.registerOffer(offer);
    const engine = new ExpertMarketplaceEngine();

    // Capability filter matches.
    const matched = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        capability: 'rust-code-review',
      }),
      fixture.store,
    );
    expect(matched.cards).toHaveLength(1);
    expect(matched.cards[0]?.cheapestRate?.amountMinor).toBe(12_500);

    // Capability filter mismatch hides the listing.
    const unmatched = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        capability: 'structural-load-analysis',
      }),
      fixture.store,
    );
    expect(unmatched.cards).toHaveLength(0);

    // Jurisdiction filter.
    const gh = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        jurisdiction: { country: 'GH' },
      }),
      fixture.store,
    );
    expect(gh.cards).toHaveLength(0);

    // Max-rate filter (fail-closed on currency mismatch).
    const underBudget = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        maxRateMinor: 20_000,
        currency: 'USD',
      }),
      fixture.store,
    );
    expect(underBudget.cards).toHaveLength(1);
    const overBudget = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        maxRateMinor: 5_000,
        currency: 'USD',
      }),
      fixture.store,
    );
    expect(overBudget.cards).toHaveLength(0);

    // minRating is fail-closed without reviews.
    const noReviews = await engine.search(
      pool,
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        minRating: 3,
      }),
      fixture.store,
    );
    expect(noReviews.cards).toHaveLength(0);

    // After delisting, the listing disappears from search.
    pool.registerListingStatusRecord(
      await createListingStatusRecord({
        listingRef: fixture.listing.digest,
        tenant: TENANT,
        transition: 'delist',
        at: T.complete,
      }),
    );
    const afterDelist = await engine.search(
      pool,
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search }),
      fixture.store,
    );
    expect(afterDelist.cards).toHaveLength(0);
  });

  it('truncates deterministically and validates query shape', async () => {
    const pool = new ExpertMarketplacePool();
    const engine = new ExpertMarketplaceEngine();
    const result = await engine.search(
      pool,
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search, limit: 1 }),
    );
    expect(result.truncated).toBe(false);
    expect(result.cards).toHaveLength(0);
    expect(() =>
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search, limit: 500 }),
    ).toThrowError(MarketplaceExpertsError);
    expect(() =>
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search, maxRateMinor: 100 }),
    ).toThrowError(MarketplaceExpertsError);
    expect(() =>
      createMarketplaceQuery({
        tenant: TENANT,
        evaluatedAt: T.search,
        sort: 'random' as never,
      }),
    ).toThrowError(MarketplaceExpertsError);
  });
});
