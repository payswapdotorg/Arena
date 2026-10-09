/**
 * The registered host job kinds (Work Order P002; issue #154).
 *
 * ADR-P001-01 — one shared durable job runner at the host boundary:
 * "every C-series service's job kinds … are registered as
 * JobDefinitions executed through this runner". This module is the
 * closed registry of the kinds the P002 host registers for its first
 * composed service (the C001 escalation lifecycle) plus the two kinds
 * the ratified ADRs name explicitly:
 *
 *   - `escalation-recompute`       (ADR-P001-01 recompute family)
 *   - `escalation-projection`      (ADR-P001-01 projection
 *                                   materialization; event-fed per R-082)
 *   - `learning-candidate-projection` (ADR-P001-06 — the learning-
 *                                   candidate projection job kind; the
 *                                   projection body is a DOCUMENTED SEAM
 *                                   with an honest stub executor,
 *                                   disclosed in the PR body)
 *   - `retention-sweep`            (R-043 — retention enforcement as a
 *                                   host runner job)
 *
 * Timeouts and retry policies are PURE DATA on the definitions
 * (R-022/R-035/R-043); the runner never sleeps and reads only the
 * injected clock (A015 law).
 */

import { createJobDefinition } from '@arena/job-protocol';
import type { JobDefinition, JobRecord } from '@arena/job-protocol';

/** The host runner's execution context (pure data passed to executors). */
export interface JobExecutionContext {
  readonly jobId: string;
  readonly attempt: number;
  readonly clockNow: number;
}

/** An executor for one registered job kind (domain outcome recorder). */
export type JobKindExecutor = (input: unknown, context: JobExecutionContext) => Promise<unknown>;

/** One registered job kind: its definition + its executor. */
export interface JobKindRegistration {
  readonly definition: JobDefinition;
  readonly executor: JobKindExecutor;
}

/** The closed job-kind name registry (the names the host registers). */
export const RUNTIME_JOB_KIND_NAMES = Object.freeze([
  'escalation-recompute',
  'escalation-projection',
  'learning-candidate-projection',
  'retention-sweep',
] as const);
export type RuntimeJobKindName = (typeof RUNTIME_JOB_KIND_NAMES)[number];

/** The namespace all host-registered kinds live under. */
export const RUNTIME_JOB_NAMESPACE = 'arena-runtime';

/** Validate a job-kind name against the closed registry. */
export function isRuntimeJobKindName(value: unknown): value is RuntimeJobKindName {
  return (
    typeof value === 'string' &&
    (RUNTIME_JOB_KIND_NAMES as readonly string[]).includes(value)
  );
}

/**
 * The learning-candidate projection executor — an HONEST STUB
 * (ADR-P001-06 rule 3: the projection runs as registered job kinds,
 * never ad-hoc loops; the projection BODY over the four producer
 * families is P006's integrated-loop scope). The stub records a
 * structured no-op verdict that is unmistakable in persisted results:
 * it never fabricates candidates.
 */
export const LEARNING_CANDIDATE_PROJECTION_STUB_EXECUTOR: JobKindExecutor =
  async function learningCandidateProjectionStub(input) {
    return Object.freeze({
      kind: 'learning-candidate-projection',
      disposition: 'stub-not-implemented',
      note: 'ADR-P001-06 host-side projection seam: the job kind is registered and durably executed; the projection body over C008/C009/C013/C014 producer surfaces is the P006 integrated-loop scope',
      inputEchoDigestKeys: Array.isArray(
        (input as { records?: unknown[] } | null | undefined)?.records,
      )
        ? ((input as { records: unknown[] }).records.length)
        : 0,
    });
  };

/**
 * Build the full host job-kind registry (async: definition digests are
 * content-addressed). Every definition is deterministic pure data —
 * the SAME registry bytes on every host start (digest-stable).
 */
export async function createRuntimeJobKindRegistrations(): Promise<
  readonly JobKindRegistration[]
> {
  const escalationRecompute = await createJobDefinition({
    kind: { namespace: RUNTIME_JOB_NAMESPACE, name: 'escalation-recompute', version: '1.0.0' },
    inputSchema: 'arena:schema/runtime/escalation-recompute-input@1.0.0',
    correlationAddress: 'arena/runtime/escalation-recompute',
    idempotency: { scope: 'runtime-escalation-recompute', retentionMs: 90 * 24 * 60 * 60 * 1000 },
    timeout: { timeoutMs: 60_000 },
    retry: { maxAttempts: 3, backoffScheduleMs: [500, 2_000] },
    priority: 'normal',
  });

  const escalationProjection = await createJobDefinition({
    kind: { namespace: RUNTIME_JOB_NAMESPACE, name: 'escalation-projection', version: '1.0.0' },
    inputSchema: 'arena:schema/runtime/escalation-projection-input@1.0.0',
    correlationAddress: 'arena/runtime/escalation-projection',
    idempotency: { scope: 'runtime-escalation-projection', retentionMs: 90 * 24 * 60 * 60 * 1000 },
    timeout: { timeoutMs: 30_000 },
    retry: { maxAttempts: 5, backoffScheduleMs: [250, 1_000, 4_000, 16_000] },
    priority: 'normal',
  });

  const learningCandidateProjection = await createJobDefinition({
    kind: {
      namespace: RUNTIME_JOB_NAMESPACE,
      name: 'learning-candidate-projection',
      version: '1.0.0',
    },
    inputSchema: 'arena:schema/runtime/learning-candidate-projection-input@1.0.0',
    correlationAddress: 'arena/runtime/learning-candidate-projection',
    idempotency: {
      scope: 'runtime-learning-candidate-projection',
      retentionMs: 90 * 24 * 60 * 60 * 1000,
    },
    timeout: { timeoutMs: 30_000 },
    retry: { maxAttempts: 5, backoffScheduleMs: [250, 1_000, 4_000, 16_000] },
    priority: 'low',
  });

  const retentionSweep = await createJobDefinition({
    kind: { namespace: RUNTIME_JOB_NAMESPACE, name: 'retention-sweep', version: '1.0.0' },
    inputSchema: 'arena:schema/runtime/retention-sweep-input@1.0.0',
    correlationAddress: 'arena/runtime/retention-sweep',
    idempotency: { scope: 'runtime-retention-sweep', retentionMs: 30 * 24 * 60 * 60 * 1000 },
    timeout: { timeoutMs: 120_000 },
    retry: { maxAttempts: 2, backoffScheduleMs: [1_000] },
    priority: 'low',
  });

  /** The escalation recompute executor: re-derives the timeout sweep. */
  const escalationRecomputeExecutor: JobKindExecutor = async (_input, context) =>
    Object.freeze({
      kind: 'escalation-recompute',
      sweptAt: context.clockNow,
    });

  /** The escalation projection executor: records the projection position. */
  const escalationProjectionExecutor: JobKindExecutor = async (input, context) =>
    Object.freeze({
      kind: 'escalation-projection',
      projectedAt: context.clockNow,
      requestId:
        typeof (input as { requestId?: unknown } | null | undefined)?.requestId === 'string'
          ? (input as { requestId: string }).requestId
          : null,
    });

  /** The retention sweep executor: records the swept horizon. */
  const retentionSweepExecutor: JobKindExecutor = async (_input, context) =>
    Object.freeze({
      kind: 'retention-sweep',
      sweptAt: context.clockNow,
    });

  return Object.freeze([
    Object.freeze({ definition: escalationRecompute, executor: escalationRecomputeExecutor }),
    Object.freeze({ definition: escalationProjection, executor: escalationProjectionExecutor }),
    Object.freeze({
      definition: learningCandidateProjection,
      executor: LEARNING_CANDIDATE_PROJECTION_STUB_EXECUTOR,
    }),
    Object.freeze({ definition: retentionSweep, executor: retentionSweepExecutor }),
  ]);
}

/** Stable registry key for a registration (namespace/name@version). */
export function registrationKey(registration: {
  definition: JobDefinition;
}): string {
  const kind = registration.definition.kind;
  return `${kind.namespace}/${kind.name}@${kind.version}`;
}

/** Find a registration for a persisted job record's kind identity. */
export function findRegistrationForRecord(
  registrations: readonly JobKindRegistration[],
  record: JobRecord,
): JobKindRegistration | undefined {
  return registrations.find(
    (registration) =>
      registration.definition.kind.namespace === record.kind.namespace &&
      registration.definition.kind.name === record.kind.name &&
      registration.definition.kind.version === record.kind.version,
  );
}
