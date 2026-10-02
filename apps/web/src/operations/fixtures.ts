/**
 * The deterministic B014 operations corpus (Work Order B014;
 * apps/web/src/operations).
 *
 * PURE, DETERMINISTIC fixtures built EXCLUSIVELY through the PUBLIC APIs
 * of the sibling protocol packages (relative imports, the
 * expert-runtime posture): every object below is a REAL, validated,
 * content-addressed protocol object, not a look-alike JSON shape —
 *
 *   - jobs are REAL A015 `JobRecord`s: submitted through
 *     `createJobRecord` and driven through the package's own pure
 *     lifecycle transitions (`claimJob` / `progressJob` / `completeJob` /
 *     `failJob` / `cancelJob`), so the corpus carries the actual
 *     append-only event histories, attempt outcomes and retry backoff
 *     gates the state machine produces;
 *   - SLOs are REAL A035 objects: the product SLO catalog (the A035
 *     targets from docs/operations/slo-targets.md, with the documented
 *     0.9999 encoding of the "perfect 1.00" zero-budget targets) validated
 *     through `toSloDefinition`, evaluated through the package's own pure
 *     `evaluateSlo` over deterministic metric samples — including one
 *     deliberately no-data SLO (fail-closed) and one breached;
 *   - audit events are REAL A034 objects: validated through
 *     `toSecurityAuditEvent`, chained through `buildSecurityAuditRecord`
 *     and verified through `verifySecurityAuditChain` — append-only,
 *     digest-chained, tamper-evident;
 *   - capacity postures are REAL B002 objects: derived through
 *     `deriveCapacityStatus` over deterministic dimension readings,
 *     snapshotted through `toCapacitySnapshot`, projected through
 *     `toProviderHealth` and aggregated worst-of through
 *     `aggregateProviderHealth` — all four closed FT2.0 states appear
 *     (AVAILABLE, DEGRADED, EXHAUSTED, DISABLED).
 *
 * NO randomness and NO wall clock: every timestamp is a fixed narrative
 * constant, every digest either computed by the protocol package itself
 * or a fixed sha256-shaped constant. Two constructions of this corpus are
 * byte-identical (tested) — demo state stays deterministic, resettable
 * and visibly labelled, never customer state.
 */

import { canonicalJson, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  cancelJob,
  claimJob,
  completeJob,
  createJobRecord,
  failJob,
  progressJob,
} from '../../../../packages/job-protocol/src/index.js';
import type { JobRecord } from '../../../../packages/job-protocol/src/index.js';
import {
  evaluateSlo,
  toObservabilityTimestamp,
  toSloDefinition,
  toTelemetrySignal,
} from '../../../../packages/observability/src/index.js';
import type {
  MetricSignal,
  SloDefinition,
  SloEvaluation,
} from '../../../../packages/observability/src/index.js';
import {
  buildSecurityAuditRecord,
  toSecurityAuditEvent,
  verifySecurityAuditChain,
} from '../../../../packages/security/src/index.js';
import type {
  SecurityAuditRecord,
  SecurityAuditSnapshot,
} from '../../../../packages/security/src/index.js';
import {
  aggregateProviderHealth,
  deriveCapacityStatus,
  toCapacitySnapshot,
  toProviderHealth,
} from '../../../../packages/persistence/src/index.js';
import type {
  CapacityDimensionReading,
  ProviderHealth,
  ProviderHealthSnapshot,
} from '../../../../packages/persistence/src/index.js';

// ---------------------------------------------------------------------------
// Fixed narrative constants (no randomness, no wall clock)
// ---------------------------------------------------------------------------

/** The demo narrative epoch offsets used by this corpus (ms-precision UTC). */
export const OPERATIONS_DEMO_TIME = Object.freeze({
  t0: '2026-10-01T08:30:00.000Z',
  t1: '2026-10-01T08:35:00.000Z',
  t2: '2026-10-01T08:40:00.000Z',
  t3: '2026-10-01T08:45:00.000Z',
  t4: '2026-10-01T08:50:00.000Z',
  t5: '2026-10-01T08:55:00.000Z',
  t6: '2026-10-01T09:00:00.000Z',
} as const);

/** The instant every demo evaluation window and capacity snapshot closes on. */
export const OPERATIONS_DEMO_EPOCH_MS = Date.parse(OPERATIONS_DEMO_TIME.t0) as number;

/** Stable job ids for the demo detail routes (the ids double as route segments). */
export const OPERATIONS_DEMO_JOB_IDS = Object.freeze({
  regression: 'demo.job.regression-suite',
  upload: 'demo.job.trajectory-upload',
  evidence: 'demo.job.evidence-bundle',
  report: 'demo.job.report-render',
  scan: 'demo.job.escalation-scan',
} as const);

/** Fixed sha256-shaped digests for the objects this corpus references but does not construct. */
const DIGEST_DEMO_JOB_DEF_REGRESSION = 'b19a'.repeat(16);
const DIGEST_DEMO_JOB_DEF_UPLOAD = 'c21f'.repeat(16);
const DIGEST_DEMO_JOB_DEF_EVIDENCE = 'd31c'.repeat(16);
const DIGEST_DEMO_JOB_DEF_REPORT = 'e41b'.repeat(16);
const DIGEST_DEMO_JOB_DEF_SCAN = 'f51d'.repeat(16);
const DIGEST_DEMO_REGRESSION_ARTIFACT = '9e67'.repeat(16);

/** The retry policy every demo job submits under (3 attempts, 1-minute backoff). */
const DEMO_JOB_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  backoffScheduleMs: Object.freeze([60_000, 60_000, 60_000]),
  retryableErrorClasses: Object.freeze(['dependency-unavailable', 'upstream-timeout']),
} as const);

// ---------------------------------------------------------------------------
// Jobs (REAL A015 records, driven through the package's own transitions)
// ---------------------------------------------------------------------------

function submitDemoJob(input: {
  readonly jobId: string;
  readonly definitionDigest: string;
  readonly kind: { readonly namespace: string; readonly name: string; readonly version: string };
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly jobInput: Record<string, unknown>;
}): JobRecord {
  return createJobRecord({
    definitionDigest: input.definitionDigest,
    kind: { ...input.kind },
    correlationId: toCorrelationId(input.correlationId),
    idempotencyKey: toIdempotencyKey(input.idempotencyKey),
    idempotencyScope: 'demo-operations',
    input: input.jobInput,
    policy: {
      timeoutMs: 300_000,
      retry: {
        maxAttempts: DEMO_JOB_RETRY_POLICY.maxAttempts,
        backoffScheduleMs: [...DEMO_JOB_RETRY_POLICY.backoffScheduleMs],
        retryableErrorClasses: [...DEMO_JOB_RETRY_POLICY.retryableErrorClasses],
      },
    },
    jobId: input.jobId,
    submittedAt: OPERATIONS_DEMO_TIME.t0,
  });
}

function buildDemoJobs(): readonly JobRecord[] {
  const { t1, t2, t3, t4, t5, t6 } = OPERATIONS_DEMO_TIME;

  // 1) Succeeded: submitted, claimed, progressed, completed with a result.
  const regression = completeJob(
    progressJob(
      claimJob(
        submitDemoJob({
          jobId: OPERATIONS_DEMO_JOB_IDS.regression,
          definitionDigest: DIGEST_DEMO_JOB_DEF_REGRESSION,
          kind: { namespace: 'arena-demo', name: 'regression-suite-run', version: '1.0.0' },
          correlationId: 'demo-corr-job-regression',
          idempotencyKey: 'demo-idem-job-regression',
          jobInput: { caseRef: 'demo.capability-case.payments-reliability' },
        }),
        { at: t1 },
      ),
      { at: t2, percent: 60, note: 'Compiling the regression matrix' },
    ),
    {
      at: t3,
      result: { verdict: 'green', suitesRun: 12, artifactDigest: DIGEST_DEMO_REGRESSION_ARTIFACT },
    },
  );

  // 2) Running: claimed, mid-progress — the outcome stays pending, never assumed.
  const upload = progressJob(
    claimJob(
      submitDemoJob({
        jobId: OPERATIONS_DEMO_JOB_IDS.upload,
        definitionDigest: DIGEST_DEMO_JOB_DEF_UPLOAD,
        kind: { namespace: 'arena-demo', name: 'trajectory-upload', version: '1.0.0' },
        correlationId: 'demo-corr-job-upload',
        idempotencyKey: 'demo-idem-job-upload',
        jobInput: { trajectoryRef: 'demo.trajectory.payments-reliability' },
      }),
      { at: t1 },
    ),
    { at: t2, percent: 45, note: 'Streaming trajectory chunks' },
  );

  // 3) Re-queued after a retryable failure: attempt 1 failed, backoff gate set.
  const evidence = failJob(
    claimJob(
      submitDemoJob({
        jobId: OPERATIONS_DEMO_JOB_IDS.evidence,
        definitionDigest: DIGEST_DEMO_JOB_DEF_EVIDENCE,
        kind: { namespace: 'arena-demo', name: 'evidence-bundle-pack', version: '1.0.0' },
        correlationId: 'demo-corr-job-evidence',
        idempotencyKey: 'demo-idem-job-evidence',
        jobInput: { bundleKind: 'verification-evidence' },
      }),
      { at: t1 },
    ),
    { at: t2, errorClass: 'dependency-unavailable', message: 'object store returned 503 while packing the bundle' },
  );

  // 4) Failed terminally: all three attempts exhausted the retry policy.
  let report = claimJob(
    submitDemoJob({
      jobId: OPERATIONS_DEMO_JOB_IDS.report,
      definitionDigest: DIGEST_DEMO_JOB_DEF_REPORT,
      kind: { namespace: 'arena-demo', name: 'report-render', version: '1.0.0' },
      correlationId: 'demo-corr-job-report',
      idempotencyKey: 'demo-idem-job-report',
      jobInput: { reportKind: 'evaluation-summary' },
    }),
    { at: t1 },
  );
  report = failJob(report, {
    at: t2,
    errorClass: 'dependency-unavailable',
    message: 'render dependency unavailable (attempt 1)',
  });
  report = claimJob(report, { at: t3 });
  report = failJob(report, {
    at: t4,
    errorClass: 'dependency-unavailable',
    message: 'render dependency unavailable (attempt 2)',
  });
  report = claimJob(report, { at: t5 });
  report = failJob(report, {
    at: t6,
    errorClass: 'dependency-unavailable',
    message: 'render dependency unavailable (attempt 3, retry budget exhausted)',
  });

  // 5) Cancelled while running: terminal, with the recorded reason.
  const scan = cancelJob(
    claimJob(
      submitDemoJob({
        jobId: OPERATIONS_DEMO_JOB_IDS.scan,
        definitionDigest: DIGEST_DEMO_JOB_DEF_SCAN,
        kind: { namespace: 'arena-demo', name: 'escalation-scan', version: '1.0.0' },
        correlationId: 'demo-corr-job-scan',
        idempotencyKey: 'demo-idem-job-scan',
        jobInput: { scanKind: 'escalation-reference-flow' },
      }),
      { at: t1 },
    ),
    { at: t2, reason: 'superseded by direct expert review' },
  );

  return Object.freeze([regression, upload, evidence, report, scan]);
}

// ---------------------------------------------------------------------------
// SLOs (REAL A035 definitions + evaluations over deterministic samples)
// ---------------------------------------------------------------------------

/**
 * The A035 SLO catalog (docs/operations/slo-targets.md). Documented
 * deviation, mirroring the deployment-side catalog: the A035 doc expresses
 * three targets as a "perfect 1.00" (zero error budget) — `SloDefinition`
 * targets are strict ratios in (0, 1), so the zero-budget intent is
 * represented as 0.9999 with a 25% at-risk threshold; the zero-tolerance
 * semantics live in the ops rollback policy.
 */
const RAW_SLO_CATALOG = [
  {
    definitionVersion: 1,
    sloId: 'slo-job-completion',
    name: 'Job completion ratio',
    service: 'job-orchestrator',
    sli: { kind: 'good-total-ratio', metricName: 'job-outcome-good', thresholdMs: null },
    targetRatio: 0.99,
    windowMs: 3_600_000,
    minSampleCount: 20,
    atRiskThresholdRatio: 0.5,
    description: 'share of jobs that complete successfully',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-job-latency',
    name: 'Job latency under 5 minutes',
    service: 'job-orchestrator',
    sli: { kind: 'latency-threshold-ratio', metricName: 'job-duration-ms', thresholdMs: 300_000 },
    targetRatio: 0.95,
    windowMs: 3_600_000,
    minSampleCount: 20,
    atRiskThresholdRatio: 0.5,
    description: 'share of jobs completing within 300000ms',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-environment-isolation',
    name: 'Environment isolation integrity',
    service: 'environment-runner',
    sli: { kind: 'good-total-ratio', metricName: 'run-isolation-violation', thresholdMs: null },
    targetRatio: 0.9999,
    windowMs: 86_400_000,
    minSampleCount: 10,
    atRiskThresholdRatio: 0.25,
    description: 'share of runs with zero isolation violations',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-runner-lease',
    name: 'Runner lease renewal ratio',
    service: 'environment-runner',
    sli: { kind: 'good-total-ratio', metricName: 'runner-lease-renewed', thresholdMs: null },
    targetRatio: 0.999,
    windowMs: 86_400_000,
    minSampleCount: 100,
    atRiskThresholdRatio: 0.5,
    description: 'share of runner lease renewals that succeed on time',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-certification-determinism',
    name: 'Certification replay determinism',
    service: 'certification-fabric',
    sli: { kind: 'good-total-ratio', metricName: 'certification-replay-identical', thresholdMs: null },
    targetRatio: 0.9999,
    windowMs: 86_400_000,
    minSampleCount: 10,
    atRiskThresholdRatio: 0.25,
    description: 'share of certification replays that are identical',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-audit-chain-integrity',
    name: 'Security audit chain integrity',
    service: 'security-service',
    sli: { kind: 'good-total-ratio', metricName: 'audit-chain-verified', thresholdMs: null },
    targetRatio: 0.9999,
    windowMs: 86_400_000,
    minSampleCount: 10,
    atRiskThresholdRatio: 0.25,
    description: 'share of audit-chain verifications that pass',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-console-availability',
    name: 'Console availability ratio',
    service: 'console',
    sli: { kind: 'good-total-ratio', metricName: 'console-request-good', thresholdMs: null },
    targetRatio: 0.995,
    windowMs: 3_600_000,
    minSampleCount: 100,
    atRiskThresholdRatio: 0.5,
    description: 'share of console requests served successfully',
  },
  {
    definitionVersion: 1,
    sloId: 'slo-observability-ingestion',
    name: 'Observability ingestion acceptance',
    service: 'observability-service',
    sli: { kind: 'good-total-ratio', metricName: 'ingest-accepted', thresholdMs: null },
    targetRatio: 0.999,
    windowMs: 3_600_000,
    minSampleCount: 100,
    atRiskThresholdRatio: 0.5,
    description: 'share of telemetry ingestions accepted',
  },
] as const;

/** The frozen A035 SLO catalog, validated fail-closed through the package's own `toSloDefinition`. */
export function buildSloCatalog(): readonly SloDefinition[] {
  return Object.freeze(RAW_SLO_CATALOG.map((entry) => toSloDefinition(entry)));
}

/** One deterministic metric sample inside a window (built through the package's public validator). */
function metricSample(input: {
  readonly sloId: string;
  readonly index: number;
  readonly at: number;
  readonly service: string;
  readonly metricName: string;
  readonly metricType: 'counter' | 'timer';
  readonly unit: 'count' | 'milliseconds';
  readonly value: number;
}): MetricSignal {
  return toTelemetrySignal({
    signalVersion: 1,
    kind: 'metric',
    signalId: `demo-sig-${input.sloId}-${String(input.index).padStart(4, '0')}`,
    sequence: input.index + 1,
    occurredAt: toObservabilityTimestamp(input.at),
    sourceService: input.service,
    correlationId: toCorrelationId(`demo-corr-${input.sloId}`),
    causationId: null,
    tenantId: 'arena-demo',
    metricName: input.metricName,
    metricType: input.metricType,
    unit: input.unit,
    value: input.value,
    labels: {},
  }) as MetricSignal;
}

/** The evaluation window of one definition, closing on the demo epoch (duration MUST equal windowMs). */
function windowOf(definition: SloDefinition): {
  readonly windowStart: number;
  readonly windowEnd: number;
} {
  return {
    windowStart: OPERATIONS_DEMO_EPOCH_MS - definition.windowMs,
    windowEnd: OPERATIONS_DEMO_EPOCH_MS,
  };
}

/** Deterministically spread `count` sample instants inside the window (ascending, in-window). */
function sampleTimes(windowMs: number, count: number, windowStart: number): number[] {
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    times.push(windowStart + Math.round(((index + 1) * windowMs) / (count + 1)));
  }
  return times;
}

/**
 * The verdict distribution the demo corpus deliberately carries: one
 * breach, two at-risk, four met and — honestly — one no-data SLO
 * (fail-closed: below the minimum sample count, never a pass).
 */
function buildSloEvaluations(catalog: readonly SloDefinition[]): readonly SloEvaluation[] {
  const evaluations: SloEvaluation[] = [];
  for (const definition of catalog) {
    const window = windowOf(definition);
    const isLatency = definition.sli.kind === 'latency-threshold-ratio';
    const times = sampleTimes(
      definition.windowMs,
      SAMPLE_COUNTS[definition.sloId] ?? 0,
      window.windowStart,
    );
    const samples = times.map((at, index) => {
      const value = SAMPLE_VALUE_OVERRIDES[definition.sloId]?.(index) ?? 1;
      return metricSample({
        sloId: definition.sloId,
        index,
        at,
        service: definition.service,
        metricName: definition.sli.metricName,
        metricType: isLatency ? 'timer' : 'counter',
        unit: isLatency ? 'milliseconds' : 'count',
        value,
      });
    });
    evaluations.push(
      evaluateSlo({
        definition,
        window: {
          windowStart: toObservabilityTimestamp(window.windowStart),
          windowEnd: toObservabilityTimestamp(window.windowEnd),
        },
        samples,
      }),
    );
  }
  return Object.freeze(evaluations);
}

/** Sample counts per SLO (the honest no-data case sits below its minimum). */
const SAMPLE_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  'slo-job-completion': 25,
  'slo-job-latency': 24,
  'slo-environment-isolation': 10,
  'slo-runner-lease': 100,
  'slo-certification-determinism': 9,
  'slo-audit-chain-integrity': 12,
  'slo-console-availability': 200,
  'slo-observability-ingestion': 100,
} as const);

/** Value overrides per SLO (default 1 = good event; 0 = bad event; latency values in ms). */
const SAMPLE_VALUE_OVERRIDES: Readonly<Record<string, (index: number) => number>> = Object.freeze({
  // 24 of 25 good → 0.96 achieved against a 0.99 target: an honest breach.
  'slo-job-completion': (index: number) => (index === 12 ? 0 : 1),
  // 23 of 24 under the 300s threshold → at-risk (budget burn above the at-risk bar).
  'slo-job-latency': (index: number) => (index === 5 ? 320_000 : 30_000 + index * 9_000),
  // 199 of 200 good → exactly at the 0.995 target: budget fully burned → at-risk.
  'slo-console-availability': (index: number) => (index === 100 ? 0 : 1),
});

/**
 * Evaluate one SLO over an EMPTY sample set (the honest session-posture
 * measurement: the A035 evaluator itself fails closed — verdict no-data,
 * budget reported exhausted — never a fabricated pass).
 */
export function evaluateSloEmpty(definition: SloDefinition, windowEnd: number): SloEvaluation {
  return evaluateSlo({
    definition,
    window: {
      windowStart: toObservabilityTimestamp(windowEnd - definition.windowMs),
      windowEnd: toObservabilityTimestamp(windowEnd),
    },
    samples: [],
  });
}

// ---------------------------------------------------------------------------
// Audit (REAL A034 events, chained + verified through the package)
// ---------------------------------------------------------------------------

const DEMO_AUDIT_EVENT_SEEDS = [
  {
    recordVersion: 1,
    eventId: '7f0c2b1a-3d4e-4f5a-8b6c-9d0e1f2a3b4c',
    kind: 'authorization-decision',
    tenantId: 'arena-demo',
    principalId: 'demo-visitor',
    action: 'read',
    boundaryClass: 'operations-surface',
    outcome: { effect: 'allow', reason: 'operator-role-lens' },
    correlationId: 'demo-corr-ops-0001',
    causationId: null,
    occurredAt: OPERATIONS_DEMO_TIME.t0,
  },
  {
    recordVersion: 1,
    eventId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    kind: 'tenant-access-denied',
    tenantId: 'arena-demo',
    principalId: 'principal-foreign-visitor',
    action: 'read',
    boundaryClass: 'capability-case',
    outcome: { effect: 'deny', reason: 'tenant-scope-violation' },
    correlationId: 'demo-corr-ops-0002',
    causationId: 'c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f',
    occurredAt: OPERATIONS_DEMO_TIME.t1,
  },
  {
    recordVersion: 1,
    eventId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
    kind: 'secret-detected',
    tenantId: 'arena-demo',
    principalId: null,
    action: 'telemetry-scan',
    boundaryClass: 'observability-ingestion',
    outcome: { effect: 'recorded', reason: 'credential-pattern-detected' },
    correlationId: 'demo-corr-ops-0003',
    causationId: null,
    occurredAt: OPERATIONS_DEMO_TIME.t2,
  },
  {
    recordVersion: 1,
    eventId: '3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f',
    kind: 'policy-registered',
    tenantId: 'arena-demo',
    principalId: 'demo-governance',
    action: 'register',
    boundaryClass: 'security-policy',
    outcome: { effect: 'recorded', reason: 'security-policy-version-registered' },
    correlationId: 'demo-corr-ops-0004',
    causationId: null,
    occurredAt: OPERATIONS_DEMO_TIME.t3,
  },
] as const;

async function buildDemoAuditChain(): Promise<{
  readonly records: readonly SecurityAuditRecord[];
  readonly snapshot: SecurityAuditSnapshot;
}> {
  const records: SecurityAuditRecord[] = [];
  let previous: SecurityAuditRecord | null = null;
  for (const [index, seed] of DEMO_AUDIT_EVENT_SEEDS.entries()) {
    const payload = toSecurityAuditEvent(seed);
    previous = await buildSecurityAuditRecord(previous, payload, index + 1);
    records.push(previous);
  }
  const snapshot = await verifySecurityAuditChain(records);
  if (!snapshot.verified) {
    throw new Error('demo audit chain must verify (deterministic corpus, fail closed)');
  }
  return { records: Object.freeze(records), snapshot };
}

// ---------------------------------------------------------------------------
// Capacity (REAL B002 snapshots, all four closed FT2.0 states)
// ---------------------------------------------------------------------------

/** One provider in the operations capacity registry (provider-neutral, hosted posture in parentheses). */
export interface OperationsProviderSpec {
  readonly providerId: string;
  readonly role: string;
  readonly note: string;
}

/**
 * The provider-neutral capacity registry (FT2.0): which logical provider
 * carries what. Provider names live only in the hosted adapter layer —
 * this surface renders the LOGICAL roles.
 */
export const OPERATIONS_PROVIDERS: readonly OperationsProviderSpec[] = Object.freeze([
  {
    providerId: 'control-plane-store',
    role: 'Authoritative control-plane records (hosted posture: Postgres)',
    note: 'The authoritative store for control-plane records; bounded free-tier storage and compute-hour allowances.',
  },
  {
    providerId: 'coordination-store',
    role: 'Bounded, rebuildable coordination state — caches, idempotency windows, rate limits, leases (hosted posture: Redis)',
    note: 'Only bounded/rebuildable state lives here; authoritative facts never do.',
  },
  {
    providerId: 'object-store',
    role: 'Trajectories, datasets, evidence bundles and releases (hosted posture: object storage)',
    note: 'Content-addressed blobs with a monthly storage allowance and operation quotas.',
  },
  {
    providerId: 'job-compute',
    role: 'Request-scoped functions and bounded long-running job compute (hosted posture: platform functions)',
    note: 'Long-running jobs run as durable job records with bounded worker execution — never inside one request.',
  },
] as const);

/** One provider health entry paired with its registry role. */
export interface DemoProviderHealth {
  readonly health: ProviderHealth;
  readonly role: string;
  readonly note: string;
}

const DEMO_CAPACITY_DIMENSIONS: Readonly<Record<string, readonly CapacityDimensionReading[]>> =
  Object.freeze({
    'control-plane-store': [
      { dimension: 'storage', used: 210, limit: 512, remaining: 302, windowMs: null },
      { dimension: 'compute-hours', used: 12, limit: 100, remaining: 88, windowMs: 2_678_400_000 },
    ],
    'coordination-store': [
      { dimension: 'commands', used: 480_000, limit: 500_000, remaining: 20_000, windowMs: 2_592_000_000 },
    ],
    'object-store': [
      { dimension: 'storage', used: 10_240, limit: 10_240, remaining: 0, windowMs: null },
      { dimension: 'class-a-operations', used: 950_000, limit: 1_000_000, remaining: 50_000, windowMs: 2_592_000_000 },
    ],
    // job-compute renders DISABLED (configuration-missing) — no dimensions.
  } as const);

function buildDemoProviderHealths(): readonly DemoProviderHealth[] {
  const entries: DemoProviderHealth[] = [];
  for (const spec of OPERATIONS_PROVIDERS) {
    const dimensions = DEMO_CAPACITY_DIMENSIONS[spec.providerId];
    const health: ProviderHealth =
      dimensions !== undefined
        ? toProviderHealth(
            spec.providerId,
            toCapacitySnapshot({
              status: deriveCapacityStatus(dimensions).status,
              checkedAt: OPERATIONS_DEMO_EPOCH_MS,
              dimensions,
              reasons: deriveCapacityStatus(dimensions).reasons,
            }),
          )
        : toProviderHealth(
            spec.providerId,
            toCapacitySnapshot({
              status: 'DISABLED',
              checkedAt: OPERATIONS_DEMO_EPOCH_MS,
              dimensions: [],
              reasons: [{ code: 'configuration-missing' }],
            }),
          );
    entries.push(Object.freeze({ health, role: spec.role, note: spec.note }));
  }
  return Object.freeze(entries);
}

/**
 * The session-posture provider healths: the hosted adapters are NOT wired
 * in the local posture (B015/B016 wire them through the same
 * CapacityProbe port), so every provider reads DISABLED with reason
 * `configuration-missing` — the B002 contract's own fail-closed unwired
 * posture, rendered explicitly, never as unlimited and never as an error.
 */
export function buildSessionProviderHealths(checkedAt: number): readonly ProviderHealth[] {
  return Object.freeze(
    OPERATIONS_PROVIDERS.map((spec) =>
      toProviderHealth(
        spec.providerId,
        toCapacitySnapshot({
          status: 'DISABLED',
          checkedAt,
          dimensions: [],
          reasons: [{ code: 'configuration-missing' }],
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** The deterministic B014 operations demo corpus. */
export interface OperationsDemoCorpus {
  /** REAL A015 job records: succeeded, running, re-queued, failed (retry-exhausted), cancelled. */
  readonly jobs: readonly JobRecord[];
  /** The frozen A035 SLO catalog (8 SLOs). */
  readonly sloCatalog: readonly SloDefinition[];
  /** REAL A035 evaluations: met, at-risk, breached and one no-data (fail-closed). */
  readonly sloEvaluations: readonly SloEvaluation[];
  /** REAL A034 audit records: chained, verified. */
  readonly auditRecords: readonly SecurityAuditRecord[];
  readonly auditChainVerified: boolean;
  readonly auditHeadDigest: string;
  /** REAL B002 provider healths across all four closed FT2.0 states + their registry roles. */
  readonly providers: readonly DemoProviderHealth[];
  readonly capacityOverall: ProviderHealthSnapshot;
  /** Canonical-JSON determinism stamp over the ordered corpus identities. */
  readonly corpusHash: string;
}

/**
 * Build the deterministic B014 operations corpus. PURE: identical calls
 * yield identical protocol objects (identical digests, identical
 * evaluations) — no randomness, no clock, no shared state.
 */
export async function buildOperationsDemoCorpus(): Promise<OperationsDemoCorpus> {
  const jobs = buildDemoJobs();
  const sloCatalog = buildSloCatalog();
  const sloEvaluations = buildSloEvaluations(sloCatalog);
  const audit = await buildDemoAuditChain();
  const providers = buildDemoProviderHealths();
  const capacityOverall = aggregateProviderHealth(
    providers.map((entry) => entry.health),
    OPERATIONS_DEMO_EPOCH_MS,
  );

  const corpusHash = canonicalJson([
    OPERATIONS_DEMO_TIME.t0,
    ...jobs.map((job) => [job.jobId, job.status, job.updatedAt]),
    ...sloEvaluations.map((evaluation) => [
      evaluation.sloId,
      evaluation.verdict,
      evaluation.sampleCount,
    ]),
    audit.records[audit.records.length - 1]?.digest ?? 'empty-audit-chain',
    ...providers.map((entry) => [entry.health.providerId, entry.health.status]),
    capacityOverall.overall,
  ]);

  return Object.freeze({
    jobs,
    sloCatalog,
    sloEvaluations,
    auditRecords: audit.records,
    auditChainVerified: audit.snapshot.verified,
    auditHeadDigest: audit.records[audit.records.length - 1]?.digest ?? '',
    providers,
    capacityOverall,
    corpusHash,
  } satisfies OperationsDemoCorpus);
}
