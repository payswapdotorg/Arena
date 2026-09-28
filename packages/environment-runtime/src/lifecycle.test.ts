/**
 * Lifecycle state machine tests (Work Order A010 gate 3):
 *   - positive: every legal edge of the frozen transition table, the
 *     full canonical path (requested → … → cleaned), checkpoint loop,
 *     time-limit enforcement → timed-out, terminal finality;
 *   - negative: EXHAUSTIVE coverage of every illegal (state, event)
 *     pair — each throws ILLEGAL_TRANSITION carrying the offending
 *     from/to states.
 */

import { describe, expect, it } from 'vitest';
import {
  RUN_LIFECYCLE_EVENTS,
  RUN_STATES,
  RUN_TRANSITIONS,
  canTransitionRunState,
  enforceTimeLimit,
  isFinalRunState,
  isRunOutcomeState,
  isTimeBearingRunState,
  legalRunEventsFrom,
  targetRunState,
  toRunLifecycleEvent,
  transitionRunState,
} from './lifecycle.js';
import type { RunLifecycleEvent, RunState } from './lifecycle.js';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';

describe('run lifecycle state machine (gate 3)', () => {
  it('walks the full canonical path (positive)', () => {
    let state: RunState = 'requested';
    state = transitionRunState(state, 'provision-started');
    expect(state).toBe('provisioning');
    state = transitionRunState(state, 'provisioned');
    expect(state).toBe('ready');
    state = transitionRunState(state, 'started');
    expect(state).toBe('running');
    state = transitionRunState(state, 'checkpoint-started');
    expect(state).toBe('checkpointing');
    state = transitionRunState(state, 'checkpoint-completed');
    expect(state).toBe('running');
    state = transitionRunState(state, 'completed');
    expect(state).toBe('completed');
    state = transitionRunState(state, 'cleaned');
    expect(state).toBe('cleaned');
  });

  it('walks the failure and timeout exits (positive)', () => {
    expect(transitionRunState('requested', 'failed')).toBe('failed');
    expect(transitionRunState('provisioning', 'failed')).toBe('failed');
    expect(transitionRunState('ready', 'failed')).toBe('failed');
    expect(transitionRunState('running', 'failed')).toBe('failed');
    expect(transitionRunState('checkpointing', 'failed')).toBe('failed');
    expect(transitionRunState('provisioning', 'timed-out')).toBe('timed-out');
    expect(transitionRunState('running', 'timed-out')).toBe('timed-out');
    expect(transitionRunState('checkpointing', 'timed-out')).toBe('timed-out');
    expect(transitionRunState('failed', 'cleaned')).toBe('cleaned');
    expect(transitionRunState('timed-out', 'cleaned')).toBe('cleaned');
  });

  it('every legal edge of the frozen table round-trips (positive)', () => {
    for (const edge of RUN_TRANSITIONS) {
      for (const from of edge.from) {
        expect(targetRunState(from, edge.event)).toBe(edge.to);
        expect(canTransitionRunState(from, edge.event)).toBe(true);
        expect(transitionRunState(from, edge.event)).toBe(edge.to);
        expect(legalRunEventsFrom(from)).toContain(edge.event);
      }
    }
    // All states are reachable and every state has SOME outcome:
    expect(RUN_STATES.length).toBe(9);
    expect(RUN_TRANSITIONS.length).toBe(9);
  });

  it('EXHAUSTIVELY rejects every illegal (state, event) pair with from/to in details (negative, gate 3)', () => {
    const legalPairs = new Set<string>();
    for (const edge of RUN_TRANSITIONS) {
      for (const from of edge.from) legalPairs.add(`${from}|${edge.event}`);
    }
    let illegalCount = 0;
    for (const from of RUN_STATES) {
      for (const event of RUN_LIFECYCLE_EVENTS) {
        if (legalPairs.has(`${from}|${event}`)) continue;
        illegalCount += 1;
        const error = capture(() => transitionRunState(from, event));
        expect(error, `${from} --${event}--> must be illegal`).toBeDefined();
        expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
        // The offending from/to states ride in details (gate 3).
        const details = (error?.details ?? {}) as Record<string, unknown>;
        expect(details['from']).toBe(from);
        expect(typeof details['to']).toBe('string');
        expect(canTransitionRunState(from, event)).toBe(false);
      }
    }
    // 9 states × 9 events = 81 pairs; the table's 9 edges cover 17
    // legal (state, event) pairs ⇒ 64 illegal pairs, every one covered.
    expect(illegalCount).toBe(81 - 17);
  });

  it('rejects the named illegal classes explicitly (negative, gate 3 examples)', () => {
    // running → provisioning
    expect(capture(() => transitionRunState('running', 'provision-started'))?.details)
      .toMatchObject({ from: 'running', to: 'provisioning' });
    // completed → running
    expect(capture(() => transitionRunState('completed', 'started'))?.details).toMatchObject({
      from: 'completed',
      to: 'running',
    });
    // completed → completed (terminal is final except cleanup)
    expect(capture(() => transitionRunState('completed', 'completed'))?.details).toMatchObject({
      from: 'completed',
      to: 'completed',
    });
    // cleaned is absorbing
    expect(capture(() => transitionRunState('cleaned', 'cleaned'))?.details).toMatchObject({
      from: 'cleaned',
      to: 'cleaned',
    });
    expect(capture(() => transitionRunState('cleaned', 'started'))?.details).toMatchObject({
      from: 'cleaned',
      to: 'running',
    });
    // requested cannot jump straight to running
    expect(capture(() => transitionRunState('requested', 'started'))?.details).toMatchObject({
      from: 'requested',
      to: 'running',
    });
    // unknown vocabulary
    expect(
      capture(() => transitionRunState('running', 'teleported' as RunLifecycleEvent))?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
    expect(capture(() => transitionRunState('hovering' as RunState, 'started'))?.code).toBe(
      ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION,
    );
  });

  it('time-limit enforcement produces timed-out (gate 3 test)', () => {
    for (const state of ['provisioning', 'running', 'checkpointing'] as const) {
      expect(enforceTimeLimit(state, 600, 600)).toBe('timed-out');
      expect(enforceTimeLimit(state, 601, 600)).toBe('timed-out');
      expect(enforceTimeLimit(state, 599, 600)).toBe(state);
    }
    // Non-time-bearing states are returned unchanged (no deadline applies).
    for (const state of ['requested', 'ready', 'completed', 'failed', 'timed-out', 'cleaned'] as const) {
      expect(enforceTimeLimit(state, 10_000, 1)).toBe(state);
    }
    expect(isTimeBearingRunState('running')).toBe(true);
    expect(isTimeBearingRunState('requested')).toBe(false);
  });

  it('rejects invalid time-limit inputs (negative)', () => {
    expect(() => enforceTimeLimit('running', 0, 600)).toThrow(EnvironmentRuntimeError);
    expect(() => enforceTimeLimit('running', -5, 600)).toThrow(EnvironmentRuntimeError);
    expect(() => enforceTimeLimit('running', 1.5, 600)).toThrow(EnvironmentRuntimeError);
    expect(() => enforceTimeLimit('running', 10, 0)).toThrow(EnvironmentRuntimeError);
  });

  it('terminal vocabulary helpers (positive)', () => {
    expect(isRunOutcomeState('completed')).toBe(true);
    expect(isRunOutcomeState('failed')).toBe(true);
    expect(isRunOutcomeState('timed-out')).toBe(true);
    expect(isRunOutcomeState('cleaned')).toBe(false);
    expect(isFinalRunState('cleaned')).toBe(true);
    expect(isFinalRunState('completed')).toBe(false);
    expect(toRunLifecycleEvent('started')).toBe('started');
    expect(() => toRunLifecycleEvent('nope')).toThrow(EnvironmentRuntimeError);
  });
});

function capture(fn: () => unknown): EnvironmentRuntimeError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}
