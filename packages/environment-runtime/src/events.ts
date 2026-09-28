/**
 * Runtime event taxonomy + per-run append-only ordering (Work Order
 * A010 gates 3, 4, 7; requirement R33 — observability).
 *
 * A `RuntimeEvent` is one append-only event in a run's stream — the
 * payload half of the wire form; every event ALSO travels inside a
 * versioned `Envelope<T>` (see envelopes.ts / makeRuntimeEventEnvelope)
 * carrying the correlation id and idempotency key of the run it belongs
 * to (gate 4 — lifecycle transitions are emitted as enveloped,
 * idempotency-keyed events).
 *
 * Taxonomy (closed set, v1):
 *   run-submitted          the run record was created (sequence 1)
 *   admission-decided      the admission check outcome (fit / violations)
 *   state-transitioned     every lifecycle transition (from → to + event)
 *   workload-progressed    one simulated workload step (deterministic)
 *   checkpoint-recorded    a checkpoint was taken while running
 *   checkpoint-restored    the world was reset to a recorded checkpoint
 *   run-result-produced    a completed run produced its RunResult
 *
 * Ordering invariants enforced EVERYWHERE events are appended
 * (EnvironmentEventLog, run-state fold, strict wire parsing):
 *   - sequences are exactly 1..n, contiguous, per run;
 *   - the first event of a run is always `run-submitted`;
 *   - event kinds follow the closed lifecycle adjacency (out-of-order
 *     appends are rejected);
 *   - timestamps are monotonically non-decreasing per run;
 *   - after a transition into an outcome state only the result and the
 *     cleanup transition may follow; after `cleaned` nothing may.
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RunLifecycleEvent, RunState } from './lifecycle.js';
import { isRunLifecycleEvent, isRunState } from './lifecycle.js';
import type { RunId, RunTimestamp, TenantId } from './shared.js';
import {
  isContentDigest,
  isRunId,
  isRunTimestamp,
  isTenantId,
} from './shared.js';

/** Wire version of every runtime event payload. */
export const RUNTIME_EVENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed taxonomy
// ---------------------------------------------------------------------------

export const RUNTIME_EVENT_KINDS = Object.freeze([
  'run-submitted',
  'admission-decided',
  'state-transitioned',
  'workload-progressed',
  'checkpoint-recorded',
  'checkpoint-restored',
  'run-result-produced',
] as const);
export type RuntimeEventKind = (typeof RUNTIME_EVENT_KINDS)[number];

export function isRuntimeEventKind(value: unknown): value is RuntimeEventKind {
  return (
    typeof value === 'string' && (RUNTIME_EVENT_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Event payloads (discriminated union)
// ---------------------------------------------------------------------------

interface RuntimeEventCommon {
  readonly eventVersion: typeof RUNTIME_EVENT_VERSION;
  /** 1-based monotonic sequence within this run's stream. */
  readonly sequence: number;
  /** Canonical ms-UTC timestamp (when the event occurred). */
  readonly occurredAt: RunTimestamp;
  /** The tenant-scoped run this event belongs to (present on every kind). */
  readonly runId: RunId;
  /** The owning tenant (present on every kind — tenant-scoped streams). */
  readonly tenantId: TenantId;
}

export interface RunSubmittedEvent extends RuntimeEventCommon {
  readonly kind: 'run-submitted';
  readonly recordDigest: string;
  readonly jobRef: string;
  readonly seed: string | null;
}

export interface AdmissionDecidedEvent extends RuntimeEventCommon {
  readonly kind: 'admission-decided';
  readonly admitted: boolean;
  /** Human-readable least-privilege violations (empty when admitted). */
  readonly violations: readonly string[];
}

export interface StateTransitionedEvent extends RuntimeEventCommon {
  readonly kind: 'state-transitioned';
  readonly from: RunState;
  readonly to: RunState;
  readonly lifecycleEvent: RunLifecycleEvent;
  readonly reason?: string;
}

export interface WorkloadProgressedEvent extends RuntimeEventCommon {
  readonly kind: 'workload-progressed';
  readonly step: number;
  /** Simulated elapsed milliseconds accumulated by the workload so far. */
  readonly simulatedElapsedMs: number;
  readonly note?: string;
}

export interface CheckpointRecordedEvent extends RuntimeEventCommon {
  readonly kind: 'checkpoint-recorded';
  readonly checkpointSequence: number;
  readonly snapshotDigest: string;
  readonly stepIndex: number;
}

export interface CheckpointRestoredEvent extends RuntimeEventCommon {
  readonly kind: 'checkpoint-restored';
  readonly checkpointSequence: number;
  readonly snapshotDigest: string;
  /** The world position the run continues from after the restore. */
  readonly restoredStepIndex: number;
}

export interface RunResultProducedEvent extends RuntimeEventCommon {
  readonly kind: 'run-result-produced';
  readonly resultDigest: string;
  readonly trajectoryDigest: string;
  readonly evidenceDigests: readonly string[];
}

export type RuntimeEvent =
  | RunSubmittedEvent
  | AdmissionDecidedEvent
  | StateTransitionedEvent
  | WorkloadProgressedEvent
  | CheckpointRecordedEvent
  | CheckpointRestoredEvent
  | RunResultProducedEvent;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

/** Structural (non-throwing) check for any event in the taxonomy. */
export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['eventVersion'] !== RUNTIME_EVENT_VERSION) return false;
  if (!isRuntimeEventKind(candidate['kind'])) return false;
  if (!isPositiveInteger(candidate['sequence'])) return false;
  if (!isRunTimestamp(candidate['occurredAt'])) return false;
  if (!isRunId(candidate['runId'])) return false;
  if (!isTenantId(candidate['tenantId'])) return false;

  switch (candidate['kind']) {
    case 'run-submitted':
      return (
        isContentDigest(candidate['recordDigest']) &&
        typeof candidate['jobRef'] === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate['jobRef']) &&
        (candidate['seed'] === null ||
          (typeof candidate['seed'] === 'string' && candidate['seed'].length > 0))
      );
    case 'admission-decided':
      return (
        typeof candidate['admitted'] === 'boolean' &&
        isNonEmptyStringArray(candidate['violations'])
      );
    case 'state-transitioned':
      return (
        isRunState(candidate['from']) &&
        isRunState(candidate['to']) &&
        isRunLifecycleEvent(candidate['lifecycleEvent']) &&
        (candidate['reason'] === undefined || typeof candidate['reason'] === 'string')
      );
    case 'workload-progressed':
      return (
        isPositiveInteger(candidate['step']) &&
        typeof candidate['simulatedElapsedMs'] === 'number' &&
        Number.isInteger(candidate['simulatedElapsedMs']) &&
        candidate['simulatedElapsedMs'] >= 0 &&
        (candidate['note'] === undefined || typeof candidate['note'] === 'string')
      );
    case 'checkpoint-recorded':
      return (
        isPositiveInteger(candidate['checkpointSequence']) &&
        isContentDigest(candidate['snapshotDigest']) &&
        isNonNegativeInteger(candidate['stepIndex'])
      );
    case 'checkpoint-restored':
      return (
        isPositiveInteger(candidate['checkpointSequence']) &&
        isContentDigest(candidate['snapshotDigest']) &&
        isNonNegativeInteger(candidate['restoredStepIndex'])
      );
    case 'run-result-produced':
      return (
        isContentDigest(candidate['resultDigest']) &&
        isContentDigest(candidate['trajectoryDigest']) &&
        isNonEmptyStringArray(candidate['evidenceDigests']) &&
        candidate['evidenceDigests'].length > 0 &&
        candidate['evidenceDigests'].every((entry) => isContentDigest(entry))
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Kind adjacency (closed ordering — the log-level twin of the FSM)
// ---------------------------------------------------------------------------

/**
 * Event kinds that may follow each kind. Terminal-aware: after a
 * state-transitioned event whose `to` is an outcome state the stream may
 * only carry the run result and the cleanup transition; after `cleaned`
 * nothing. The to-sensitive rule is enforced by the event log (it can
 * see the payloads); the pure kind table below is the coarse floor.
 */
export function nextRuntimeEventKinds(lastKind: RuntimeEventKind): readonly RuntimeEventKind[] {
  switch (lastKind) {
    case 'run-submitted':
      return ['admission-decided', 'state-transitioned'];
    case 'admission-decided':
      return ['state-transitioned'];
    case 'state-transitioned':
      return [
        'state-transitioned',
        'workload-progressed',
        'checkpoint-recorded',
        'checkpoint-restored',
        'run-result-produced',
      ];
    case 'workload-progressed':
      return [
        'workload-progressed',
        'state-transitioned',
        'checkpoint-recorded',
        'checkpoint-restored',
        'run-result-produced',
      ];
    case 'checkpoint-recorded':
      return ['state-transitioned', 'checkpoint-restored'];
    case 'checkpoint-restored':
      return [
        'workload-progressed',
        'state-transitioned',
        'checkpoint-recorded',
        'checkpoint-restored',
      ];
    case 'run-result-produced':
      return ['state-transitioned'];
    default:
      return [];
  }
}

/** The initial event kind of every run stream. */
export const RUNTIME_STREAM_INITIAL_KIND: RuntimeEventKind = 'run-submitted';

// ---------------------------------------------------------------------------
// Constructors (strictly validated, deep-frozen)
// ---------------------------------------------------------------------------

function base(
  sequence: number,
  occurredAt: string,
  runId: string,
  tenantId: string,
): RuntimeEventCommon {
  if (!isPositiveInteger(sequence)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `runtime event: sequence must be a positive integer, got: ${String(sequence)}`,
    });
  }
  if (!isRunTimestamp(occurredAt)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `runtime event: occurredAt must be a canonical ms-UTC timestamp, got: ${JSON.stringify(occurredAt)}`,
    });
  }
  if (!isRunId(runId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `runtime event: invalid tenant-scoped run id: ${JSON.stringify(runId)}`,
    });
  }
  if (!isTenantId(tenantId)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TENANT, {
      message: `runtime event: invalid tenant id: ${JSON.stringify(tenantId)}`,
    });
  }
  return { eventVersion: RUNTIME_EVENT_VERSION, sequence, occurredAt, runId, tenantId };
}

export function makeRunSubmittedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  recordDigest: string;
  jobRef: string;
  seed: string | null;
}): RunSubmittedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isContentDigest(input.recordDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-submitted event: recordDigest must be a lowercase sha256 hex digest',
    });
  }
  if (
    typeof input.jobRef !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.jobRef)
  ) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-submitted event: jobRef must be an A015 job id',
    });
  }
  if (input.seed !== null && typeof input.seed !== 'string') {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-submitted event: seed must be a string or null',
    });
  }
  return Object.freeze({
    ...common,
    kind: 'run-submitted' as const,
    recordDigest: input.recordDigest,
    jobRef: input.jobRef,
    seed: input.seed,
  });
}

export function makeAdmissionDecidedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  admitted: boolean;
  violations: readonly string[];
}): AdmissionDecidedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (typeof input.admitted !== 'boolean') {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'admission-decided event: admitted must be a boolean',
    });
  }
  if (
    !Array.isArray(input.violations) ||
    !input.violations.every((entry) => typeof entry === 'string')
  ) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'admission-decided event: violations must be an array of strings',
    });
  }
  return Object.freeze({
    ...common,
    kind: 'admission-decided' as const,
    admitted: input.admitted,
    violations: Object.freeze([...input.violations]),
  });
}

export function makeStateTransitionedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  from: RunState;
  to: RunState;
  lifecycleEvent: RunLifecycleEvent;
  reason?: string;
}): StateTransitionedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isRunState(input.from) || !isRunState(input.to)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `state-transitioned event: from/to must be run states, got: ${String(input.from)} → ${String(input.to)}`,
    });
  }
  if (!isRunLifecycleEvent(input.lifecycleEvent)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `state-transitioned event: unknown lifecycle event ${JSON.stringify(input.lifecycleEvent)}`,
    });
  }
  return Object.freeze({
    ...common,
    kind: 'state-transitioned' as const,
    from: input.from,
    to: input.to,
    lifecycleEvent: input.lifecycleEvent,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  });
}

export function makeWorkloadProgressedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  step: number;
  simulatedElapsedMs: number;
  note?: string;
}): WorkloadProgressedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isPositiveInteger(input.step)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `workload-progressed event: step must be a positive integer, got: ${String(input.step)}`,
    });
  }
  if (
    typeof input.simulatedElapsedMs !== 'number' ||
    !Number.isInteger(input.simulatedElapsedMs) ||
    input.simulatedElapsedMs < 0
  ) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: `workload-progressed event: simulatedElapsedMs must be a non-negative integer, got: ${String(input.simulatedElapsedMs)}`,
    });
  }
  return Object.freeze({
    ...common,
    kind: 'workload-progressed' as const,
    step: input.step,
    simulatedElapsedMs: input.simulatedElapsedMs,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
}

export function makeCheckpointRecordedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  checkpointSequence: number;
  snapshotDigest: string;
  stepIndex: number;
}): CheckpointRecordedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isPositiveInteger(input.checkpointSequence)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-recorded event: checkpointSequence must be a positive integer',
    });
  }
  if (!isContentDigest(input.snapshotDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-recorded event: snapshotDigest must be a lowercase sha256 hex digest',
    });
  }
  if (!isNonNegativeInteger(input.stepIndex)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-recorded event: stepIndex must be a non-negative integer (0 = the initial world)',
    });
  }
  return Object.freeze({
    ...common,
    kind: 'checkpoint-recorded' as const,
    checkpointSequence: input.checkpointSequence,
    snapshotDigest: input.snapshotDigest,
    stepIndex: input.stepIndex,
  });
}

export function makeCheckpointRestoredEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  checkpointSequence: number;
  snapshotDigest: string;
  restoredStepIndex: number;
}): CheckpointRestoredEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isPositiveInteger(input.checkpointSequence)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-restored event: checkpointSequence must be a positive integer',
    });
  }
  if (!isContentDigest(input.snapshotDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-restored event: snapshotDigest must be a lowercase sha256 hex digest',
    });
  }
  if (!isNonNegativeInteger(input.restoredStepIndex)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'checkpoint-restored event: restoredStepIndex must be a non-negative integer',
    });
  }
  return Object.freeze({
    ...common,
    kind: 'checkpoint-restored' as const,
    checkpointSequence: input.checkpointSequence,
    snapshotDigest: input.snapshotDigest,
    restoredStepIndex: input.restoredStepIndex,
  });
}

export function makeRunResultProducedEvent(input: {
  sequence: number;
  occurredAt: string;
  runId: string;
  tenantId: string;
  resultDigest: string;
  trajectoryDigest: string;
  evidenceDigests: readonly string[];
}): RunResultProducedEvent {
  const common = base(
    input.sequence,
    input.occurredAt,
    input.runId,
    input.tenantId,
  );
  if (!isContentDigest(input.resultDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-result-produced event: resultDigest must be a lowercase sha256 hex digest',
    });
  }
  if (!isContentDigest(input.trajectoryDigest)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-result-produced event: trajectoryDigest must be a lowercase sha256 hex digest',
    });
  }
  if (
    !Array.isArray(input.evidenceDigests) ||
    input.evidenceDigests.length === 0 ||
    !input.evidenceDigests.every((entry) => isContentDigest(entry))
  ) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run-result-produced event: evidenceDigests must be a non-empty array of lowercase sha256 hex digests',
    });
  }
  return Object.freeze({
    ...common,
    kind: 'run-result-produced' as const,
    resultDigest: input.resultDigest,
    trajectoryDigest: input.trajectoryDigest,
    evidenceDigests: Object.freeze([...input.evidenceDigests]),
  });
}
