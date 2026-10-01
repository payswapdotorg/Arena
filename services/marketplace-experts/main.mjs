#!/usr/bin/env node
/**
 * Demo entry for the A031 reference expert-marketplace fabric.
 *
 * Drives ONE deterministic end-to-end scenario against the REAL sibling
 * packages: publish a listing through the REAL A007 qualification gate →
 * record a commercial offer → request + complete an engagement → review
 * it → search the marketplace → fail-closed negative probes.
 *
 * Run:  cd services/marketplace-experts && pnpm demo   (or: node main.mjs)
 *
 * The entry self-bootstraps `node --experimental-strip-types` and the
 * .js→.ts resolve hook (ts-source-hooks.mjs) so the REAL workspace
 * packages run straight from their TypeScript sources — zero new
 * dependencies (mirrors the A007 demo entry's bootstrap verbatim).
 */

if (
  !process.execArgv.some((arg) => arg.includes('strip-types')) &&
  process.env.ARENA_A031_DEMO !== 'respawned'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--',
      import.meta.filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, ARENA_A031_DEMO: 'respawned' } },
  );
  process.exit(result.status ?? 1);
}

const { register } = await import('node:module');
register('./ts-source-hooks.mjs', import.meta.url);

const registry = await import('@arena/expert-registry');
const qualification = await import('@arena/expert-qualification');
const marketplace = await import('./src/index.js');
const { toCorrelationId, toIdempotencyKey } = await import('@arena/protocol-core');

const log = (label, value) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

// --- 1. The expert-record store over REAL A006/A007 records ---
const profile = await registry.publishProfile(
  await registry.createExpertProfile({
    identity: { tenant: 'tenant-alpha', expertId: 'expert-ada' },
    identityRefs: [
      { kind: 'identity-attestation', digest: '4'.repeat(64), locator: 'urn:arena:demo:attestation:ada' },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: 'a'.repeat(64) },
        proficiency: 'proficient',
        proficiencyEvidence: [{ digest: '5'.repeat(64), description: 'Reviewed pull requests.' }],
      },
    ],
    qualifications: [],
    evidence: [{ digest: '5'.repeat(64), description: 'Reference review work product.' }],
    taskHistory: [],
    reliability: [],
    availability: { windows: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }] },
    domainScope: {
      domains: [{ kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: 'b'.repeat(64) }],
      jurisdictions: [{ country: 'US' }],
      limitations: [{ class: 'professional-scope', statement: 'Advisory code review only.' }],
    },
    privacyPolicy: {
      visibility: {
        identityRefs: 'tenant-internal', competencies: 'public', qualifications: 'public',
        evidence: 'tenant-internal', taskHistory: 'tenant-internal', reliability: 'tenant-internal',
        availability: 'public', domainScope: 'public',
      },
    },
    declaredBy: { type: 'user', tenant: 'tenant-alpha', principalId: 'expert-intake' },
    declaredAt: '2026-09-02T09:00:00.000Z',
  }),
  { at: '2026-09-02T10:00:00.000Z', actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'expert-intake' } },
);

const work1 = await qualification.createQualificationEvidence({
  kind: 'work-product-ref',
  observedAt: '2026-09-01T09:00:00.000Z',
  workProduct: { digest: '1'.repeat(64), description: 'reviewed pull request with notes' },
});
const work2 = await qualification.createQualificationEvidence({
  kind: 'work-product-ref',
  observedAt: '2026-09-01T09:00:00.000Z',
  workProduct: { digest: '2'.repeat(64), description: 'reviewed pull request with fixes' },
});
const verification = await qualification.createQualificationEvidence({
  kind: 'verification-ref',
  observedAt: '2026-09-01T09:00:00.000Z',
  verification: { recordDigest: '3'.repeat(64), outcome: 'pass' },
});
const policy = await qualification.createQualificationPolicy({
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
const claim = await qualification.createCompetencyClaim({
  expertId: 'expert-ada',
  tenant: 'tenant-alpha',
  capability: { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: 'a'.repeat(64) },
  proficiency: 'proficient',
  evidence: [work1.digest, work2.digest, verification.digest],
  declaredAt: '2026-09-02T09:00:00.000Z',
});
const record = await qualification.evaluateCompetencyClaim({
  claim, policy, evidence: [work1, work2, verification], evaluatedAt: '2026-09-03T09:00:00.000Z',
});
const card = await qualification.createQualifiedExpertCard({
  expertId: 'expert-ada',
  tenant: 'tenant-alpha',
  domainRefs: [{ kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: 'b'.repeat(64) }],
  jurisdictions: [{ country: 'US' }],
  availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
});

const store = {
  profiles: new Map([[profile.digest, profile]]),
  cards: new Map([[card.digest, card]]),
  claims: new Map([[claim.digest, claim]]),
  records: new Map([[record.digest, record]]),
  async getExpertProfile(d) { return this.profiles.get(d); },
  async getQualifiedExpertCard(d) { return this.cards.get(d); },
  async getCompetencyClaim(d) { return this.claims.get(d); },
  async getQualificationRecord(d) { return this.records.get(d); },
};

// --- 2. The marketplace fabric + the REAL publish gate ---
const fabric = new marketplace.ExpertMarketplaceFabric(undefined, { expertRecords: store });
const listing = await marketplace.createExpertListing({
  listingId: 'listing-ada-review',
  tenant: 'tenant-alpha',
  expertId: 'expert-ada',
  headline: 'Senior Rust code review, evidence-backed',
  description: 'Qualified code-review engagements grounded in verified work products.',
  profileRef: profile.digest,
  cardRef: card.digest,
  qualificationProofs: [{ claimRef: claim.digest, recordRef: record.digest }],
  capabilityRefs: [{ kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: 'a'.repeat(64) }],
  domainRefs: [{ kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: 'b'.repeat(64) }],
  jurisdictions: [{ country: 'US' }],
  declaredAt: '2026-09-04T09:00:00.000Z',
});
fabric.registerListing(listing);

const CORR = toCorrelationId('corr-a031-demo');
const published = await fabric.publishListing(
  { listingRef: listing.digest, at: '2026-09-05T09:00:00.000Z' },
  { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-publish') },
);
log('listing published through the A007 gate', {
  status: fabric.pool.currentListingStatus(listing.digest),
  gateProofs: published.gate.proofs.map((p) => ({ status: p.recordStatus, inForce: p.inForce, validUntil: p.validUntil })),
  eventSchema: published.event.schema,
});

// --- 3. Offer + engagement + review ---
const offer = await marketplace.createCommercialOffer({
  offerId: 'offer-review-session',
  tenant: 'tenant-alpha',
  expertId: 'expert-ada',
  listingRef: listing.digest,
  kind: 'code-review',
  headline: 'One 60-minute Rust review session',
  rate: { currency: 'USD', amountMinor: 12500, unit: 'per-session' },
  minNoticeHours: 24,
  maxDurationHours: 48,
  availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
  validFrom: '2026-09-04T10:00:00.000Z',
  validUntil: '2027-09-04T10:00:00.000Z',
  declaredAt: '2026-09-04T10:00:00.000Z',
});
await fabric.recordOffer({ offer }, { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-offer') });

const engagement = await marketplace.createEngagement({
  engagementId: 'engagement-0001',
  tenant: 'tenant-alpha',
  listingRef: listing.digest,
  offerRef: offer.digest,
  expertId: 'expert-ada',
  customer: 'customer-acme',
  scopeNote: 'Review PR #42 for unsafe transmutes.',
  scheduledFor: '2026-09-07T09:00:00.000Z',
  requestedAt: '2026-09-06T09:00:00.000Z',
});
await fabric.requestEngagement({ engagement }, { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-engage') });
await fabric.transitionEngagement(
  { engagementRef: engagement.digest, transition: 'accept', at: '2026-09-06T10:00:00.000Z' },
  { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-accept') },
);
await fabric.transitionEngagement(
  { engagementRef: engagement.digest, transition: 'complete', at: '2026-09-08T09:00:00.000Z' },
  { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-complete') },
);
const review = await marketplace.createReview({
  reviewId: 'review-0001',
  tenant: 'tenant-alpha',
  engagementRef: engagement.digest,
  listingRef: listing.digest,
  expertId: 'expert-ada',
  customer: 'customer-acme',
  rating: 5,
  text: 'Outstanding review depth; caught two unsafe transmutes.',
  reviewedAt: '2026-09-09T09:00:00.000Z',
});
await fabric.recordReview({ review }, { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-a031-review') });
log('engagement lifecycle + review', {
  status: fabric.pool.currentEngagementStatus(engagement.digest),
  rating: review.rating,
  derivedVerdict: review.verdict,
});

// --- 4. Search ---
const searched = await fabric.searchMarketplace(
  { tenant: 'tenant-alpha', evaluatedAt: '2026-09-10T09:00:00.000Z', sort: 'relevance' },
  { correlationId: CORR },
);
log('marketplace search', {
  totalMatches: searched.result.totalMatches,
  cards: searched.result.cards.map((c) => ({
    listingId: c.listingId,
    inForceProofs: c.inForceProofs.filter((p) => p.inForce).length,
    activeOffers: c.activeOffers.length,
    averageRating: c.stats.averageRating,
  })),
  querySchema: searched.query.schema,
  responseSchema: searched.response.schema,
});

// --- 5. Negative probes (fail-closed) ---
try {
  await fabric.searchMarketplace({ tenant: 'tenant-beta', evaluatedAt: '2026-09-10T09:00:00.000Z' }, { correlationId: CORR });
  console.log('\n=== tenant isolation probe: UNEXPECTED VISIBILITY ===');
} catch (error) {
  console.log(`\n=== tenant isolation probe: ${(error).constructor.name} ===`);
}
const bare = new marketplace.ExpertMarketplaceFabric();
bare.registerListing(listing);
try {
  await bare.publishListing(
    { listingRef: listing.digest, at: '2026-09-05T09:00:00.000Z' },
    { correlationId: CORR, idempotencyKey: toIdempotencyKey('idem-bare') },
  );
  console.log('=== fail-closed probe: UNEXPECTED PUBLISH ===');
} catch (error) {
  console.log(`=== fail-closed probe (absent store): ${error.code} ===`);
  console.log(`status stays: ${bare.pool.currentListingStatus(listing.digest)}`);
}

log('observability', fabric.describe());
console.log('\n=== A031 demo complete (deterministic) ===');
