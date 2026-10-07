/**
 * Escalation-validation error taxonomy (Work Order C009; issue #116).
 * Mirrors the sibling domain packages' typed errors (@arena/escalation's
 * EscalationError, @arena/intervention's InterventionError): closed code
 * set, category mapping, structured wire-safe form and a strictly
 * validating parser — unknown codes are REJECTED at parse time.
 *
 * Every adjudication/validation outcome is machine-readable (never a
 * bare boolean — house verdict style); the codes below are the closed
 * failure vocabulary of the escalation-validation domain core.
 */

export const ESCALATION_VALIDATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type EscalationValidationErrorCategory =
  (typeof ESCALATION_VALIDATION_ERROR_CATEGORIES)[number];

export const ESCALATION_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_CONDITION: 'ESCALATION_VALIDATION_INVALID_CONDITION',
  INVALID_PLAN: 'ESCALATION_VALIDATION_INVALID_PLAN',
  INVALID_VERDICT: 'ESCALATION_VALIDATION_INVALID_VERDICT',
  INVALID_REVISION: 'ESCALATION_VALIDATION_INVALID_REVISION',
  INVALID_REPLACEMENT: 'ESCALATION_VALIDATION_INVALID_REPLACEMENT',
  INVALID_ENTRY: 'ESCALATION_VALIDATION_INVALID_ENTRY',
  INVALID_INPUT: 'ESCALATION_VALIDATION_INVALID_INPUT',
  INVALID_STATE: 'ESCALATION_VALIDATION_INVALID_STATE',
  UNDER_SPECIFIED: 'ESCALATION_VALIDATION_UNDER_SPECIFIED',
  NO_VALIDATOR: 'ESCALATION_VALIDATION_NO_VALIDATOR',
  CONFLICT_OF_INTEREST: 'ESCALATION_VALIDATION_CONFLICT_OF_INTEREST',
  REVISION_BUDGET_EXHAUSTED: 'ESCALATION_VALIDATION_REVISION_BUDGET_EXHAUSTED',
  CROSS_TENANT_ACCESS: 'ESCALATION_VALIDATION_CROSS_TENANT_ACCESS',
  TAMPERED: 'ESCALATION_VALIDATION_TAMPERED',
  SCHEMA_MISMATCH: 'ESCALATION_VALIDATION_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'ESCALATION_VALIDATION_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'ESCALATION_VALIDATION_UNKNOWN_ERROR',
} as const);
export type EscalationValidationErrorCode =
  (typeof ESCALATION_VALIDATION_ERROR_CODES)[keyof typeof ESCALATION_VALIDATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<EscalationValidationErrorCode, EscalationValidationErrorCategory>
> = {
  ESCALATION_VALIDATION_INVALID_CONDITION: 'validation',
  ESCALATION_VALIDATION_INVALID_PLAN: 'validation',
  ESCALATION_VALIDATION_INVALID_VERDICT: 'validation',
  ESCALATION_VALIDATION_INVALID_REVISION: 'validation',
  ESCALATION_VALIDATION_INVALID_REPLACEMENT: 'validation',
  ESCALATION_VALIDATION_INVALID_ENTRY: 'validation',
  ESCALATION_VALIDATION_INVALID_INPUT: 'validation',
  ESCALATION_VALIDATION_INVALID_STATE: 'state',
  ESCALATION_VALIDATION_UNDER_SPECIFIED: 'validation',
  ESCALATION_VALIDATION_NO_VALIDATOR: 'state',
  ESCALATION_VALIDATION_CONFLICT_OF_INTEREST: 'scope',
  ESCALATION_VALIDATION_REVISION_BUDGET_EXHAUSTED: 'state',
  ESCALATION_VALIDATION_CROSS_TENANT_ACCESS: 'scope',
  ESCALATION_VALIDATION_TAMPERED: 'integrity',
  ESCALATION_VALIDATION_SCHEMA_MISMATCH: 'validation',
  ESCALATION_VALIDATION_UNSUPPORTED_VERSION: 'versioning',
  ESCALATION_VALIDATION_UNKNOWN_ERROR: 'unknown',
};

export function isEscalationValidationErrorCode(
  value: unknown,
): value is EscalationValidationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ESCALATION_VALIDATION_ERROR_CODES).includes(
      value as EscalationValidationErrorCode,
    )
  );
}

export function categoryForEscalationValidationCode(
  code: EscalationValidationErrorCode,
): EscalationValidationErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe escalation-validation failure (fail-closed). */
export class EscalationValidationError extends Error {
  readonly code: EscalationValidationErrorCode;
  readonly category: EscalationValidationErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: EscalationValidationErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'EscalationValidationError';
    this.code = code;
    this.category = categoryForEscalationValidationCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: EscalationValidationErrorCode;
    category: EscalationValidationErrorCategory;
    message: string;
    details: Readonly<Record<string, unknown>>;
    correlationId: string | null;
  } {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      correlationId: this.correlationId,
    };
  }
}

export interface WireEscalationValidationError {
  readonly code: EscalationValidationErrorCode;
  readonly category: EscalationValidationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireEscalationValidationError(
  value: unknown,
): WireEscalationValidationError {
  if (typeof value !== 'object' || value === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: 'wire escalation-validation error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isEscalationValidationErrorCode(candidate['code'])) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: `unknown escalation-validation error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !ESCALATION_VALIDATION_ERROR_CATEGORIES.includes(
      candidate['category'] as EscalationValidationErrorCategory,
    )
  ) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: `unknown escalation-validation error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: 'wire escalation-validation error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as EscalationValidationErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}

/** Normalize any thrown value into an EscalationValidationError (fail-closed). */
export function normalizeToEscalationValidationError(
  error: unknown,
): EscalationValidationError {
  if (error instanceof EscalationValidationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.UNKNOWN_ERROR, {
    message,
  });
}
