/**
 * EvaluatorKind closed-enum tests (Work Order A012 gate 2 — the negative
 * gate: an unknown evaluator kind is rejected).
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATOR_KINDS,
  isEvaluatorKind,
  toEvaluatorKind,
} from './evaluator-kind.js';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';

describe('EVALUATOR_KINDS closed enum (EV1.0)', () => {
  it('contains EXACTLY the seven EV1.0 evaluator types (positive)', () => {
    expect([...EVALUATOR_KINDS]).toEqual([
      'deterministic-test',
      'model-based',
      'expert',
      'rubric',
      'simulation',
      'comparative',
      'adversarial',
    ]);
    expect(EVALUATOR_KINDS).toHaveLength(7);
  });

  it('is frozen (immutability)', () => {
    expect(Object.isFrozen(EVALUATOR_KINDS)).toBe(true);
  });

  it('isEvaluatorKind accepts all members (positive)', () => {
    for (const kind of EVALUATOR_KINDS) {
      expect(isEvaluatorKind(kind)).toBe(true);
    }
  });

  it('isEvaluatorKind rejects unknown kinds, non-strings and junk (negative)', () => {
    for (const bad of [
      'heuristic',
      'deterministic',
      'Deterministic-Test',
      'llm-judge',
      '',
      42,
      null,
      undefined,
      { kind: 'rubric' },
      ['rubric'],
    ]) {
      expect(isEvaluatorKind(bad)).toBe(false);
    }
  });

  it('toEvaluatorKind passes members through (positive)', () => {
    expect(toEvaluatorKind('deterministic-test', 'evaluator descriptor')).toBe('deterministic-test');
    expect(toEvaluatorKind('adversarial', 'evaluator descriptor')).toBe('adversarial');
  });

  it('toEvaluatorKind throws a typed EVALUATION_INVALID_KIND on unknown kinds (negative — gate 2)', () => {
    expect(() => toEvaluatorKind('heuristic', 'evaluator descriptor')).toThrowError(EvaluationError);
    expect(() => toEvaluatorKind('heuristic', 'evaluator descriptor')).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_KIND }),
    );
    expect(() => toEvaluatorKind('heuristic', 'evaluator descriptor')).toThrowError(
      /must be one of/,
    );
    expect(() => toEvaluatorKind('', 'evaluator descriptor')).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_KIND }),
    );
  });
});
