/**
 * The seeded reference corpus for the Arena expert marketplace surface
 * (Work Order A031) — JavaScript edition (the A017/A018 corpus pattern).
 *
 * WHY .mjs: @arena/web's manifest is frozen (it declares only
 * @arena/protocol-core) while this module must instantiate the sibling
 * domain packages (@arena/expert-registry, @arena/expert-qualification)
 * and the A031 marketplace fabric. The app-level tsconfig builds every
 * non-test .ts under src/ with rootDir=src, so the corpus builder ships
 * as plain JavaScript (ESM, Node built-ins + workspace sources only),
 * loaded by main.mjs after the .js→.ts resolution shim is registered
 * and typed at the test boundary via corpus.d.mts.
 *
 * WHAT IT BUILDS (all through the packages' PUBLIC entry files):
 *   - 1 published A006 expert profile;
 *   - 1 qualified A007 fixture (2 work products + 1 passing verification
 *     → a QUALIFIED record in force) + a qualified-expert card;
 *   - the A031 marketplace fabric with the listing PUBLISHED through the
 *     REAL qualification gate, one commercial offer recorded, one
 *     engagement walked requested → accepted → completed, one review.
 *
 * Determinism: every timestamp is a fixed constant and every digest
 * fixture is a fixed 64-hex string — building the corpus twice yields
 * byte-identical records.
 */

import {
  createExpertProfile,
  publishProfile,
} from '../../../../../packages/expert-registry/src/index.ts';
import {
  createCompetencyClaim,
  createQualificationEvidence,
  createQualificationPolicy,
  createQualifiedExpertCard,
  evaluateCompetencyClaim,
} from '../../../../../packages/expert-qualification/src/index.ts';
import {
  createCommercialOffer,
  createEngagement,
  createExpertListing,
  createReview,
  ExpertMarketplaceFabric,
} from '../../../../../services/marketplace-experts/src/index.ts';

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT = 'demo';

/** The seeded expert id. */
export const SEED_EXPERT_ID = 'expert-ada';

/** The seeded ids (route addresses). */
export const SEED_LISTING_ID = 'listing-ada-review';
export const SEED_ENGAGEMENT_ID = 'engagement-0001';

/** Fixed 64-hex digest fixtures. */
const hex = (seed) => seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '1');
const D = Object.freeze({
  capability: hex('a1b2c3d4e5'),
  domain: hex('b2c3d4e5f6'),
  work1: hex('1111111111'),
  work2: hex('2222222222'),
  verification: hex('3333333333'),
  attestation: hex('4444444444'),
  evidenceOne: hex('5555555555'),
});

/** The fixed timeline (UTC). */
const T = Object.freeze({
  observed: '2026-09-01T09:00:00.000Z',
  declared: '2026-09-02T09:00:00.000Z',
  evaluated: '2026-09-03T09:00:00.000Z',
  profilePublished: '2026-09-02T10:00:00.000Z',
  listingDeclared: '2026-09-04T09:00:00.000Z',
  publish: '2026-09-05T09:00:00.000Z',
  offerDeclared: '2026-09-04T10:00:00.000Z',
  offerFrom: '2026-09-04T10:00:00.000Z',
  offerUntil: '2027-09-04T10:00:00.000Z',
  engagementRequested: '2026-09-06T09:00:00.000Z',
  engagementScheduled: '2026-09-07T09:00:00.000Z',
  accept: '2026-09-06T10:00:00.000Z',
  complete: '2026-09-08T09:00:00.000Z',
  review: '2026-09-09T09:00:00.000Z',
  search: '2026-09-10T09:00:00.000Z',
});

const ACTOR = Object.freeze({
  type: 'user',
  tenant: SEED_TENANT,
  principalId: 'expert-intake',
});

const CORR = 'corr-a031-corpus';
const idem = (n) => `idem-a031-${n}`;

/** The injected expert-record store over the built records. */
class CorpusExpertStore {
  constructor() {
    this.profiles = new Map();
    this.cards = new Map();
    this.claims = new Map();
    this.records = new Map();
  }
  async getExpertProfile(digest) {
    return this.profiles.get(digest);
  }
  async getQualifiedExpertCard(digest) {
    return this.cards.get(digest);
  }
  async getCompetencyClaim(digest) {
    return this.claims.get(digest);
  }
  async getQualificationRecord(digest) {
    return this.records.get(digest);
  }
}

/**
 * Build the deep-frozen, byte-deterministic seeded marketplace corpus
 * (the exact MarketplaceCorpus shape of router.ts).
 */
export async function buildMarketplaceCorpus() {
  // --- A006: the published expert profile ---
  const draft = await createExpertProfile({
    identity: { tenant: SEED_TENANT, expertId: SEED_EXPERT_ID },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: D.attestation,
        locator: 'urn:arena:demo:attestation:ada-1',
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'rust-code-review',
          version: '2.1.0',
          digest: D.capability,
        },
        proficiency: 'proficient',
        proficiencyEvidence: [
          { digest: D.evidenceOne, description: 'Reviewed pull requests with verification notes.' },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-rv-2026-0142',
          issuer: 'Open Certification Board',
        },
        evidence: [D.evidenceOne],
        status: 'verified',
        validFrom: T.evaluated,
        validUntil: '2027-12-31T09:00:00.000Z',
        jurisdiction: { country: 'US' },
      },
    ],
    evidence: [{ digest: D.evidenceOne, description: 'Reference review work product.' }],
    taskHistory: [],
    reliability: [],
    availability: { windows: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }] },
    domainScope: {
      domains: [
        { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
      ],
      jurisdictions: [{ country: 'US' }],
      limitations: [
        { class: 'professional-scope', statement: 'Advisory code review only.' },
      ],
    },
    privacyPolicy: {
      visibility: {
        identityRefs: 'tenant-internal',
        competencies: 'public',
        qualifications: 'public',
        evidence: 'tenant-internal',
        taskHistory: 'tenant-internal',
        reliability: 'tenant-internal',
        availability: 'public',
        domainScope: 'public',
      },
    },
    declaredBy: ACTOR,
    declaredAt: T.declared,
  });
  const profile = await publishProfile(draft, {
    at: T.profilePublished,
    actor: ACTOR,
  });

  // --- A007: the qualified-expert evidence chain ---
  const work1 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: T.observed,
    workProduct: { digest: D.work1, description: 'reviewed pull request with notes' },
  });
  const work2 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: T.observed,
    workProduct: { digest: D.work2, description: 'reviewed pull request with fixes' },
  });
  const verification = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: T.observed,
    verification: { recordDigest: D.verification, outcome: 'pass' },
  });
  const policy = await createQualificationPolicy({
    policyId: 'policy-review-qualified',
    version: '1.0.0',
    description: 'Two fresh work products plus one passing verification, valid 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  });
  const claim = await createCompetencyClaim({
    expertId: SEED_EXPERT_ID,
    tenant: SEED_TENANT,
    capability: {
      kind: 'skill',
      id: 'rust-code-review',
      version: '2.1.0',
      digest: D.capability,
    },
    proficiency: 'proficient',
    evidence: [work1.digest, work2.digest, verification.digest],
    declaredAt: T.declared,
  });
  const qualificationRecord = await evaluateCompetencyClaim({
    claim,
    policy,
    evidence: [work1, work2, verification],
    evaluatedAt: T.evaluated,
  });
  const card = await createQualifiedExpertCard({
    expertId: SEED_EXPERT_ID,
    tenant: SEED_TENANT,
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
    ],
    jurisdictions: [{ country: 'US' }],
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
  });

  const store = new CorpusExpertStore();
  store.profiles.set(profile.digest, profile);
  store.cards.set(card.digest, card);
  store.claims.set(claim.digest, claim);
  store.records.set(qualificationRecord.digest, qualificationRecord);

  // --- A031: the marketplace fabric (the REAL gates run here) ---
  const fabric = new ExpertMarketplaceFabric(undefined, { expertRecords: store });

  const listing = await createExpertListing({
    listingId: SEED_LISTING_ID,
    tenant: SEED_TENANT,
    expertId: SEED_EXPERT_ID,
    headline: 'Senior Rust code review, evidence-backed',
    description: 'Qualified code-review engagements grounded in verified work products.',
    profileRef: profile.digest,
    cardRef: card.digest,
    qualificationProofs: [
      { claimRef: claim.digest, recordRef: qualificationRecord.digest },
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

  // The REAL qualification gate verifies the A007 evidence at publish time.
  const published = await fabric.publishListing(
    { listingRef: listing.digest, at: T.publish },
    { correlationId: CORR, idempotencyKey: idem('publish') },
  );
  if (published.record.transition !== 'publish' || !published.gate.proofs[0].inForce) {
    throw new Error('corpus gate did not verify the seeded qualification evidence');
  }

  const offer = await createCommercialOffer({
    offerId: 'offer-review-session',
    tenant: SEED_TENANT,
    expertId: SEED_EXPERT_ID,
    listingRef: listing.digest,
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
  await fabric.recordOffer(
    { offer },
    { correlationId: CORR, idempotencyKey: idem('offer') },
  );

  const engagement = await createEngagement({
    engagementId: SEED_ENGAGEMENT_ID,
    tenant: SEED_TENANT,
    listingRef: listing.digest,
    offerRef: offer.digest,
    expertId: SEED_EXPERT_ID,
    customer: 'customer-acme',
    scopeNote: 'Review PR #42 for unsafe transmutes.',
    scheduledFor: T.engagementScheduled,
    requestedAt: T.engagementRequested,
  });
  await fabric.requestEngagement(
    { engagement },
    { correlationId: CORR, idempotencyKey: idem('engage') },
  );
  await fabric.transitionEngagement(
    { engagementRef: engagement.digest, transition: 'accept', at: T.accept },
    { correlationId: CORR, idempotencyKey: idem('accept') },
  );
  await fabric.transitionEngagement(
    { engagementRef: engagement.digest, transition: 'complete', at: T.complete },
    { correlationId: CORR, idempotencyKey: idem('complete') },
  );
  const review = await createReview({
    reviewId: 'review-0001',
    tenant: SEED_TENANT,
    engagementRef: engagement.digest,
    listingRef: listing.digest,
    expertId: SEED_EXPERT_ID,
    customer: 'customer-acme',
    rating: 5,
    text: 'Outstanding review depth; caught two unsafe transmutes.',
    reviewedAt: T.review,
  });
  await fabric.recordReview({ review }, { correlationId: CORR, idempotencyKey: idem('review') });

  // --- The frozen view-model the router renders ---
  const search = await fabric.searchMarketplace(
    { tenant: SEED_TENANT, evaluatedAt: T.search, sort: 'relevance' },
    { correlationId: CORR },
  );
  const listingCard = search.result.cards.find(
    (entry) => entry.listingRef === listing.digest,
  );
  if (listingCard === undefined) {
    throw new Error('seeded listing missing from the marketplace search result');
  }

  const listingView = Object.freeze({
    listingRef: listing.digest,
    listingId: listing.listingId,
    tenant: listing.tenant,
    expertId: listing.expertId,
    headline: listing.headline,
    description: listing.description,
    capabilities: Object.freeze(listing.capabilityRefs.map((ref) => ref.id)),
    domains: Object.freeze(listing.domainRefs.map((ref) => ref.id)),
    jurisdictions: Object.freeze(listing.jurisdictions.map((entry) => entry.country)),
    qualificationProofs: Object.freeze(
      listingCard.inForceProofs.map((proof) =>
        Object.freeze({
          claimRef: proof.claimRef,
          recordRef: proof.recordRef,
          status: proof.recordStatus,
          inForce: proof.inForce,
          validUntil: proof.validUntil,
        }),
      ),
    ),
    offers: Object.freeze(
      listingCard.activeOffers.map((active) =>
        Object.freeze({
          offerId: active.offerId,
          kind: active.kind,
          headline: active.headline,
          currency: active.rate.currency,
          amountMinor: active.rate.amountMinor,
          unit: active.rate.unit,
        }),
      ),
    ),
    engagements: listingCard.stats.engagements,
    completed: listingCard.stats.completed,
    reviews: listingCard.stats.reviews,
    averageRating: listingCard.stats.averageRating,
    publishedAt: listingCard.publishedAt,
  });

  const engagementView = Object.freeze({
    engagementId: engagement.engagementId,
    tenant: engagement.tenant,
    listingRef: engagement.listingRef,
    expertId: engagement.expertId,
    customer: engagement.customer,
    scopeNote: engagement.scopeNote,
    status: fabric.pool.currentEngagementStatus(engagement.digest),
    review: Object.freeze({
      rating: review.rating,
      verdict: review.verdict,
      text: review.text,
    }),
  });

  const deepFreeze = (value) => {
    if (typeof value === 'object' && value !== null) {
      for (const key of Object.getOwnPropertyNames(value)) {
        deepFreeze(value[key]);
      }
      Object.freeze(value);
    }
    return value;
  };

  return deepFreeze({
    tenant: SEED_TENANT,
    generatedNote: 'seeded deterministic reference corpus (A031)',
    listings: Object.freeze([listingView]),
    engagements: Object.freeze([engagementView]),
  });
}
