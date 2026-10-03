/**
 * Replay environment event-stream view model (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * The ENVIRONMENT EVENT STREAM of a replayed run: the append-only,
 * enveloped A010 `RuntimeEvent` stream (lifecycle transitions, admission
 * decisions, checkpoints, workload steps, results, cleanup) projected
 * into display rows, each linked to a trajectory step index where the
 * event carries one (checkpoint / workload events).
 *
 * HONEST STREAM STATES (first-class, never collapsed):
 *   - `ready`    — at least one readable event;
 *   - `empty`    — a stream exists but records zero events;
 *   - `no-data`  — no event stream was provided for this run at all
 *                  ("no data", distinct from empty);
 *   - `degraded` — at least one entry failed the public
 *                  `isRuntimeEvent` guard and rendered as an unreadable
 *                  row under the `unknown` truth class.
 *
 * TOTAL, SYNC, NEVER-THROWING over ANY input: accepts an
 * `EnvironmentEventLog` ({ entries: Envelope[] }), a bare array of event
 * envelopes, or a bare array of raw runtime events — anything else (or
 * nothing) is the honest `no-data` posture. Structural validation reuses
 * @arena/environment-runtime's PUBLIC guards.
 */

import { isRuntimeEvent } from '@arena/environment-runtime';
import type { RuntimeEvent } from '@arena/environment-runtime';
import {
  REPLAY_STEP_TRUTH_CLASS,
  UNKNOWN_TRUTH_CLASS,
} from './truth.js';
import type { ReplayTruthClass } from './truth.js';

/** The event-stream surface state. */
export type ReplayEventStreamState = 'ready' | 'empty' | 'no-data' | 'degraded';

/** One event-stream row. */
export interface ReplayEventRowModel {
  /** 1-based per-run event sequence (the stream's logical order). */
  readonly sequence: number | null;
  /** The event kind (closed A010 taxonomy) or 'unreadable'. */
  readonly kind: string;
  readonly truthClass: ReplayTruthClass;
  readonly kindLabel: string;
  readonly summary: string;
  /** Canonical ms-UTC occurrence — null for unreadable rows. */
  readonly occurredAt: string | null;
  /** The trajectory step index this event links to (checkpoint/workload events), else null. */
  readonly linkedStep: number | null;
}

/** The complete event-stream view model. */
export interface ReplayEventStreamModel {
  readonly state: ReplayEventStreamState;
  readonly events: readonly ReplayEventRowModel[];
  /** Count of entries that failed the structural guard (degraded rows). */
  readonly unreadableCount: number;
  /** The honest one-line state note (rendered verbatim). */
  readonly note: string;
}

const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'run-submitted': 'Run submitted',
  'admission-decided': 'Admission decided',
  'state-transitioned': 'State transitioned',
  'workload-progressed': 'Workload progressed',
  'checkpoint-recorded': 'Checkpoint recorded',
  'checkpoint-restored': 'Checkpoint restored',
  'run-result-produced': 'Run result produced',
  unreadable: 'Unreadable',
} as const);

function labelOf(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

function eventSummary(event: RuntimeEvent): string {
  switch (event.kind) {
    case 'run-submitted':
      return `run submitted — record ${shortDigest(event.recordDigest)}, job ${event.jobRef}, seed ${event.seed === null ? 'none' : event.seed}`;
    case 'admission-decided':
      return event.admitted
        ? `admission granted — no least-privilege violations`
        : `admission refused — ${String(event.violations.length)} violation(s): ${event.violations.join('; ')}`;
    case 'state-transitioned':
      return `${event.from} → ${event.to} (${event.lifecycleEvent}${event.reason !== undefined ? `: ${event.reason}` : ''})`;
    case 'workload-progressed':
      return `workload step ${String(event.step)} — ${String(event.simulatedElapsedMs)}ms simulated elapsed${event.note !== undefined ? ` (${event.note})` : ''}`;
    case 'checkpoint-recorded':
      return `checkpoint ${String(event.checkpointSequence)} recorded at step ${String(event.stepIndex)} — snapshot ${shortDigest(event.snapshotDigest)}`;
    case 'checkpoint-restored':
      return `checkpoint ${String(event.checkpointSequence)} restored — continuing from step ${String(event.restoredStepIndex)}, snapshot ${shortDigest(event.snapshotDigest)}`;
    case 'run-result-produced':
      return `run result ${shortDigest(event.resultDigest)} — trajectory ${shortDigest(event.trajectoryDigest)}, ${String(event.evidenceDigests.length)} evidence digest(s)`;
  }
}

function linkedStepOf(event: RuntimeEvent): number | null {
  switch (event.kind) {
    case 'workload-progressed':
      return event.step;
    case 'checkpoint-recorded':
      return event.stepIndex;
    case 'checkpoint-restored':
      return event.restoredStepIndex;
    default:
      return null;
  }
}

function rowOf(event: RuntimeEvent): ReplayEventRowModel {
  return Object.freeze({
    sequence: event.sequence,
    kind: event.kind,
    truthClass: REPLAY_STEP_TRUTH_CLASS,
    kindLabel: labelOf(event.kind),
    summary: eventSummary(event),
    occurredAt: event.occurredAt,
    linkedStep: linkedStepOf(event),
  } satisfies ReplayEventRowModel);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract the raw event payload of one stream entry (envelope or bare event). */
function payloadOfEntry(entry: unknown): unknown {
  if (isPlainRecord(entry) && 'payload' in entry) {
    return entry['payload'];
  }
  return entry;
}

/**
 * Project ANY payload into the event-stream view model. Total,
 * synchronous, deterministic, never-throwing.
 *
 * Accepted input shapes: an `EnvironmentEventLog`-like object with an
 * `entries` array of event envelopes; a bare array of event envelopes;
 * a bare array of raw runtime events. Anything else (null, undefined,
 * non-array) is the honest `no-data` state.
 */
export function toReplayEventStream(payload: unknown): ReplayEventStreamModel {
  const rawEntries: unknown = Array.isArray(payload)
    ? payload
    : isPlainRecord(payload) && Array.isArray(payload['entries'])
      ? payload['entries']
      : null;

  if (rawEntries === null) {
    return Object.freeze({
      state: 'no-data',
      events: Object.freeze([]),
      unreadableCount: 0,
      note: 'no environment event stream was provided for this run (no data — distinct from an empty stream)',
    } satisfies ReplayEventStreamModel);
  }

  const rows: ReplayEventRowModel[] = [];
  let unreadableCount = 0;
  for (let index = 0; index < (rawEntries as unknown[]).length; index += 1) {
    const entry = (rawEntries as unknown[])[index];
    if (entry === undefined) continue;
    const event = payloadOfEntry(entry);
    if (isRuntimeEvent(event)) {
      rows.push(rowOf(event));
      continue;
    }
    unreadableCount += 1;
    const position = index + 1;
    rows.push(
      Object.freeze({
        sequence: null,
        kind: 'unreadable',
        truthClass: UNKNOWN_TRUTH_CLASS,
        kindLabel: KIND_LABELS['unreadable'] ?? 'Unreadable',
        summary: `stream entry at position ${String(position)} failed the runtime-event structural guard — rendered as unknown (stream position ${String(position)} used for ordering)`,
        occurredAt: null,
        linkedStep: null,
      } satisfies ReplayEventRowModel),
    );
  }

  if (rows.length === 0) {
    return Object.freeze({
      state: 'empty',
      events: Object.freeze([]),
      unreadableCount: 0,
      note: 'an environment event stream exists for this run but records zero events (empty — recorded, not missing)',
    } satisfies ReplayEventStreamModel);
  }

  if (unreadableCount > 0) {
    return Object.freeze({
      state: 'degraded',
      events: Object.freeze(rows),
      unreadableCount,
      note: `${String(unreadableCount)} event-stream entr${unreadableCount === 1 ? 'y' : 'ies'} failed structural validation and render as unknown — degraded, never silently repaired`,
    } satisfies ReplayEventStreamModel);
  }

  return Object.freeze({
    state: 'ready',
    events: Object.freeze(rows),
    unreadableCount: 0,
    note: `environment event stream: ${String(rows.length)} append-only event${rows.length === 1 ? '' : 's'} (A010 runtime events; simulation-replay truth class)`,
  } satisfies ReplayEventStreamModel);
}
