/**
 * The deterministic B011 replay demo corpus (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * PURE, DETERMINISTIC fixtures built EXCLUSIVELY through the PUBLIC APIs
 * of the sibling protocol packages (@arena/trajectory,
 * @arena/environment-runtime, @arena/evaluation, @arena/verification —
 * the expert-runtime posture): every object below is a REAL, validated,
 * content-addressed protocol object, not a look-alike JSON shape. The
 * corpus carries the B006 demo narrative (the payments-reliability
 * case) with NO randomness and NO wall clock — every timestamp is a
 * fixed narrative constant, every digest either computed by the
 * protocol package itself or a fixed sha256-shaped constant.
 *
 * Three runs, deliberately demonstrating the replay surface's truth
 * postures side by side:
 *   - run A (payments-reliability-a): COMPLETED — a full trajectory
 *     (action/observation/checkpoint/completion), a full environment
 *     event stream, an A010 RunResult, and the A012/A013 linkage (an
 *     evaluation record + a verification record bound to the
 *     trajectory digest by content addressing);
 *   - run B (payments-reliability-b): IN FLIGHT — a structurally
 *     consistent trajectory with NO completion entry (PENDING — never
 *     guessed) and an event stream that stops mid-run;
 *   - run C (payments-reliability-c): FAILED — an error entry mid-run,
 *     a completion entry with outcome 'failed' and no evidence
 *     addresses, and NO RunResult (A010: run results exist only for
 *     completed runs — failed runs are evidenced by their event
 *     streams).
 *
 * Two constructions of this corpus are byte-identical (tested): the
 * demo composition (/demo/replay) renders this corpus and the unit
 * tests assert its determinism, so demo state stays deterministic,
 * resettable and visibly labelled — never customer state.
 */

import { canonicalJson, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  appendTrajectoryEntry,
  createTrajectoryRecord,
  createTrajectoryHeader,
} from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import {
  appendRuntimeEventEnvelope,
  createEnvironmentEventLog,
  createRunRecord,
  createRunResult,
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeRunResultProducedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
  makeRuntimeEventEnvelope,
} from '@arena/environment-runtime';
import type { EnvironmentEventLog, RunRecord, RunResult } from '@arena/environment-runtime';
import {
  createEvaluationCriteria,
  createEvaluatorDescriptor,
  createEvaluationRecord,
} from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import {
  createVerificationRecord,
  createVerifierDescriptor,
} from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';

// ---------------------------------------------------------------------------
// Fixed narrative constants (no randomness, no wall clock)
// ---------------------------------------------------------------------------

/** The demo narrative epoch offsets used by this corpus (ms-precision UTC). */
export const REPLAY_DEMO_TIME = Object.freeze({
  t0: '2026-10-01T08:00:00.000Z',
  t1: '2026-10-01T08:01:00.000Z',
  t2: '2026-10-01T08:02:00.000Z',
  t3: '2026-10-01T08:03:00.000Z',
  t4: '2026-10-01T08:04:00.000Z',
  t5: '2026-10-01T08:05:00.000Z',
  t6: '2026-10-01T08:06:00.000Z',
  t7: '2026-10-01T08:07:00.000Z',
  t8: '2026-10-01T08:08:00.000Z',
  t9: '2026-10-01T08:09:00.000Z',
  t10: '2026-10-01T08:10:00.000Z',
  t11: '2026-10-01T08:11:00.000Z',
  t12: '2026-10-01T08:12:00.000Z',
} as const);

/** Stable tenant-scoped run ids for the demo replay routes. */
export const REPLAY_DEMO_IDS = Object.freeze({
  runA: 'arena-demo/payments-reliability-a',
  runB: 'arena-demo/payments-reliability-b',
  runC: 'arena-demo/payments-reliability-c',
} as const);

/** Fixed sha256-shaped digests for objects this corpus references but does not construct. */
const DIGEST_DEMO_ENV = '3a1e'.repeat(16);
const DIGEST_DEMO_SNAPSHOT_A = '5aab'.repeat(16);
const DIGEST_DEMO_SNAPSHOT_A2 = '6bbc'.repeat(16);
const DIGEST_DEMO_SNAPSHOT_B = '7ccd'.repeat(16);
const DIGEST_DEMO_SNAPSHOT_C = '8dde'.repeat(16);
const DIGEST_DEMO_BODY_VERSION = 'b04d'.repeat(16);
const DIGEST_DEMO_SUBSTRATE = '5cab'.repeat(16);
const DIGEST_DEMO_REGRESSION = '9e67'.repeat(16);
const DIGEST_DEMO_REVIEW = '2ec0'.repeat(16);

/** The reserved demo tenant (B006). */
const DEMO_TENANT = 'arena-demo';

/** The demo environment version ref every demo run pins. */
const DEMO_ENVIRONMENT = Object.freeze({
  namespace: 'arena-demo',
  name: 'sandboxed-workspace',
  version: '1.0.0',
  digest: DIGEST_DEMO_ENV,
});

/** The task version the payments-reliability narrative addresses. */
const DEMO_TASK_VERSION = Object.freeze({
  taskId: 'payments-reliability',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One replayed demo run: the canonical objects the run detail renders. */
export interface ReplayDemoRun {
  /** The tenant-scoped run id (`arena-demo/<run-key>`). */
  readonly runId: string;
  readonly runRecord: RunRecord;
  readonly trajectory: TrajectoryRecord;
  /** The per-run environment event log (enveloped A010 runtime events). */
  readonly eventLog: EnvironmentEventLog;
  /** The A010 RunResult (completed runs only; null for B and C). */
  readonly runResult: RunResult | null;
  /** A012 evaluation records bound to this run's trajectory digest. */
  readonly evaluationRecords: readonly EvaluationRecord[];
  /** A013 verification records linked to this run's evidence. */
  readonly verificationRecords: readonly VerificationRecord[];
}

/** The deterministic replay demo corpus. */
export interface ReplayDemoCorpus {
  readonly runs: readonly ReplayDemoRun[];
  /** Canonical-JSON determinism stamp over the ordered run ids + digests. */
  readonly corpusHash: string;
}

// ---------------------------------------------------------------------------
// Trajectory builders (PUBLIC @arena/trajectory factories only)
// ---------------------------------------------------------------------------

async function buildRunTrajectory(input: {
  readonly trajectoryId: string;
  readonly runKey: string;
  readonly initialSnapshotDigest: string;
  readonly runRecordDigest: string;
  readonly seed: string;
  readonly startedAt: string;
  readonly steps: ReadonlyArray<{
    readonly kind: 'action' | 'observation' | 'checkpoint' | 'error' | 'completion';
    readonly payload: unknown;
    readonly occurredAt: string;
  }>;
}): Promise<TrajectoryRecord> {
  const header = await createTrajectoryHeader({
    trajectoryId: input.trajectoryId,
    run: {
      taskVersion: { ...DEMO_TASK_VERSION },
      environmentVersion: { ...DEMO_ENVIRONMENT },
      runId: `${DEMO_TENANT}/${input.runKey}`,
      initialSnapshotDigest: input.initialSnapshotDigest,
      runRecordDigest: input.runRecordDigest,
    },
    agentBodyRef: DIGEST_DEMO_BODY_VERSION,
    substrateRef: DIGEST_DEMO_SUBSTRATE,
    startedAt: input.startedAt,
    seed: input.seed,
  });
  let record = createTrajectoryRecord(header);
  let sequence = 0;
  for (const step of input.steps) {
    sequence += 1;
    record = await appendTrajectoryEntry(record, {
      sequence,
      kind: step.kind,
      payload: step.payload,
      occurredAt: step.occurredAt,
    });
  }
  return record;
}

// ---------------------------------------------------------------------------
// Event log builders (PUBLIC @arena/environment-runtime factories only)
// ---------------------------------------------------------------------------

function append(
  log: EnvironmentEventLog,
  event: Parameters<typeof makeRuntimeEventEnvelope>[0],
  correlationId: string,
  idempotencyKey: string,
): EnvironmentEventLog {
  return appendRuntimeEventEnvelope(
    log,
    makeRuntimeEventEnvelope(event, {
      correlationId: toCorrelationId(correlationId),
      idempotencyKey: toIdempotencyKey(idempotencyKey),
    }),
  );
}

async function buildRunEventLog(input: {
  readonly runKey: string;
  readonly runRecord: RunRecord;
  readonly seed: string | null;
  /** The run's start time (the first trajectory step's timestamp). */
  readonly startedAt: string;
  /**
   * The mid-run events in TIME order (the log enforces monotonic
   * timestamps + kind adjacency): workload steps and checkpoints. A
   * checkpoint expands to its full legal sequence (running→checkpointing,
   * checkpoint-recorded, checkpointing→running).
   */
  readonly midRun: ReadonlyArray<
    | { readonly kind: 'workload'; readonly occurredAt: string; readonly step: number; readonly elapsedMs: number; readonly note?: string }
    | { readonly kind: 'checkpoint'; readonly occurredAt: string; readonly snapshotDigest: string; readonly stepIndex: number }
  >;
  readonly outcome: 'completed' | 'failed' | 'in-flight';
  /** The A010 RunResult payload (completed runs only). */
  readonly resultPayload: { readonly resultDigest: string; readonly trajectoryDigest: string; readonly evidenceDigests: readonly string[]; readonly occurredAt: string } | null;
  /** When the run failed (the failure transition's timestamp). */
  readonly failedAt: string | null;
}): Promise<EnvironmentEventLog> {
  const correlationId = `demo-corr-replay-${input.runKey}`;
  let log = createEnvironmentEventLog();
  const tenant = DEMO_TENANT;
  const runId = `${tenant}/${input.runKey}`;
  let sequence = 0;
  const next = () => {
    sequence += 1;
    return sequence;
  };

  // 1. run-submitted (the mandatory stream opener).
  log = append(
    log,
    makeRunSubmittedEvent({
      sequence: next(),
      occurredAt: input.runRecord.submittedAt,
      runId,
      tenantId: tenant,
      recordDigest: input.runRecord.digest,
      jobRef: input.runRecord.jobRef,
      seed: input.seed,
    }),
    correlationId,
    `demo-idem-${input.runKey}-evt-${String(sequence)}`,
  );

  // 2. admission-decided (admitted — the demo narrative fits the envelope).
  log = append(
    log,
    makeAdmissionDecidedEvent({
      sequence: next(),
      occurredAt: input.runRecord.submittedAt,
      runId,
      tenantId: tenant,
      admitted: true,
      violations: [],
    }),
    correlationId,
    `demo-idem-${input.runKey}-evt-${String(sequence)}`,
  );

  // 3-5. requested → provisioning → ready → running.
  log = append(
    log,
    makeStateTransitionedEvent({
      sequence: next(),
      occurredAt: input.runRecord.submittedAt,
      runId,
      tenantId: tenant,
      from: 'requested',
      to: 'provisioning',
      lifecycleEvent: 'provision-started',
    }),
    correlationId,
    `demo-idem-${input.runKey}-evt-${String(sequence)}`,
  );
  log = append(
    log,
    makeStateTransitionedEvent({
      sequence: next(),
      occurredAt: input.runRecord.submittedAt,
      runId,
      tenantId: tenant,
      from: 'provisioning',
      to: 'ready',
      lifecycleEvent: 'provisioned',
    }),
    correlationId,
    `demo-idem-${input.runKey}-evt-${String(sequence)}`,
  );
  const startedAt = input.startedAt;
  log = append(
    log,
    makeStateTransitionedEvent({
      sequence: next(),
      occurredAt: startedAt,
      runId,
      tenantId: tenant,
      from: 'ready',
      to: 'running',
      lifecycleEvent: 'started',
    }),
    correlationId,
    `demo-idem-${input.runKey}-evt-${String(sequence)}`,
  );

  // 6. mid-run events (workload steps + checkpoints with their full
  //    legal transition sequences), in the order supplied.
  for (const event of input.midRun) {
    if (event.kind === 'workload') {
      log = append(
        log,
        makeWorkloadProgressedEvent({
          sequence: next(),
          occurredAt: event.occurredAt,
          runId,
          tenantId: tenant,
          step: event.step,
          simulatedElapsedMs: event.elapsedMs,
          ...(event.note !== undefined ? { note: event.note } : {}),
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
    } else {
      // The checkpoint's legal sequence: running → checkpointing →
      // (record) → back to running.
      log = append(
        log,
        makeStateTransitionedEvent({
          sequence: next(),
          occurredAt: event.occurredAt,
          runId,
          tenantId: tenant,
          from: 'running',
          to: 'checkpointing',
          lifecycleEvent: 'checkpoint-started',
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
      log = append(
        log,
        makeCheckpointRecordedEvent({
          sequence: next(),
          occurredAt: event.occurredAt,
          runId,
          tenantId: tenant,
          checkpointSequence: 1,
          snapshotDigest: event.snapshotDigest,
          stepIndex: event.stepIndex,
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
      log = append(
        log,
        makeStateTransitionedEvent({
          sequence: next(),
          occurredAt: event.occurredAt,
          runId,
          tenantId: tenant,
          from: 'checkpointing',
          to: 'running',
          lifecycleEvent: 'checkpoint-completed',
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
    }
  }

  // 7. outcome transition (+ result + cleanup for terminal outcomes).
  if (input.outcome === 'completed') {
    log = append(
      log,
      makeStateTransitionedEvent({
        sequence: next(),
        occurredAt: input.resultPayload?.occurredAt ?? startedAt,
        runId,
        tenantId: tenant,
        from: 'running',
        to: 'completed',
        lifecycleEvent: 'completed',
      }),
      correlationId,
      `demo-idem-${input.runKey}-evt-${String(sequence)}`,
    );
    if (input.resultPayload !== null) {
      log = append(
        log,
        makeRunResultProducedEvent({
          sequence: next(),
          occurredAt: input.resultPayload.occurredAt,
          runId,
          tenantId: tenant,
          resultDigest: input.resultPayload.resultDigest,
          trajectoryDigest: input.resultPayload.trajectoryDigest,
          evidenceDigests: input.resultPayload.evidenceDigests,
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
      log = append(
        log,
        makeStateTransitionedEvent({
          sequence: next(),
          occurredAt: input.resultPayload.occurredAt,
          runId,
          tenantId: tenant,
          from: 'completed',
          to: 'cleaned',
          lifecycleEvent: 'cleaned',
        }),
        correlationId,
        `demo-idem-${input.runKey}-evt-${String(sequence)}`,
      );
    }
  } else if (input.outcome === 'failed') {
    const failedAt = input.failedAt ?? startedAt;
    log = append(
      log,
      makeStateTransitionedEvent({
        sequence: next(),
        occurredAt: failedAt,
        runId,
        tenantId: tenant,
        from: 'running',
        to: 'failed',
        lifecycleEvent: 'failed',
      }),
      correlationId,
      `demo-idem-${input.runKey}-evt-${String(sequence)}`,
    );
    log = append(
      log,
      makeStateTransitionedEvent({
        sequence: next(),
        occurredAt: failedAt,
        runId,
        tenantId: tenant,
        from: 'failed',
        to: 'cleaned',
        lifecycleEvent: 'cleaned',
      }),
      correlationId,
      `demo-idem-${input.runKey}-evt-${String(sequence)}`,
    );
  }
  // 'in-flight': the stream simply stops — no outcome, no result, no
  // cleanup. PENDING is the honest posture (never guessed).

  return log;
}

// ---------------------------------------------------------------------------
// Run record builder (PUBLIC @arena/environment-runtime factory only)
// ---------------------------------------------------------------------------

async function buildRunRecord(input: {
  readonly runKey: string;
  readonly initialSnapshotDigest: string;
  readonly seed: string | null;
  readonly submittedAt: string;
}): Promise<RunRecord> {
  return createRunRecord({
    runId: `${DEMO_TENANT}/${input.runKey}`,
    tenantId: DEMO_TENANT,
    environment: { ...DEMO_ENVIRONMENT },
    jobRef: 'job-payments-reliability',
    initialSnapshotDigest: input.initialSnapshotDigest,
    seed: input.seed,
    submittedAt: input.submittedAt,
    resourceEnvelope: { cpuMillis: 500, memoryMiB: 256, wallClockSeconds: 60 },
    networkEnvelope: { egress: 'default-deny' },
    filesystemEnvelope: { writeMode: 'declared-mounts-only' },
    secretEnvelope: { isolation: 'isolation-boundary' },
  });
}

// ---------------------------------------------------------------------------
// The corpus assembly
// ---------------------------------------------------------------------------

/**
 * Build the deterministic replay demo corpus. PURE: identical calls
 * yield identical protocol objects (identical digests, identical
 * corpusHash) — no randomness, no clock, no shared state.
 */
export async function buildReplayDemoCorpus(): Promise<ReplayDemoCorpus> {
  const { t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12 } = REPLAY_DEMO_TIME;
  const seedA = 'demo-seed-payments-reliability-001';
  const seedB = 'demo-seed-payments-reliability-002';
  const seedC = 'demo-seed-payments-reliability-003';

  // ---------------- run A (completed, full linkage) -----------------------
  const runRecordA = await buildRunRecord({
    runKey: 'payments-reliability-a',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_A,
    seed: seedA,
    submittedAt: t0,
  });

  const trajectoryA = await buildRunTrajectory({
    trajectoryId: 'payments-reliability-a',
    runKey: 'payments-reliability-a',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_A,
    runRecordDigest: runRecordA.digest,
    seed: seedA,
    startedAt: t1,
    steps: [
      {
        kind: 'action',
        payload: { actionId: 'read-tests', input: { path: 'src/retry.test.ts' } },
        occurredAt: t2,
      },
      {
        kind: 'observation',
        payload: {
          observationId: 'obs-failing-tests',
          channel: 'stdout',
          content:
            '3 failing tests in retry policy: jitter bounds exceeded, retry cap ignored, backoff reset on retry',
        },
        occurredAt: t3,
      },
      {
        kind: 'checkpoint',
        payload: { checkpointId: 'ckpt-before-edit', snapshotDigest: DIGEST_DEMO_SNAPSHOT_A2 },
        // SAME wall-clock timestamp as the previous step — the timeline
        // must fall back to the LOGICAL (chain sequence) order here.
        occurredAt: t3,
      },
      {
        kind: 'action',
        payload: {
          actionId: 'edit-file',
          input: { path: 'src/retry.ts', change: 'cap retries at 3 with jittered exponential backoff' },
        },
        occurredAt: t4,
      },
      {
        kind: 'observation',
        payload: {
          observationId: 'obs-edit-applied',
          channel: 'files',
          content: 'wrote src/retry.ts (14 lines changed)',
        },
        occurredAt: t5,
      },
      { kind: 'action', payload: { actionId: 'run-tests', input: { suite: 'regression' } }, occurredAt: t6 },
      {
        kind: 'observation',
        payload: {
          observationId: 'obs-suite-green',
          channel: 'stdout',
          content: 'regression suite green: 42 passed, 0 failed',
        },
        occurredAt: t7,
      },
      {
        kind: 'completion',
        payload: { outcome: 'completed', evidenceDigests: [DIGEST_DEMO_REGRESSION, DIGEST_DEMO_REVIEW] },
        occurredAt: t8,
      },
    ],
  });

  const runResultA = await createRunResult({
    runId: `${DEMO_TENANT}/payments-reliability-a`,
    tenantId: DEMO_TENANT,
    recordDigest: runRecordA.digest,
    finalState: 'completed',
    finishedAt: t9,
    runAddress: {
      taskVersion: { ...DEMO_TASK_VERSION },
      environmentVersion: { ...DEMO_ENVIRONMENT },
      runId: 'payments-reliability-a',
      initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_A,
      trajectoryDigest: trajectoryA.chainHead,
      evidenceDigests: [DIGEST_DEMO_REGRESSION, DIGEST_DEMO_REVIEW],
    },
  });

  const eventLogA = await buildRunEventLog({
    runKey: 'payments-reliability-a',
    runRecord: runRecordA,
    seed: seedA,
    startedAt: t2,
    midRun: [
      { kind: 'workload', occurredAt: t2, step: 1, elapsedMs: 1200, note: 'read failing tests' },
      { kind: 'checkpoint', occurredAt: t3, snapshotDigest: DIGEST_DEMO_SNAPSHOT_A2, stepIndex: 3 },
      { kind: 'workload', occurredAt: t5, step: 2, elapsedMs: 3400 },
      { kind: 'workload', occurredAt: t6, step: 3, elapsedMs: 4100, note: 're-run regression suite' },
    ],
    outcome: 'completed',
    resultPayload: {
      resultDigest: runResultA.digest,
      trajectoryDigest: trajectoryA.chainHead,
      evidenceDigests: [DIGEST_DEMO_REGRESSION, DIGEST_DEMO_REVIEW],
      occurredAt: t9,
    },
    failedAt: null,
  });

  // The A012 evaluation record judging run A's trajectory (bound by the
  // REAL trajectory digest — the linkage the replay surface renders).
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-payments-reliability',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'regression-coverage',
        weight: 1,
        description: 'Regression tests cover the changed retry path and its failure modes.',
        targetRef: DIGEST_DEMO_SNAPSHOT_A,
      },
      {
        criterionId: 'retry-behavior',
        weight: 1,
        description: 'Retry behavior obeys the declared jittered-backoff policy under load.',
        targetRef: DIGEST_DEMO_SNAPSHOT_A,
      },
      {
        criterionId: 'review-readiness',
        weight: 1,
        description: 'The change is minimal, reviewable and documented for a human reviewer.',
        targetRef: DIGEST_DEMO_SNAPSHOT_A,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });

  const evaluator = await createEvaluatorDescriptor({
    evaluatorId: 'evaluator-payments-reliability',
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: DIGEST_DEMO_SNAPSHOT_A,
      trajectoryRef: trajectoryA.chainHead,
      bodyRef: DIGEST_DEMO_BODY_VERSION,
      substrateRef: DIGEST_DEMO_SUBSTRATE,
    },
    criteriaRef: criteria.digest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations:
      'Deterministic suite over one recorded trajectory; it does not generalize beyond the tested composition.',
    provenance: { authoredBy: 'arena-demo', submittedAt: t0, notes: null },
  });

  const evaluationRecordA = await createEvaluationRecord(
    {
      evaluatorRef: evaluator.digest,
      caseRef: DIGEST_DEMO_SNAPSHOT_A,
      trajectoryRef: trajectoryA.chainHead,
      criteriaRef: criteria.digest,
      seed: seedA,
      verdicts: [
        {
          criterionId: 'regression-coverage',
          score: 0.9,
          judgment: 'Regression tests added for jitter bounds and the retry cap.',
          notes: null,
        },
        {
          criterionId: 'retry-behavior',
          score: 0.85,
          judgment: 'Jittered exponential backoff with retries capped at three.',
          notes: null,
        },
        {
          criterionId: 'review-readiness',
          score: 1,
          judgment: 'Minimal diff with an inline rationale for the human reviewer.',
          notes: null,
        },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: t5,
      finishedAt: t8,
      provenance: {
        executedBy: 'arena-demo-evaluator',
        recordedAt: t8,
        notes: 'Deterministic demo evaluation run.',
      },
    },
    criteria,
  );

  // The A013 verification record over run A's evidence artifacts.
  const verifier = await createVerifierDescriptor({
    verifierId: 'verifier-payments-reliability',
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'req-regression-rerun',
        evidenceKind: 'regression-test-suite',
        claim: 'Regression tests re-run in a clean environment.',
        artifact: {
          namespace: 'arena-demo',
          name: 'regression-test-suite',
          version: '1.0.0',
          digest: DIGEST_DEMO_REGRESSION,
        },
        requiredProducer: null,
      },
      {
        requirementId: 'req-second-review',
        evidenceKind: 'review-report',
        claim: 'The change diff was inspected by a second reviewer.',
        artifact: {
          namespace: 'arena-demo',
          name: 'second-review-report',
          version: '1.0.0',
          digest: DIGEST_DEMO_REVIEW,
        },
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'Every declared evidence requirement is present and supports its claim.',
      fail: 'At least one present evidence item fails to support its claim.',
      unknown: 'Evidence is missing, unverified or indeterminate, so no verdict is guessed.',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'verifier-descriptor', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verifier-descriptor', version: '1.0.0' },
    provenance: { authoredBy: 'arena-demo', submittedAt: t0, notes: null },
  });

  const verificationRecordA = await createVerificationRecord(
    {
      verifierRef: verifier.digest,
      evidence: [
        {
          evidenceKind: 'regression-test-suite',
          artifact: {
            namespace: 'arena-demo',
            name: 'regression-test-suite',
            version: '1.0.0',
            digest: DIGEST_DEMO_REGRESSION,
          },
          provenance: { producedBy: 'arena-demo-verifier', producedAt: t5, notes: null },
        },
        {
          evidenceKind: 'review-report',
          artifact: {
            namespace: 'arena-demo',
            name: 'second-review-report',
            version: '1.0.0',
            digest: DIGEST_DEMO_REVIEW,
          },
          provenance: { producedBy: 'arena-demo-reviewer', producedAt: t5, notes: null },
        },
      ],
      evidenceSupport: [
        {
          requirementId: 'req-regression-rerun',
          status: 'present-supported',
          evidenceDigest: DIGEST_DEMO_REGRESSION,
          notes: 'Suite re-run green in a clean environment.',
        },
        {
          requirementId: 'req-second-review',
          status: 'present-supported',
          evidenceDigest: DIGEST_DEMO_REVIEW,
          notes: 'Second reviewer approved the diff.',
        },
      ],
      correlationId: 'demo-corr-payments-reliability-a',
      idempotencyKey: 'demo-idem-payments-reliability-a',
      startedAt: t5,
      finishedAt: t8,
      provenance: {
        executedBy: 'arena-demo-verifier',
        recordedAt: t8,
        notes: 'Deterministic demo verification run.',
      },
    },
    verifier,
  );

  // ---------------- run B (in flight — PENDING) ----------------------------
  const runRecordB = await buildRunRecord({
    runKey: 'payments-reliability-b',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_B,
    seed: seedB,
    submittedAt: t10,
  });

  const trajectoryB = await buildRunTrajectory({
    trajectoryId: 'payments-reliability-b',
    runKey: 'payments-reliability-b',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_B,
    runRecordDigest: runRecordB.digest,
    seed: seedB,
    startedAt: t11,
    steps: [
      {
        kind: 'action',
        payload: { actionId: 'read-incident', input: { source: 'alerts/payments-latency' } },
        occurredAt: t11,
      },
      {
        kind: 'observation',
        payload: {
          observationId: 'obs-incident-symptoms',
          channel: 'events',
          content: 'p99 latency above 800ms on retry path for the last 20 minutes',
        },
        occurredAt: t12,
      },
      {
        kind: 'checkpoint',
        payload: { checkpointId: 'ckpt-mid-investigation', snapshotDigest: DIGEST_DEMO_SNAPSHOT_B },
        occurredAt: t12,
      },
      // NO completion entry — the run is still in flight (PENDING).
    ],
  });

  const eventLogB = await buildRunEventLog({
    runKey: 'payments-reliability-b',
    runRecord: runRecordB,
    seed: seedB,
    startedAt: t11,
    midRun: [
      { kind: 'workload', occurredAt: t11, step: 1, elapsedMs: 900, note: 'read incident alert' },
      { kind: 'checkpoint', occurredAt: t12, snapshotDigest: DIGEST_DEMO_SNAPSHOT_B, stepIndex: 3 },
    ],
    outcome: 'in-flight',
    resultPayload: null,
    failedAt: null,
  });

  // ---------------- run C (failed — evidenced by the stream) --------------
  const runRecordC = await buildRunRecord({
    runKey: 'payments-reliability-c',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_C,
    seed: seedC,
    submittedAt: t0,
  });

  const trajectoryC = await buildRunTrajectory({
    trajectoryId: 'payments-reliability-c',
    runKey: 'payments-reliability-c',
    initialSnapshotDigest: DIGEST_DEMO_SNAPSHOT_C,
    runRecordDigest: runRecordC.digest,
    seed: seedC,
    startedAt: t1,
    steps: [
      {
        kind: 'action',
        payload: { actionId: 'apply-migration', input: { migration: '0042-add-retry-ledger' } },
        occurredAt: t2,
      },
      {
        kind: 'error',
        payload: {
          code: 'WORKLOAD_TIMEOUT',
          message: 'migration exceeded the 60s wall-clock allowance during the lock acquisition phase',
        },
        occurredAt: t6,
      },
      {
        kind: 'observation',
        payload: {
          observationId: 'obs-migration-aborted',
          channel: 'stderr',
          content: 'migration 0042 aborted; the retry ledger table was rolled back cleanly',
        },
        occurredAt: t6,
      },
      {
        kind: 'completion',
        payload: { outcome: 'failed', evidenceDigests: [] },
        occurredAt: t7,
      },
    ],
  });

  const eventLogC = await buildRunEventLog({
    runKey: 'payments-reliability-c',
    runRecord: runRecordC,
    seed: seedC,
    startedAt: t2,
    midRun: [
      { kind: 'workload', occurredAt: t2, step: 1, elapsedMs: 60000, note: 'apply migration 0042' },
    ],
    outcome: 'failed',
    // A010: run results exist ONLY for completed runs — failed runs are
    // evidenced by their event streams. The failure time rides the
    // outcome transition.
    resultPayload: null,
    failedAt: t7,
  });

  // ---------------- determinism stamp --------------------------------------
  const corpusHash = canonicalJson([
    REPLAY_DEMO_IDS.runA,
    runRecordA.digest,
    trajectoryA.chainHead,
    runResultA.digest,
    evaluationRecordA.digest,
    verificationRecordA.digest,
    REPLAY_DEMO_IDS.runB,
    runRecordB.digest,
    trajectoryB.chainHead,
    REPLAY_DEMO_IDS.runC,
    runRecordC.digest,
    trajectoryC.chainHead,
  ]);

  return Object.freeze({
    runs: Object.freeze([
      Object.freeze({
        runId: REPLAY_DEMO_IDS.runA,
        runRecord: runRecordA,
        trajectory: trajectoryA,
        eventLog: eventLogA,
        runResult: runResultA,
        evaluationRecords: Object.freeze([evaluationRecordA]),
        verificationRecords: Object.freeze([verificationRecordA]),
      } satisfies ReplayDemoRun),
      Object.freeze({
        runId: REPLAY_DEMO_IDS.runB,
        runRecord: runRecordB,
        trajectory: trajectoryB,
        eventLog: eventLogB,
        runResult: null,
        evaluationRecords: Object.freeze([]),
        verificationRecords: Object.freeze([]),
      } satisfies ReplayDemoRun),
      Object.freeze({
        runId: REPLAY_DEMO_IDS.runC,
        runRecord: runRecordC,
        trajectory: trajectoryC,
        eventLog: eventLogC,
        runResult: null,
        evaluationRecords: Object.freeze([]),
        verificationRecords: Object.freeze([]),
      } satisfies ReplayDemoRun),
    ]),
    corpusHash,
  } satisfies ReplayDemoCorpus);
}
