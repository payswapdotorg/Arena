import { describe, expect, it } from 'vitest';

/**
 * Expert state-mark tests (Work Order B009) — the product-truth contract:
 * injective treatments (no two canonical kinds collapse into one UI kind),
 * DISTINCT pending/unknown marks, structural lifecycle states rendered
 * verbatim with honest recognition, unknown never guessed.
 */

import {
  EXPERT_KIND_TREATMENT,
  TRUTH_ASSERTING_STEP_KINDS,
  caseLifecycle,
  classifyDatum,
  isBadgeTreatment,
  isOpenTaskClass,
  isTruthAssertingStepKind,
  runState,
  taskStateClass,
  trajectoryOutcome,
  trajectoryStepKind,
  truthTreatment,
} from './state-mark.js';
import { CANONICAL_STATE_KINDS } from '../../../../packages/role-context/src/index.js';
import { CASE_STATUSES } from '../../../../packages/capability-case/src/index.js';
import { RUN_STATES } from '../../../../packages/environment-runtime/src/index.js';

describe('product-truth treatments (injective; distinct pending/unknown)', () => {
  it('maps every canonical kind onto a treatment (total, closed vocabulary)', () => {
    expect(Object.keys(EXPERT_KIND_TREATMENT).sort()).toEqual([...CANONICAL_STATE_KINDS].sort());
    for (const kind of CANONICAL_STATE_KINDS) {
      expect(truthTreatment(kind)).toBeDefined();
    }
  });

  it('is INJECTIVE: no two canonical kinds render as the same UI kind', () => {
    const treatments = CANONICAL_STATE_KINDS.map((kind) => truthTreatment(kind));
    expect(new Set(treatments).size).toBe(treatments.length);
  });

  it('keeps pending and unknown OFF the badge vocabulary (distinct expert marks)', () => {
    expect(truthTreatment('pending')).toBe('pending');
    expect(truthTreatment('unknown')).toBe('unknown');
    expect(isBadgeTreatment('pending')).toBe(false);
    expect(isBadgeTreatment('unknown')).toBe(false);
    expect(isBadgeTreatment('verified')).toBe(true);
  });

  it('classifies data through the B003 total classifier (stateKind honored; unknown never guessed)', () => {
    expect(classifyDatum({ stateKind: 'expert-judgment' }).kind).toBe('expert-judgment');
    expect(classifyDatum({ stateKind: 'evidence' }).treatment).toBe('evidence');
    expect(classifyDatum({}).kind).toBe('unknown');
    expect(classifyDatum({ stateKind: 'not-a-kind' }).kind).toBe('unknown');
    expect(classifyDatum('nonsense').kind).toBe('unknown');
  });
});

describe('case lifecycle (A005 vocabulary, verbatim carry)', () => {
  it('recognizes every A005 status', () => {
    for (const status of CASE_STATUSES) {
      const classified = caseLifecycle(status);
      expect(classified.recognized).toBe(true);
      expect(classified.value).toBe(status);
    }
  });

  it('keeps unknown lifecycle values honest (never coerced into a neighbor)', () => {
    const classified = caseLifecycle('in-flight');
    expect(classified.recognized).toBe(false);
    expect(classified.value).toBe('in-flight');
    expect(caseLifecycle(undefined).value).toBe('');
    expect(caseLifecycle(42).recognized).toBe(false);
  });
});

describe('task states (presentation classes; verbatim carry)', () => {
  it('classes every recognized task state deterministically', () => {
    expect(taskStateClass('pending')).toEqual({ state: { value: 'pending', recognized: true }, class: 'awaiting-expert' });
    expect(taskStateClass('in-review').class).toBe('awaiting-expert');
    expect(taskStateClass('in-progress').class).toBe('in-flight');
    expect(taskStateClass('blocked').class).toBe('blocked');
    expect(taskStateClass('completed').class).toBe('done');
  });

  it('classes unrecognized task states as unknown (never guessed)', () => {
    const classified = taskStateClass('awaiting-signature');
    expect(classified.class).toBe('unknown');
    expect(classified.state.recognized).toBe(false);
    expect(classified.state.value).toBe('awaiting-signature');
    expect(taskStateClass(null).class).toBe('unknown');
  });

  it('separates open work from done work (queue grouping)', () => {
    expect(isOpenTaskClass('awaiting-expert')).toBe(true);
    expect(isOpenTaskClass('in-flight')).toBe(true);
    expect(isOpenTaskClass('blocked')).toBe(true);
    expect(isOpenTaskClass('done')).toBe(false);
    expect(isOpenTaskClass('unknown')).toBe(false);
  });
});

describe('run + trajectory states (A010/A011 vocabularies, verbatim carry)', () => {
  it('recognizes every A010 run state', () => {
    for (const state of RUN_STATES) {
      expect(runState(state).recognized).toBe(true);
    }
    expect(runState('running').value).toBe('running');
  });

  it('keeps unknown run states honest', () => {
    expect(runState('paused').recognized).toBe(false);
    expect(runState(undefined).value).toBe('');
  });

  it('recognizes trajectory step kinds from both the A011 vocabulary and the reference corpus', () => {
    for (const kind of ['action', 'observation', 'checkpoint', 'error', 'completion']) {
      expect(trajectoryStepKind(kind).recognized).toBe(true);
    }
    for (const kind of ['tool', 'result', 'model-output']) {
      expect(trajectoryStepKind(kind).recognized).toBe(true);
    }
    expect(trajectoryStepKind('thought').recognized).toBe(false);
  });

  it('recognizes the A011 outcome vocabulary exactly', () => {
    for (const outcome of ['completed', 'failed', 'timed-out']) {
      expect(trajectoryOutcome(outcome).recognized).toBe(true);
    }
    expect(trajectoryOutcome('cancelled').recognized).toBe(false);
  });

  it('marks ONLY model-output steps as truth-asserting (replay umbrella otherwise)', () => {
    expect(isTruthAssertingStepKind(trajectoryStepKind('model-output'))).toBe(true);
    expect(isTruthAssertingStepKind(trajectoryStepKind('observation'))).toBe(false);
    expect(isTruthAssertingStepKind(trajectoryStepKind('action'))).toBe(false);
    expect(isTruthAssertingStepKind(trajectoryStepKind('tool'))).toBe(false);
    expect(isTruthAssertingStepKind(trajectoryStepKind('guesswork'))).toBe(false);
    expect(Object.keys(TRUTH_ASSERTING_STEP_KINDS)).toEqual(['model-output']);
  });
});
