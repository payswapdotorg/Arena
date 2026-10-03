/**
 * The seeded marketplace corpus for the product marketplace UX (Work Order
 * B013; issue #88; apps/web/src/marketplace/corpus.ts). SERVER-ONLY.
 *
 * This ABSORBS the console-era corpus recipes (the A017/A018
 * `marketplace/{artifacts,experts}/corpus.mjs` pattern) into the product
 * posture: ONE TypeScript builder, parameterized by tenant, building the
 * corpus through the PUBLIC APIs of the domain packages —
 *
 *   - A031 experts: @arena/expert-registry (profile publish) +
 *     @arena/expert-qualification (the real A007 evidence chain) +
 *     services/marketplace-experts (listing published through the REAL
 *     qualification gate, offer, engagement, review, search);
 *   - A032 artifacts: services/marketplace-artifacts (offers admitted
 *     through the gate with provenance + verification evidence, grants +
 *     revocation through the license/data-rights paths, reviews) over
 *     @arena/artifact-protocol / @arena/provenance / @arena/verification;
 *   - A033 entitlements: @arena/entitlements grants (granted / revoked /
 *     expired / pending — the explicit state machine, deterministic).
 *
 * The corpus carries the RAW record views (provenance records, grant
 * records, entitlement grants) so the marketplace-ui view models project
 * them honestly — this module never interprets state, never prices, never
 * certifies.
 *
 * Determinism: every timestamp is a fixed UTC constant and the domain
 * packages' content addressing makes every digest reproducible
 * byte-for-byte. Two builds are identical. The corpus is deep-frozen.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched.
 */

import {
  createExpertProfile,
  publishProfile,
} from '../../../../packages/expert-registry/src/index.js';
import {
  createCompetencyClaim,
  createQualificationEvidence,
  createQualificationPolicy,
  createQualifiedExpertCard,
  evaluateCompetencyClaim,
} from '../../../../packages/expert-qualification/src/index.js';
import {
  createCommercialOffer,
  createEngagement,
  createExpertListing,
  createReview,
  ExpertMarketplaceFabric,
} from '../../../../services/marketplace-experts/src/index.js';
import { createMarketplaceArtifactsService } from '../../../../services/marketplace-artifacts/src/index.js';
import type { MarketplaceOfferProfile } from '../../../../services/marketplace-artifacts/src/index.js';
import { createMaterialArtifact } from '../../../../packages/artifact-protocol/src/index.js';
import type { RightsMetadata } from '../../../../packages/artifact-protocol/src/index.js';
import {
  createProvenanceRecord,
  provenanceRecordDigest,
} from '../../../../packages/provenance/src/index.js';
import {
  createVerifierDescriptor,
  createVerificationRecord,
} from '../../../../packages/verification/src/index.js';
import {
  createFeatureFlagGrant,
  createQuotaGrant,
  createRateLimitGrant,
  revokeEntitlementGrant,
} from '../../../../packages/entitlements/src/index.js';
import type { EntitlementGrant } from '../../../../packages/entitlements/src/index.js';

/** The corpus contract version (structure marker). */
export const MARKETPLACE_CORPUS_VERSION = 1 as const;

/** The composition posture the corpus feeds ('session' | 'demo'). */
export type MarketplaceMode = 'session' | 'demo';

/** Fixed 64-hex digest fixtures (deterministic content-independent seeds). */
const hex = (seed: string): string =>
  seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '1');

const D = Object.freeze({
  capability: hex('a1b2c3d4e5'),
  domain: hex('b2c3d4e5f6'),
  work1: hex('1111111111'),
  work2: hex('2222222222'),
  verification: hex('3333333333'),
  attestation: hex('4444444444'),
  evidenceOne: hex('5555555555'),
});

/** The fixed expert-side timeline (UTC; mirrors the A031 console corpus). */
const ET = Object.freeze({
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

/** The fixed artifact-side timeline (UTC; mirrors the A032 console corpus). */
const AT = Object.freeze({
  t0: '2026-01-15T09:30:00.000Z',
  t1: '2026-01-15T09:30:01.000Z',
  t2: '2026-01-15T09:30:02.000Z',
  t3: '2026-01-15T09:30:03.000Z',
  t4: '2026-01-15T09:30:04.000Z',
  t5: '2026-01-15T09:30:05.000Z',
  t6: '2026-01-15T09:30:06.000Z',
});

/** The fixed entitlement-side timeline (around the evaluation time). */
const GT = Object.freeze({
  granted: '2026-09-04T09:00:00.000Z',
  expiry: '2026-09-15T09:00:00.000Z',
  revoked: '2026-09-05T09:00:00.000Z',
  pendingFrom: '2027-01-01T00:00:00.000Z',
});

/** The seeded expert-side ids. */
export const SEED_EXPERT_LISTING_ID = 'listing-ada-review' as const;
export const SEED_EXPERT_ID = 'expert-ada' as const;
export const SEED_ENGAGEMENT_ID = 'engagement-0001' as const;

/** The seeded artifact-side offer ids. */
export const SEED_DATASET_OFFER_ID = 'solder-defect-dataset' as const;
export const SEED_SUITE_OFFER_ID = 'solder-qa-criteria-suite' as const;
export const SEED_ENVIRONMENT_OFFER_ID = 'engineering-sandbox-environment' as const;

/** The rights postures (A002 RightsMetadata shapes, literal-typed). */
const RIGHTS_OPEN: RightsMetadata = Object.freeze({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
});
const RIGHTS_TENANT_ONLY: RightsMetadata = Object.freeze({
  license: 'Arena-Internal-1.0',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'none',
});
const RIGHTS_ENGAGEMENT: RightsMetadata = Object.freeze({
  license: 'Professional engagement terms',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'none',
  professionalLimitations: ['Advisory code review only.'],
});

/** The deep-frozen corpus the runtime composes view models over. */
export interface MarketplaceCorpus {
  readonly corpusVersion: typeof MARKETPLACE_CORPUS_VERSION;
  readonly tenant: string;
  readonly secondaryTenant: string;
  readonly mode: MarketplaceMode;
  readonly evaluatedAt: string;
  readonly generatedNote: string;
  /** Expert-service listing inputs (A031 card + qualification chain + terms). */
  readonly expertListings: readonly unknown[];
  readonly expertEngagements: readonly unknown[];
  /** Artifact listing inputs (A032 profile + provenance + grants + reviews). */
  readonly artifactListings: readonly unknown[];
  /** The A033 entitlement grants (granted / revoked / expired / pending). */
  readonly entitlementGrants: readonly unknown[];
  readonly counts: Readonly<Record<string, number>>;
}

/** The corpus build input. */
export interface BuildMarketplaceCorpusInput {
  /** The primary tenant every seeded record lives in (the reading tenant). */
  readonly tenant: string;
  /** The secondary tenant owning the tenant-internal offer. */
  readonly secondaryTenant: string;
  /** The fixed evaluation time every state derives against. */
  readonly evaluatedAt: string;
  /** The composition posture the corpus feeds. */
  readonly mode: MarketplaceMode;
}

function deepFreeze(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The artifact-side evidence machinery (the A032 gate inputs)
// ---------------------------------------------------------------------------

async function makeEvidenceArtifact(
  index: number,
  namespace: string,
  name: string,
): Promise<Awaited<ReturnType<typeof createMaterialArtifact>>> {
  return createMaterialArtifact({
    identity: { namespace, name, version: '1.0.0' },
    refs: [],
    content: { kind: 'corpus-fixture', index, payload: `corpus fixture ${String(index)}` },
  });
}

async function makeVerifierFixture(): Promise<Awaited<ReturnType<typeof createVerifierDescriptor>>> {
  return createVerifierDescriptor({
    verifierId: 'corpus-marketplace-verifier',
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'requirement-001',
        evidenceKind: 'test-report',
        claim: 'the listing subject passes the marketplace admission constraints',
        artifact: null,
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'all admission constraints are satisfied',
      fail: 'at least one admission constraint is violated',
      unknown: 'the evidence was insufficient to decide',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'corpus-marketplace-verifier', submittedAt: AT.t0, notes: null },
  });
}

// ---------------------------------------------------------------------------
// The corpus build (through the packages' PUBLIC entry files)
// ---------------------------------------------------------------------------

/** The injected expert-record store over the built records (the A031 seam). */
class CorpusExpertStore {
  readonly profiles = new Map<string, Awaited<ReturnType<typeof createExpertProfile>>>();
  readonly cards = new Map<string, Awaited<ReturnType<typeof createQualifiedExpertCard>>>();
  readonly claims = new Map<string, Awaited<ReturnType<typeof createCompetencyClaim>>>();
  readonly records = new Map<
    string,
    Awaited<ReturnType<typeof evaluateCompetencyClaim>>
  >();

  async getExpertProfile(
    digest: string,
  ): Promise<Awaited<ReturnType<typeof createExpertProfile>> | undefined> {
    return this.profiles.get(digest);
  }
  async getQualifiedExpertCard(
    digest: string,
  ): Promise<Awaited<ReturnType<typeof createQualifiedExpertCard>> | undefined> {
    return this.cards.get(digest);
  }
  async getCompetencyClaim(
    digest: string,
  ): Promise<Awaited<ReturnType<typeof createCompetencyClaim>> | undefined> {
    return this.claims.get(digest);
  }
  async getQualificationRecord(
    digest: string,
  ): Promise<Awaited<ReturnType<typeof evaluateCompetencyClaim>> | undefined> {
    return this.records.get(digest);
  }
}

/** What one admitted artifact offer returns to the corpus projection. */
interface AdmittedOffer {
  readonly offerId: string;
  readonly offerDigest: string;
  readonly provenanceDigest: string;
  readonly verificationDigest: string;
  readonly verificationOutcome: string;
  readonly provenanceRecord: unknown;
}

/**
 * Build the deep-frozen, byte-deterministic marketplace corpus through the
 * REAL package public APIs (the absorbed console recipes, parameterized).
 */
export async function buildMarketplaceCorpus(
  input: BuildMarketplaceCorpusInput,
): Promise<MarketplaceCorpus> {
  const tenant = input.tenant;
  const secondaryTenant = input.secondaryTenant;
  const actor = Object.freeze({ type: 'user', tenant, principalId: 'marketplace-intake' });
  const CORR = 'corr-b013-corpus';
  const idem = (n: string): string => `idem-b013-${n}`;

  // --- A031: the expert-service listing (the real A006/A007/A031 path) ---
  const draft = await createExpertProfile({
    identity: { tenant, expertId: SEED_EXPERT_ID },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: D.attestation,
        locator: `urn:arena:${tenant}:attestation:ada-1`,
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: D.capability },
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
        validFrom: ET.evaluated,
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
    declaredBy: actor,
    declaredAt: ET.declared,
  });
  const profile = await publishProfile(draft, { at: ET.profilePublished, actor });

  const work1 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: ET.observed,
    workProduct: { digest: D.work1, description: 'reviewed pull request with notes' },
  });
  const work2 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: ET.observed,
    workProduct: { digest: D.work2, description: 'reviewed pull request with fixes' },
  });
  const verificationEvidence = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: ET.observed,
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
    tenant,
    capability: { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: D.capability },
    proficiency: 'proficient',
    evidence: [work1.digest, work2.digest, verificationEvidence.digest],
    declaredAt: ET.declared,
  });
  const qualificationRecord = await evaluateCompetencyClaim({
    claim,
    policy,
    evidence: [work1, work2, verificationEvidence],
    evaluatedAt: ET.evaluated,
  });
  const qualifiedCard = await createQualifiedExpertCard({
    expertId: SEED_EXPERT_ID,
    tenant,
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
    ],
    jurisdictions: [{ country: 'US' }],
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
  });

  const store = new CorpusExpertStore();
  store.profiles.set(profile.digest, profile);
  store.cards.set(qualifiedCard.digest, qualifiedCard);
  store.claims.set(claim.digest, claim);
  store.records.set(qualificationRecord.digest, qualificationRecord);

  const expertFabric = new ExpertMarketplaceFabric(undefined, { expertRecords: store });

  const listing = await createExpertListing({
    listingId: SEED_EXPERT_LISTING_ID,
    tenant,
    expertId: SEED_EXPERT_ID,
    headline: 'Senior Rust code review, evidence-backed',
    description: 'Qualified code-review engagements grounded in verified work products.',
    profileRef: profile.digest,
    cardRef: qualifiedCard.digest,
    qualificationProofs: [{ claimRef: claim.digest, recordRef: qualificationRecord.digest }],
    capabilityRefs: [
      { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: D.capability },
    ],
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
    ],
    jurisdictions: [{ country: 'US' }],
    declaredAt: ET.listingDeclared,
  });
  expertFabric.registerListing(listing);

  const published = await expertFabric.publishListing(
    { listingRef: listing.digest, at: ET.publish },
    { correlationId: CORR, idempotencyKey: idem('publish') },
  );
  if (published.record.transition !== 'publish' || !published.gate.proofs[0]?.inForce) {
    throw new Error('marketplace corpus: the A031 gate did not verify the seeded qualification');
  }

  const offer = await createCommercialOffer({
    offerId: 'offer-review-session',
    tenant,
    expertId: SEED_EXPERT_ID,
    listingRef: listing.digest,
    kind: 'code-review',
    headline: 'One 60-minute Rust review session',
    rate: { currency: 'USD', amountMinor: 12500, unit: 'per-session' },
    minNoticeHours: 24,
    maxDurationHours: 48,
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
    validFrom: ET.offerFrom,
    validUntil: ET.offerUntil,
    declaredAt: ET.offerDeclared,
  });
  await expertFabric.recordOffer({ offer }, { correlationId: CORR, idempotencyKey: idem('offer') });

  const engagement = await createEngagement({
    engagementId: SEED_ENGAGEMENT_ID,
    tenant,
    listingRef: listing.digest,
    offerRef: offer.digest,
    expertId: SEED_EXPERT_ID,
    customer: `customer-${tenant}`,
    scopeNote: 'Review PR #42 for unsafe transmutes.',
    scheduledFor: ET.engagementScheduled,
    requestedAt: ET.engagementRequested,
  });
  await expertFabric.requestEngagement(
    { engagement },
    { correlationId: CORR, idempotencyKey: idem('engage') },
  );
  await expertFabric.transitionEngagement(
    { engagementRef: engagement.digest, transition: 'accept', at: ET.accept },
    { correlationId: CORR, idempotencyKey: idem('accept') },
  );
  await expertFabric.transitionEngagement(
    { engagementRef: engagement.digest, transition: 'complete', at: ET.complete },
    { correlationId: CORR, idempotencyKey: idem('complete') },
  );
  const review = await createReview({
    reviewId: 'review-0001',
    tenant,
    engagementRef: engagement.digest,
    listingRef: listing.digest,
    expertId: SEED_EXPERT_ID,
    customer: `customer-${tenant}`,
    rating: 5,
    text: 'Outstanding review depth; caught two unsafe transmutes.',
    reviewedAt: ET.review,
  });
  await expertFabric.recordReview({ review }, { correlationId: CORR, idempotencyKey: idem('review') });

  const search = await expertFabric.searchMarketplace(
    { tenant, evaluatedAt: ET.search, sort: 'relevance' },
    { correlationId: CORR },
  );
  const listingCard = search.result.cards.find((entry) => entry.listingRef === listing.digest);
  if (listingCard === undefined) {
    throw new Error('marketplace corpus: seeded expert listing missing from search results');
  }

  const expertListingInput = deepFreeze({
    listingRef: listing.digest,
    listingId: listing.listingId,
    tenant: listing.tenant,
    expertId: listing.expertId,
    headline: listing.headline,
    description: listing.description,
    capabilities: listing.capabilityRefs.map((ref) => ref.id),
    domains: listing.domainRefs.map((ref) => ref.id),
    jurisdictions: listing.jurisdictions.map((entry) => entry.country),
    qualificationProofs: listingCard.inForceProofs.map((proof) => ({
      claimRef: proof.claimRef,
      recordRef: proof.recordRef,
      status: proof.recordStatus,
      inForce: proof.inForce,
      validUntil: proof.validUntil,
    })),
    offers: listingCard.activeOffers.map((active) => ({
      offerId: active.offerId,
      kind: active.kind,
      headline: active.headline,
      currency: active.rate.currency,
      amountMinor: active.rate.amountMinor,
      unit: active.rate.unit,
    })),
    engagements: listingCard.stats.engagements,
    completed: listingCard.stats.completed,
    reviews: listingCard.stats.reviews,
    averageRating: listingCard.stats.averageRating,
    publishedAt: listingCard.publishedAt,
    // The A007 qualification chain, projected as the listing's provenance input.
    qualificationRecord: {
      expertId: SEED_EXPERT_ID,
      tenant,
      capability: { kind: 'skill', id: 'rust-code-review', version: '2.1.0', digest: D.capability },
      evidence: [work1.digest, work2.digest, verificationEvidence.digest],
      evaluatedAt: ET.evaluated,
      claimRef: claim.digest,
    },
    // Engagement terms + professional limitations (the rights-posture input).
    rights: RIGHTS_ENGAGEMENT,
    evaluatedAt: input.evaluatedAt,
    mode: input.mode,
  });

  const engagementInput = deepFreeze({
    engagementId: engagement.engagementId,
    tenant: engagement.tenant,
    listingRef: engagement.listingRef,
    expertId: engagement.expertId,
    customer: engagement.customer,
    scopeNote: engagement.scopeNote,
    // The corpus drove the engagement to completion through the REAL
    // transitions (requested → accepted → completed); the status is the
    // terminal transition we applied, never a fabricated state.
    status: 'completed',
    review: { rating: review.rating, verdict: review.verdict, text: review.text },
  });

  // --- A032: the artifact listings (the real gate/license paths) ---
  const service = createMarketplaceArtifactsService();
  const artifactFabric = service.fabric;
  const descriptor = await makeVerifierFixture();
  const artifactGrantRecords: unknown[] = [];

  async function admitOffer(spec: {
    readonly offerId: string;
    readonly artifactKind: 'dataset' | 'evaluation-suite' | 'environment';
    readonly artifactName: string;
    readonly title: string;
    readonly summary: string;
    readonly publisherTenant: string;
    readonly publisherId: string;
    readonly rights: RightsMetadata;
    readonly visibility: 'public' | 'tenant-internal';
    readonly offeredAt: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly withLineage: boolean;
  }): Promise<AdmittedOffer> {
    const publisher = {
      type: 'service',
      tenant: spec.publisherTenant,
      principalId: spec.publisherId,
    };
    const artifact = await makeEvidenceArtifact(
      spec.offerId.length,
      spec.publisherTenant,
      spec.artifactName,
    );
    const artifactRef = {
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    };
    const source = spec.withLineage
      ? await makeEvidenceArtifact(99, spec.publisherTenant, 'corpus-source-images')
      : undefined;
    const sourceRef = source
      ? {
          namespace: source.identity.namespace,
          name: source.identity.name,
          version: source.identity.version,
          digest: source.digest,
        }
      : undefined;
    const transform = spec.withLineage
      ? await makeEvidenceArtifact(98, spec.publisherTenant, 'label-transform')
      : undefined;
    const transformRef = transform
      ? {
          namespace: transform.identity.namespace,
          name: transform.identity.name,
          version: transform.identity.version,
          digest: transform.digest,
        }
      : undefined;
    const provenanceRecord = createProvenanceRecord({
      artifact: artifactRef,
      creator: { type: 'expert', tenant: spec.publisherTenant, principalId: 'expert-001' },
      createdAt: AT.t0,
      recordedAt: AT.t0,
      parents: sourceRef ? [{ parent: sourceRef, relation: 'derived-from' }] : [],
      transformation: {
        transform: transformRef ?? artifactRef,
        inputs: sourceRef ? [sourceRef] : [],
      },
      rights: spec.rights,
      verification: [],
    });
    const verificationRecord = await createVerificationRecord(
      {
        verifierRef: descriptor.digest,
        evidence: [
          {
            evidenceKind: 'test-report',
            artifact: artifactRef,
            provenance: {
              producedBy: 'corpus-marketplace-verifier',
              producedAt: AT.t0,
              notes: null,
            },
          },
        ],
        evidenceSupport: [
          {
            requirementId: 'requirement-001',
            status: 'present-supported',
            evidenceDigest: artifactRef.digest,
            notes: null,
          },
        ],
        correlationId: `${spec.correlationId}-verification`,
        idempotencyKey: `${spec.idempotencyKey}-verification`,
        startedAt: AT.t0,
        finishedAt: AT.t1,
        provenance: { executedBy: 'corpus-marketplace-verifier', recordedAt: AT.t1, notes: null },
      },
      descriptor,
    );
    await artifactFabric.putProvenanceRecord(provenanceRecord);
    artifactFabric.putVerificationRecord(verificationRecord);
    const registration = await artifactFabric.registerOffer({
      candidate: {
        kind: 'offer-registration',
        offerId: spec.offerId,
        artifactKind: spec.artifactKind,
        artifact: artifactRef,
        title: spec.title,
        summary: spec.summary,
        publisher,
        rights: spec.rights,
        visibility: spec.visibility,
        offeredAt: spec.offeredAt,
        provenance: { offeredBy: publisher.principalId, recordedAt: spec.offeredAt, notes: null },
      },
      correlationId: spec.correlationId,
      idempotencyKey: spec.idempotencyKey,
      evidence: [
        { kind: 'provenance', digest: await provenanceRecordDigest(provenanceRecord) },
        { kind: 'verification', digest: verificationRecord.digest },
      ],
    });
    return {
      offerId: spec.offerId,
      offerDigest: registration.record.digest,
      provenanceDigest: await provenanceRecordDigest(provenanceRecord),
      verificationDigest: verificationRecord.digest,
      verificationOutcome: verificationRecord.outcome,
      provenanceRecord,
    };
  }

  const dataset = await admitOffer({
    offerId: SEED_DATASET_OFFER_ID,
    artifactKind: 'dataset',
    artifactName: 'solder-joint-defects',
    title: 'Solder joint defect dataset',
    summary: 'Labeled solder joint inspection imagery for capability evaluation.',
    publisherTenant: tenant,
    publisherId: 'publisher-a-001',
    rights: RIGHTS_OPEN,
    visibility: 'public',
    offeredAt: AT.t1,
    correlationId: 'corr-b013-offer-001',
    idempotencyKey: 'idem-b013-offer-001',
    withLineage: true,
  });
  const suite = await admitOffer({
    offerId: SEED_SUITE_OFFER_ID,
    artifactKind: 'evaluation-suite',
    artifactName: 'solder-qa-criteria',
    title: 'Solder QA evaluation criteria suite',
    summary: 'Weighted-sum criteria over defect detection recall floors.',
    publisherTenant: tenant,
    publisherId: 'publisher-a-001',
    rights: RIGHTS_OPEN,
    visibility: 'public',
    offeredAt: AT.t2,
    correlationId: 'corr-b013-offer-002',
    idempotencyKey: 'idem-b013-offer-002',
    withLineage: false,
  });
  const environment = await admitOffer({
    offerId: SEED_ENVIRONMENT_OFFER_ID,
    artifactKind: 'environment',
    artifactName: 'engineering-sandbox',
    title: 'Engineering sandbox environment',
    summary: 'Isolated deterministic engineering sandbox with evidence outputs.',
    publisherTenant: secondaryTenant,
    publisherId: 'publisher-b-001',
    rights: RIGHTS_TENANT_ONLY,
    visibility: 'tenant-internal',
    offeredAt: AT.t3,
    correlationId: 'corr-b013-offer-003',
    idempotencyKey: 'idem-b013-offer-003',
    withLineage: false,
  });

  // --- grants + reviews (through the real license/data-rights paths) ---
  const grantee = { type: 'user', tenant, principalId: 'user-a-001' };
  const granteeTwo = { type: 'user', tenant, principalId: 'user-a-002' };
  const grant1 = await artifactFabric.grantAccess({
    grantId: 'grant-b013-dataset-active',
    offerId: SEED_DATASET_OFFER_ID,
    grantee,
    permittedUse: 'evaluation',
    asOf: AT.t4,
    correlationId: 'corr-b013-grant-001',
    idempotencyKey: 'idem-b013-grant-001',
  });
  artifactGrantRecords.push(grant1.record);
  const grant2 = await artifactFabric.grantAccess({
    grantId: 'grant-b013-dataset-revoked',
    offerId: SEED_DATASET_OFFER_ID,
    grantee: granteeTwo,
    permittedUse: 'tenant-internal',
    asOf: AT.t4,
    correlationId: 'corr-b013-grant-002',
    idempotencyKey: 'idem-b013-grant-002',
  });
  artifactGrantRecords.push(grant2.record);
  const grant3 = await artifactFabric.grantAccess({
    grantId: 'grant-b013-dataset-expired',
    offerId: SEED_DATASET_OFFER_ID,
    grantee,
    permittedUse: 'evaluation',
    asOf: AT.t4,
    expiresAt: AT.t5,
    correlationId: 'corr-b013-grant-003',
    idempotencyKey: 'idem-b013-grant-003',
  });
  artifactGrantRecords.push(grant3.record);

  const recordedReviews: unknown[] = [];
  const review1 = await artifactFabric.submitReview({
    reviewId: 'review-b013-dataset-001',
    offerId: SEED_DATASET_OFFER_ID,
    reviewer: grantee,
    rating: 5,
    verdict: 'recommend',
    body: 'The dataset is well-labeled and the provenance chain is auditable.',
    submittedAt: AT.t5,
    correlationId: 'corr-b013-review-001',
    idempotencyKey: 'idem-b013-review-001',
  });
  recordedReviews.push(review1.record);
  const review2 = await artifactFabric.submitReview({
    reviewId: 'review-b013-dataset-002',
    offerId: SEED_DATASET_OFFER_ID,
    reviewer: granteeTwo,
    rating: 4,
    verdict: 'mixed',
    body: 'Solid coverage; some split balance needs review.',
    submittedAt: AT.t5,
    correlationId: 'corr-b013-review-002',
    idempotencyKey: 'idem-b013-review-002',
  });
  recordedReviews.push(review2.record);

  // The revocation lands AFTER the reviews (grant-gated submissions): the
  // append-only ledger records WHY, and the revocation is terminal.
  const revocation = await artifactFabric.revokeGrant({
    grantId: 'grant-b013-dataset-revoked',
    grounds: 'licence review: terms breached',
    revoker: { type: 'service', tenant, principalId: 'publisher-a-001' },
    revokedAt: AT.t6,
    correlationId: 'corr-b013-revoke-001',
    idempotencyKey: 'idem-b013-revoke-001',
  });
  artifactGrantRecords.push(revocation.record);

  // --- project the artifact listings through the service QUERY surface ---
  const grantsByOffer = new Map<string, unknown[]>();
  for (const record of artifactGrantRecords) {
    const grantData = record as {
      readonly offer: { readonly offerId: string };
    };
    const list = grantsByOffer.get(grantData.offer.offerId) ?? [];
    list.push(record);
    grantsByOffer.set(grantData.offer.offerId, list);
  }

  const partials = [
    { admitted: dataset, visibility: 'public', tenant, rights: RIGHTS_OPEN },
    { admitted: suite, visibility: 'public', tenant, rights: RIGHTS_OPEN },
    { admitted: environment, visibility: 'tenant-internal', tenant: secondaryTenant, rights: RIGHTS_TENANT_ONLY },
  ] as const;

  const artifactListings: unknown[] = [];
  for (const partial of partials) {
    const offerResponse = await artifactFabric.handleQueryRequest({
      requestVersion: 1,
      kind: 'get-offer',
      params: { offerId: partial.admitted.offerId },
      scope: { tenant: partial.tenant },
    });
    const offerProfile = offerResponse.result as MarketplaceOfferProfile | null;
    if (
      offerProfile === null ||
      offerProfile.registration === null ||
      offerProfile.registration.artifact === null
    ) {
      throw new Error(
        `marketplace corpus: offer ${JSON.stringify(partial.admitted.offerId)} lost its registration`,
      );
    }
    const registration = offerProfile.registration;
    const registrationArtifact = registration.artifact;
    if (registrationArtifact === null) {
      throw new Error(
        `marketplace corpus: offer ${JSON.stringify(partial.admitted.offerId)} lost its artifact ref`,
      );
    }
    let listingReviews: readonly unknown[] = [];
    try {
      const reviewsResponse = await artifactFabric.handleQueryRequest({
        requestVersion: 1,
        kind: 'list-reviews',
        params: { offerId: partial.admitted.offerId },
        scope: { tenant: partial.tenant },
      });
      listingReviews = reviewsResponse.result as unknown as readonly unknown[];
    } catch {
      // offers without reviews answer with an empty list
    }
    artifactListings.push(
      deepFreeze({
        offerId: partial.admitted.offerId,
        title: registration.title,
        summary: registration.summary,
        artifactKind: partial.admitted.offerId === SEED_DATASET_OFFER_ID
          ? 'dataset'
          : partial.admitted.offerId === SEED_SUITE_OFFER_ID
            ? 'evaluation-suite'
            : 'environment',
        visibility: partial.visibility,
        tenant: partial.tenant,
        state: offerProfile.state,
        offerDigest: partial.admitted.offerDigest,
        artifactIdentity: `${registrationArtifact.namespace}/${registrationArtifact.name}@${registrationArtifact.version}#${registrationArtifact.digest}`,
        rights: partial.rights,
        evidence: [
          { kind: 'provenance', digest: partial.admitted.provenanceDigest, outcome: null },
          {
            kind: 'verification',
            digest: partial.admitted.verificationDigest,
            outcome: partial.admitted.verificationOutcome,
          },
        ],
        provenanceRecord: partial.admitted.provenanceRecord,
        grants: grantsByOffer.get(partial.admitted.offerId) ?? [],
        reviews: listingReviews.map((entry) => {
          const reviewData = entry as {
            readonly rating: number;
            readonly verdict: string;
            readonly body: string;
            readonly reviewerTenant: string;
            readonly reviewer: { readonly principalId: string };
          };
          return {
            rating: reviewData.rating,
            verdict: reviewData.verdict,
            body: reviewData.body,
            reviewerTenant: reviewData.reviewerTenant,
            reviewerId: reviewData.reviewer.principalId,
          };
        }),
        reviewCount: offerProfile.reviewCount,
        averageRating: offerProfile.averageRating,
        evaluatedAt: input.evaluatedAt,
        mode: input.mode,
      }),
    );
  }

  // --- A033: the entitlement grants (the explicit state machine) ---
  const quotaGranted = createQuotaGrant({
    grantId: 'grant-b013-quota-active',
    tenantId: tenant,
    featureKey: 'marketplace.artifact-access',
    issuedAt: GT.granted,
    validFrom: GT.granted,
    limit: 100,
    window: 'day',
  });
  const flagDraft = createFeatureFlagGrant({
    grantId: 'grant-b013-flag-revoked',
    tenantId: tenant,
    featureKey: 'marketplace.purchase-intent',
    issuedAt: GT.granted,
    validFrom: GT.granted,
    enabled: true,
  });
  const flagRevoked = revokeEntitlementGrant(flagDraft, GT.revoked, 'policy violation — terminal');
  const rateExpired = createRateLimitGrant({
    grantId: 'grant-b013-rate-expired',
    tenantId: tenant,
    featureKey: 'marketplace.download-rate',
    issuedAt: GT.granted,
    validFrom: GT.granted,
    expiresAt: GT.expiry,
    limit: 10,
    durationSeconds: 60,
  });
  const quotaPending = createQuotaGrant({
    grantId: 'grant-b013-quota-pending',
    tenantId: tenant,
    featureKey: 'marketplace.artifact-access',
    issuedAt: GT.granted,
    validFrom: GT.pendingFrom,
    limit: 5,
    window: 'day',
  });
  const entitlementGrants: readonly EntitlementGrant[] = [
    quotaGranted,
    flagRevoked,
    rateExpired,
    quotaPending,
  ];

  return deepFreeze({
    corpusVersion: MARKETPLACE_CORPUS_VERSION,
    tenant,
    secondaryTenant,
    mode: input.mode,
    evaluatedAt: input.evaluatedAt,
    generatedNote:
      'seeded deterministic marketplace corpus (B013) — built through the A031/A032/A033 public APIs',
    expertListings: Object.freeze([expertListingInput]),
    expertEngagements: Object.freeze([engagementInput]),
    artifactListings: Object.freeze(artifactListings),
    entitlementGrants: Object.freeze([...entitlementGrants]),
    counts: Object.freeze({
      expertListings: 1,
      artifactOffers: partials.length,
      grants: artifactGrantRecords.length,
      reviews: recordedReviews.length,
      entitlementGrants: entitlementGrants.length,
    }),
  }) as MarketplaceCorpus;
}
