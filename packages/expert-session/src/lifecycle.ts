/**
 * Expert session lifecycle (Work Order C006; spec
 * expert-environment-session.md EES1.0) — the session state machine
 * bound to the C001 escalation lifecycle.
 *
 *   open (capsule derived; escalation SESSION_READY)
 *     → active (expert begins; escalation IN_PROGRESS)
 *     → completed (submission accepted into the escalation; escalation SUBMITTED)
 *   open|active → expired (capsule time bound exceeded)
 *   open|active → cancelled (escalation cancelled / expert replaced)
 *
 * House discipline (mirroring @arena/escalation's lifecycle):
 *   - every transition is a PURE function returning a NEW deep-frozen
 *     record (append-only history — never rewritten);
 *   - terminal states are FINAL;
 *   - verdicts are MACHINE-READABLE (closed reason vocabulary);
 *   - all timestamps are injected (no wall-clock reads — lock rule 17);
 *   - events append ONLY while the session is active, with monotonic
 *     1..n sequences and monotonic timestamps.
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ExpertSessionCapsule } from './capsule.js';
import { isCapsuleWithinTimeBound } from './capsule.js';
import type { ExpertSessionEvent } from './events.js';
import { createExpertSessionEvent } from './events.js';
import type { ExpertSessionSubmission } from './submission.js';
import type { ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import { deepFreeze, toExpertSessionTimestamp } from './shared.js';

/** Wire version of the session record shape. */
export const EXPERT_SESSION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed state vocabulary
// ---------------------------------------------------------------------------

export const EXPERT_SESSION_STATES = Object.freeze([
  'open',
  'active',
  'completed',
  'expired',
  'cancelled',
] as const);
export type ExpertSessionState = (typeof EXPERT_SESSION_STATES)[number];

export const EXPERT_SESSION_TERMINAL_STATES = Object.freeze(['completed', 'expired', 'cancelled'] as const);
export type TerminalExpertSessionState = (typeof EXPERT_SESSION_TERMINAL_STATES)[number];

export function isExpertSessionState(value: unknown): value is ExpertSessionState {
  return typeof value === 'string' && (EXPERT_SESSION_STATES as readonly string[]).includes(value);
}

export function isTerminalExpertSessionState(value: unknown): value is TerminalExpertSessionState {
  return (
    typeof value === 'string' &&
    (EXPERT_SESSION_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

/** The ONLY legal transitions out of each session state. */
export const EXPERT_SESSION_TRANSITIONS: Readonly<
  Record<ExpertSessionState, readonly ExpertSessionState[]>
> = Object.freeze({
  open: Object.freeze(['active', 'expired', 'cancelled'] as readonly ExpertSessionState[]),
  active: Object.freeze(['completed', 'expired', 'cancelled'] as readonly ExpertSessionState[]),
  completed: Object.freeze([] as readonly ExpertSessionState[]),
  expired: Object.freeze([] as readonly ExpertSessionState[]),
  cancelled: Object.freeze([] as readonly ExpertSessionState[]),
});

// ---------------------------------------------------------------------------
// Session record
// ---------------------------------------------------------------------------

export interface ExpertSessionStateHistoryEntry {
  readonly sequence: number;
  readonly from: ExpertSessionState | null;
  readonly to: ExpertSessionState;
  readonly occurredAt: ExpertSessionTimestamp;
  readonly reason: 'creation' | 'transition_ok';
  readonly actor?: string;
}

export interface ExpertSessionRecord {
  readonly recordVersion: typeof EXPERT_SESSION_RECORD_VERSION;
  readonly capsule: ExpertSessionCapsule;
  readonly state: ExpertSessionState;
  /** The submission (present once completed). */
  readonly submission?: ExpertSessionSubmission;
  /** Append-only observable event stream (1..n while active). */
  readonly events: readonly ExpertSessionEvent[];
  readonly history: readonly ExpertSessionStateHistoryEntry[];
  readonly updatedAt: ExpertSessionTimestamp;
}

/** Create the initial session record for a derived capsule (state `open`). */
export function createExpertSessionRecord(
  capsule: ExpertSessionCapsule,
  now: number | string | Date,
): ExpertSessionRecord {
  const occurredAt = toExpertSessionTimestamp(now);
  const record: ExpertSessionRecord = Object.freeze({
    recordVersion: EXPERT_SESSION_RECORD_VERSION,
    capsule,
    state: 'open',
    events: Object.freeze([]),
    history: Object.freeze([
      Object.freeze({ sequence: 1, from: null, to: 'open', occurredAt, reason: 'creation' }),
    ]),
    updatedAt: occurredAt,
  });
  deepFreeze(record as unknown as PlainJsonValue);
  return record;
}

export interface SessionTransitionContext {
  readonly now: number | string | Date;
  readonly actor?: string;
  /** The submission — required when entering `completed`. */
  readonly submission?: ExpertSessionSubmission;
}

/** Apply a guarded session transition (pure; append-only history). */
export function applyExpertSessionTransition(
  record: ExpertSessionRecord,
  to: ExpertSessionState,
  context: SessionTransitionContext,
): ExpertSessionRecord {
  if (!(EXPERT_SESSION_TRANSITIONS[record.state] as readonly string[]).includes(to)) {
    if (isTerminalExpertSessionState(record.state)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.TERMINAL_STATE, {
        message: `session ${record.capsule.sessionId} is in terminal state ${record.state}; no transition may follow`,
        details: { sessionId: record.capsule.sessionId, state: record.state },
      });
    }
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TRANSITION, {
      message: `session transition ${record.state} -> ${to} is not legal`,
      details: { from: record.state, to },
    });
  }
  if (to === 'completed' && context.submission === undefined) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'entering completed requires the session submission',
    });
  }
  if (to === 'expired' && isCapsuleWithinTimeBound(record.capsule, context.now)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'expiry requires the capsule time bound to have been exceeded',
    });
  }
  const occurredAt = toExpertSessionTimestamp(context.now);
  const lastEntry = record.history[record.history.length - 1];
  if (lastEntry !== undefined && Date.parse(occurredAt) < Date.parse(lastEntry.occurredAt)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'history timestamps must be monotonically non-decreasing (injected clock ran backwards)',
    });
  }
  const entry: ExpertSessionStateHistoryEntry = Object.freeze({
    sequence: record.history.length + 1,
    from: record.state,
    to,
    occurredAt,
    reason: 'transition_ok',
    ...(context.actor !== undefined ? { actor: context.actor } : {}),
  });
  const next: ExpertSessionRecord = Object.freeze({
    ...record,
    state: to,
    history: Object.freeze([...record.history, entry]),
    updatedAt: occurredAt,
    ...(context.submission !== undefined ? { submission: context.submission } : {}),
  });
  return next;
}

// ---------------------------------------------------------------------------
// Event append (active sessions only; monotonic sequence)
// ---------------------------------------------------------------------------

export interface AppendSessionEventInput {
  readonly kind: string;
  readonly payload: unknown;
  readonly now: number | string | Date;
  readonly actor?: string;
  readonly eventId?: string;
}

/** Append one observable event to an ACTIVE session (append-only stream). */
export function appendSessionEvent(
  record: ExpertSessionRecord,
  input: AppendSessionEventInput,
): ExpertSessionRecord {
  if (record.state !== 'active') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_STATE, {
      message: `events append only while the session is active (state: ${record.state})`,
      details: { sessionId: record.capsule.sessionId, state: record.state },
    });
  }
  const now = toExpertSessionTimestamp(input.now);
  const lastEvent = record.events[record.events.length - 1];
  if (lastEvent !== undefined && Date.parse(now) < Date.parse(lastEvent.recordedAt)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: 'event timestamps must be monotonically non-decreasing (injected clock ran backwards)',
    });
  }
  const event = createExpertSessionEvent({
    sessionId: record.capsule.sessionId,
    sequence: record.events.length + 1,
    kind: input.kind,
    payload: input.payload,
    now,
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
  });
  const next: ExpertSessionRecord = Object.freeze({
    ...record,
    events: Object.freeze([...record.events, event]),
    updatedAt: now,
  });
  return next;
}

/** Structural guard for wire values claiming to be session records. */
export function isExpertSessionRecord(value: unknown): value is ExpertSessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== EXPERT_SESSION_RECORD_VERSION ||
    !isExpertSessionState(candidate['state']) ||
    !Array.isArray(candidate['events']) ||
    !Array.isArray(candidate['history']) ||
    candidate['history'].length === 0
  ) {
    return false;
  }
  for (let index = 0; index < candidate['history'].length; index += 1) {
    const entry = (candidate['history'] as readonly unknown[])[index] as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null || entry['sequence'] !== index + 1) return false;
  }
  for (let index = 0; index < candidate['events'].length; index += 1) {
    const entry = (candidate['events'] as readonly unknown[])[index] as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null || entry['sequence'] !== index + 1) return false;
  }
  return true;
}
