/**
 * Typed error taxonomy for the Arena adversarial expert evaluation
 * domain core (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md AE1.0). Mirrors the house
 * discipline (@arena/escalation-validation errors.ts): a closed code
 * vocabulary, machine-readable details, never a bare string throw.
 */

/** Closed error-code vocabulary for the adversarial-evaluation domain. */
export const ADVERSARIAL_EVALUATION_ERROR_CODES = Object.freeze({
  INVALID_COMPETITION: 'invalid-competition',
  INVALID_TRANSITION: 'invalid-transition',
  INVALID_JUDGMENT: 'invalid-judgment',
  GUARDRAIL_VIOLATION: 'guardrail-violation',
  INVALID_ADJUDICATION: 'invalid-adjudication',
  INVALID_SIGNAL: 'invalid-signal',
  INVALID_BYPRODUCT: 'invalid-byproduct',
  CERTIFICATION_BOUNDARY_VIOLATION: 'certification-boundary-violation',
} as const);
export type AdversarialEvaluationErrorCode =
  (typeof ADVERSARIAL_EVALUATION_ERROR_CODES)[keyof typeof ADVERSARIAL_EVALUATION_ERROR_CODES];

export function isAdversarialEvaluationErrorCode(
  value: unknown,
): value is AdversarialEvaluationErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(ADVERSARIAL_EVALUATION_ERROR_CODES) as readonly string[]).includes(value)
  );
}

/** The typed domain error (code + machine-readable details). */
export class AdversarialEvaluationError extends Error {
  readonly code: AdversarialEvaluationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AdversarialEvaluationErrorCode,
    options: { readonly message: string; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(`[${code}] ${options.message}`);
    this.name = 'AdversarialEvaluationError';
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }
}
