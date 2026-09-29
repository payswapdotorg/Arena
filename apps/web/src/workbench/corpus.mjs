/**
 * The seeded reference corpus for the Arena Expert Workbench (Work
 * Order A017) — JavaScript edition, 1:1 mirroring the A018 console
 * corpus builder (apps/web/src/console/corpus.mjs).
 *
 * WHY .mjs (same reason as the console): @arena/web's manifest is
 * frozen (it declares only @arena/protocol-core) while this module must
 * instantiate SEVEN further workspace packages (@arena/workbench, five
 * domain packages and the expert-matching + job-orchestrator reference
 * services). The app-level tsconfig builds every non-test .ts under
 * src/ with rootDir=src, and TypeScript refuses to emit a compiled-in
 * module graph that reaches outside that root — so the corpus builder
 * ships as plain JavaScript (ESM, Node built-ins + workspace sources
 * only), loaded by main.mjs after the .js→.ts resolution shim is
 * registered and typed at the test boundary via corpus.d.mts.
 *
 * WHAT IT BUILDS (all through the domain packages' PUBLIC entry files
 * and the reference service fabrics):
 *
 *   - 2 expert registry profiles (A006) with different lifecycle states
 *     (published; published→suspended), admitted into an ExpertRegistry
 *     and read back through its tenant-scoped query API;
 *   - the full qualification + matching flow (A007) through the
 *     expert-matching REFERENCE FABRIC: evidence records, competency
 *     claims, a qualification policy, idempotent qualify-claim command
 *     runs (one qualified record, one stale record) and two match
 *     outcomes — one clean match and one partial/unmatched outcome
 *     carrying the closed-vocabulary unmatched reasons (R8);
 *   - 2 TaskSpecs + 2 compilation records (A008) through the task-spec
 *     public APIs;
 *   - 2 trajectory records (A011) with full digest-chained entry
 *     histories (one completed, one failed);
 *   - 3 durable jobs (A015) driven through the job-orchestrator
 *     REFERENCE FLOW (JobOrchestrator + ManualClock + InMemoryJobStore
 *     + InMemoryEventSink, injected deterministic envelope ids).
 *
 * DEGRADATION (R41): `buildWorkbenchCorpus({ expertSupply: 'down' })`
 * builds the SAME records but marks the expert supply unavailable — the
 * workbench then serves this exact state as LAST-KNOWN with its
 * degradation banner (no invented data).
 *
 * DETERMINISM: every timestamp is a fixed constant, every digest
 * fixture is a fixed 64-hex string, the orchestrator clock is a
 * ManualClock and envelope ids are injected — building the corpus twice
 * yields byte-identical records, so the golden HTML snapshots in the
 * test suites are stable.
 */

import {
  createExpertProfile,
  createExpertRegistry,
  listExperts,
  publishProfile,
  recordProfileState,
  registerExpert,
  suspendProfile,
} from '../../../../packages/expert-registry/src/index.ts';
import {
  createCompetencyClaim,
  createMatchRequest,
  createMatchingPolicy,
  createQualifiedExpertCard,
  createQualificationEvidence,
  createQualificationPolicy,
} from '../../../../packages/expert-qualification/src/index.ts';
import {
  createExpertMatchingFabric,
} from '../../../../services/expert-matching/src/index.ts';
import {
  createCompilationRecord,
  createTaskSpec,
} from '../../../../packages/task-spec/src/index.ts';
import {
  appendTrajectoryEntry,
  openTrajectory,
} from '../../../../packages/trajectory/src/index.ts';
import { createJobDefinition } from '../../../../packages/job-protocol/src/index.ts';
import {
  toCorrelationId,
  toIdempotencyKey,
} from '../../../../packages/protocol-core/src/index.ts';
import { freezeWorkbenchCorpus } from '../../../../packages/workbench/src/index.ts';
import {
  InMemoryEventSink,
  InMemoryJobStore,
  JobOrchestrator,
  ManualClock,
} from '../../../../services/job-orchestrator/src/index.ts';

// ---------------------------------------------------------------------------
// Deterministic seed constants (fixed — the corpus is byte-stable)
// ---------------------------------------------------------------------------

/** The demo tenant every seeded record lives in. */
export const SEED_TENANT = 'demo';

/** Fixed 64-hex digest fixtures used for content-addressed refs. */
export const SEED_DIGESTS = Object.freeze({
  capabilityReconciliation:
    'aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11',
  capabilityLoad:
    'bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22',
  domainPayable:
    'cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33',
  domainPerformance:
    'dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44',
  attestation:
    'ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55ee55',
  evidenceOne:
    '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
  evidenceTwo:
    '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff',
  evidenceThree:
    '2121212121212121212121212121212121212121212121212121212121212121',
  workOne:
    '3232323232323232323232323232323232323232323232323232323232323232',
  workTwo:
    '4343434343434343434343434343434343434343434343434343434343434343',
  verificationPass:
    '5454545454545454545454545454545454545454545454545454545454545454',
  staleWorkOne:
    '6565656565656565656565656565656565656565656565656565656565656565',
  staleWorkTwo:
    '7676767676767676767676767676767676767676767676767676767676767676',
  staleVerification:
    '8787878787878787878787878787878787878787878787878787878787878787',
  evaluatorDescriptor:
    '9898989898989898989898989898989898989898989898989898989898989898',
  verifierDescriptor:
    'a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9',
  environmentSandbox:
    'babababababababababababababababababababababababababababababababa',
  policyDigest:
    'cbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcb',
  caseReview:
    'dcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdc',
  caseLatency:
    'edededededededededededededededededededededededededededededededed',
  snapshotInitial:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  agentBody:
    'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
  substrate:
    'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
  snapshotCheckpoint:
    'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3',
});

/** Fixed timeline (UTC) — every event in the corpus happens on it. */
export const SEED_TIMELINE = Object.freeze({
  profileDeclared: '2026-09-28T09:00:00.000Z',
  profilePublished: '2026-09-28T10:00:00.000Z',
  profileSuspended: '2026-09-29T09:00:00.000Z',
  evidenceObservedFresh: '2026-10-01T09:00:00.000Z',
  evidenceObservedStale: '2024-10-01T09:00:00.000Z',
  claimDeclared: '2026-10-02T09:00:00.000Z',
  qualificationEvaluated: '2026-10-05T09:00:00.000Z',
  matchEvaluated: '2026-10-05T09:30:00.000Z',
  taskCompiled: '2026-10-04T09:00:00.000Z',
  trajectoryOneStarted: '2026-10-06T09:00:00.000Z',
  trajectoryOneAction: '2026-10-06T09:05:00.000Z',
  trajectoryOneCheckpoint: '2026-10-06T09:40:00.000Z',
  trajectoryOneCompleted: '2026-10-06T10:00:00.000Z',
  trajectoryTwoStarted: '2026-10-06T11:00:00.000Z',
  trajectoryTwoAction: '2026-10-06T11:05:00.000Z',
  trajectoryTwoFailed: '2026-10-06T11:55:00.000Z',
  jobClockStart: '2026-10-07T09:00:00.000Z',
});

/** The seeded expert ids (registry order after listExperts sorting). */
export const SEED_EXPERT_IDS = Object.freeze(['expert-ada', 'expert-kwame']);

/** The seeded trajectory ids (the detail route's addressable ids). */
export const SEED_TRAJECTORY_IDS = Object.freeze([
  'traj-erp-close-0001',
  'traj-load-replay-0002',
]);

/** The seeded job ids, in store insertion order. */
export const SEED_JOB_IDS = Object.freeze([
  'job-match-experts-0001',
  'job-compile-spec-0001',
  'job-match-experts-0002',
]);

/** When the last-known snapshot was captured (the degraded-mode marker). */
export const SEED_LAST_KNOWN_AT = '2026-10-07T12:00:00.000Z';

const ACTOR_OPS = Object.freeze({
  type: 'user',
  tenant: SEED_TENANT,
  principalId: 'workbench-seed-ops',
});

const ACTOR_ORCHESTRATOR = Object.freeze({
  type: 'service',
  tenant: SEED_TENANT,
  principalId: 'workbench-seed',
});

// ---------------------------------------------------------------------------
// Expert registry (A006): 2 profiles, different lifecycle states
// ---------------------------------------------------------------------------

async function seedExpertRegistry() {
  let registry = createExpertRegistry();

  // Expert A: the reconciliation specialist — DRAFT → PUBLISHED.
  const adaDraft = await createExpertProfile({
    identity: { tenant: SEED_TENANT, expertId: 'expert-ada' },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: SEED_DIGESTS.attestation,
        locator: 'urn:arena:demo:attestation:ada-1',
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'invoice-reconciliation',
          version: '1.2.0',
          digest: SEED_DIGESTS.capabilityReconciliation,
        },
        proficiency: 'distinguished',
        proficiencyEvidence: [
          {
            digest: SEED_DIGESTS.evidenceOne,
            description: 'Two years of month-end close reconciliation records.',
          },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-ap-2026-0142',
          issuer: 'Open Certification Board',
        },
        evidence: [SEED_DIGESTS.evidenceOne],
        status: 'verified',
        validFrom: SEED_TIMELINE.qualificationEvaluated,
        validUntil: '2027-10-05T09:00:00.000Z',
        jurisdiction: { country: 'GH' },
      },
    ],
    evidence: [
      {
        digest: SEED_DIGESTS.evidenceOne,
        description: 'Reference close-set reconciliation work product.',
      },
    ],
    taskHistory: [
      {
        kind: 'task-outcome',
        tenant: SEED_TENANT,
        taskId: 'task-reconcile-invoices',
        version: '1.0.0',
        digest: SEED_DIGESTS.evidenceTwo,
        occurredAt: SEED_TIMELINE.evidenceObservedFresh,
      },
    ],
    reliability: [
      {
        sequence: 1,
        kind: 'task-completed',
        occurredAt: SEED_TIMELINE.evidenceObservedFresh,
        recordedBy: ACTOR_OPS,
      },
      {
        sequence: 2,
        kind: 'task-completed',
        occurredAt: SEED_TIMELINE.claimDeclared,
        recordedBy: ACTOR_OPS,
      },
      {
        sequence: 3,
        kind: 'task-failed',
        occurredAt: SEED_TIMELINE.qualificationEvaluated,
        recordedBy: ACTOR_OPS,
      },
    ],
    availability: {
      windows: [{ recurrence: 'daily', startUtc: '09:00', endUtc: '17:00' }],
      note: 'Business hours; same-day response.',
    },
    domainScope: {
      domains: [
        {
          kind: 'domain',
          id: 'accounts-payable',
          version: '1.0.0',
          digest: SEED_DIGESTS.domainPayable,
        },
      ],
      jurisdictions: [{ country: 'GH' }],
      limitations: [
        {
          class: 'professional-scope',
          statement: 'Advisory reconciliation only; no regulatory filing.',
        },
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
    declaredBy: ACTOR_OPS,
    declaredAt: SEED_TIMELINE.profileDeclared,
  });
  const ada = await publishProfile(adaDraft, {
    at: SEED_TIMELINE.profilePublished,
    actor: ACTOR_OPS,
  });

  // Expert B: the load analyst — DRAFT → PUBLISHED → SUSPENDED.
  const kwameDraft = await createExpertProfile({
    identity: { tenant: SEED_TENANT, expertId: 'expert-kwame' },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: SEED_DIGESTS.attestation,
        locator: 'urn:arena:demo:attestation:kwame-1',
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'load-analysis',
          version: '1.1.0',
          digest: SEED_DIGESTS.capabilityLoad,
        },
        proficiency: 'working',
        proficiencyEvidence: [
          {
            digest: SEED_DIGESTS.evidenceThree,
            description: 'Load-test analysis references.',
          },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-perf-2024-0077',
          issuer: 'Open Certification Board',
        },
        evidence: [SEED_DIGESTS.evidenceThree],
        status: 'attested',
        validFrom: SEED_TIMELINE.evidenceObservedStale,
        validUntil: SEED_TIMELINE.evidenceObservedFresh,
      },
    ],
    evidence: [
      {
        digest: SEED_DIGESTS.evidenceThree,
        description: 'Reference load-analysis work product.',
      },
    ],
    taskHistory: [],
    reliability: [
      {
        sequence: 1,
        kind: 'no-response',
        occurredAt: SEED_TIMELINE.evidenceObservedStale,
        recordedBy: ACTOR_OPS,
      },
    ],
    availability: {
      windows: [{ recurrence: 'weekly', dayOfWeek: 1, startUtc: '08:00', endUtc: '12:00' }],
    },
    domainScope: {
      domains: [
        {
          kind: 'domain',
          id: 'performance-engineering',
          version: '1.0.0',
          digest: SEED_DIGESTS.domainPerformance,
        },
      ],
      jurisdictions: [],
      limitations: [
        {
          class: 'capacity',
          statement: 'Single-engagement capacity at a time.',
        },
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
    declaredBy: ACTOR_OPS,
    declaredAt: SEED_TIMELINE.profileDeclared,
  });
  const kwamePublished = await publishProfile(kwameDraft, {
    at: SEED_TIMELINE.profilePublished,
    actor: ACTOR_OPS,
  });
  const kwame = await suspendProfile(kwamePublished, {
    at: SEED_TIMELINE.profileSuspended,
    actor: ACTOR_OPS,
    note: 'Availability pause while on leave.',
  });

  // Admission + state recording: the registry admits the FRESH DRAFT,
  // then each lifecycle advance is recorded as an append-only state
  // (the A006 audit flow).
  registry = registerExpert(registry, adaDraft, {
    registeredBy: ACTOR_OPS,
    registeredAt: SEED_TIMELINE.profileDeclared,
  });
  registry = recordProfileState(registry, ada, {
    registeredBy: ACTOR_OPS,
    registeredAt: SEED_TIMELINE.profilePublished,
  });
  registry = registerExpert(registry, kwameDraft, {
    registeredBy: ACTOR_OPS,
    registeredAt: SEED_TIMELINE.profileDeclared,
  });
  registry = recordProfileState(registry, kwamePublished, {
    registeredBy: ACTOR_OPS,
    registeredAt: SEED_TIMELINE.profilePublished,
  });
  registry = recordProfileState(registry, kwame, {
    registeredBy: ACTOR_OPS,
    registeredAt: SEED_TIMELINE.profileSuspended,
  });

  // Read back through the registry's tenant-scoped query API.
  const profiles = listExperts(registry, { tenant: SEED_TENANT });
  return { profiles };
}

// ---------------------------------------------------------------------------
// Qualification + matching flow (A007) through the reference fabric
// ---------------------------------------------------------------------------

async function seedQualificationAndMatching() {
  const fabric = createExpertMatchingFabric();

  // Evidence records (digest-addressed, append-only).
  const evidence = [
    await createQualificationEvidence({
      kind: 'work-product-ref',
      observedAt: SEED_TIMELINE.evidenceObservedFresh,
      workProduct: {
        digest: SEED_DIGESTS.workOne,
        description: 'Netting ruleset review, October close.',
      },
    }),
    await createQualificationEvidence({
      kind: 'work-product-ref',
      observedAt: SEED_TIMELINE.evidenceObservedFresh,
      workProduct: {
        digest: SEED_DIGESTS.workTwo,
        description: 'Credit-note reconciliation memo INV-2291.',
      },
    }),
    await createQualificationEvidence({
      kind: 'verification-ref',
      observedAt: SEED_TIMELINE.evidenceObservedFresh,
      verification: {
        recordDigest: SEED_DIGESTS.verificationPass,
        outcome: 'pass',
      },
    }),
    await createQualificationEvidence({
      kind: 'work-product-ref',
      observedAt: SEED_TIMELINE.evidenceObservedStale,
      workProduct: {
        digest: SEED_DIGESTS.staleWorkOne,
        description: 'Load baseline report (2024).',
      },
    }),
    await createQualificationEvidence({
      kind: 'work-product-ref',
      observedAt: SEED_TIMELINE.evidenceObservedStale,
      workProduct: {
        digest: SEED_DIGESTS.staleWorkTwo,
        description: 'Latency regression analysis (2024).',
      },
    }),
    await createQualificationEvidence({
      kind: 'verification-ref',
      observedAt: SEED_TIMELINE.evidenceObservedStale,
      verification: {
        recordDigest: SEED_DIGESTS.staleVerification,
        outcome: 'pass',
      },
    }),
  ];

  // Claims (one per expert, over their own evidence).
  const adaClaim = await createCompetencyClaim({
    expertId: 'expert-ada',
    tenant: SEED_TENANT,
    capability: {
      kind: 'skill',
      id: 'invoice-reconciliation',
      version: '1.2.0',
      digest: SEED_DIGESTS.capabilityReconciliation,
    },
    proficiency: 'distinguished',
    evidence: evidence.slice(0, 3).map((record) => record.digest),
    declaredAt: SEED_TIMELINE.claimDeclared,
  });
  const kwameClaim = await createCompetencyClaim({
    expertId: 'expert-kwame',
    tenant: SEED_TENANT,
    capability: {
      kind: 'skill',
      id: 'load-analysis',
      version: '1.1.0',
      digest: SEED_DIGESTS.capabilityLoad,
    },
    proficiency: 'working',
    evidence: evidence.slice(3).map((record) => record.digest),
    declaredAt: SEED_TIMELINE.claimDeclared,
  });

  // The qualification policy: 2 fresh work products + 1 verification pass.
  const policy = await createQualificationPolicy({
    policyId: 'policy-reconciliation-qualification',
    version: '1.4.0',
    description:
      'Qualifies reconciliation and load-analysis claims: two fresh work products plus one passing verification record, valid 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  });

  // Qualified-expert cards (the matching-side metadata records).
  const adaCard = await createQualifiedExpertCard({
    expertId: 'expert-ada',
    tenant: SEED_TENANT,
    domainRefs: [
      {
        kind: 'domain',
        id: 'accounts-payable',
        version: '1.0.0',
        digest: SEED_DIGESTS.domainPayable,
      },
    ],
    jurisdictions: [{ country: 'GH' }],
    availability: [
      { recurrence: 'daily', startUtc: '09:00', endUtc: '17:00' },
    ],
  });
  const kwameCard = await createQualifiedExpertCard({
    expertId: 'expert-kwame',
    tenant: SEED_TENANT,
    domainRefs: [
      {
        kind: 'domain',
        id: 'performance-engineering',
        version: '1.0.0',
        digest: SEED_DIGESTS.domainPerformance,
      },
    ],
    jurisdictions: [],
    availability: [
      { recurrence: 'weekly', dayOfWeek: 1, startUtc: '08:00', endUtc: '12:00' },
    ],
  });

  // Register everything into the pool (the reference fabric flow).
  fabric.registerExpertCard(adaCard);
  fabric.registerExpertCard(kwameCard);
  for (const record of evidence) fabric.registerEvidence(record);
  fabric.registerQualificationPolicy(policy);
  fabric.registerClaim(adaClaim);
  fabric.registerClaim(kwameClaim);

  // Qualify both claims through the idempotent command flow:
  // ada → qualified (fresh evidence); kwame → stale (sufficient count,
  // outside the freshness window).
  const { record: adaRecord } = await fabric.qualifyClaim(
    { claimRef: adaClaim.digest, policyRef: policy.digest, evaluatedAt: SEED_TIMELINE.qualificationEvaluated, renew: false },
    { correlationId: 'workbench-seed-qualify-ada', idempotencyKey: 'workbench-seed-qualify-ada' },
  );
  const { record: kwameRecord } = await fabric.qualifyClaim(
    { claimRef: kwameClaim.digest, policyRef: policy.digest, evaluatedAt: SEED_TIMELINE.qualificationEvaluated, renew: false },
    { correlationId: 'workbench-seed-qualify-kwame', idempotencyKey: 'workbench-seed-qualify-kwame' },
  );

  // Two match outcomes (R8): a clean match for the reconciliation task,
  // and a partial-match result for the load task (kwame's qualification
  // is STALE — the closed-vocabulary unmatched reason, no silent
  // best-effort).
  const standardMatchingPolicy = await createMatchingPolicy({
    policyId: 'policy-match-standard',
    version: '1.2.0',
    description:
      'Standard deterministic matching: rank by satisfied requirements, evidence depth, then content-digest tie-break',
    maxCandidates: 10,
    includePartialMatches: false,
    availabilityRequired: false,
  });
  const partialMatchingPolicy = await createMatchingPolicy({
    policyId: 'policy-match-partial',
    version: '1.2.0',
    description:
      'Partial-inclusive deterministic matching: surfaces candidates with explicit unmatched reasons instead of hiding them',
    maxCandidates: 10,
    includePartialMatches: true,
    availabilityRequired: false,
  });

  const reconciliationRequest = await createMatchRequest({
    tenant: SEED_TENANT,
    requirements: [
      {
        requirementId: 'invoice-reconciliation',
        capability: {
          kind: 'skill',
          id: 'invoice-reconciliation',
          version: '1.2.0',
          digest: SEED_DIGESTS.capabilityReconciliation,
        },
        minimumProficiency: 'proficient',
      },
    ],
    evaluatedAt: SEED_TIMELINE.matchEvaluated,
  });
  const loadRequest = await createMatchRequest({
    tenant: SEED_TENANT,
    requirements: [
      {
        requirementId: 'load-analysis',
        capability: {
          kind: 'skill',
          id: 'load-analysis',
          version: '1.1.0',
          digest: SEED_DIGESTS.capabilityLoad,
        },
        minimumProficiency: 'working',
      },
    ],
    evaluatedAt: SEED_TIMELINE.matchEvaluated,
  });

  const { result: reconciliationMatch } = await fabric.matchExperts(
    reconciliationRequest,
    standardMatchingPolicy,
    { correlationId: 'workbench-seed-match-reconciliation' },
  );
  const { result: loadMatch } = await fabric.matchExperts(
    loadRequest,
    partialMatchingPolicy,
    { correlationId: 'workbench-seed-match-load' },
  );

  return {
    claims: [adaClaim, kwameClaim],
    qualificationRecords: [adaRecord, kwameRecord],
    matchResults: [reconciliationMatch, loadMatch],
  };
}

// ---------------------------------------------------------------------------
// Task specs + compilation records (A008)
// ---------------------------------------------------------------------------

const TASK_SPEC_COMMON = {
  taskClass: 'correction',
  constraints: ['Use only the ERP export snapshot'],
  permittedTools: [
    {
      namespace: SEED_TENANT,
      name: 'erp-export-reader',
      version: '1.0.0',
      digest: SEED_DIGESTS.evidenceOne,
    },
  ],
  prohibitedShortcuts: ['Assume full settlement without checking credit notes'],
  longHorizonEvidence: null,
  environmentRequirements: {
    environments: [
      {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentSandbox,
      },
    ],
    constraints: ['No live ERP writes'],
  },
  quality: [
    'realistic-context',
    'discriminative-difficulty',
    'observable-success',
    'reproducible-evaluation',
    'low-leakage',
    'clear-provenance',
    'declared-limitations',
  ].map((dimension) => ({
    dimension,
    satisfied: true,
    justification: `declared posture for ${dimension}`,
    provenance: { source: 'compilation-policy', ref: 'reference-policy@1.0.0' },
  })),
  dataRights: {
    classification: 'private-tenant',
    tenantScope: SEED_TENANT,
    crossTenantReuse: false,
    licensing: null,
    privacyNotes: null,
  },
};

async function seedTasks() {
  const reviewSpec = await createTaskSpec({
    ...TASK_SPEC_COMMON,
    identity: { tenant: SEED_TENANT, taskId: 'task-reconcile-invoices' },
    version: '1.0.0',
    instructions:
      'Reconcile the outstanding credit notes against partially paid invoices in the sandbox ERP export and net the totals to the expected balance.',
    capabilityLabels: ['invoice-reconciliation', 'accounts-payable'],
    difficulty: { scale: 'arena:task-difficulty@1', class: 'standard' },
    domain: {
      kind: 'domain',
      id: 'accounts-payable',
      version: '1.0.0',
      digest: SEED_DIGESTS.domainPayable,
    },
    initialState: {
      environment: {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentSandbox,
      },
      seed: 'seed-2026-alpha',
      note: null,
    },
    objectives: ['Reconcile credit notes against partially paid invoices'],
    expectedOutputs: ['Netted total matches the ERP expected balance'],
    completionCriteria: ['Netted total matches the ERP expected balance'],
    evidenceCriteria: ['Annotated trajectory with the netting decision'],
    evaluatorBindings: [
      {
        evaluatorId: 'reconciliation-accuracy',
        version: '1.0.0',
        descriptorDigest: SEED_DIGESTS.evaluatorDescriptor,
      },
    ],
    verifierBindings: [
      {
        verifierId: 'erp-balance-check',
        version: '1.0.0',
        descriptorDigest: SEED_DIGESTS.verifierDescriptor,
      },
    ],
    expertQualificationRequirements: {
      competencies: [
        {
          kind: 'skill',
          id: 'invoice-reconciliation',
          version: '1.2.0',
          digest: SEED_DIGESTS.capabilityReconciliation,
        },
      ],
      qualificationPolicy: null,
      expectations: ['qualified in the target capability within the last 180 days'],
    },
    derivedFrom: {
      caseRef: {
        tenant: SEED_TENANT,
        caseId: 'case-review-invoices',
        version: '1.0.0',
        digest: SEED_DIGESTS.caseReview,
      },
      policyRef: {
        policyId: 'reference-policy',
        version: '1.0.0',
        digest: SEED_DIGESTS.policyDigest,
      },
    },
  });

  const loadSpec = await createTaskSpec({
    ...TASK_SPEC_COMMON,
    identity: { tenant: SEED_TENANT, taskId: 'task-diagnose-latency' },
    version: '1.0.0',
    taskClass: 'diagnosis',
    instructions:
      'Diagnose the latency regression on the close-set workload by replaying the load profile in the sandbox and attributing the regression to a layer.',
    capabilityLabels: ['load-analysis', 'performance-engineering'],
    difficulty: { scale: 'arena:task-difficulty@1', class: 'exploratory' },
    domain: {
      kind: 'domain',
      id: 'performance-engineering',
      version: '1.0.0',
      digest: SEED_DIGESTS.domainPerformance,
    },
    initialState: {
      environment: {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentSandbox,
      },
      seed: 'seed-2026-beta',
      note: null,
    },
    objectives: ['Attribute the close-set latency regression to a specific layer'],
    expectedOutputs: ['Attribution report with replayed measurements'],
    completionCriteria: ['Attribution report names the layer with supporting measurements'],
    evidenceCriteria: ['Replay trajectory with the measurement steps'],
    evaluatorBindings: [
      {
        evaluatorId: 'attribution-accuracy',
        version: '1.0.0',
        descriptorDigest: SEED_DIGESTS.evaluatorDescriptor,
      },
    ],
    verifierBindings: [
      {
        verifierId: 'measurement-check',
        version: '1.0.0',
        descriptorDigest: SEED_DIGESTS.verifierDescriptor,
      },
    ],
    expertQualificationRequirements: {
      competencies: [
        {
          kind: 'skill',
          id: 'load-analysis',
          version: '1.1.0',
          digest: SEED_DIGESTS.capabilityLoad,
        },
      ],
      qualificationPolicy: null,
      expectations: ['qualified in load-analysis within the last 180 days'],
    },
    derivedFrom: {
      caseRef: {
        tenant: SEED_TENANT,
        caseId: 'case-load-review-latency',
        version: '1.0.0',
        digest: SEED_DIGESTS.caseLatency,
      },
      policyRef: {
        policyId: 'reference-policy',
        version: '1.0.0',
        digest: SEED_DIGESTS.policyDigest,
      },
    },
  });

  const reviewCompilation = await createCompilationRecord({
    compilationKey: 'compile-review-invoices-0001',
    correlationId: 'workbench-seed-compile-review',
    caseRef: {
      tenant: SEED_TENANT,
      caseId: 'case-review-invoices',
      version: '1.0.0',
      digest: SEED_DIGESTS.caseReview,
    },
    targetDigest: reviewSpec.digest,
    policyRef: {
      policyId: 'reference-policy',
      version: '1.0.0',
      digest: SEED_DIGESTS.policyDigest,
    },
    emittedSpecs: [
      {
        tenant: SEED_TENANT,
        taskId: 'task-reconcile-invoices',
        version: '1.0.0',
        digest: reviewSpec.digest,
      },
    ],
    compiledAt: SEED_TIMELINE.taskCompiled,
  });
  const loadCompilation = await createCompilationRecord({
    compilationKey: 'compile-diagnose-latency-0002',
    correlationId: 'workbench-seed-compile-latency',
    caseRef: {
      tenant: SEED_TENANT,
      caseId: 'case-load-review-latency',
      version: '1.0.0',
      digest: SEED_DIGESTS.caseLatency,
    },
    targetDigest: loadSpec.digest,
    policyRef: {
      policyId: 'reference-policy',
      version: '1.0.0',
      digest: SEED_DIGESTS.policyDigest,
    },
    emittedSpecs: [
      {
        tenant: SEED_TENANT,
        taskId: 'task-diagnose-latency',
        version: '1.0.0',
        digest: loadSpec.digest,
      },
    ],
    compiledAt: SEED_TIMELINE.taskCompiled,
  });

  return { specs: [reviewSpec, loadSpec], compilations: [reviewCompilation, loadCompilation] };
}

// ---------------------------------------------------------------------------
// Trajectories (A011): one completed, one failed — full entry chains
// ---------------------------------------------------------------------------

async function seedTrajectories() {
  // Trajectory 1: the completed close-set reconciliation run.
  let completed = await openTrajectory({
    trajectoryId: SEED_TRAJECTORY_IDS[0],
    run: {
      taskVersion: { taskId: 'task-reconcile-invoices', version: '1.0.0' },
      environmentVersion: {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentSandbox,
      },
      runId: `${SEED_TENANT}/run-erp-close-0001`,
      initialSnapshotDigest: SEED_DIGESTS.snapshotInitial,
      runRecordDigest: null,
    },
    agentBodyRef: SEED_DIGESTS.agentBody,
    substrateRef: SEED_DIGESTS.substrate,
    startedAt: SEED_TIMELINE.trajectoryOneStarted,
    seed: 'seed-2026-alpha',
  });
  completed = await appendTrajectoryEntry(completed, {
    sequence: 1,
    kind: 'action',
    payload: {
      actionId: 'propose-netting',
      input: { invoice: 'INV-2291', creditNote: 'CN-0117' },
    },
    occurredAt: SEED_TIMELINE.trajectoryOneAction,
  });
  completed = await appendTrajectoryEntry(completed, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'stdout',
      channel: 'stdout',
      content: 'netting proposal recorded: INV-2291 + credit note CN-0117',
    },
    occurredAt: SEED_TIMELINE.trajectoryOneAction,
  });
  completed = await appendTrajectoryEntry(completed, {
    sequence: 3,
    kind: 'checkpoint',
    payload: {
      checkpointId: 'cp-netting-verified',
      snapshotDigest: SEED_DIGESTS.snapshotCheckpoint,
    },
    occurredAt: SEED_TIMELINE.trajectoryOneCheckpoint,
  });
  completed = await appendTrajectoryEntry(completed, {
    sequence: 4,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [SEED_DIGESTS.evidenceTwo] },
    occurredAt: SEED_TIMELINE.trajectoryOneCompleted,
  });

  // Trajectory 2: the failed load replay.
  let failed = await openTrajectory({
    trajectoryId: SEED_TRAJECTORY_IDS[1],
    run: {
      taskVersion: { taskId: 'task-diagnose-latency', version: '1.0.0' },
      environmentVersion: {
        namespace: SEED_TENANT,
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: SEED_DIGESTS.environmentSandbox,
      },
      runId: `${SEED_TENANT}/run-load-replay-0002`,
      initialSnapshotDigest: SEED_DIGESTS.snapshotInitial,
      runRecordDigest: null,
    },
    agentBodyRef: SEED_DIGESTS.agentBody,
    substrateRef: SEED_DIGESTS.substrate,
    startedAt: SEED_TIMELINE.trajectoryTwoStarted,
    seed: null,
  });
  failed = await appendTrajectoryEntry(failed, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'replay-load', input: null },
    occurredAt: SEED_TIMELINE.trajectoryTwoAction,
  });
  failed = await appendTrajectoryEntry(failed, {
    sequence: 2,
    kind: 'error',
    payload: {
      code: 'ERR_TIMEOUT',
      message: 'replay exceeded the wall-clock limit before attribution',
    },
    occurredAt: SEED_TIMELINE.trajectoryTwoFailed,
  });
  failed = await appendTrajectoryEntry(failed, {
    sequence: 3,
    kind: 'completion',
    payload: { outcome: 'failed', evidenceDigests: [] },
    occurredAt: SEED_TIMELINE.trajectoryTwoFailed,
  });

  return { trajectories: [completed, failed] };
}

// ---------------------------------------------------------------------------
// Durable jobs (A015) through the job-orchestrator reference flow
// ---------------------------------------------------------------------------

async function seedJobs() {
  const clock = new ManualClock(Date.parse(SEED_TIMELINE.jobClockStart));
  const store = new InMemoryJobStore();
  const sink = new InMemoryEventSink();
  // Deterministic envelope ids (UUID-shaped): the whole flow is
  // byte-reproducible.
  let envelopeCounter = 0;
  const newEnvelopeId = () => {
    envelopeCounter += 1;
    return `00000000-0000-4000-8000-${String(envelopeCounter).padStart(12, '0')}`;
  };
  const orchestrator = new JobOrchestrator({ clock, store, sink, newEnvelopeId });

  const matchingDefinition = await createJobDefinition({
    kind: { namespace: SEED_TENANT, name: 'match-experts', version: '1.0.0' },
    inputSchema: 'arena:schema/demo/match-request@1.0.0',
    correlationAddress: 'demo/matching',
    idempotency: { scope: 'demo-matching' },
    timeout: { timeoutMs: 60000 },
    retry: {
      maxAttempts: 2,
      backoffScheduleMs: [1000],
      retryableErrorClasses: ['transient', 'timeout'],
    },
    priority: 'high',
  });
  const compilationDefinition = await createJobDefinition({
    kind: { namespace: SEED_TENANT, name: 'compile-task-spec', version: '1.0.0' },
    inputSchema: 'arena:schema/demo/compilation-run@1.0.0',
    correlationAddress: 'demo/compilation',
    idempotency: { scope: 'demo-compilation' },
    timeout: { timeoutMs: 120000 },
    retry: { maxAttempts: 1 },
    priority: 'normal',
  });

  // Job 1: the happy path — queued → running → progress → succeeded.
  await orchestrator.submit({
    definition: matchingDefinition,
    input: { taskId: 'task-reconcile-invoices', requirementId: 'invoice-reconciliation' },
    correlationId: toCorrelationId('workbench-seed-match-0001'),
    idempotencyKey: toIdempotencyKey('workbench-seed-match-0001'),
    jobId: SEED_JOB_IDS[0],
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(10_000);
  await orchestrator.claim({ jobId: SEED_JOB_IDS[0], actor: ACTOR_ORCHESTRATOR });
  clock.advance(20_000);
  await orchestrator.progress({
    jobId: SEED_JOB_IDS[0],
    percent: 50,
    note: 'pool queried; ranking candidates by satisfied requirements',
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(30_000);
  await orchestrator.complete({
    jobId: SEED_JOB_IDS[0],
    result: {
      summary: 'Matched expert-ada for invoice-reconciliation.',
      candidates: 1,
      requirementsUnmet: 0,
    },
    actor: ACTOR_ORCHESTRATOR,
  });

  // Job 2: the failure path — queued → running → failed (terminal).
  await orchestrator.submit({
    definition: compilationDefinition,
    input: { caseId: 'case-load-review-latency' },
    correlationId: toCorrelationId('workbench-seed-compile-0001'),
    idempotencyKey: toIdempotencyKey('workbench-seed-compile-0001'),
    jobId: SEED_JOB_IDS[1],
    actor: ACTOR_ORCHESTRATOR,
  });
  clock.advance(15_000);
  await orchestrator.claim({ jobId: SEED_JOB_IDS[1], actor: ACTOR_ORCHESTRATOR });
  clock.advance(45_000);
  await orchestrator.fail({
    jobId: SEED_JOB_IDS[1],
    errorClass: 'compilation-timeout',
    message: 'case state did not compile within the sandbox deadline',
    actor: ACTOR_ORCHESTRATOR,
  });

  // Job 3: freshly submitted, still queued.
  await orchestrator.submit({
    definition: matchingDefinition,
    input: { taskId: 'task-diagnose-latency', requirementId: 'load-analysis' },
    correlationId: toCorrelationId('workbench-seed-match-0002'),
    idempotencyKey: toIdempotencyKey('workbench-seed-match-0002'),
    jobId: SEED_JOB_IDS[2],
    actor: ACTOR_ORCHESTRATOR,
  });

  const jobs = await store.list();
  return { jobs };
}

// ---------------------------------------------------------------------------
// Corpus assembly
// ---------------------------------------------------------------------------

/**
 * Build the deep-frozen, byte-deterministic seeded workbench corpus.
 *
 * @param {{expertSupply?: 'up' | 'down'}} [options]
 *   `expertSupply: 'down'` marks the expert supply unavailable (R41): the
 *   SAME last-known records are kept and the workbench renders its
 *   degradation banner over them (no invented data).
 * @returns {Promise<import('./corpus.d.mts').SeededWorkbenchCorpus>} the frozen corpus
 */
export async function buildWorkbenchCorpus(options = {}) {
  const expertSupplyUp = (options.expertSupply ?? 'up') === 'up';

  const [registry, qualification, tasks, trajectories, jobs] = await Promise.all([
    seedExpertRegistry(),
    seedQualificationAndMatching(),
    seedTasks(),
    seedTrajectories(),
    seedJobs(),
  ]);

  return freezeWorkbenchCorpus({
    expertSupply: {
      section: 'experts',
      available: expertSupplyUp,
      detail: expertSupplyUp
        ? 'expert registry, qualification records and matching are reachable'
        : 'expert supply unreachable: the registry/qualification/matching source did not answer at snapshot time',
      lastKnownAt: SEED_LAST_KNOWN_AT,
    },
    taskQueue: {
      section: 'tasks',
      available: true,
      detail: 'task queue and task compiler are reachable',
      lastKnownAt: SEED_LAST_KNOWN_AT,
    },
    trajectoryStore: {
      section: 'trajectories',
      available: true,
      detail: 'trajectory store is reachable',
      lastKnownAt: SEED_LAST_KNOWN_AT,
    },
    jobStore: {
      section: 'jobs',
      available: true,
      detail: 'job store and orchestrator are reachable',
      lastKnownAt: SEED_LAST_KNOWN_AT,
    },
    profiles: registry.profiles,
    claims: qualification.claims,
    qualificationRecords: qualification.qualificationRecords,
    matchResults: qualification.matchResults,
    specs: tasks.specs,
    compilations: tasks.compilations,
    trajectories: trajectories.trajectories,
    jobs: jobs.jobs,
  });
}
