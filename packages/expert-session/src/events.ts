/**
 * Observable event stream (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Agent observation" —
 * architecture-lock rule 30).
 *
 * The originating agent/application may receive an observable stream
 * containing ONLY approved events (closed EES1.0 vocabulary):
 * environment observations; human actions; tool invocations; tool
 * results; artifact changes; annotations; checkpoints; final result;
 * expert correction; explicit tool-gap signal.
 *
 * PRIVATE CHAIN-OF-THOUGHT IS NEVER IN THE STREAM: construction rejects
 * payloads carrying private-reasoning markers with the typed
 * PRIVATE_REASONING failure, and the observation projection re-screens
 * every payload through the capsule's privacy barrier. Arena captures
 * observable work, evidence and structured annotations — not hidden
 * reasoning.
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { PrivacyBarrier } from './barrier.js';
import { screenObservation } from './barrier.js';
import type { ExpertSessionId, ExpertSessionEventId, ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import {
  deepFreeze,
  isExpertSessionEventId,
  isExpertSessionId,
  isPlainJsonValue,
  newExpertSessionEventId,
  toExpertSessionEventId,
  toExpertSessionId,
  toExpertSessionTimestamp,
} from './shared.js';

/** Wire version of the session event shape. */
export const EXPERT_SESSION_EVENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed approved vocabulary (EES1.0 "Agent observation")
// ---------------------------------------------------------------------------

export const EXPERT_SESSION_EVENT_KINDS = Object.freeze([
  'environment-observation',
  'human-action',
  'tool-invocation',
  'tool-result',
  'artifact-change',
  'annotation',
  'checkpoint',
  'final-result',
  'expert-correction',
  'tool-gap-signal',
] as const);
export type ExpertSessionEventKind = (typeof EXPERT_SESSION_EVENT_KINDS)[number];

export function isExpertSessionEventKind(value: unknown): value is ExpertSessionEventKind {
  return (
    typeof value === 'string' &&
    (EXPERT_SESSION_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Payload keys that mark private reasoning. An event whose payload tree
 * contains ANY of these keys is rejected at construction — private
 * chain-of-thought is neither required nor transmissible (EES1.0;
 * architecture-lock rule 30).
 */
export const PRIVATE_REASONING_MARKERS = Object.freeze([
  'chainOfThought',
  'privateReasoning',
  'internalMonologue',
  'hiddenReasoning',
  'reasoningTrace',
] as const);

// ---------------------------------------------------------------------------
// Event record
// ---------------------------------------------------------------------------

export interface ExpertSessionEvent {
  readonly eventVersion: typeof EXPERT_SESSION_EVENT_VERSION;
  readonly eventId: ExpertSessionEventId;
  readonly sessionId: ExpertSessionId;
  /** 1-based monotonic sequence within the session's append-only stream. */
  readonly sequence: number;
  readonly kind: ExpertSessionEventKind;
  readonly payload: PlainJsonValue;
  readonly recordedAt: ExpertSessionTimestamp;
  /** Acting principal (expert ref / system) — optional. */
  readonly actor?: string;
}

export interface CreateSessionEventInput {
  readonly sessionId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly now: number | string | Date;
  readonly actor?: string;
  readonly eventId?: string;
}

function containsPrivateMarker(value: PlainJsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsPrivateMarker(entry));
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      if ((PRIVATE_REASONING_MARKERS as readonly string[]).includes(key)) return true;
      if (containsPrivateMarker((value as Record<string, PlainJsonValue>)[key] ?? null)) return true;
    }
  }
  return false;
}

/**
 * Create one approved observable session event. Fail-closed:
 *   - kind must be in the closed EES1.0 vocabulary;
 *   - payload must be plain JSON;
 *   - payload must NOT carry any private-reasoning marker
 *     (PRIVATE_REASONING — never transmissible, never required);
 *   - sequence must be a positive integer;
 *   - the recorded time is injected (never a wall-clock read).
 */
export function createExpertSessionEvent(input: CreateSessionEventInput): ExpertSessionEvent {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: 'session event input must be an object',
    });
  }
  if (!isExpertSessionId(input.sessionId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: `sessionId is invalid: ${JSON.stringify(input.sessionId)}`,
    });
  }
  if (!isExpertSessionEventKind(input.kind)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: `event kind is not in the approved EES1.0 vocabulary: ${JSON.stringify(input.kind)}`,
      details: { approved: EXPERT_SESSION_EVENT_KINDS },
    });
  }
  if (!isPlainJsonValue(input.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: 'event payload must be a plain-JSON value',
    });
  }
  if (containsPrivateMarker(input.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.PRIVATE_REASONING, {
      message: 'private chain-of-thought is never captured or transmitted (EES1.0; architecture-lock rule 30)',
      details: { markers: PRIVATE_REASONING_MARKERS },
    });
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: `event sequence must be a positive integer: ${JSON.stringify(input.sequence)}`,
    });
  }
  const eventId =
    input.eventId === undefined ? newExpertSessionEventId() : toExpertSessionEventId(input.eventId);
  const event: ExpertSessionEvent = Object.freeze({
    eventVersion: EXPERT_SESSION_EVENT_VERSION,
    eventId,
    sessionId: toExpertSessionId(input.sessionId),
    sequence: input.sequence,
    kind: input.kind,
    payload: deepFreeze(input.payload),
    recordedAt: toExpertSessionTimestamp(input.now),
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
  });
  return event;
}

/** Structural guard for wire values claiming to be approved session events. */
export function isObservableSessionEvent(value: unknown): value is ExpertSessionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['eventVersion'] === EXPERT_SESSION_EVENT_VERSION &&
    isExpertSessionEventId(candidate['eventId']) &&
    isExpertSessionId(candidate['sessionId']) &&
    Number.isInteger(candidate['sequence']) &&
    (candidate['sequence'] as number) >= 1 &&
    isExpertSessionEventKind(candidate['kind']) &&
    isPlainJsonValue(candidate['payload']) &&
    !containsPrivateMarker(candidate['payload'])
  );
}

// ---------------------------------------------------------------------------
// Observation projection (the stream the originating agent receives)
// ---------------------------------------------------------------------------

/**
 * Filter a wire-side event list down to APPROVED observable events only:
 * structurally invalid events, unknown kinds and private-reasoning
 * carriers are dropped (defense in depth — construction already
 * rejects them; this guards forged wire values).
 */
export function filterObservableEvents(events: readonly unknown[]): readonly ExpertSessionEvent[] {
  if (!Array.isArray(events)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_EVENT, {
      message: 'events must be an array',
    });
  }
  return Object.freeze(events.filter((entry) => isObservableSessionEvent(entry)));
}

/**
 * Project the observation stream for the originating agent: approved
 * events only, payloads RE-SCREENED through the capsule's privacy
 * barrier (redaction / masking applied a second time — the stream can
 * never leak pre-barrier data even if a forged event slips through).
 */
export function projectObservationStream(
  barrier: PrivacyBarrier,
  events: readonly ExpertSessionEvent[],
): readonly ExpertSessionEvent[] {
  const observable = filterObservableEvents(events as readonly unknown[]);
  return Object.freeze(
    observable.map((event) =>
      Object.freeze({
        ...event,
        payload: screenObservation(barrier, event.payload),
      }),
    ),
  );
}
