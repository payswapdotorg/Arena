/**
 * Stage machine tests (Work Order C008) — the closed stage vocabulary, the
 * transition table, terminal finality and the machine-readable verdicts.
 */

import { describe, expect, it } from 'vitest';
import { ToolGapError } from './errors.js';
import {
  TOOL_GAP_STAGES,
  TOOL_GAP_TERMINAL_STAGES,
  TOOL_GAP_TRANSITIONS,
  advanceToolGapSignalStage,
  checkStageTransition,
  decisionCodeForTransition,
} from './index.js';
import { createToolGapSignalRecord } from './signal.js';
import { makeCaptureInput, makeSignal } from './test-support.js';

describe('closed stage vocabulary', () => {
  it('declares the EES1.0 feed chain stages exactly', () => {
    expect([...TOOL_GAP_STAGES]).toEqual([
      'captured',
      'triaged',
      'tool-specification-proposed',
      'adapter-request',
      'body-improvement-candidate',
      'benchmark-candidate',
      'marketplace-artifact-candidate',
    ]);
  });

  it('terminal stages are the four feed destinations', () => {
    expect([...TOOL_GAP_TERMINAL_STAGES]).toEqual([
      'adapter-request',
      'body-improvement-candidate',
      'benchmark-candidate',
      'marketplace-artifact-candidate',
    ]);
  });

  it('every terminal stage maps to no outgoing edge (closed machine)', () => {
    for (const stage of TOOL_GAP_TERMINAL_STAGES) {
      expect(TOOL_GAP_TRANSITIONS[stage]).toEqual([]);
    }
  });
});

describe('checkStageTransition verdicts', () => {
  it('allows captured -> triaged only from captured', () => {
    expect(checkStageTransition('captured', 'triaged')).toEqual({
      allowed: true,
      reason: 'transition_ok',
      from: 'captured',
      to: 'triaged',
    });
    expect(checkStageTransition('captured', 'adapter-request').allowed).toBe(false);
    expect(checkStageTransition('captured', 'adapter-request').reason).toBe('transition_no_edge');
  });

  it('allows the four feed terminals from triaged and from tool-specification-proposed', () => {
    for (const feed of TOOL_GAP_TERMINAL_STAGES) {
      expect(checkStageTransition('triaged', feed).allowed).toBe(true);
      expect(checkStageTransition('tool-specification-proposed', feed).allowed).toBe(true);
    }
  });

  it('denies same-stage, terminal-final and unknown stages with typed reasons', () => {
    expect(checkStageTransition('triaged', 'triaged').reason).toBe('transition_same_stage');
    expect(checkStageTransition('adapter-request', 'benchmark-candidate').reason).toBe(
      'transition_terminal_final',
    );
    expect(checkStageTransition('captured', 'not-a-stage').reason).toBe('transition_unknown_stage');
    expect(checkStageTransition('not-a-stage', 'triaged').reason).toBe('transition_unknown_stage');
  });

  it('decision codes map to their destination stage', () => {
    expect(decisionCodeForTransition('triaged')).toBe('triage_disposition');
    expect(decisionCodeForTransition('tool-specification-proposed')).toBe(
      'tool_specification_proposed',
    );
    expect(decisionCodeForTransition('benchmark-candidate')).toBe('feed_disposition');
  });
});

describe('advanceToolGapSignalStage guards', () => {
  it('denies a skip from captured straight to a feed terminal (fail-closed)', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    expect(() =>
      advanceToolGapSignalStage({
        record,
        toStage: 'benchmark-candidate',
        decision: 'skip triage',
        now: 0,
      }),
    ).toThrow(ToolGapError);
  });

  it('denies transitions without a recorded decision (nothing auto-promotes)', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    expect(() =>
      advanceToolGapSignalStage({ record, toStage: 'triaged', decision: '', now: 0 }),
    ).toThrow(/nothing auto-promotes/);
  });

  it('terminal stages are final — a disposed record cannot move again', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    const triaged = advanceToolGapSignalStage({
      record,
      toStage: 'triaged',
      decision: 'triage',
      now: 0,
    });
    const disposed = advanceToolGapSignalStage({
      record: triaged,
      toStage: 'marketplace-artifact-candidate',
      decision: 'dispose to marketplace',
      now: 1,
    });
    expect(() =>
      advanceToolGapSignalStage({
        record: disposed,
        toStage: 'adapter-request',
        decision: 'move again',
        now: 2,
      }),
    ).toThrow(ToolGapError);
  });

  it('denial details carry the machine-readable reason', () => {
    const record = createToolGapSignalRecord(makeCaptureInput(makeSignal()));
    try {
      advanceToolGapSignalStage({
        record,
        toStage: 'adapter-request',
        decision: 'direct disposition attempt',
        now: 0,
      });
      expect.unreachable('must throw');
    } catch (error) {
      expect(error instanceof ToolGapError).toBe(true);
      const toolGapError = error as ToolGapError;
      expect(toolGapError.details['reason']).toBe('transition_no_edge');
      expect(toolGapError.correlationId).toBe(record.correlation.correlationId);
    }
  });
});
