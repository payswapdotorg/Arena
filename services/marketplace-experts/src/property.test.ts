/**
 * The A031 property suite: deterministic construction (same input ⇒ same
 * digest, always), digest sensitivity (any field change ⇒ different
 * digest) and engine determinism (same pool + query ⇒ byte-identical
 * result).
 */

import { describe, expect, it } from 'vitest';
import { createExpertListing, createListingStatusRecord } from './listing.js';
import { createCommercialOffer } from './offer.js';
import { createEngagement, createEngagementTransition } from './engagement.js';
import { createReview } from './review.js';
import { ExpertMarketplacePool } from './pool.js';
import { ExpertMarketplaceEngine } from './engine.js';
import { createMarketplaceQuery } from './query.js';
import {
  CUSTOMER,
  EXPERT,
  T,
  TENANT,
  fixtureProfile,
  fixtureQualification,
} from './test-support.js';

describe('deterministic construction', () => {
  it('listing digests are stable across rebuilds and sensitive to content', async () => {
    const profile = await fixtureProfile();
    const qualification = await fixtureQualification();
    const base = {
      listingId: 'listing-prop',
      tenant: TENANT,
      expertId: EXPERT,
      profileRef: profile.digest,
      cardRef: qualification.card.digest,
      qualificationProofs: [
        { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
      ] as const,
      declaredAt: T.listingDeclared,
    };
    const a = await createExpertListing({ ...base, headline: 'A', description: 'd' });
    const b = await createExpertListing({ ...base, headline: 'A', description: 'd' });
    const c = await createExpertListing({ ...base, headline: 'B', description: 'd' });
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });

  it('offer/engagement/review/transition digests are stable and sensitive', async () => {
    const offerBase = {
      offerId: 'offer-prop',
      tenant: TENANT,
      expertId: EXPERT,
      listingRef: 'a'.repeat(64),
      kind: 'consulting-session' as const,
      headline: 'h',
      rate: { currency: 'USD', amountMinor: 1_000, unit: 'per-hour' as const },
      minNoticeHours: 1,
      maxDurationHours: 2,
      availability: [],
      validFrom: T.offerFrom,
      validUntil: T.offerUntil,
      declaredAt: T.offerDeclared,
    };
    const o1 = await createCommercialOffer(offerBase);
    const o2 = await createCommercialOffer(offerBase);
    const o3 = await createCommercialOffer({
      ...offerBase,
      rate: { ...offerBase.rate, amountMinor: 1_001 },
    });
    expect(o1.digest).toBe(o2.digest);
    expect(o1.digest).not.toBe(o3.digest);

    const e1 = await createEngagement({
      engagementId: 'engagement-prop',
      tenant: TENANT,
      listingRef: 'a'.repeat(64),
      offerRef: 'b'.repeat(64),
      expertId: EXPERT,
      customer: CUSTOMER,
      scopeNote: 's',
      scheduledFor: T.engagementScheduled,
      requestedAt: T.engagementRequested,
    });
    const e2 = await createEngagement({
      engagementId: 'engagement-prop',
      tenant: TENANT,
      listingRef: 'a'.repeat(64),
      offerRef: 'b'.repeat(64),
      expertId: EXPERT,
      customer: CUSTOMER,
      scopeNote: 's',
      scheduledFor: T.engagementScheduled,
      requestedAt: T.engagementRequested,
    });
    expect(e1.digest).toBe(e2.digest);

    const r1 = await createReview({
      reviewId: 'review-prop',
      tenant: TENANT,
      engagementRef: 'a'.repeat(64),
      listingRef: 'b'.repeat(64),
      expertId: EXPERT,
      customer: CUSTOMER,
      rating: 2,
      text: 't',
      reviewedAt: T.review,
    });
    const r2 = await createReview({
      reviewId: 'review-prop',
      tenant: TENANT,
      engagementRef: 'a'.repeat(64),
      listingRef: 'b'.repeat(64),
      expertId: EXPERT,
      customer: CUSTOMER,
      rating: 2,
      text: 't',
      reviewedAt: T.review,
    });
    expect(r1.digest).toBe(r2.digest);
    expect(r1.verdict).toBe('negative');

    const t1 = await createEngagementTransition({
      engagementRef: 'a'.repeat(64),
      tenant: TENANT,
      transition: 'accept',
      at: T.accept,
    });
    const t2 = await createEngagementTransition({
      engagementRef: 'a'.repeat(64),
      tenant: TENANT,
      transition: 'accept',
      at: T.accept,
    });
    expect(t1.digest).toBe(t2.digest);

    const s1 = await createListingStatusRecord({
      listingRef: 'a'.repeat(64),
      tenant: TENANT,
      transition: 'publish',
      at: T.publish,
    });
    const s2 = await createListingStatusRecord({
      listingRef: 'a'.repeat(64),
      tenant: TENANT,
      transition: 'publish',
      at: T.publish,
    });
    expect(s1.digest).toBe(s2.digest);
  });
});

describe('engine determinism', () => {
  it('the same pool + query always produce the identical result', async () => {
    const buildPool = async (): Promise<ExpertMarketplacePool> => {
      const pool = new ExpertMarketplacePool();
      const profile = await fixtureProfile();
      const qualification = await fixtureQualification();
      const listing = await createExpertListing({
        listingId: 'listing-prop',
        tenant: TENANT,
        expertId: EXPERT,
        headline: 'h',
        description: 'd',
        profileRef: profile.digest,
        cardRef: qualification.card.digest,
        qualificationProofs: [
          { claimRef: qualification.claim.digest, recordRef: qualification.record.digest },
        ],
        domainRefs: [
          { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: qualification.card.domainRefs[0]?.digest ?? '' },
        ],
        declaredAt: T.listingDeclared,
      });
      pool.registerListing(listing);
      pool.registerListingStatusRecord(
        await createListingStatusRecord({
          listingRef: listing.digest,
          tenant: TENANT,
          transition: 'publish',
          at: T.publish,
        }),
      );
      const offer = await createCommercialOffer({
        offerId: 'offer-prop',
        tenant: TENANT,
        expertId: EXPERT,
        listingRef: listing.digest,
        kind: 'code-review',
        headline: 'h',
        rate: { currency: 'USD', amountMinor: 1_000, unit: 'per-hour' },
        minNoticeHours: 1,
        maxDurationHours: 2,
        availability: [],
        validFrom: T.offerFrom,
        validUntil: T.offerUntil,
        declaredAt: T.offerDeclared,
      });
      pool.registerOffer(offer);
      return pool;
    };
    const engine = new ExpertMarketplaceEngine();
    const resultA = await engine.search(
      await buildPool(),
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search, sort: 'relevance' }),
    );
    const resultB = await engine.search(
      await buildPool(),
      createMarketplaceQuery({ tenant: TENANT, evaluatedAt: T.search, sort: 'relevance' }),
    );
    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
    expect(resultA.cards).toHaveLength(1);
    expect(resultA.cards[0]?.cheapestRate?.currency).toBe('USD');
    expect(resultA.cards[0]?.listingId).toBe('listing-prop');
    expect(resultA.cards[0]?.domainRefs[0]?.id).toBe('software-engineering');
  });
});
