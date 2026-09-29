/**
 * Shared test fixtures for the @arena/workbench suites (Work Order
 * A017). NOT exported from the package index — internal to the tests,
 * mirroring the test-support conventions of control-ui (A018),
 * capability-case and agent-body.
 *
 * Everything is built through the DOMAIN packages' public APIs only,
 * with fixed timestamps and digest fixtures, so every golden string in
 * the render/router suites is byte-stable. No clock reads, no
 * randomness (same discipline as the domain packages' own fixtures).
 */

import {
  createCompetencyClaim,
  createMatchRequest,
  createMatchResult,
  createMatchingPolicy,
  createQualificationEvidence,
  createQualificationPolicy,
  evaluateCompetencyClaim,
} from '@arena/expert-qualification';
import type {
  CompetencyClaim,
  MatchResult,
  QualificationEvidence,
  QualificationPolicy,
  QualificationRecord,
} from '@arena/expert-qualification';
import {
  createExpertProfile,
  publishProfile,
  suspendProfile,
} from '@arena/expert-registry';
import type { ExpertProfile } from '@arena/expert-registry';
import { createJobRecord } from '@arena/job-protocol';
import type { JobRecord } from '@arena/job-protocol';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  createCompilationRecord,
  createTaskSpec,
} from '@arena/task-spec';
import type { CompilationRecord, TaskSpec } from '@arena/task-spec';
import {
  appendTrajectoryEntry,
  openTrajectory,
} from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';

import type { WorkbenchCorpus } from './corpus.js';

/** Well-known 64-hex digest fixtures. */
export const DIGEST_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DIGEST_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const DIGEST_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
export const DIGEST_D = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
export const DIGEST_E = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const DIGEST_F = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/** Fixed timeline (UTC) — every fixture event happens on it. */
export const AT = '2026-10-05T09:00:00.000Z';
export const AT_PLUS_HOUR = '2026-10-05T10:00:00.000Z';
export const AT_NEXT_DAY = '2026-10-06T09:00:00.000Z';
/** Freshness: observed 4 days before AT (within a 30-day window). */
export const AT_FRESH = '2026-10-01T09:00:00.000Z';
/** Staleness: observed ~2 years before AT (outside a 30-day window). */
export const AT_STALE = '2024-10-01T09:00:00.000Z';

/** The fixture tenant every record lives in. */
export const FIXTURE_TENANT = 'tenant-wb';

/** The seeded trajectory id (the detail route's addressable id). */
export const FIXTURE_TRAJECTORY_ID = 'traj-fixture-0001';

const ACTOR = Object.freeze({
  type: 'user',
  tenant: FIXTURE_TENANT,
  principalId: 'wb-fixture-ops',
});

// ---------------------------------------------------------------------------
// Expert profiles (A006, through the public registry API)
// ---------------------------------------------------------------------------

const PROFILE_BASE = {
  identityRefs: [
    { kind: 'identity-attestation', digest: DIGEST_B, locator: 'urn:arena:tenant-wb:attestation:1' },
  ],
  evidence: [{ digest: DIGEST_C, description: 'Fixture foundational evidence record.' }],
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
} as const;

/** Build the first fixture profile and publish it (DRAFT → PUBLISHED). */
export async function makeFixtureProfileAda(): Promise<ExpertProfile> {
  const draft = await createExpertProfile({
    ...PROFILE_BASE,
    identity: { tenant: FIXTURE_TENANT, expertId: 'expert-fixture-ada' },
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'invoice-reconciliation',
          version: '1.2.0',
          digest: DIGEST_A,
        },
        proficiency: 'distinguished',
        proficiencyEvidence: [
          { digest: DIGEST_C, description: 'Fixture proficiency evidence.' },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-ap-2026-0142',
          issuer: 'Fixture Certification Board',
        },
        evidence: [DIGEST_C],
        status: 'verified',
        validFrom: AT,
        validUntil: AT_NEXT_DAY,
        jurisdiction: { country: 'GH' },
      },
    ],
    taskHistory: [
      {
        kind: 'task-outcome',
        tenant: FIXTURE_TENANT,
        taskId: 'task-fixture-review',
        version: '1.0.0',
        digest: DIGEST_D,
        occurredAt: AT_FRESH,
      },
    ],
    reliability: [
      {
        sequence: 1,
        kind: 'task-completed',
        occurredAt: AT_FRESH,
        recordedBy: ACTOR,
      },
      {
        sequence: 2,
        kind: 'task-completed',
        occurredAt: AT,
        recordedBy: ACTOR,
      },
      {
        sequence: 3,
        kind: 'task-failed',
        occurredAt: AT_PLUS_HOUR,
        recordedBy: ACTOR,
      },
    ],
    availability: {
      windows: [{ recurrence: 'daily', startUtc: '09:00', endUtc: '17:00' }],
      note: 'Fixture business hours.',
    },
    domainScope: {
      domains: [
        { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_B },
      ],
      jurisdictions: [{ country: 'GH' }],
      limitations: [
        {
          class: 'professional-scope',
          statement: 'Fixture: advisory output only; no regulatory filing.',
        },
      ],
    },
    declaredAt: AT,
  });
  return publishProfile(draft, { at: AT_PLUS_HOUR, actor: ACTOR });
}

/** Build the second fixture profile, publish then suspend it. */
export async function makeFixtureProfileKwame(): Promise<ExpertProfile> {
  const draft = await createExpertProfile({
    ...PROFILE_BASE,
    identity: { tenant: FIXTURE_TENANT, expertId: 'expert-fixture-kwame' },
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'load-analysis',
          version: '1.1.0',
          digest: DIGEST_E,
        },
        proficiency: 'working',
        proficiencyEvidence: [
          { digest: DIGEST_F, description: 'Fixture proficiency evidence (load).' },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-perf-2025-0077',
          issuer: 'Fixture Certification Board',
        },
        evidence: [DIGEST_F],
        status: 'attested',
        validFrom: AT_STALE,
        validUntil: AT,
      },
    ],
    taskHistory: [],
    reliability: [
      {
        sequence: 1,
        kind: 'no-response',
        occurredAt: AT_STALE,
        recordedBy: ACTOR,
      },
    ],
    availability: {
      windows: [
        { recurrence: 'weekly', dayOfWeek: 1, startUtc: '08:00', endUtc: '12:00' },
      ],
    },
    domainScope: {
      domains: [
        { kind: 'domain', id: 'performance-engineering', version: '1.0.0', digest: DIGEST_D },
      ],
      jurisdictions: [],
      limitations: [
        {
          class: 'capacity',
          statement: 'Fixture: single-engagement capacity at a time.',
        },
      ],
    },
    declaredAt: AT,
  });
  const published = await publishProfile(draft, { at: AT_PLUS_HOUR, actor: ACTOR });
  return suspendProfile(published, {
    at: AT_NEXT_DAY,
    actor: ACTOR,
    note: 'Fixture availability pause.',
  });
}

// ---------------------------------------------------------------------------
// Qualification flow (A007, through the public package API)
// ---------------------------------------------------------------------------

/** Fresh evidence set backing the qualified claim (2 work products + 1 verification pass). */
export async function makeFreshEvidence(): Promise<readonly QualificationEvidence[]> {
  const workOne = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: AT_FRESH,
    workProduct: { digest: DIGEST_C, description: 'Fixture netting work product one.' },
  });
  const workTwo = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: AT_FRESH,
    workProduct: { digest: DIGEST_D, description: 'Fixture netting work product two.' },
  });
  const verification = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: AT_FRESH,
    verification: { recordDigest: DIGEST_E, outcome: 'pass' },
  });
  return [workOne, workTwo, verification];
}

/** Stale evidence set (sufficient COUNT, outside the freshness window). */
export async function makeStaleEvidence(): Promise<readonly QualificationEvidence[]> {
  const workOne = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: AT_STALE,
    workProduct: { digest: DIGEST_F, description: 'Fixture stale work product one.' },
  });
  const workTwo = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: AT_STALE,
    workProduct: { digest: DIGEST_A, description: 'Fixture stale work product two.' },
  });
  const verification = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: AT_STALE,
    verification: { recordDigest: DIGEST_B, outcome: 'pass' },
  });
  return [workOne, workTwo, verification];
}

/** The fixture qualification policy: 2 fresh work products + 1 verification pass. */
export async function makeFixtureQualificationPolicy(): Promise<QualificationPolicy> {
  return createQualificationPolicy({
    policyId: 'policy-fixture-qualification',
    version: '1.0.0',
    description:
      'Fixture policy: two fresh work products plus one passing verification record, valid 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  });
}

/** The fixture claims (one per expert, backed by their evidence digests). */
export async function makeFixtureClaims(
  freshEvidence: readonly QualificationEvidence[],
  staleEvidence: readonly QualificationEvidence[],
): Promise<readonly CompetencyClaim[]> {
  const ada = await createCompetencyClaim({
    expertId: 'expert-fixture-ada',
    tenant: FIXTURE_TENANT,
    capability: { kind: 'skill', id: 'invoice-reconciliation', version: '1.2.0', digest: DIGEST_A },
    proficiency: 'distinguished',
    evidence: freshEvidence.map((record) => record.digest),
    declaredAt: AT,
  });
  const kwame = await createCompetencyClaim({
    expertId: 'expert-fixture-kwame',
    tenant: FIXTURE_TENANT,
    capability: { kind: 'skill', id: 'load-analysis', version: '1.1.0', digest: DIGEST_E },
    proficiency: 'working',
    evidence: staleEvidence.map((record) => record.digest),
    declaredAt: AT,
  });
  return [ada, kwame];
}

/** Evaluate both fixture claims (one qualified, one stale). */
export async function makeFixtureQualificationRecords(
  claims: readonly CompetencyClaim[],
  policy: QualificationPolicy,
  freshEvidence: readonly QualificationEvidence[],
  staleEvidence: readonly QualificationEvidence[],
): Promise<readonly QualificationRecord[]> {
  const qualified = await evaluateCompetencyClaim({
    claim: claims[0] as CompetencyClaim,
    policy,
    evidence: freshEvidence,
    evaluatedAt: AT,
  });
  const stale = await evaluateCompetencyClaim({
    claim: claims[1] as CompetencyClaim,
    policy,
    evidence: staleEvidence,
    evaluatedAt: AT,
  });
  return [qualified, stale];
}

/** The fixture match results (one matched, one with unmet requirements). */
export async function makeFixtureMatchResults(
  claim: CompetencyClaim,
  qualifiedRecord: QualificationRecord,
  freshEvidence: readonly QualificationEvidence[],
): Promise<readonly MatchResult[]> {
  const policy = await createMatchingPolicy({
    policyId: 'policy-fixture-matching',
    version: '1.0.0',
    description: 'Fixture deterministic matching policy',
    maxCandidates: 10,
    includePartialMatches: false,
    availabilityRequired: false,
  });
  const matchedRequest = await createMatchRequest({
    tenant: FIXTURE_TENANT,
    requirements: [
      {
        requirementId: 'invoice-reconciliation',
        capability: { kind: 'skill', id: 'invoice-reconciliation', version: '1.2.0', digest: DIGEST_A },
        minimumProficiency: 'proficient',
      },
    ],
    evaluatedAt: AT,
  });
  const matched = await createMatchResult({
    requestDigest: matchedRequest.digest,
    matchingPolicyDigest: policy.digest,
    evaluatedAt: AT,
    candidates: [
      {
        expertId: 'expert-fixture-ada',
        tenant: FIXTURE_TENANT,
        satisfiedAll: true,
        satisfiedCount: 1,
        evidenceCount: freshEvidence.length,
        perRequirement: [
          {
            requirementId: 'invoice-reconciliation',
            satisfied: true,
            matchedProficiency: 'expert',
            claimDigest: claim.digest,
            recordDigest: qualifiedRecord.digest,
            evidenceDigests: freshEvidence.map((record) => record.digest),
          },
        ],
      },
    ],
    requirementsUnmet: [],
    truncated: false,
  });
  const unmetRequest = await createMatchRequest({
    tenant: FIXTURE_TENANT,
    requirements: [
      {
        requirementId: 'load-analysis',
        capability: { kind: 'skill', id: 'load-analysis', version: '1.1.0', digest: DIGEST_E },
        minimumProficiency: 'proficient',
      },
    ],
    evaluatedAt: AT,
  });
  const unmet = await createMatchResult({
    requestDigest: unmetRequest.digest,
    matchingPolicyDigest: policy.digest,
    evaluatedAt: AT,
    candidates: [],
    requirementsUnmet: ['load-analysis'],
    truncated: false,
  });
  return [matched, unmet];
}

// ---------------------------------------------------------------------------
// Task specs + compilation records (A008)
// ---------------------------------------------------------------------------

const TASK_SPEC_BASE = {
  taskClass: 'correction',
  instructions:
    'Fixture task statement: reconcile the fixture credit notes against the partially paid invoices in the sandbox ERP export, and net the totals to the expected balance.',
  capabilityLabels: ['invoice-reconciliation', 'accounts-payable'],
  difficulty: { scale: 'arena:task-difficulty@1', class: 'standard' },
  domain: { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_B },
  initialState: {
    environment: {
      namespace: FIXTURE_TENANT,
      name: 'fixture-sandbox',
      version: '1.4.0',
      digest: DIGEST_C,
    },
    seed: 'seed-fixture-alpha',
    note: null,
  },
  constraints: ['Use only the fixture ERP export snapshot'],
  permittedTools: [
    {
      namespace: FIXTURE_TENANT,
      name: 'fixture-export-reader',
      version: '1.0.0',
      digest: DIGEST_E,
    },
  ],
  prohibitedShortcuts: ['Assume full settlement without checking credit notes'],
  expectedOutputs: ['Netted total matches the fixture expected balance'],
  completionCriteria: ['Netted total matches the fixture expected balance'],
  evidenceCriteria: ['Annotated trajectory with the netting decision'],
  longHorizonEvidence: null,
  environmentRequirements: {
    environments: [
      {
        namespace: FIXTURE_TENANT,
        name: 'fixture-sandbox',
        version: '1.4.0',
        digest: DIGEST_C,
      },
    ],
    constraints: ['No live fixture ERP writes'],
  },
  evaluatorBindings: [
    {
      evaluatorId: 'reconciliation-accuracy',
      version: '1.0.0',
      descriptorDigest: DIGEST_D,
    },
  ],
  verifierBindings: [
    {
      verifierId: 'fixture-balance-check',
      version: '1.0.0',
      descriptorDigest: DIGEST_E,
    },
  ],
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
    justification: `fixture posture for ${dimension}`,
    provenance: { source: 'compilation-policy', ref: 'fixture-policy@1.0.0' },
  })),
  dataRights: {
    classification: 'private-tenant',
    tenantScope: FIXTURE_TENANT,
    crossTenantReuse: false,
    licensing: null,
    privacyNotes: null,
  },
} as const;

/** The first fixture TaskSpec (the correction task). */
export async function makeFixtureReviewSpec(): Promise<TaskSpec> {
  return createTaskSpec({
    ...TASK_SPEC_BASE,
    identity: { tenant: FIXTURE_TENANT, taskId: 'task-fixture-review' },
    version: '1.0.0',
    objectives: ['Reconcile fixture credit notes against partially paid invoices'],
    expertQualificationRequirements: {
      competencies: [
        { kind: 'skill', id: 'invoice-reconciliation', version: '1.2.0', digest: DIGEST_A },
      ],
      qualificationPolicy: null,
      expectations: ['qualified in the target capability within the last 180 days'],
    },
    derivedFrom: {
      caseRef: {
        tenant: FIXTURE_TENANT,
        caseId: 'case-fixture-review',
        version: '1.0.0',
        digest: DIGEST_A,
      },
      policyRef: { policyId: 'fixture-policy', version: '1.0.0', digest: DIGEST_B },
    },
  });
}

/** The second fixture TaskSpec (the analysis task). */
export async function makeFixtureLoadSpec(): Promise<TaskSpec> {
  return createTaskSpec({
    ...TASK_SPEC_BASE,
    identity: { tenant: FIXTURE_TENANT, taskId: 'task-fixture-load' },
    version: '1.0.0',
    taskClass: 'diagnosis',
    capabilityLabels: ['load-analysis', 'performance-engineering'],
    difficulty: { scale: 'arena:task-difficulty@1', class: 'exploratory' },
    domain: { kind: 'domain', id: 'performance-engineering', version: '1.0.0', digest: DIGEST_D },
    objectives: ['Diagnose the fixture latency regression on the close-set workload'],
    expertQualificationRequirements: {
      competencies: [
        { kind: 'skill', id: 'load-analysis', version: '1.1.0', digest: DIGEST_E },
      ],
      qualificationPolicy: null,
      expectations: ['qualified in load-analysis within the last 180 days'],
    },
    derivedFrom: {
      caseRef: {
        tenant: FIXTURE_TENANT,
        caseId: 'case-fixture-latency',
        version: '1.0.0',
        digest: DIGEST_F,
      },
      policyRef: { policyId: 'fixture-policy', version: '1.0.0', digest: DIGEST_B },
    },
  });
}

/** The fixture compilation record (emits the review spec). */
export async function makeFixtureCompilation(reviewSpec: TaskSpec): Promise<CompilationRecord> {
  return createCompilationRecord({
    compilationKey: 'compile-fixture-0001',
    correlationId: 'corr-fixture-0001',
    caseRef: {
      tenant: FIXTURE_TENANT,
      caseId: 'case-fixture-review',
      version: '1.0.0',
      digest: DIGEST_A,
    },
    targetDigest: reviewSpec.digest,
    policyRef: { policyId: 'fixture-policy', version: '1.0.0', digest: DIGEST_B },
    emittedSpecs: [
      {
        tenant: FIXTURE_TENANT,
        taskId: 'task-fixture-review',
        version: '1.0.0',
        digest: reviewSpec.digest,
      },
    ],
    compiledAt: AT,
  });
}

// ---------------------------------------------------------------------------
// Trajectories (A011)
// ---------------------------------------------------------------------------

/** The completed fixture trajectory (action → observation → checkpoint → completion). */
export async function makeFixtureCompletedTrajectory(): Promise<TrajectoryRecord> {
  let record = await openTrajectory({
    trajectoryId: FIXTURE_TRAJECTORY_ID,
    run: {
      taskVersion: { taskId: 'task-fixture-review', version: '1.0.0' },
      environmentVersion: {
        namespace: FIXTURE_TENANT,
        name: 'fixture-sandbox',
        version: '1.4.0',
        digest: DIGEST_C,
      },
      runId: `${FIXTURE_TENANT}/run-fixture-0001`,
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: AT,
    seed: 'seed-fixture-alpha',
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'read-invoices', input: { invoice: 'INV-2291' } },
    occurredAt: AT,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'stdout',
      channel: 'stdout',
      content: 'read 48 fixture invoices and 3 credit notes',
    },
    occurredAt: AT_PLUS_HOUR,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'checkpoint',
    payload: { checkpointId: 'cp-netting', snapshotDigest: DIGEST_F },
    occurredAt: AT_PLUS_HOUR,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 4,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [DIGEST_F] },
    occurredAt: AT_NEXT_DAY,
  });
  return record;
}

/** The failed fixture trajectory (action → error → failed completion). */
export async function makeFixtureFailedTrajectory(): Promise<TrajectoryRecord> {
  let record = await openTrajectory({
    trajectoryId: 'traj-fixture-0002',
    run: {
      taskVersion: { taskId: 'task-fixture-load', version: '1.0.0' },
      environmentVersion: {
        namespace: FIXTURE_TENANT,
        name: 'fixture-sandbox',
        version: '1.4.0',
        digest: DIGEST_C,
      },
      runId: `${FIXTURE_TENANT}/run-fixture-0002`,
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: AT_PLUS_HOUR,
    seed: null,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'replay-load', input: null },
    occurredAt: AT_PLUS_HOUR,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'error',
    payload: { code: 'ERR_TIMEOUT', message: 'fixture replay exceeded the wall-clock limit' },
    occurredAt: AT_NEXT_DAY,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'completion',
    payload: { outcome: 'failed', evidenceDigests: [] },
    occurredAt: AT_NEXT_DAY,
  });
  return record;
}

// ---------------------------------------------------------------------------
// Jobs (A015)
// ---------------------------------------------------------------------------

/** The first fixture job record (queued, freshly submitted). */
export async function makeFixtureQueuedJob(): Promise<JobRecord> {
  return createJobRecord({
    definitionDigest: DIGEST_A,
    kind: { namespace: FIXTURE_TENANT, name: 'match-experts', version: '1.0.0' },
    correlationId: toCorrelationId('corr-fixture-0001'),
    idempotencyKey: toIdempotencyKey('idem-fixture-0001'),
    idempotencyScope: 'fixture-matching',
    input: { taskId: 'task-fixture-review' },
    policy: {
      timeoutMs: 30000,
      retry: { maxAttempts: 2, backoffScheduleMs: [1000], retryableErrorClasses: [] },
    },
    jobId: 'job-fixture-match-0001',
    submittedAt: AT,
  });
}

/** The second fixture job record (queued, different kind). */
export async function makeFixtureCompileJob(): Promise<JobRecord> {
  return createJobRecord({
    definitionDigest: DIGEST_B,
    kind: { namespace: FIXTURE_TENANT, name: 'compile-task-spec', version: '1.0.0' },
    correlationId: toCorrelationId('corr-fixture-0002'),
    idempotencyKey: toIdempotencyKey('idem-fixture-0002'),
    idempotencyScope: 'fixture-compilation',
    input: { caseId: 'case-fixture-latency' },
    policy: {
      timeoutMs: 60000,
      retry: { maxAttempts: 3, backoffScheduleMs: [1000, 5000], retryableErrorClasses: ['transient'] },
    },
    jobId: 'job-fixture-compile-0002',
    submittedAt: AT_PLUS_HOUR,
  });
}

// ---------------------------------------------------------------------------
// Corpora (healthy + degraded variants)
// ---------------------------------------------------------------------------

/** The shared fixture records (built once per call; byte-deterministic). */
export interface FixtureRecords {
  readonly profiles: readonly ExpertProfile[];
  readonly claims: readonly CompetencyClaim[];
  readonly qualificationRecords: readonly QualificationRecord[];
  readonly matchResults: readonly MatchResult[];
  readonly specs: readonly TaskSpec[];
  readonly compilations: readonly CompilationRecord[];
  readonly trajectories: readonly TrajectoryRecord[];
  readonly jobs: readonly JobRecord[];
}

/** Build every fixture domain record (deterministic). */
export async function makeFixtureRecords(): Promise<FixtureRecords> {
  const [ada, kwame, freshEvidence, staleEvidence, policy] = await Promise.all([
    makeFixtureProfileAda(),
    makeFixtureProfileKwame(),
    makeFreshEvidence(),
    makeStaleEvidence(),
    makeFixtureQualificationPolicy(),
  ]);
  const claims = await makeFixtureClaims(freshEvidence, staleEvidence);
  const qualificationRecords = await makeFixtureQualificationRecords(
    claims,
    policy,
    freshEvidence,
    staleEvidence,
  );
  const matchResults = await makeFixtureMatchResults(
    claims[0] as CompetencyClaim,
    qualificationRecords[0] as QualificationRecord,
    freshEvidence,
  );
  const [reviewSpec, loadSpec, completedTrajectory, failedTrajectory, queuedJob, compileJob] =
    await Promise.all([
      makeFixtureReviewSpec(),
      makeFixtureLoadSpec(),
      makeFixtureCompletedTrajectory(),
      makeFixtureFailedTrajectory(),
      makeFixtureQueuedJob(),
      makeFixtureCompileJob(),
    ]);
  const compilation = await makeFixtureCompilation(reviewSpec);
  return {
    profiles: [ada, kwame],
    claims,
    qualificationRecords,
    matchResults,
    specs: [reviewSpec, loadSpec],
    compilations: [compilation],
    trajectories: [completedTrajectory, failedTrajectory],
    jobs: [queuedJob, compileJob],
  };
}

/** The healthy fixture corpus (every supply available). */
export async function makeFixtureCorpus(): Promise<WorkbenchCorpus> {
  const records = await makeFixtureRecords();
  return {
    expertSupply: {
      section: 'experts',
      available: true,
      detail: 'fixture expert supply available',
      lastKnownAt: AT,
    },
    taskQueue: {
      section: 'tasks',
      available: true,
      detail: 'fixture task queue available',
      lastKnownAt: AT,
    },
    trajectoryStore: {
      section: 'trajectories',
      available: true,
      detail: 'fixture trajectory store available',
      lastKnownAt: AT,
    },
    jobStore: {
      section: 'jobs',
      available: true,
      detail: 'fixture job store available',
      lastKnownAt: AT,
    },
    ...records,
  };
}

/**
 * The degraded fixture corpus (R41): the expert supply is unavailable,
 * and the directory serves its LAST-KNOWN state (the same fixture
 * records — proving the banner-and-refresh flow over real data).
 */
export async function makeDegradedCorpus(): Promise<WorkbenchCorpus> {
  const records = await makeFixtureRecords();
  return {
    expertSupply: {
      section: 'experts',
      available: false,
      detail: 'fixture expert supply unavailable (registry unreachable)',
      lastKnownAt: AT,
    },
    taskQueue: {
      section: 'tasks',
      available: true,
      detail: 'fixture task queue available',
      lastKnownAt: AT,
    },
    trajectoryStore: {
      section: 'trajectories',
      available: true,
      detail: 'fixture trajectory store available',
      lastKnownAt: AT,
    },
    jobStore: {
      section: 'jobs',
      available: true,
      detail: 'fixture job store available',
      lastKnownAt: AT,
    },
    ...records,
  };
}

/**
 * The empty degraded corpus (R41 hard case): the expert supply is
 * unavailable AND no last-known state exists — the directory must render
 * an honest empty listing (NO invented data).
 */
export async function makeEmptyDegradedCorpus(): Promise<WorkbenchCorpus> {
  const records = await makeFixtureRecords();
  return {
    expertSupply: {
      section: 'experts',
      available: false,
      detail: 'fixture expert supply unavailable (no snapshot ever captured)',
      lastKnownAt: AT,
    },
    taskQueue: {
      section: 'tasks',
      available: true,
      detail: 'fixture task queue available',
      lastKnownAt: AT,
    },
    trajectoryStore: {
      section: 'trajectories',
      available: true,
      detail: 'fixture trajectory store available',
      lastKnownAt: AT,
    },
    jobStore: {
      section: 'jobs',
      available: true,
      detail: 'fixture job store available',
      lastKnownAt: AT,
    },
    ...records,
    profiles: [],
    claims: [],
    qualificationRecords: [],
    matchResults: [],
  };
}
