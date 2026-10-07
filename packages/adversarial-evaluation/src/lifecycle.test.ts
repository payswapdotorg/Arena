/**
 * Competition lifecycle tests (Work Order C013): the AE1.0 state chain,
 * append-only history, terminal-state escapes, typed terminal reasons,
 * strict input validation.
 */

import { describe, expect, it } from 'vitest';

import {
  canTransition,
  COMPETITION_STATES,
  createCompetition,
  isTerminalCompetitionState,
  transitionCompetition,
} from './lifecycle.js';
import { AdversarialEvaluationError } from './errors.js';
import { newCompetitionId } from './shared.js';
import { fixtureCompetition, T0, T1, T2, T3 } from './test-support.js';

const CHAIN = [
  'soliciting',
  'submitted',
  'challenge',
  'response',
  'voting',
  'adjudication',
  'verified_result',
] as const;

describe('the AE1.0 competition chain', () => {
  it('walks OPEN -> ... -> VERIFIED_RESULT legally, appending history at every step', () => {
    let record = fixtureCompetition();
    expect(record.state).toBe('open');
    let at = T1;
    for (const state of CHAIN) {
      record = transitionCompetition(record, { target: state, reason: `entered ${state}`, now: at });
      expect(record.state).toBe(state);
      at += 60_000;
    }
    expect(record.stateHistory.map((entry) => entry.state)).toEqual(['open', ...CHAIN]);
    expect(record.terminalReason).toBeNull();
    expect(isTerminalCompetitionState(record.state)).toBe(true);
  });

  it('terminal states accept NO outgoing transition (bypass impossible)', () => {
    let record = fixtureCompetition();
    for (const state of CHAIN) {
      record = transitionCompetition(record, { target: state, reason: null, now: T1 });
    }
    expect(() =>
      transitionCompetition(record, { target: 'voting', reason: 'escape attempt', now: T2 }),
    ).toThrow(AdversarialEvaluationError);
    // Abandoned is terminal too.
    const abandoned = transitionCompetition(fixtureCompetition(), {
      target: 'abandoned',
      reason: 'owner cancelled',
      terminalReason: { kind: 'abandoned', code: 'cancelled-by-owner', detail: 'owner cancelled' },
      now: T1,
    });
    expect(() =>
      transitionCompetitionEscape(abandoned),
    ).toThrow(AdversarialEvaluationError);
  });

  it('illegal edges fail closed with the legal-edge list', () => {
    const record = fixtureCompetition();
    const error = capture(() =>
      transitionCompetition(record, { target: 'voting', reason: null, now: T1 }),
    );
    expect(error?.code).toBe('invalid-transition');
    expect(error?.details['legal']).toEqual(['soliciting', 'abandoned']);
  });

  it('terminal failure states REQUIRE a typed reason matching the state kind', () => {
    const record = fixtureCompetition();
    expect(() =>
      transitionCompetition(record, { target: 'abandoned', reason: null, now: T1 }),
    ).toThrow(/REQUIRES a typed terminal reason/);
    expect(() =>
      transitionCompetition(record, {
        target: 'abandoned',
        reason: null,
        terminalReason: {
          kind: 'insufficient-participation',
          code: 'too-few-solutions',
          detail: 'only one expert submitted',
        },
        now: T1,
      }),
    ).toThrow(/does not match terminal state/);
    const abandoned = transitionCompetition(record, {
      target: 'abandoned',
      reason: 'task withdrawn',
      terminalReason: { kind: 'abandoned', code: 'task-withdrawn', detail: 'the task owner withdrew the task' },
      now: T1,
    });
    expect(abandoned.terminalReason?.kind).toBe('abandoned');
  });

  it('non-failure transitions must NOT carry a terminal reason', () => {
    const record = fixtureCompetition();
    expect(() =>
      transitionCompetition(record, {
        target: 'soliciting',
        reason: null,
        terminalReason: { kind: 'abandoned', code: 'cancelled-by-owner', detail: 'x' },
        now: T1,
      }),
    ).toThrow(/must NOT carry a terminal reason/);
  });

  it('timestamps must be monotonically non-decreasing', () => {
    const record = fixtureCompetition({ now: T3 });
    expect(() =>
      transitionCompetition(record, { target: 'soliciting', reason: null, now: T2 }),
    ).toThrow(/monotonically/);
  });

  it('insufficient-participation is reachable with its typed reasons', () => {
    let record = fixtureCompetition();
    record = transitionCompetition(record, { target: 'soliciting', reason: null, now: T1 });
    record = transitionCompetition(record, {
      target: 'insufficient_participation',
      reason: 'too few solutions',
      terminalReason: {
        kind: 'insufficient-participation',
        code: 'too-few-solutions',
        detail: 'only one qualified expert submitted a solution',
      },
      now: T2,
    });
    expect(record.state).toBe('insufficient_participation');
    expect(record.terminalReason?.code).toBe('too-few-solutions');
  });
});

describe('strict creation + vocabulary', () => {
  it('rejects tasks without required skills (qualification guardrails depend on them)', () => {
    expect(() =>
      createCompetition({
        competitionId: newCompetitionId(),
        tenantId: 'tenant-test',
        task: { taskId: 't', title: 't', statement: 's', requiredSkills: [] },
        now: T0,
      }),
    ).toThrow(/at least one required skill/);
  });

  it('rejects unknown input fields (smuggled authority shapes)', () => {
    expect(() =>
      createCompetition({
        competitionId: newCompetitionId(),
        tenantId: 'tenant-test',
        task: { taskId: 't', title: 't', statement: 's', requiredSkills: ['s'] },
        now: T0,
        ...( { certified: true } as unknown as Record<string, unknown>),
      }),
    ).toThrow(/rejects unknown field/);
  });

  it('the state vocabulary is the closed AE1.0 set', () => {
    expect(COMPETITION_STATES).toHaveLength(10);
    expect(canTransition('voting', 'adjudication')).toBe(true);
    expect(canTransition('voting', 'verified_result')).toBe(false);
    expect(canTransition('open', 'abandoned')).toBe(true);
  });
});

function transitionCompetitionEscape(record: Parameters<typeof transitionCompetition>[0]): ReturnType<typeof transitionCompetition> {
  return transitionCompetition(record, { target: 'open', reason: 'escape', now: T2 });
}

function capture(run: () => unknown): AdversarialEvaluationError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof AdversarialEvaluationError) return error;
    throw error;
  }
}
