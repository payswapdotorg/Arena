/**
 * Pure queries over the EnvironmentEventLog (Work Order A010 gate 7;
 * requirement R33) — mirroring @arena/capability-graph's query
 * conventions: total functions over frozen inputs, no mutation, no I/O.
 *
 * The run-state projections here are the READ side of observability:
 *   - runStatesSnapshot: every run's current lifecycle status + world
 *     position, folded from its stream (the fold re-validates);
 *   - runsInState: the set of runs currently in a state;
 *   - eventsForRun / eventsForTenant / eventsEnteringState: log slices
 *     (re-exported from event-log.ts for a single query surface);
 *   - checkpointsOf / latestCheckpointOf: checkpoint chain access;
 *   - admissionDecisionsOf: the admission decision trail of a run.
 *
 * `runStatesSnapshot` needs the runs' INITIAL states; callers supply a
 * resolver from runId → RunRecord (the runner holds the records), or
 * use `foldRunEvents` directly when the initial snapshot is at hand.
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { EnvironmentEventLog } from './event-log.js';
import { eventsForRun } from './event-log.js';
import type { RecordedCheckpoint } from './checkpoint.js';
import { foldRunEvents } from './run-state.js';
import type { RunStateSnapshot } from './run-state.js';
import type { RunRecord } from './run-record.js';
import { initialRunState } from './run-state.js';
import { isRunState } from './lifecycle.js';
import { deepFreeze } from './shared.js';
import type { RunId } from './shared.js';

export { eventsForRun, eventsForTenant, eventsEnteringState } from './event-log.js';

/** Resolve the RunRecord of a run (supplied by the caller / runner). */
export interface RunRecordResolver {
  (runId: RunId): RunRecord | undefined;
}

/**
 * The per-run projection of a log: current snapshots for every run the
 * log knows about. Each run's stream is folded from its initial state
 * (resolved via `records`), re-validating every invariant — a corrupted
 * stream throws.
 */
export function runStatesSnapshot(
  log: EnvironmentEventLog,
  records: RunRecordResolver,
): ReadonlyMap<RunId, RunStateSnapshot> {
  const snapshots = new Map<RunId, RunStateSnapshot>();
  const runIds: RunId[] = [];
  for (const envelope of log.entries) {
    if (!runIds.includes(envelope.payload.runId)) runIds.push(envelope.payload.runId);
  }
  for (const runId of runIds) {
    const record = records(runId);
    if (record === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RECORD, {
        message: `run states snapshot: no run record available for ${JSON.stringify(runId)} (the fold needs the run's initial state)`,
        details: { runId },
      });
    }
    const events = eventsForRun(log, runId).map((envelope) => envelope.payload);
    snapshots.set(runId, foldRunEvents(initialRunState(record), events));
  }
  return deepFreeze(snapshots) as ReadonlyMap<RunId, RunStateSnapshot>;
}

/** The current snapshot of one run (fold from its record + stream). */
export function runStateOf(
  log: EnvironmentEventLog,
  record: RunRecord,
): RunStateSnapshot {
  const events = eventsForRun(log, record.runId).map((envelope) => envelope.payload);
  return foldRunEvents(initialRunState(record), events);
}

/** Every run currently in the given state (pure query). */
export function runsInState(
  log: EnvironmentEventLog,
  records: RunRecordResolver,
  state: string,
): readonly RunId[] {
  if (!isRunState(state)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `runsInState: unknown run state: ${JSON.stringify(state)}`,
    });
  }
  const snapshots = runStatesSnapshot(log, records);
  return Object.freeze(
    [...snapshots.entries()]
      .filter(([, snapshot]) => snapshot.status === state)
      .map(([runId]) => runId),
  );
}

/** The recorded checkpoint chain of a run (pure query). */
export function checkpointsOf(
  snapshot: RunStateSnapshot,
): readonly RecordedCheckpoint[] {
  return Object.freeze([...snapshot.checkpoints]);
}

/** The most recently recorded checkpoint of a run, or undefined. */
export function latestCheckpointOf(
  snapshot: RunStateSnapshot,
): RecordedCheckpoint | undefined {
  return snapshot.checkpoints.length > 0
    ? snapshot.checkpoints[snapshot.checkpoints.length - 1]
    : undefined;
}

/** The admission decisions of a run, in sequence order (pure query). */
export function admissionDecisionsOf(
  log: EnvironmentEventLog,
  runId: RunId,
): readonly { admitted: boolean; violations: readonly string[]; sequence: number }[] {
  return Object.freeze(
    eventsForRun(log, runId)
      .filter(
        (envelope) => envelope.payload.kind === 'admission-decided',
      )
      .map((envelope) => {
        const payload = envelope.payload as {
          kind: 'admission-decided';
          admitted: boolean;
          violations: readonly string[];
          sequence: number;
        };
        return {
          admitted: payload.admitted,
          violations: Object.freeze([...payload.violations]),
          sequence: payload.sequence,
        };
      }),
  );
}
