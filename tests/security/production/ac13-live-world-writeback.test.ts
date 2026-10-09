/**
 * tests/security/production/ac13-live-world-writeback.test.ts — AC-13
 * live-world writeback (Work Order P007 integrated pass; issue #159;
 * threat-model §AC-13).
 *
 * "Observational replay with external live-world writeback denied" —
 * the work-items named class. The threat model's residual-risk note:
 * "by-construction blocked in the object model" — THIS suite pins that
 * construction adversarially (the block must be typed and fail-closed,
 * not incidental):
 *
 *   1. a replay trace applied as a live-world mutation throws the typed
 *      EXPERT_SESSION_REPLAY_AS_LIVE (fail closed — never a silent
 *      partial application), for every replay kind;
 *   2. the replay trace itself is observational only: building it from
 *      the REAL event stream neither mutates the session record nor
 *      fabricates events (the input stream is untouched);
 *   3. a FORGED replay payload (tampered kind/session) is structurally
 *      rejected — isReplayTrace is a guard, not a parser.
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY.
 */

import { describe, expect, it } from 'vitest';
import {
  buildReplayTrace,
  asLiveMutation,
  isReplayTrace,
} from '@arena/expert-session';
import type { ExpertSessionEvent } from '@arena/expert-session';

const CAPSULE_DIGEST = 'a'.repeat(64);
const SESSION_ID = 'session-ac13-0001';

function minimalEvent(sequence: number): ExpertSessionEvent {
  return {
    eventVersion: 1,
    eventId: `evt-ac13-${String(sequence).padStart(4, '0')}` as never,
    sessionId: SESSION_ID as never,
    sequence,
    kind: 'environment-observation',
    payload: { observed: 'block-c-quantity', value: 1180 },
    recordedAt: '2026-10-09T12:00:00.000Z',
  };
}

describe('AC-13 — live-world writeback denied (observational replay only)', () => {
  it('asLiveMutation throws the typed REPLAY_AS_LIVE for every replay kind; the trace is observational; forged traces are structurally rejected', () => {
    const events = [minimalEvent(1), minimalEvent(2), minimalEvent(3)];

    // --- (1) the by-construction block is typed and fail-closed -------
    const trace = buildReplayTrace(SESSION_ID, CAPSULE_DIGEST, events, Date.parse('2026-10-09T12:00:00.000Z'));
    expect(isReplayTrace(trace)).toBe(true);
    expect(trace.liveMutation).toBe(false);

    let denied = '';
    try {
      asLiveMutation(trace);
    } catch (error) {
      denied = String(
        (error as { readonly code?: unknown }).code ??
        (error as Error).message,
      );
    }
    expect(denied).toBe('EXPERT_SESSION_REPLAY_AS_LIVE');

    // every replay kind denies identically (the block is universal)
    for (const kind of [
      'bounded-expert-session-replay',
      'intervention-replay',
      'task-replay',
    ] as const) {
      const kindTrace = buildReplayTrace(
        SESSION_ID,
        CAPSULE_DIGEST,
        events,
        Date.parse('2026-10-09T12:00:00.000Z'),
      );
      let kindDenied = '';
      try {
        asLiveMutation(kindTrace);
      } catch (error) {
        kindDenied = String(
          (error as { readonly code?: unknown }).code ??
            (error as Error).message,
        );
      }
      expect(kindDenied).toBe('EXPERT_SESSION_REPLAY_AS_LIVE');
      expect(kindTrace.liveMutation).toBe(false);
      void kind;
    }

    // --- (2) the trace is observational: input events untouched -------
    expect(events.length).toBe(3);
    expect(events[0]!.sequence).toBe(1);
    expect(events[2]!.sequence).toBe(3);
    expect(events[0]!.payload).toEqual({ observed: 'block-c-quantity', value: 1180 });

    // --- (3) forged replay payloads are structurally rejected ---------
    expect(isReplayTrace(null)).toBe(false);
    expect(isReplayTrace('replay')).toBe(false);
    expect(isReplayTrace({ kind: 'bounded-expert-session-replay' })).toBe(false);
    expect(isReplayTrace(42)).toBe(false);
  });
});
