/**
 * Replay timeline view model (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * The TIMELINE model over a trajectory: the ordered, append-only step
 * stream exactly as recorded — per-step action/observation/checkpoint/
 * error/completion records, WALL-CLOCK vs LOGICAL ordering made explicit
 * (every step carries its occurred-at AND its chain sequence; when two
 * steps share a wall-clock timestamp the LOGICAL order is authoritative
 * and the model says so), and HONEST GAPS:
 *
 *   - `no-data` steps mark missing sequence numbers (a truncated or
 *     corrupted payload) — the gap is rendered, never papered over;
 *   - `unreadable` steps mark array elements that failed the per-entry
 *     structural guard — they keep their declared position and render
 *     under the `unknown` truth class;
 *   - a structurally consistent trajectory with NO completion entry is
 *     PENDING (run in flight or truncated after the fact — unknown
 *     which), never guessed and never an error.
 *
 * TOTAL, SYNC, NEVER-THROWING: `toReplayTimeline(payload: unknown)` is a
 * pure projection over ANY input — malformed/truncated payloads degrade
 * truthfully (visible degradation notes + `unknown` marks), never crash,
 * never silently repair. Structural validation reuses @arena/trajectory's
 * PUBLIC guards (`isTrajectoryRecord`, `isTrajectoryEntry`); full chain
 * digest verification is a separate async step owned by the runtime layer
 * (`verifyReplayTrajectoryChain` below wraps the package's public
 * `verifyTrajectoryRecord` with a typed, non-throwing outcome).
 */

import {
  isTrajectoryEntry,
  isTrajectoryRecord,
  verifyTrajectoryRecord,
} from '@arena/trajectory';
import type {
  TrajectoryEntry,
  TrajectoryEntryKind,
  TrajectoryRecord,
} from '@arena/trajectory';
import { TRAJECTORY_ERROR_CODES } from '@arena/trajectory';
import {
  REPLAY_DEGRADED_NOTE,
  REPLAY_NOT_RESULT_NOTE,
  REPLAY_OBSERVATIONAL_NOTE,
  REPLAY_PENDING_NOTE,
  REPLAY_STEP_TRUTH_CLASS,
  UNKNOWN_TRUTH_CLASS,
} from './truth.js';
import type { ReplayTruthClass } from './truth.js';

// ---------------------------------------------------------------------------
// Bounded rendering (the house "no unbounded read" discipline)
// ---------------------------------------------------------------------------

/** Hard bound on rendered timeline rows (defensive against hostile payloads). */
export const REPLAY_MAX_TIMELINE_STEPS = 500;

/** Hard bound on gap markers inserted for missing sequence numbers. */
export const REPLAY_MAX_GAP_STEPS = 200;

// ---------------------------------------------------------------------------
// Step models
// ---------------------------------------------------------------------------

/** The per-step payload view: exactly what each entry kind renders. */
export type ReplayStepPayloadView =
  | { readonly kind: 'action'; readonly actionId: string; readonly input: unknown }
  | {
      readonly kind: 'observation';
      readonly observationId: string;
      readonly channel: string;
      readonly content: string;
    }
  | { readonly kind: 'checkpoint'; readonly checkpointId: string; readonly snapshotDigest: string }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }
  | { readonly kind: 'completion'; readonly outcome: string; readonly evidenceDigests: readonly string[] }
  | { readonly kind: 'no-data' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** The timeline row kind: the five entry kinds plus the two honest-gap kinds. */
export type ReplayStepKind = TrajectoryEntryKind | 'no-data' | 'unreadable';

/** One timeline step (frozen; deterministic; carries its own truth class). */
export interface ReplayStepModel {
  readonly sequence: number;
  readonly kind: ReplayStepKind;
  /** The truth class of this step: simulation-replay for readable entries, unknown for gaps/unreadable. */
  readonly truthClass: ReplayTruthClass;
  /** Short human label of the kind (rendered verbatim). */
  readonly kindLabel: string;
  /** One-line payload summary (deterministic; truncated at a fixed width). */
  readonly summary: string;
  /** Wall-clock occurrence (canonical ms-UTC) — null for gaps/unreadable entries. */
  readonly occurredAt: string | null;
  /** Wall-clock ms since the previous READABLE step — null when unknown/first. */
  readonly wallClockDeltaMs: number | null;
  /** True when this step shares its wall-clock timestamp with the previous readable step (logical order authoritative). */
  readonly sameWallClockAsPrevious: boolean;
  readonly payloadView: ReplayStepPayloadView;
  /** The entry's chained digest (null for gaps/unreadable). */
  readonly stepDigest: string | null;
  /** The digest of the chain predecessor (null for gaps/unreadable). */
  readonly prevDigest: string | null;
}

/** Human labels for the seven row kinds (closed vocabulary). */
const STEP_KIND_LABELS: Readonly<Record<ReplayStepKind, string>> = Object.freeze({
  action: 'Action',
  observation: 'Observation',
  checkpoint: 'Checkpoint',
  error: 'Error',
  completion: 'Completion',
  'no-data': 'No data (gap)',
  unreadable: 'Unreadable',
} as const);

/** Fixed summary truncation width. */
const SUMMARY_WIDTH = 140;

function truncate(text: string): string {
  return text.length > SUMMARY_WIDTH ? `${text.slice(0, SUMMARY_WIDTH - 1)}…` : text;
}

function actionSummary(entry: TrajectoryEntry): string {
  const payload = entry.payload as { actionId?: unknown; input?: unknown };
  const actionId = typeof payload.actionId === 'string' ? payload.actionId : 'unknown-action';
  const input = payload.input;
  const inputKeys =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? Object.keys(input as Record<string, unknown>)
      : [];
  const shape =
    input === null || input === undefined
      ? 'no input'
      : inputKeys.length > 0
        ? `input {${inputKeys.slice(0, 6).join(', ')}${inputKeys.length > 6 ? ', …' : ''}}`
        : 'input {}';
  return truncate(`action ${actionId} — ${shape}`);
}

function observationSummary(entry: TrajectoryEntry): string {
  const payload = entry.payload as { observationId?: unknown; channel?: unknown; content?: unknown };
  const observationId =
    typeof payload.observationId === 'string' ? payload.observationId : 'unknown-observation';
  const channel = typeof payload.channel === 'string' ? payload.channel : 'unknown-channel';
  const content = typeof payload.content === 'string' ? payload.content : '';
  return truncate(`observation ${observationId} on ${channel} — ${content}`);
}

function checkpointSummary(entry: TrajectoryEntry): string {
  const payload = entry.payload as { checkpointId?: unknown; snapshotDigest?: unknown };
  const checkpointId =
    typeof payload.checkpointId === 'string' ? payload.checkpointId : 'unknown-checkpoint';
  const snapshotDigest =
    typeof payload.snapshotDigest === 'string' ? payload.snapshotDigest : '';
  return truncate(
    `checkpoint ${checkpointId} @ ${snapshotDigest.slice(0, 12)}… (snapshot digest)`,
  );
}

function errorSummary(entry: TrajectoryEntry): string {
  const payload = entry.payload as { code?: unknown; message?: unknown };
  const code = typeof payload.code === 'string' ? payload.code : 'UNKNOWN_CODE';
  const message = typeof payload.message === 'string' ? payload.message : '';
  return truncate(`error ${code} — ${message}`);
}

function completionSummary(entry: TrajectoryEntry): string {
  const payload = entry.payload as { outcome?: unknown; evidenceDigests?: unknown };
  const outcome = typeof payload.outcome === 'string' ? payload.outcome : 'unknown';
  const evidence = Array.isArray(payload.evidenceDigests) ? payload.evidenceDigests.length : 0;
  return truncate(`completion — ${outcome} (${evidence} evidence digest(s))`);
}

function payloadViewOf(entry: TrajectoryEntry): ReplayStepPayloadView {
  switch (entry.kind) {
    case 'action':
      return Object.freeze({
        kind: 'action',
        actionId: String((entry.payload as { actionId: unknown }).actionId),
        input: (entry.payload as { input: unknown }).input ?? null,
      });
    case 'observation':
      return Object.freeze({
        kind: 'observation',
        observationId: String((entry.payload as { observationId: unknown }).observationId),
        channel: String((entry.payload as { channel: unknown }).channel),
        content: String((entry.payload as { content: unknown }).content),
      });
    case 'checkpoint':
      return Object.freeze({
        kind: 'checkpoint',
        checkpointId: String((entry.payload as { checkpointId: unknown }).checkpointId),
        snapshotDigest: String((entry.payload as { snapshotDigest: unknown }).snapshotDigest),
      });
    case 'error':
      return Object.freeze({
        kind: 'error',
        code: String((entry.payload as { code: unknown }).code),
        message: String((entry.payload as { message: unknown }).message),
      });
    case 'completion': {
      const evidence = (entry.payload as { evidenceDigests?: unknown }).evidenceDigests;
      return Object.freeze({
        kind: 'completion',
        outcome: String((entry.payload as { outcome: unknown }).outcome),
        evidenceDigests: Object.freeze(
          Array.isArray(evidence)
            ? evidence.filter((digest): digest is string => typeof digest === 'string')
            : [],
        ),
      });
    }
  }
}

function summaryOf(entry: TrajectoryEntry): string {
  switch (entry.kind) {
    case 'action':
      return actionSummary(entry);
    case 'observation':
      return observationSummary(entry);
    case 'checkpoint':
      return checkpointSummary(entry);
    case 'error':
      return errorSummary(entry);
    case 'completion':
      return completionSummary(entry);
  }
}

// ---------------------------------------------------------------------------
// Timeline model
// ---------------------------------------------------------------------------

/** The trajectory's run-binding summary (the four evidence-address parts). */
export interface ReplayRunRefModel {
  readonly taskId: string | null;
  readonly taskVersion: string | null;
  readonly environmentId: string | null;
  readonly environmentVersion: string | null;
  readonly runId: string | null;
  readonly initialSnapshotDigest: string | null;
  readonly runRecordDigest: string | null;
}

/** Wall-clock span of the readable steps. */
export interface ReplaySpanModel {
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  /** Wall-clock ms from the first to the last readable step (null when fewer than two timestamps). */
  readonly elapsedMs: number | null;
}

/** The honest posture of the trajectory's outcome. */
export type ReplayOutcome = 'completed' | 'failed' | 'timed-out' | 'pending' | 'unknown';

/** The timeline surface state (first-class, never collapsed). */
export type ReplayTimelineState = 'ready' | 'degraded' | 'no-data';

/** The complete timeline view model over one trajectory payload. */
export interface ReplayTimelineModel {
  readonly state: ReplayTimelineState;
  /** Structural integrity: chain-consistent (isTrajectoryRecord) vs invalid-shape. */
  readonly integrity: 'chain-consistent' | 'invalid-shape';
  readonly trajectoryId: string | null;
  readonly runRef: ReplayRunRefModel;
  readonly startedAt: string | null;
  readonly seed: string | null;
  readonly steps: readonly ReplayStepModel[];
  /** Count of READABLE entries (excludes gap markers and unreadable rows). */
  readonly stepCount: number;
  readonly chainHead: string | null;
  readonly outcome: ReplayOutcome;
  /** True when the trajectory has no completion entry but IS structurally consistent (in flight). */
  readonly pending: boolean;
  /** Evidence digests declared by the completion entry (empty when none). */
  readonly evidenceDigests: readonly string[];
  readonly span: ReplaySpanModel;
  /** Sequences sharing a wall-clock timestamp with their predecessor — logical order authoritative. */
  readonly sameWallClockSteps: readonly number[];
  /** Degradation notes (non-empty exactly when state === 'degraded'). */
  readonly degradation: readonly string[];
  /** The surface's frozen product-truth notes (observational, not-result, pending/degraded). */
  readonly notes: readonly string[];
}

function emptyRunRef(): ReplayRunRefModel {
  return Object.freeze({
    taskId: null,
    taskVersion: null,
    environmentId: null,
    environmentVersion: null,
    runId: null,
    initialSnapshotDigest: null,
    runRecordDigest: null,
  });
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortDigest(digest: string | null): string {
  return digest === null ? 'null' : `${digest.slice(0, 12)}…`;
}

/**
 * Project ANY payload into the timeline view model. Total, synchronous,
 * deterministic, never-throwing: malformed/truncated inputs degrade
 * truthfully, valid inputs render at full fidelity.
 */
export function toReplayTimeline(payload: unknown): ReplayTimelineModel {
  const degradation: string[] = [];
  const notes: string[] = [REPLAY_OBSERVATIONAL_NOTE, REPLAY_NOT_RESULT_NOTE];

  // -- absent payload: the honest no-data posture -------------------------
  if (!isRecordLike(payload)) {
    return Object.freeze({
      state: 'no-data',
      integrity: 'invalid-shape',
      trajectoryId: null,
      runRef: emptyRunRef(),
      startedAt: null,
      seed: null,
      steps: Object.freeze([]),
      stepCount: 0,
      chainHead: null,
      outcome: 'unknown',
      pending: false,
      evidenceDigests: Object.freeze([]),
      span: Object.freeze({ firstAt: null, lastAt: null, elapsedMs: null }),
      sameWallClockSteps: Object.freeze([]),
      degradation: Object.freeze([
        'no trajectory payload was provided for this run (no data)',
      ]),
      notes: Object.freeze([...notes, REPLAY_DEGRADED_NOTE]),
    } satisfies ReplayTimelineModel);
  }

  // -- structural integrity through the PUBLIC trajectory guard -----------
  const integrityOk = isTrajectoryRecord(payload);
  if (!integrityOk) {
    degradation.push(
      'trajectory payload failed structural validation (isTrajectoryRecord: header, entries or chain-head inconsistent) — rendered as degraded replay data',
    );
  }

  // -- header facts --------------------------------------------------------
  const header = payload['header'] as unknown;
  let trajectoryId: string | null = null;
  let runRef: ReplayRunRefModel = emptyRunRef();
  let startedAt: string | null = null;
  let seed: string | null = null;
  let chainHead: string | null = null;
  if (isRecordLike(header)) {
    const id = header['trajectoryId'];
    if (typeof id === 'string') trajectoryId = id;
    const started = header['startedAt'];
    if (typeof started === 'string') startedAt = started;
    const rawSeed = header['seed'];
    if (typeof rawSeed === 'string') seed = rawSeed;
    const run = header['run'];
    if (isRecordLike(run)) {
      const taskVersion = run['taskVersion'];
      const environmentVersion = run['environmentVersion'];
      const runId = run['runId'];
      const initialSnapshotDigest = run['initialSnapshotDigest'];
      const runRecordDigest = run['runRecordDigest'];
      const taskId =
        isRecordLike(taskVersion) && typeof taskVersion['taskId'] === 'string'
          ? taskVersion['taskId']
          : null;
      const taskVersionString =
        isRecordLike(taskVersion) && typeof taskVersion['version'] === 'string'
          ? taskVersion['version']
          : null;
      const environmentId =
        isRecordLike(environmentVersion) &&
        typeof environmentVersion['namespace'] === 'string' &&
        typeof environmentVersion['name'] === 'string'
          ? `${environmentVersion['namespace']}/${environmentVersion['name']}`
          : null;
      const environmentVersionString =
        isRecordLike(environmentVersion) && typeof environmentVersion['version'] === 'string'
          ? environmentVersion['version']
          : null;
      runRef = Object.freeze({
        taskId,
        taskVersion: taskVersionString,
        environmentId,
        environmentVersion: environmentVersionString,
        runId: typeof runId === 'string' ? runId : null,
        initialSnapshotDigest:
          typeof initialSnapshotDigest === 'string' ? initialSnapshotDigest : null,
        runRecordDigest:
          runRecordDigest === null || runRecordDigest === undefined
            ? null
            : typeof runRecordDigest === 'string'
              ? runRecordDigest
              : null,
      });
    }
  }
  const declaredChainHead = payload['chainHead'];
  if (typeof declaredChainHead === 'string') chainHead = declaredChainHead;

  // -- entries: per-element honest projection ------------------------------
  const rawEntries = payload['entries'];
  const entries: unknown[] = Array.isArray(rawEntries) ? [...rawEntries] : [];
  if (!Array.isArray(rawEntries)) {
    degradation.push('the entries field is missing or not an array — zero steps rendered');
  }

  const projected: ReplayStepModel[] = [];
  let unreadableCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const element = entries[index];
    if (element === undefined) continue;
    if (isTrajectoryEntry(element)) {
      projected.push(stepModelOf(element));
      continue;
    }
    // Unreadable element: keep its DECLARED sequence when present, else its position.
    const declaredSequence =
      typeof element === 'object' && element !== null && !Array.isArray(element)
        ? (element as Record<string, unknown>)['sequence']
        : undefined;
    const sequence =
      typeof declaredSequence === 'number' && Number.isInteger(declaredSequence) && declaredSequence > 0
        ? declaredSequence
        : index + 1;
    const reason = isRecordLike(element)
      ? 'entry failed the per-entry structural guard (kind, payload, chain digests or timestamps invalid)'
      : 'entry is not an object';
    unreadableCount += 1;
    projected.push(
      Object.freeze({
        sequence,
        kind: 'unreadable',
        truthClass: UNKNOWN_TRUTH_CLASS,
        kindLabel: STEP_KIND_LABELS['unreadable'],
        summary: truncate(`${reason} — rendered as unknown, never guessed`),
        occurredAt: null,
        wallClockDeltaMs: null,
        sameWallClockAsPrevious: false,
        payloadView: Object.freeze({ kind: 'unreadable', reason }),
        stepDigest: null,
        prevDigest: null,
      } satisfies ReplayStepModel),
    );
    if (projected.length >= REPLAY_MAX_TIMELINE_STEPS) {
      degradation.push(
        `timeline truncated after ${String(REPLAY_MAX_TIMELINE_STEPS)} rows (${String(entries.length - index - 1)} further entry positions exist)`,
      );
      break;
    }
  }
  if (unreadableCount > 0) {
    degradation.push(
      `${String(unreadableCount)} trajectory entr${unreadableCount === 1 ? 'y' : 'ies'} failed the per-entry structural guard and rendered as unreadable (unknown)`,
    );
  }

  // -- deterministic order + gap analysis -----------------------------------
  const ordered = [...projected].sort((a, b) => a.sequence - b.sequence);
  const steps: ReplayStepModel[] = [];
  let expectedSequence = 1;
  let gapMarkers = 0;
  let truncatedByGapBound = 0;
  for (const step of ordered) {
    while (step.sequence > expectedSequence) {
      if (gapMarkers >= REPLAY_MAX_GAP_STEPS) {
        truncatedByGapBound += step.sequence - expectedSequence;
        break;
      }
      steps.push(
        Object.freeze({
          sequence: expectedSequence,
          kind: 'no-data',
          truthClass: UNKNOWN_TRUTH_CLASS,
          kindLabel: STEP_KIND_LABELS['no-data'],
          summary: `sequence ${String(expectedSequence)} is missing from the payload — no data for this step (never fabricated)`,
          occurredAt: null,
          wallClockDeltaMs: null,
          sameWallClockAsPrevious: false,
          payloadView: Object.freeze({ kind: 'no-data' }),
          stepDigest: null,
          prevDigest: null,
        } satisfies ReplayStepModel),
      );
      gapMarkers += 1;
      expectedSequence += 1;
    }
    steps.push(step);
    expectedSequence = step.sequence + 1;
  }
  if (gapMarkers > 0) {
    degradation.push(
      `${String(gapMarkers)} sequence gap${gapMarkers === 1 ? '' : 's'} detected — rendered as no-data markers (truncated or corrupted payload)`,
    );
  }
  if (truncatedByGapBound > 0) {
    degradation.push(
      `${String(truncatedByGapBound)} further missing sequences collapsed behind the gap-marker bound (${String(REPLAY_MAX_GAP_STEPS)})`,
    );
  }

  // -- wall-clock vs logical ordering ---------------------------------------
  let lastOccurredAtMs: number | null = null;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  const sameWallClockSteps: number[] = [];
  const decorated: ReplayStepModel[] = steps.map((step) => {
    if (step.occurredAt === null) {
      return step;
    }
    const atMs = Date.parse(step.occurredAt);
    if (Number.isNaN(atMs)) {
      return step;
    }
    if (firstAt === null) firstAt = step.occurredAt;
    lastAt = step.occurredAt;
    const delta = lastOccurredAtMs === null ? null : atMs - lastOccurredAtMs;
    const same = lastOccurredAtMs !== null && atMs === lastOccurredAtMs;
    if (same) sameWallClockSteps.push(step.sequence);
    lastOccurredAtMs = atMs;
    return Object.freeze({
      ...step,
      wallClockDeltaMs: delta,
      sameWallClockAsPrevious: same,
    });
  });
  if (sameWallClockSteps.length > 0) {
    notes.push(
      `${String(sameWallClockSteps.length)} timeline step${sameWallClockSteps.length === 1 ? '' : 's'} carry the same wall-clock timestamp as the previous step — the LOGICAL (chain sequence) order is authoritative for rendering`,
    );
  }
  const elapsedMs =
    firstAt !== null && lastAt !== null && !Number.isNaN(Date.parse(firstAt)) && !Number.isNaN(Date.parse(lastAt))
      ? Date.parse(lastAt) - Date.parse(firstAt)
      : null;

  // -- outcome / pending ------------------------------------------------------
  const completion = decorated.find(
    (step) => step.kind === 'completion' && step.truthClass === REPLAY_STEP_TRUTH_CLASS,
  );
  let outcome: ReplayOutcome;
  let pending = false;
  let evidenceDigests: readonly string[] = Object.freeze([]);
  if (completion !== undefined && completion.payloadView.kind === 'completion') {
    outcome = completion.payloadView.outcome === 'completed' || completion.payloadView.outcome === 'failed' || completion.payloadView.outcome === 'timed-out'
      ? completion.payloadView.outcome
      : 'unknown';
    evidenceDigests = completion.payloadView.evidenceDigests;
  } else if (integrityOk) {
    outcome = 'pending';
    pending = true;
    notes.push(REPLAY_PENDING_NOTE);
  } else {
    outcome = 'unknown';
    degradation.push('no readable completion entry — final outcome unknown');
  }

  const state: ReplayTimelineState =
    integrityOk && unreadableCount === 0 && gapMarkers === 0 && truncatedByGapBound === 0
      ? 'ready'
      : 'degraded';
  if (state === 'degraded') notes.push(REPLAY_DEGRADED_NOTE);

  return Object.freeze({
    state,
    integrity: integrityOk ? 'chain-consistent' : 'invalid-shape',
    trajectoryId,
    runRef,
    startedAt,
    seed,
    steps: Object.freeze(decorated),
    stepCount: decorated.filter((step) => step.truthClass === REPLAY_STEP_TRUTH_CLASS).length,
    chainHead,
    outcome,
    pending,
    evidenceDigests,
    span: Object.freeze({ firstAt, lastAt, elapsedMs }),
    sameWallClockSteps: Object.freeze(sameWallClockSteps),
    degradation: Object.freeze(degradation),
    notes: Object.freeze(notes),
  } satisfies ReplayTimelineModel);
}

/** Build the readable step model for one validated trajectory entry. */
function stepModelOf(entry: TrajectoryEntry): ReplayStepModel {
  return Object.freeze({
    sequence: entry.sequence,
    kind: entry.kind,
    truthClass: REPLAY_STEP_TRUTH_CLASS,
    kindLabel: STEP_KIND_LABELS[entry.kind],
    summary: summaryOf(entry),
    occurredAt: entry.occurredAt,
    wallClockDeltaMs: null,
    sameWallClockAsPrevious: false,
    payloadView: payloadViewOf(entry),
    stepDigest: entry.stepDigest,
    prevDigest: entry.prevDigest,
  } satisfies ReplayStepModel);
}

// ---------------------------------------------------------------------------
// Full-chain verification (runtime-owned, async, typed non-throwing outcome)
// ---------------------------------------------------------------------------

/** The typed outcome of full trajectory chain verification. */
export interface ReplayChainVerification {
  readonly status: 'verified' | 'failed' | 'not-attempted';
  /** The recomputed chain head on success; the declared one otherwise (when readable). */
  readonly chainHead: string | null;
  /** The trajectory error code on failure (e.g. TRAJECTORY_TAMPERED). */
  readonly errorCode: string | null;
  /** Human-readable failure detail (observability, never customer data). */
  readonly detail: string | null;
}

/**
 * Verify a trajectory payload through @arena/trajectory's PUBLIC
 * `verifyTrajectoryRecord` (recomputes the header digest and the whole
 * step chain). Non-throwing: any failure — malformed shape OR a tamper
 * tripwire — resolves to the typed `failed` outcome with the trajectory
 * package's own error code; the views render it as a degradation, never
 * as a crash and never as silent success.
 */
export async function verifyReplayTrajectoryChain(
  payload: unknown,
  expectedChainHead?: string,
): Promise<ReplayChainVerification> {
  const declared =
    isRecordLike(payload) && typeof payload['chainHead'] === 'string'
      ? payload['chainHead']
      : null;
  try {
    const recomputed = await verifyTrajectoryRecord(
      payload as TrajectoryRecord,
      expectedChainHead,
    );
    return Object.freeze({
      status: 'verified',
      chainHead: recomputed,
      errorCode: null,
      detail: null,
    } satisfies ReplayChainVerification);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return Object.freeze({
      status: 'failed',
      chainHead: declared,
      errorCode: typeof code === 'string' ? code : TRAJECTORY_ERROR_CODES.INVALID_RECORD,
      detail: error instanceof Error ? error.message : String(error),
    } satisfies ReplayChainVerification);
  }
}

/** True iff the timeline renders every step at full fidelity (no degradation). */
export function isReplayTimelineReady(timeline: ReplayTimelineModel): boolean {
  return timeline.state === 'ready';
}

/** The honest one-line status of a timeline for list rows and tests. */
export function replayTimelineStatusLabel(timeline: ReplayTimelineModel): string {
  if (timeline.state === 'no-data') return 'no trajectory data';
  if (timeline.pending) return 'pending (in flight)';
  if (timeline.state === 'degraded') return `degraded (outcome ${timeline.outcome})`;
  return `replayable (${timeline.stepCount} steps, outcome ${timeline.outcome})`;
}

// Re-exported for the view layer's short-digest rendering.
export { shortDigest };
