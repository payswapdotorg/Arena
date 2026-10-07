/**
 * Replay (Work Order C006; spec expert-environment-session.md EES1.0
 * "Replay"; AGENTS.md "Replay / demo": replay is OBSERVATIONAL unless a
 * separately authorized live action is issued).
 *
 * Every session is replayable when rights permit. Replay shows:
 *
 *   state → human action → observable consequence → evidence
 *
 * and CLEARLY indicates that it was a bounded expert session rather
 * than a live-world mutation: the trace carries a typed
 * `kind: 'bounded-expert-session-replay'` marker and `liveMutation:
 * false`, and any attempt to convert a replay trace into a live
 * mutation is the typed REPLAY_AS_LIVE failure (fail-closed — the
 * replica is never a live-world write path, architecture-lock rule 28).
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ExpertSessionEvent } from './events.js';
import type { ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import { deepFreeze, toExpertSessionTimestamp } from './shared.js';

/** Wire version of the replay trace shape. */
export const EXPERT_SESSION_REPLAY_VERSION = 1 as const;

/** Typed marker: a replay is observational, never a live-world mutation. */
export const REPLAY_KIND = 'bounded-expert-session-replay' as const;

/** One replay step: state → human action → observable consequence → evidence. */
export interface ReplayFrame {
  readonly step: number;
  /** Environment state observed before the action (screened). */
  readonly state: PlainJsonValue | null;
  /** The human/tool action taken. */
  readonly action: PlainJsonValue | null;
  /** The observable consequence of the action. */
  readonly consequence: PlainJsonValue | null;
  /** Evidence attached to the step (annotation/checkpoint/event refs). */
  readonly evidence: readonly PlainJsonValue[];
}

export interface ReplayTrace {
  readonly replayVersion: typeof EXPERT_SESSION_REPLAY_VERSION;
  /** Observational marker — a bounded expert session replay. */
  readonly kind: typeof REPLAY_KIND;
  /** The replayed session. */
  readonly sessionId: string;
  /** Content digest of the replayed capsule (provenance). */
  readonly capsuleDigest: string;
  readonly frames: readonly ReplayFrame[];
  readonly replayedAt: ExpertSessionTimestamp;
  /** ALWAYS false — a replay is never a live-world mutation. */
  readonly liveMutation: false;
}

const STATE_KINDS = Object.freeze(['environment-observation'] as const);
const ACTION_KINDS = Object.freeze(['human-action', 'tool-invocation'] as const);
const CONSEQUENCE_KINDS = Object.freeze(['tool-result', 'artifact-change', 'expert-correction'] as const);
export const EVIDENCE_KINDS = Object.freeze(['annotation', 'checkpoint', 'final-result', 'tool-gap-signal'] as const);

/**
 * Build the replay trace from a session's observable event stream. The
 * grouping is deterministic: one frame per human/tool ACTION — the
 * preceding state observation, the first following consequence and all
 * interleaved evidence (annotations, checkpoints, further
 * consequences, tool-gap signals) attach to that frame.
 */
export function buildReplayTrace(
  sessionId: string,
  capsuleDigest: string,
  events: readonly ExpertSessionEvent[],
  now: number | string | Date,
): ReplayTrace {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'replay requires the session id',
    });
  }
  if (typeof capsuleDigest !== 'string' || !/^[0-9a-f]{64}$/.test(capsuleDigest)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'replay requires the capsule digest',
    });
  }
  const frames: ReplayFrame[] = [];
  let state: PlainJsonValue | null = null;
  let action: PlainJsonValue | null = null;
  let consequence: PlainJsonValue | null = null;
  const evidence: PlainJsonValue[] = [];

  const pushFrame = () => {
    if (action === null && consequence === null && evidence.length === 0) return;
    frames.push(
      Object.freeze({
        step: frames.length + 1,
        state,
        action,
        consequence,
        evidence: Object.freeze([...evidence]),
      }),
    );
    state = null;
    action = null;
    consequence = null;
    evidence.length = 0;
  };

  for (const event of events) {
    if ((STATE_KINDS as readonly string[]).includes(event.kind)) {
      if (action !== null) pushFrame();
      state = event.payload;
    } else if ((ACTION_KINDS as readonly string[]).includes(event.kind)) {
      if (action !== null) pushFrame();
      action = event.payload;
    } else if ((CONSEQUENCE_KINDS as readonly string[]).includes(event.kind)) {
      if (consequence === null) {
        consequence = event.payload;
      } else {
        // Additional consequences behave as evidence of the same step.
        evidence.push(event.payload);
      }
    } else {
      evidence.push(event.payload);
      if (event.kind === 'final-result') pushFrame();
    }
  }
  pushFrame();

  const trace: ReplayTrace = Object.freeze({
    replayVersion: EXPERT_SESSION_REPLAY_VERSION,
    kind: REPLAY_KIND,
    sessionId,
    capsuleDigest,
    frames: Object.freeze(frames),
    replayedAt: toExpertSessionTimestamp(now),
    liveMutation: false,
  });
  deepFreeze(trace as unknown as PlainJsonValue);
  return trace;
}

/**
 * THE REPLAY LAW, enforced: attempting to treat a replay trace as a
 * live mutation fails closed with REPLAY_AS_LIVE. A replay is
 * observational; a live action requires separate explicit authorization
 * through the host application's own authority (architecture-lock
 * rules 26, 28).
 */
export function asLiveMutation(trace: ReplayTrace): never {
  throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.REPLAY_AS_LIVE, {
    message: 'a replay trace is observational and can never be applied as a live-world mutation',
    details: { sessionId: trace.sessionId, kind: trace.kind },
  });
}

/** Structural guard: wire values claiming to be replay traces. */
export function isReplayTrace(value: unknown): value is ReplayTrace {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['replayVersion'] === EXPERT_SESSION_REPLAY_VERSION &&
    candidate['kind'] === REPLAY_KIND &&
    typeof candidate['sessionId'] === 'string' &&
    typeof candidate['capsuleDigest'] === 'string' &&
    Array.isArray(candidate['frames']) &&
    candidate['liveMutation'] === false
  );
}
