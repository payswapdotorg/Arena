/**
 * EvaluatorKind — the CLOSED evaluator-type vocabulary of EV1.0
 * (Work Order A012 gate 2; spec/evaluation.md "Evaluation"):
 *
 *   deterministic test | model-based evaluator | expert evaluator |
 *   rubric evaluator | simulation evaluator | comparative evaluator |
 *   adversarial evaluator
 *
 * The vocabulary is a closed enum: an EvaluatorDescriptor carrying a kind
 * outside this set is REJECTED at construction (negative test), and the
 * generated contract (contracts/evaluation/evaluator-descriptor.v1.json)
 * mirrors the enum so wire-side drift fails parity.
 *
 * Only `deterministic-test` and `rubric` have reference implementations
 * in the A012 reference fabric (services/evaluation); the other five
 * kinds are DECLARED descriptor types with pluggable hook interfaces and
 * no implementations (Work Order A012 scope NOTE).
 */

import { EVALUATION_ERROR_CODES } from './errors.js';
import { expectEnumMember } from './shared.js';

export const EVALUATOR_KINDS = Object.freeze([
  'deterministic-test',
  'model-based',
  'expert',
  'rubric',
  'simulation',
  'comparative',
  'adversarial',
] as const);

export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];

/** Structural (non-throwing) check for the closed evaluator-kind enum. */
export function isEvaluatorKind(value: unknown): value is EvaluatorKind {
  return (
    typeof value === 'string' &&
    (EVALUATOR_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Validate an evaluator kind. Unknown kinds are rejected with
 * EVALUATION_INVALID_KIND — the closed-enum negative gate.
 */
export function toEvaluatorKind(value: string, context: string): EvaluatorKind {
  return expectEnumMember(
    value,
    EVALUATOR_KINDS,
    'kind',
    EVALUATION_ERROR_CODES.INVALID_KIND,
    context,
  );
}
