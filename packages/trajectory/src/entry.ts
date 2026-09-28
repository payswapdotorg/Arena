/**
 * TrajectoryEntry — one append-only, ordered step of a trajectory (Work
 * Order A011 gate 3; spec/task-spec.md TaskSpec §actions/observations;
 * requirements R10, R11; architecture-lock rule 6).
 *
 * A trajectory is the record of what the agent DID inside a run, so every
 * entry is one of exactly five kinds:
 *
 *   - `action`      — an action the agent took (action id + canonical
 *                     JSON input, addressed against the task's action
 *                     surface);
 *   - `observation` — an observation the agent received (observation id +
 *                     channel + content; the channel vocabulary mirrors
 *                     A009's observation surface channels);
 *   - `checkpoint`  — an environment checkpoint reached at this step
 *                     (checkpoint id + snapshot digest — A010
 *                     RunCheckpoint-shaped digest refs, never redefined);
 *   - `error`       — an error encountered mid-run (code + message; the
 *                     agent may recover, so an error entry does NOT close
 *                     the trajectory);
 *   - `completion`  — the terminal entry (outcome + evidence digests);
 *                     a trajectory with a completion entry is FROZEN —
 *                     nothing may follow (gate 4).
 *
 * Ordering invariants (enforced at the append boundary):
 *   - sequence numbers are 1-based, contiguous and strictly increasing —
 *     a gap, a duplicate or a regression is rejected;
 *   - occurredAt timestamps are monotonically non-decreasing.
 *
 * Content addressing (gate 3): every entry is individually
 * digest-addressed by its `stepDigest` — sha256 over the canonical JSON
 * of { sequence, kind, payload, occurredAt, prevDigest } via
 * @arena/protocol-core's digestCanonical (never reimplemented). The
 * chain: entry N's stepDigest commits to entry N-1's stepDigest through
 * `prevDigest` (the FIRST entry is anchored to the trajectory header's
 * digest), so the whole trajectory is one tamper-evident hash chain —
 * mutating any historical entry changes EVERY subsequent stepDigest
 * (gate 3 tests).
 */

import { canonicalJson, digestCanonical } from '@arena/protocol-core';
import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import {
  deepFreeze,
  expectCanonicalJsonValue,
  expectEnumMember,
  expectFields,
  expectPositiveInteger,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isTrajectoryTimestamp,
  toContentDigest,
  toErrorCode,
  toNeutralId,
  toNeutralText,
  toTrajectoryTimestamp,
} from './shared.js';
import type {
  ContentDigest,
  ErrorCode,
  NeutralId,
  NeutralText,
  TrajectoryTimestamp,
} from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabulary
// ---------------------------------------------------------------------------

export const TRAJECTORY_ENTRY_KINDS = Object.freeze([
  'action',
  'observation',
  'checkpoint',
  'error',
  'completion',
] as const);
export type TrajectoryEntryKind = (typeof TRAJECTORY_ENTRY_KINDS)[number];

/**
 * Observation channels — character-for-character mirror of A009's
 * OBSERVATION_CHANNELS (the environment's observation surface). Kept in
 * sync with the generated contracts by contracts.parity.test.ts.
 */
export const OBSERVATION_CHANNELS = Object.freeze([
  'stdout',
  'stderr',
  'files',
  'events',
  'metrics',
  'state-dump',
] as const);
export type ObservationChannel = (typeof OBSERVATION_CHANNELS)[number];

/**
 * Completion outcomes — character-for-character mirror of A010's
 * RUN_OUTCOME_STATES (the run lifecycle's outcome vocabulary). Kept in
 * sync with the generated contracts by contracts.parity.test.ts.
 */
export const TRAJECTORY_OUTCOMES = Object.freeze(['completed', 'failed', 'timed-out'] as const);
export type TrajectoryOutcome = (typeof TRAJECTORY_OUTCOMES)[number];

export function isTrajectoryEntryKind(value: unknown): value is TrajectoryEntryKind {
  return (
    typeof value === 'string' &&
    (TRAJECTORY_ENTRY_KINDS as readonly string[]).includes(value)
  );
}

export function isObservationChannel(value: unknown): value is ObservationChannel {
  return (
    typeof value === 'string' && (OBSERVATION_CHANNELS as readonly string[]).includes(value)
  );
}

export function isTrajectoryOutcome(value: unknown): value is TrajectoryOutcome {
  return (
    typeof value === 'string' && (TRAJECTORY_OUTCOMES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Typed payloads per kind (gate 3)
// ---------------------------------------------------------------------------

/** An action the agent took: action id + canonical JSON input. */
export interface ActionEntryPayload {
  readonly actionId: NeutralId;
  readonly input: Readonly<Record<string, unknown>> | null;
}

/** An observation the agent received (A009 observation-surface shaped). */
export interface ObservationEntryPayload {
  readonly observationId: NeutralId;
  readonly channel: ObservationChannel;
  readonly content: NeutralText;
}

/** An environment checkpoint reached at this step (A010 digest refs). */
export interface CheckpointEntryPayload {
  readonly checkpointId: NeutralId;
  readonly snapshotDigest: ContentDigest;
}

/** An error encountered mid-run (recoverable — the run may continue). */
export interface ErrorEntryPayload {
  readonly code: ErrorCode;
  readonly message: NeutralText;
}

/** The terminal entry: outcome + the evidence outputs the run produced. */
export interface CompletionEntryPayload {
  readonly outcome: TrajectoryOutcome;
  readonly evidenceDigests: readonly ContentDigest[];
}

export type TrajectoryEntryPayload =
  | ActionEntryPayload
  | ObservationEntryPayload
  | CheckpointEntryPayload
  | ErrorEntryPayload
  | CompletionEntryPayload;

export interface ActionEntryPayloadInput {
  readonly actionId: string;
  readonly input?: Readonly<Record<string, unknown>> | null;
}
export interface ObservationEntryPayloadInput {
  readonly observationId: string;
  readonly channel: string;
  readonly content: string;
}
export interface CheckpointEntryPayloadInput {
  readonly checkpointId: string;
  readonly snapshotDigest: string;
}
export interface ErrorEntryPayloadInput {
  readonly code: string;
  readonly message: string;
}
export interface CompletionEntryPayloadInput {
  readonly outcome: string;
  readonly evidenceDigests?: readonly string[];
}

/** Validate and freeze the typed payload for a given entry kind. */
export function toTrajectoryEntryPayload(
  kind: TrajectoryEntryKind,
  value: unknown,
): TrajectoryEntryPayload {
  switch (kind) {
    case 'action': {
      const record = expectFields(
        value,
        ['actionId'],
        ['input'],
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'action entry payload',
      );
      const actionId = toNeutralId(
        typeof record['actionId'] === 'string' ? record['actionId'] : '',
        'action payload actionId',
      );
      const rawInput = record['input'];
      let input: Readonly<Record<string, unknown>> | null = null;
      if (rawInput !== undefined && rawInput !== null) {
        if (typeof rawInput !== 'object' || Array.isArray(rawInput)) {
          throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
            message: 'action entry payload: input must be a plain JSON object or null',
            details: { receivedType: typeof rawInput },
          });
        }
        expectCanonicalJsonValue(rawInput, 'input', 'action entry payload');
        try {
          canonicalJson(rawInput);
        } catch (cause) {
          throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
            message:
              'action entry payload: input must be canonical-JSON serializable (no undefined, functions, bigints or class instances)',
            cause,
          });
        }
        input = deepFreeze({ ...(rawInput as Readonly<Record<string, unknown>>) });
      }
      return deepFreeze({ actionId, input });
    }
    case 'observation': {
      const record = expectFields(
        value,
        ['observationId', 'channel', 'content'],
        [],
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'observation entry payload',
      );
      const observationId = toNeutralId(
        typeof record['observationId'] === 'string' ? record['observationId'] : '',
        'observation payload observationId',
      );
      const channel = expectEnumMember(
        record['channel'],
        OBSERVATION_CHANNELS,
        'channel',
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'observation entry payload',
      );
      const content = toNeutralText(
        typeof record['content'] === 'string' ? record['content'] : '',
        'observation payload content',
      );
      return deepFreeze({ observationId, channel, content });
    }
    case 'checkpoint': {
      const record = expectFields(
        value,
        ['checkpointId', 'snapshotDigest'],
        [],
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'checkpoint entry payload',
      );
      const checkpointId = toNeutralId(
        typeof record['checkpointId'] === 'string' ? record['checkpointId'] : '',
        'checkpoint payload checkpointId',
      );
      const snapshotDigest = toContentDigest(
        typeof record['snapshotDigest'] === 'string' ? record['snapshotDigest'] : '',
        'checkpoint payload snapshotDigest',
      );
      return deepFreeze({ checkpointId, snapshotDigest });
    }
    case 'error': {
      const record = expectFields(
        value,
        ['code', 'message'],
        [],
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'error entry payload',
      );
      const code = toErrorCode(typeof record['code'] === 'string' ? record['code'] : '');
      const message = toNeutralText(
        typeof record['message'] === 'string' ? record['message'] : '',
        'error payload message',
      );
      return deepFreeze({ code, message });
    }
    case 'completion': {
      const record = expectFields(
        value,
        ['outcome'],
        ['evidenceDigests'],
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'completion entry payload',
      );
      const outcome = expectEnumMember(
        record['outcome'],
        TRAJECTORY_OUTCOMES,
        'outcome',
        TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD,
        'completion entry payload',
      );
      const rawEvidence = record['evidenceDigests'];
      let evidenceDigests: readonly ContentDigest[] = [];
      if (rawEvidence !== undefined && rawEvidence !== null) {
        if (!Array.isArray(rawEvidence)) {
          throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
            message: 'completion entry payload: evidenceDigests must be an array of digests',
          });
        }
        evidenceDigests = Object.freeze(
          rawEvidence.map((entry) =>
            toContentDigest(
              typeof entry === 'string' ? entry : '',
              'completion payload evidenceDigests',
            ),
          ),
        );
      }
      return deepFreeze({ outcome, evidenceDigests });
    }
  }
}

/** Structural (non-throwing) check for a typed entry payload. */
export function isTrajectoryEntryPayload(
  kind: TrajectoryEntryKind,
  value: unknown,
): value is TrajectoryEntryPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  switch (kind) {
    case 'action':
      return (
        isNeutralId(candidate['actionId']) &&
        (candidate['input'] === null ||
          candidate['input'] === undefined ||
          (typeof candidate['input'] === 'object' &&
            candidate['input'] !== null &&
            !Array.isArray(candidate['input'])))
      );
    case 'observation':
      return (
        isNeutralId(candidate['observationId']) &&
        isObservationChannel(candidate['channel']) &&
        isNeutralText(candidate['content'])
      );
    case 'checkpoint':
      return (
        isNeutralId(candidate['checkpointId']) &&
        isContentDigest(candidate['snapshotDigest'])
      );
    case 'error':
      return (
        typeof candidate['code'] === 'string' &&
        /^[A-Z][A-Z0-9_]{0,127}$/.test(candidate['code']) &&
        isNeutralText(candidate['message'])
      );
    case 'completion':
      return (
        isTrajectoryOutcome(candidate['outcome']) &&
        (candidate['evidenceDigests'] === undefined ||
          (Array.isArray(candidate['evidenceDigests']) &&
            candidate['evidenceDigests'].every((entry) => isContentDigest(entry))))
      );
  }
}

// ---------------------------------------------------------------------------
// TrajectoryEntry — view, chain, constructors
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the stepDigest commits to. */
export interface TrajectoryEntryView {
  readonly sequence: number;
  readonly kind: TrajectoryEntryKind;
  readonly payload: TrajectoryEntryPayload;
  readonly occurredAt: TrajectoryTimestamp;
}

/**
 * A frozen trajectory entry: the view plus the chain fields. `prevDigest`
 * is the previous entry's stepDigest (the FIRST entry is anchored to the
 * trajectory header's digest); `stepDigest` is the chained digest over
 * { ...view, prevDigest }.
 */
export interface TrajectoryEntry extends TrajectoryEntryView {
  readonly prevDigest: ContentDigest;
  readonly stepDigest: ContentDigest;
}

/** Stable field list for the entry view (tests + contracts mirror it). */
export const TRAJECTORY_ENTRY_FIELDS = Object.freeze([
  'sequence',
  'kind',
  'payload',
  'occurredAt',
] as const) as readonly string[];

/** The input shape of an append (kind + typed payload + occurred-at). */
export interface CreateTrajectoryEntryInput {
  readonly sequence: number;
  readonly kind: TrajectoryEntryKind;
  readonly payload: unknown;
  readonly occurredAt: string;
}

/** The chain tail an append validates against. */
export interface TrajectoryChainTail {
  /** Anchor for the next entry: header digest (empty) or last stepDigest. */
  readonly anchorDigest: ContentDigest;
  /** Sequence of the last entry (0 when the trajectory is empty). */
  readonly lastSequence: number;
  /** Occurred-at of the last entry (null when the trajectory is empty). */
  readonly lastOccurredAt: TrajectoryTimestamp | null;
  /** True once a completion entry has been appended. */
  readonly completed: boolean;
}

/** Structural (non-throwing) check for the digest-free entry view. */
export function isTrajectoryEntryView(value: unknown): value is TrajectoryEntryView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] > 0 &&
    isTrajectoryEntryKind(candidate['kind']) &&
    isTrajectoryEntryPayload(candidate['kind'], candidate['payload']) &&
    isTrajectoryTimestamp(candidate['occurredAt'])
  );
}

/** Structural (non-throwing) check for the full entry (view + chain). */
export function isTrajectoryEntry(value: unknown): value is TrajectoryEntry {
  if (!isTrajectoryEntryView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['prevDigest']) && isContentDigest(candidate['stepDigest']);
}

/** The chained digest over { ...view, prevDigest } (canonical sha256). */
export async function computeTrajectoryStepDigest(
  view: TrajectoryEntryView,
  prevDigest: string,
): Promise<ContentDigest> {
  const digest = await digestCanonical({ ...view, prevDigest });
  return toContentDigest(digest, 'trajectory step digest');
}

/**
 * Create a validated, deep-frozen, chain-linked trajectory entry.
 *
 * Enforces every ordering invariant documented on the module:
 *   - `sequence` must be exactly `tail.lastSequence + 1` (gaps,
 *     duplicates and regressions are rejected with distinct codes);
 *   - `occurredAt` must not precede the last entry's occurred-at;
 *   - the payload must be structurally valid for its kind;
 *   - NOTHING may follow a completion entry.
 */
export async function createTrajectoryEntry(
  tail: TrajectoryChainTail,
  input: CreateTrajectoryEntryInput,
): Promise<TrajectoryEntry> {
  const record = expectFields(
    input,
    ['sequence', 'kind', 'payload', 'occurredAt'],
    [],
    TRAJECTORY_ERROR_CODES.INVALID_ENTRY,
    'trajectory entry',
  );

  const sequence = expectPositiveInteger(
    record['sequence'],
    'sequence',
    TRAJECTORY_ERROR_CODES.INVALID_ENTRY,
    'trajectory entry',
  );
  const kind = expectEnumMember(
    record['kind'],
    TRAJECTORY_ENTRY_KINDS,
    'kind',
    TRAJECTORY_ERROR_CODES.INVALID_ENTRY,
    'trajectory entry',
  );
  const occurredAt = toTrajectoryTimestamp(
    typeof record['occurredAt'] === 'string' ? record['occurredAt'] : '',
    'trajectory entry occurredAt',
  );

  const expected = tail.lastSequence + 1;
  if (sequence < expected) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.SEQUENCE_REGRESSION, {
      message: `entry sequence ${String(sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only trajectories never rewrite history)`,
      details: { expected, actual: sequence, kind },
    });
  }
  if (sequence > expected) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.SEQUENCE_GAP, {
      message: `entry sequence ${String(sequence)} leaves a gap before the expected next sequence ${String(expected)} (trajectory sequences must be contiguous and strictly increasing)`,
      details: { expected, actual: sequence, kind },
    });
  }
  if (tail.completed) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED, {
      message: `trajectory is frozen by its completion entry at sequence ${String(tail.lastSequence)} — nothing may follow (architecture-lock rule 6: append-only)`,
      details: { completedAtSequence: tail.lastSequence, attemptedKind: kind },
    });
  }
  if (
    tail.lastOccurredAt !== null &&
    Date.parse(occurredAt) < Date.parse(tail.lastOccurredAt)
  ) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TIMESTAMP_REGRESSION, {
      message: `entry occurred-at ${occurredAt} precedes the last entry's occurred-at ${tail.lastOccurredAt} (trajectory timestamps are monotonically non-decreasing)`,
      details: { lastOccurredAt: tail.lastOccurredAt, attemptedOccurredAt: occurredAt },
    });
  }

  const payload = toTrajectoryEntryPayload(kind, record['payload']);
  const view: TrajectoryEntryView = { sequence, kind, payload, occurredAt };
  const stepDigest = await computeTrajectoryStepDigest(view, tail.anchorDigest);
  return deepFreeze({ ...view, prevDigest: tail.anchorDigest, stepDigest }) as TrajectoryEntry;
}

/** The digest-free view of an entry (what its stepDigest commits to). */
export function trajectoryEntryView(entry: TrajectoryEntry): TrajectoryEntryView {
  const { prevDigest: _prev, stepDigest: _step, ...view } = entry;
  return deepFreeze({ ...view }) as TrajectoryEntryView;
}

/**
 * Verify one entry: recompute the chained stepDigest and compare
 * (optionally also pinning the expected prevDigest). Throws
 * TRAJECTORY_TAMPERED on any mismatch.
 */
export async function verifyTrajectoryEntry(
  entry: TrajectoryEntry,
  expectedPrevDigest?: string,
): Promise<ContentDigest> {
  if (!isTrajectoryEntry(entry)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_ENTRY, {
      message: 'trajectory entry verification requires a structurally valid entry',
    });
  }
  if (expectedPrevDigest !== undefined && entry.prevDigest !== expectedPrevDigest) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TAMPERED, {
      message: `entry ${String(entry.sequence)} prevDigest ${entry.prevDigest} does not match the chain predecessor ${expectedPrevDigest}`,
      details: { sequence: entry.sequence, expected: expectedPrevDigest, actual: entry.prevDigest },
    });
  }
  const actual = await computeTrajectoryStepDigest(
    trajectoryEntryView(entry),
    entry.prevDigest,
  );
  if (actual !== entry.stepDigest) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.TAMPERED, {
      message: `entry ${String(entry.sequence)} stepDigest mismatch: expected ${entry.stepDigest}, got ${actual}`,
      details: { sequence: entry.sequence, expected: entry.stepDigest, actual },
    });
  }
  return actual;
}
