/**
 * RunStateSnapshot — the event-sourced projection of a run's current
 * world (Work Order A010 gates 3, 7, 8).
 *
 * The EnvironmentEventLog is the durable source of truth; a
 * RunStateSnapshot is the PURE FOLD over a run's events. It is
 * deep-frozen and carries NO mutation API; it is NOT separately
 * content-addressed (unlike RunRecord / RunCheckpoint / RunResult) —
 * snapshots are verified by REPLAYING the log through the fold, the
 * standard event-sourced verification path (verifyEnvironmentEventLog
 * + foldRunEvents).
 *
 * The fold enforces, per event:
 *   - structural validity (isRuntimeEvent);
 *   - single-run identity (foreign-run events are rejected);
 *   - per-run sequence contiguity (gap / duplicate / regression);
 *   - monotonic timestamps;
 *   - lifecycle legality — a state-transitioned event whose `from`
 *     contradicts the current status is rejected, and its (from,
 *     lifecycleEvent) pair must be a legal FSM edge (the fold is the
 *     second, semantic tripwire behind the log's kind-adjacency floor);
 *   - checkpoint chain integrity (contiguous sequences, matching
 *     digests on restore).
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { RecordedCheckpoint } from './checkpoint.js';
import { isRecordedCheckpoint } from './checkpoint.js';
import type { RuntimeEvent } from './events.js';
import { isRuntimeEvent } from './events.js';
import type { RunState } from './lifecycle.js';
import { isRunState, transitionRunState } from './lifecycle.js';
import type { RunRecord } from './run-record.js';
import {
  deepFreeze,
  isRunId,
  isRunTimestamp,
  isTenantId,
  toContentDigest,
} from './shared.js';
import type { ContentDigest, RunId, RunTimestamp, TenantId } from './shared.js';

/** Wire version of the run state snapshot shape. */
export const RUN_STATE_VERSION = 1 as const;

/** The world projection carried alongside the lifecycle status. */
export interface RunStateSnapshot {
  readonly stateVersion: typeof RUN_STATE_VERSION;
  readonly runId: RunId;
  readonly tenantId: TenantId;
  readonly recordDigest: ContentDigest;
  /** Current lifecycle status (gate 3 state machine). */
  readonly status: RunState;
  /** Number of state-transitioned events applied. */
  readonly transitions: number;
  /** Number of events applied (sequence of the last applied event). */
  readonly appliedEvents: number;
  /** Timestamp of the last applied event (monotonic floor). */
  readonly lastEventAt: RunTimestamp;
  /** When the current status was entered. */
  readonly enteredStatusAt: RunTimestamp;
  /** Whether the admission check admitted the run (null = not decided). */
  readonly admitted: boolean | null;
  /** Workload steps taken (world position; 0 = initial snapshot). */
  readonly worldStep: number;
  /** Simulated elapsed workload milliseconds. */
  readonly worldElapsedMs: number;
  /** Checkpoints recorded by this run, in sequence order. */
  readonly checkpoints: readonly RecordedCheckpoint[];
  /** Sequence of the checkpoint the world was last restored to (null = never). */
  readonly restoredToCheckpoint: number | null;
  /** Digest of the produced run result (null = not produced). */
  readonly resultDigest: ContentDigest | null;
}

/** The initial snapshot of a run: `requested`, world at the initial state. */
export function initialRunState(record: RunRecord): RunStateSnapshot {
  return deepFreeze({
    stateVersion: RUN_STATE_VERSION,
    runId: record.runId,
    tenantId: record.tenantId,
    recordDigest: record.digest,
    status: 'requested' as RunState,
    transitions: 0,
    appliedEvents: 0,
    lastEventAt: record.submittedAt,
    enteredStatusAt: record.submittedAt,
    admitted: null,
    worldStep: 0,
    worldElapsedMs: 0,
    checkpoints: Object.freeze([]) as readonly RecordedCheckpoint[],
    restoredToCheckpoint: null,
    resultDigest: null,
  });
}

/** Structural (non-throwing) check. */
export function isRunStateSnapshot(value: unknown): value is RunStateSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['stateVersion'] === RUN_STATE_VERSION &&
    isRunId(candidate['runId']) &&
    isTenantId(candidate['tenantId']) &&
    typeof candidate['recordDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['recordDigest']) &&
    isRunState(candidate['status']) &&
    typeof candidate['transitions'] === 'number' &&
    Number.isInteger(candidate['transitions']) &&
    candidate['transitions'] >= 0 &&
    typeof candidate['appliedEvents'] === 'number' &&
    Number.isInteger(candidate['appliedEvents']) &&
    candidate['appliedEvents'] >= 0 &&
    isRunTimestamp(candidate['lastEventAt']) &&
    isRunTimestamp(candidate['enteredStatusAt']) &&
    (candidate['admitted'] === null || typeof candidate['admitted'] === 'boolean') &&
    typeof candidate['worldStep'] === 'number' &&
    Number.isInteger(candidate['worldStep']) &&
    candidate['worldStep'] >= 0 &&
    typeof candidate['worldElapsedMs'] === 'number' &&
    Number.isInteger(candidate['worldElapsedMs']) &&
    candidate['worldElapsedMs'] >= 0 &&
    Array.isArray(candidate['checkpoints']) &&
    candidate['checkpoints'].every((entry) => isRecordedCheckpoint(entry)) &&
    (candidate['restoredToCheckpoint'] === null ||
      (typeof candidate['restoredToCheckpoint'] === 'number' &&
        Number.isInteger(candidate['restoredToCheckpoint']) &&
        candidate['restoredToCheckpoint'] >= 1)) &&
    (candidate['resultDigest'] === null ||
      (typeof candidate['resultDigest'] === 'string' &&
        /^[0-9a-f]{64}$/.test(candidate['resultDigest'])))
  );
}

function order(message: string, details: Readonly<Record<string, unknown>>): never {
  throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER, {
    message,
    details,
  });
}

/**
 * Apply one runtime event to a snapshot (the fold). Returns a NEW frozen
 * snapshot; the input snapshot is never modified. Throws typed errors
 * for any violation of the invariants documented on the module.
 */
export function applyRuntimeEvent(
  state: RunStateSnapshot,
  event: RuntimeEvent,
): RunStateSnapshot {
  if (!isRunStateSnapshot(state)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run state fold: not a structurally valid run state snapshot',
    });
  }
  if (!isRuntimeEvent(event)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
      message: 'run state fold: not a structurally valid runtime event',
    });
  }
  if (event.runId !== state.runId) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_OUT_OF_ORDER,
      {
        message: `event belongs to run ${JSON.stringify(event.runId)}, not ${JSON.stringify(state.runId)} (per-run state is isolated)`,
        details: { stateRunId: state.runId, eventRunId: event.runId },
      },
    );
  }
  if (event.tenantId !== state.tenantId) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION,
      {
        message: `event tenant ${JSON.stringify(event.tenantId)} does not match the run's tenant ${JSON.stringify(state.tenantId)}`,
        details: { runId: state.runId, stateTenant: state.tenantId, eventTenant: event.tenantId },
      },
    );
  }
  const expected = state.appliedEvents + 1;
  if (event.sequence < expected) {
    throw new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE,
      {
        message: `event sequence ${String(event.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only folds never rewrite history)`,
        details: { expected, actual: event.sequence, kind: event.kind },
      },
    );
  }
  if (event.sequence > expected) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_GAP, {
      message: `event sequence ${String(event.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-run sequences must be contiguous)`,
      details: { expected, actual: event.sequence, kind: event.kind },
    });
  }
  if (event.occurredAt < state.lastEventAt) {
    order(
      `event timestamps must be monotonically non-decreasing (last: ${state.lastEventAt}, attempted: ${event.occurredAt})`,
      { last: state.lastEventAt, attempted: event.occurredAt },
    );
  }

  switch (event.kind) {
    case 'run-submitted': {
      if (state.appliedEvents !== 0) {
        order('run-submitted must be the first event of a run stream', {
          appliedEvents: state.appliedEvents,
        });
      }
      if (event.recordDigest !== state.recordDigest) {
        throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
          message: `run-submitted event pins record digest ${event.recordDigest}, but the run's record digest is ${state.recordDigest}`,
          details: { eventRecordDigest: event.recordDigest, stateRecordDigest: state.recordDigest },
        });
      }
      return advance(state, event, {});
    }
    case 'admission-decided': {
      if (state.status !== 'requested') {
        order(`admission decision cannot follow state '${state.status}'`, {
          status: state.status,
        });
      }
      return advance(state, event, { admitted: event.admitted });
    }
    case 'state-transitioned': {
      if (event.from !== state.status) {
        throw new EnvironmentRuntimeError(
          ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION,
          {
            message: `state-transitioned event claims from '${event.from}' but the run is in '${state.status}' (the fold is the semantic tripwire behind the log's kind ordering)`,
            details: { from: event.from, to: event.to, currentStatus: state.status },
          },
        );
      }
      const legal = transitionRunState(event.from, event.lifecycleEvent);
      if (legal !== event.to) {
        throw new EnvironmentRuntimeError(
          ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION,
          {
            message: `state-transitioned event claims ${event.from} --${event.lifecycleEvent}--> ${event.to}, but the transition table maps it to '${legal ?? 'nothing (illegal)'}'`,
            details: { from: event.from, to: event.to, lifecycleEvent: event.lifecycleEvent, legal },
          },
        );
      }
      return advance(state, event, {
        status: event.to,
        transitions: state.transitions + 1,
        enteredStatusAt: event.occurredAt,
      });
    }
    case 'workload-progressed': {
      if (state.status !== 'running') {
        order(`workload progress requires a running run, got '${state.status}'`, {
          status: state.status,
        });
      }
      if (event.step !== state.worldStep + 1) {
        order(
          `workload step ${String(event.step)} must be exactly the next step (${String(state.worldStep + 1)})`,
          { expected: state.worldStep + 1, actual: event.step },
        );
      }
      if (event.simulatedElapsedMs < state.worldElapsedMs) {
        order('simulated elapsed time cannot regress', {
          last: state.worldElapsedMs,
          attempted: event.simulatedElapsedMs,
        });
      }
      return advance(state, event, {
        worldStep: event.step,
        worldElapsedMs: event.simulatedElapsedMs,
      });
    }
    case 'checkpoint-recorded': {
      if (state.status !== 'running' && state.status !== 'checkpointing') {
        order(`checkpoints require a running/checkpointing run, got '${state.status}'`, {
          status: state.status,
        });
      }
      const nextSequence = state.checkpoints.length + 1;
      if (event.checkpointSequence !== nextSequence) {
        order(
          `checkpoint sequence ${String(event.checkpointSequence)} must be exactly the next sequence (${String(nextSequence)})`,
          { expected: nextSequence, actual: event.checkpointSequence },
        );
      }
      const checkpoint: RecordedCheckpoint = Object.freeze({
        sequence: event.checkpointSequence,
        snapshotDigest: toContentDigest(event.snapshotDigest),
        stepIndex: event.stepIndex,
        recordedAt: event.occurredAt,
      });
      return advance(state, event, {
        checkpoints: Object.freeze([...state.checkpoints, checkpoint]),
      });
    }
    case 'checkpoint-restored': {
      if (state.status !== 'running') {
        order(`checkpoint restore requires a running run, got '${state.status}'`, {
          status: state.status,
        });
      }
      const recorded = state.checkpoints.find(
        (candidate) => candidate.sequence === event.checkpointSequence,
      );
      if (recorded === undefined) {
        throw new EnvironmentRuntimeError(
          ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED,
          {
            message: `checkpoint-restored event references checkpoint #${String(event.checkpointSequence)}, which this run never recorded`,
            details: { sequence: event.checkpointSequence },
          },
        );
      }
      if (recorded.snapshotDigest !== event.snapshotDigest) {
        throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
          message: `checkpoint-restored event digest mismatch for checkpoint #${String(event.checkpointSequence)}`,
          details: { recorded: recorded.snapshotDigest, event: event.snapshotDigest },
        });
      }
      if (event.restoredStepIndex !== recorded.stepIndex) {
        throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
          message: `checkpoint-restored event step index ${String(event.restoredStepIndex)} does not match the recorded checkpoint step index ${String(recorded.stepIndex)}`,
          details: { recorded: recorded.stepIndex, event: event.restoredStepIndex },
        });
      }
      return advance(state, event, {
        worldStep: event.restoredStepIndex,
        restoredToCheckpoint: event.checkpointSequence,
      });
    }
    case 'run-result-produced': {
      if (state.status !== 'completed') {
        order(`run results require a completed run, got '${state.status}'`, {
          status: state.status,
        });
      }
      return advance(state, event, { resultDigest: toContentDigest(event.resultDigest) });
    }
    default: {
      // Exhaustiveness guard: the closed taxonomy has no other kind.
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: `unknown runtime event kind: ${JSON.stringify(event)}`,
      });
    }
  }
}

function advance(
  state: RunStateSnapshot,
  event: RuntimeEvent,
  changes: Partial<RunStateSnapshot>,
): RunStateSnapshot {
  return deepFreeze({
    ...state,
    ...changes,
    appliedEvents: event.sequence,
    lastEventAt: event.occurredAt,
  }) as RunStateSnapshot;
}

/**
 * Fold a run's whole event stream over an initial snapshot (replay).
 * The fold re-validates every invariant; a corrupted stream throws.
 */
export function foldRunEvents(
  initial: RunStateSnapshot,
  events: readonly RuntimeEvent[],
): RunStateSnapshot {
  let state = initial;
  for (const event of events) {
    state = applyRuntimeEvent(state, event);
  }
  return state;
}
