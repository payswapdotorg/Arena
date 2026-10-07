/**
 * Escalation error taxonomy (Work Order C001; spec/expert-escalation-api.md
 * ES1.0). Mirrors the sibling domain packages' typed errors
 * (@arena/job-protocol's JobError, @arena/arena-sdk's ArenaApiError):
 * closed code set, category mapping, structured wire-safe form and a
 * strictly validating parser — unknown codes are REJECTED at parse time.
 *
 * Every lifecycle outcome is machine-readable (never a bare boolean —
 * house verdict style); the codes below are the closed failure vocabulary
 * of the escalation domain core.
 */

export const ESCALATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type EscalationErrorCategory = (typeof ESCALATION_ERROR_CATEGORIES)[number];

export const ESCALATION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'ESCALATION_INVALID_REQUEST',
  INVALID_TENANT: 'ESCALATION_INVALID_TENANT',
  INVALID_MODE: 'ESCALATION_INVALID_MODE',
  INVALID_RESULT: 'ESCALATION_INVALID_RESULT',
  INVALID_EVENT: 'ESCALATION_INVALID_EVENT',
  INVALID_STATE: 'ESCALATION_INVALID_STATE',
  INVALID_TRANSITION: 'ESCALATION_INVALID_TRANSITION',
  TERMINAL_STATE: 'ESCALATION_TERMINAL_STATE',
  IDENTITY_CONFLICT: 'ESCALATION_IDENTITY_CONFLICT',
  CROSS_TENANT_ACCESS: 'ESCALATION_CROSS_TENANT_ACCESS',
  UNPERMITTED_ACTION: 'ESCALATION_UNPERMITTED_ACTION',
  DEADLINE_PASSED: 'ESCALATION_DEADLINE_PASSED',
  TAMPERED: 'ESCALATION_TAMPERED',
  SCHEMA_MISMATCH: 'ESCALATION_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'ESCALATION_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'ESCALATION_UNKNOWN_ERROR',
} as const);
export type EscalationErrorCode =
  (typeof ESCALATION_ERROR_CODES)[keyof typeof ESCALATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EscalationErrorCode, EscalationErrorCategory>> = {
  ESCALATION_INVALID_REQUEST: 'validation',
  ESCALATION_INVALID_TENANT: 'validation',
  ESCALATION_INVALID_MODE: 'validation',
  ESCALATION_INVALID_RESULT: 'validation',
  ESCALATION_INVALID_EVENT: 'validation',
  ESCALATION_INVALID_STATE: 'validation',
  ESCALATION_INVALID_TRANSITION: 'state',
  ESCALATION_TERMINAL_STATE: 'state',
  ESCALATION_IDENTITY_CONFLICT: 'idempotency',
  ESCALATION_CROSS_TENANT_ACCESS: 'scope',
  ESCALATION_UNPERMITTED_ACTION: 'scope',
  ESCALATION_DEADLINE_PASSED: 'state',
  ESCALATION_TAMPERED: 'integrity',
  ESCALATION_SCHEMA_MISMATCH: 'validation',
  ESCALATION_UNSUPPORTED_VERSION: 'versioning',
  ESCALATION_UNKNOWN_ERROR: 'unknown',
};

export function isEscalationErrorCode(value: unknown): value is EscalationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ESCALATION_ERROR_CODES).includes(value as EscalationErrorCode)
  );
}

export function categoryForEscalationCode(code: EscalationErrorCode): EscalationErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe escalation failure (fail-closed). */
export class EscalationError extends Error {
  readonly code: EscalationErrorCode;
  readonly category: EscalationErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: EscalationErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'EscalationError';
    this.code = code;
    this.category = categoryForEscalationCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: EscalationErrorCode;
    category: EscalationErrorCategory;
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

export interface WireEscalationError {
  readonly code: EscalationErrorCode;
  readonly category: EscalationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireEscalationError(value: unknown): WireEscalationError {
  if (typeof value !== 'object' || value === null) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire escalation error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isEscalationErrorCode(candidate['code'])) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown escalation error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !ESCALATION_ERROR_CATEGORIES.includes(candidate['category'] as EscalationErrorCategory)
  ) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown escalation error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire escalation error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as EscalationErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined ? { details: candidate['details'] as Readonly<Record<string, unknown>> } : {}),
    ...(candidate['correlationId'] !== undefined ? { correlationId: candidate['correlationId'] as string | null } : {}),
  };
}

/** Normalize any thrown value into an EscalationError (fail-closed). */
export function normalizeToEscalationError(error: unknown): EscalationError {
  if (error instanceof EscalationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new EscalationError(ESCALATION_ERROR_CODES.UNKNOWN_ERROR, { message });
}
