/**
 * Payments error taxonomy (Work Order C010; issue #77). Mirrors the
 * sibling domain packages' typed errors (@arena/escalation's
 * EscalationError, @arena/job-protocol's JobError): closed code set,
 * category mapping, structured wire-safe form and a strictly validating
 * parser — unknown codes are REJECTED at parse time.
 *
 * Every money outcome is machine-readable (never a bare boolean — house
 * verdict style); the codes below are the closed failure vocabulary of
 * the payments domain core.
 */

export const PAYMENTS_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type PaymentsErrorCategory = (typeof PAYMENTS_ERROR_CATEGORIES)[number];

export const PAYMENTS_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'PAYMENTS_INVALID_REQUEST',
  INVALID_MONEY: 'PAYMENTS_INVALID_MONEY',
  CURRENCY_MISMATCH: 'PAYMENTS_CURRENCY_MISMATCH',
  INVALID_STATE: 'PAYMENTS_INVALID_STATE',
  INVALID_TRANSITION: 'PAYMENTS_INVALID_TRANSITION',
  TERMINAL_STATE: 'PAYMENTS_TERMINAL_STATE',
  LIFECYCLE_STATE_NOT_ALLOWED: 'PAYMENTS_LIFECYCLE_STATE_NOT_ALLOWED',
  IDENTITY_CONFLICT: 'PAYMENTS_IDENTITY_CONFLICT',
  CROSS_TENANT_ACCESS: 'PAYMENTS_CROSS_TENANT_ACCESS',
  INSUFFICIENT_FUNDS: 'PAYMENTS_INSUFFICIENT_FUNDS',
  SPLIT_MISMATCH: 'PAYMENTS_SPLIT_MISMATCH',
  TRUTH_LABEL_VIOLATION: 'PAYMENTS_TRUTH_LABEL_VIOLATION',
  TAMPERED: 'PAYMENTS_TAMPERED',
  SCHEMA_MISMATCH: 'PAYMENTS_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'PAYMENTS_UNSUPPORTED_VERSION',
  PROVIDER_FAILURE: 'PAYMENTS_PROVIDER_FAILURE',
  UNKNOWN_ERROR: 'PAYMENTS_UNKNOWN_ERROR',
} as const);
export type PaymentsErrorCode =
  (typeof PAYMENTS_ERROR_CODES)[keyof typeof PAYMENTS_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<PaymentsErrorCode, PaymentsErrorCategory>> = {
  PAYMENTS_INVALID_REQUEST: 'validation',
  PAYMENTS_INVALID_MONEY: 'validation',
  PAYMENTS_CURRENCY_MISMATCH: 'validation',
  PAYMENTS_INVALID_STATE: 'validation',
  PAYMENTS_INVALID_TRANSITION: 'state',
  PAYMENTS_TERMINAL_STATE: 'state',
  PAYMENTS_LIFECYCLE_STATE_NOT_ALLOWED: 'state',
  PAYMENTS_IDENTITY_CONFLICT: 'idempotency',
  PAYMENTS_CROSS_TENANT_ACCESS: 'scope',
  PAYMENTS_INSUFFICIENT_FUNDS: 'state',
  PAYMENTS_SPLIT_MISMATCH: 'integrity',
  PAYMENTS_TRUTH_LABEL_VIOLATION: 'integrity',
  PAYMENTS_TAMPERED: 'integrity',
  PAYMENTS_SCHEMA_MISMATCH: 'validation',
  PAYMENTS_UNSUPPORTED_VERSION: 'versioning',
  PAYMENTS_PROVIDER_FAILURE: 'state',
  PAYMENTS_UNKNOWN_ERROR: 'unknown',
};

export function isPaymentsErrorCode(value: unknown): value is PaymentsErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(PAYMENTS_ERROR_CODES).includes(value as PaymentsErrorCode)
  );
}

export function categoryForPaymentsCode(code: PaymentsErrorCode): PaymentsErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe payments failure (fail-closed). */
export class PaymentError extends Error {
  readonly code: PaymentsErrorCode;
  readonly category: PaymentsErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: PaymentsErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'PaymentError';
    this.code = code;
    this.category = categoryForPaymentsCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: PaymentsErrorCode;
    category: PaymentsErrorCategory;
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

export interface WirePaymentsError {
  readonly code: PaymentsErrorCode;
  readonly category: PaymentsErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWirePaymentsError(value: unknown): WirePaymentsError {
  if (typeof value !== 'object' || value === null) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire payments error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isPaymentsErrorCode(candidate['code'])) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown payments error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !PAYMENTS_ERROR_CATEGORIES.includes(candidate['category'] as PaymentsErrorCategory)
  ) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown payments error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire payments error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as PaymentsErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}

/** Normalize any thrown value into a PaymentError (fail-closed). */
export function normalizeToPaymentError(error: unknown): PaymentError {
  if (error instanceof PaymentError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PaymentError(PAYMENTS_ERROR_CODES.UNKNOWN_ERROR, { message });
}
