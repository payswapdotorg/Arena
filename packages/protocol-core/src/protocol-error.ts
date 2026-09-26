/**
 * Arena protocol error taxonomy (architecture-lock rules 17, 18, 22).
 *
 * A closed set of error codes with a category mapping, a structured
 * (JSON-serializable) representation, and a strictly validating parser.
 * Unknown codes are REJECTED at parse time — protocol errors never degrade
 * into untyped strings.
 */

import type { CorrelationId } from './identifiers.js';
import { isCorrelationId } from './identifiers.js';

export const PROTOCOL_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const;

export type ProtocolErrorCategory = (typeof PROTOCOL_ERROR_CATEGORIES)[number];

export const PROTOCOL_ERROR_CODES = {
  INVALID_JSON: 'PROTOCOL_INVALID_JSON',
  CANONICALIZATION_FAILED: 'PROTOCOL_CANONICALIZATION_FAILED',
  UNSUPPORTED_VERSION: 'PROTOCOL_UNSUPPORTED_VERSION',
  UNKNOWN_SCHEMA: 'PROTOCOL_UNKNOWN_SCHEMA',
  SCHEMA_MISMATCH: 'PROTOCOL_SCHEMA_MISMATCH',
  INVALID_SCHEMA_REF: 'PROTOCOL_INVALID_SCHEMA_REF',
  INVALID_CORRELATION_ID: 'PROTOCOL_INVALID_CORRELATION_ID',
  INVALID_IDEMPOTENCY_KEY: 'PROTOCOL_INVALID_IDEMPOTENCY_KEY',
  INVALID_ENVELOPE: 'PROTOCOL_INVALID_ENVELOPE',
  ENVELOPE_TAMPERED: 'PROTOCOL_ENVELOPE_TAMPERED',
  UNKNOWN_ERROR_CODE: 'PROTOCOL_UNKNOWN_ERROR_CODE',
  UNCLASSIFIED_ERROR: 'PROTOCOL_UNCLASSIFIED_ERROR',
} as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[keyof typeof PROTOCOL_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ProtocolErrorCode, ProtocolErrorCategory>> = {
  PROTOCOL_INVALID_JSON: 'encoding',
  PROTOCOL_CANONICALIZATION_FAILED: 'encoding',
  PROTOCOL_UNSUPPORTED_VERSION: 'versioning',
  PROTOCOL_UNKNOWN_SCHEMA: 'versioning',
  PROTOCOL_SCHEMA_MISMATCH: 'versioning',
  PROTOCOL_INVALID_SCHEMA_REF: 'validation',
  PROTOCOL_INVALID_CORRELATION_ID: 'validation',
  PROTOCOL_INVALID_IDEMPOTENCY_KEY: 'validation',
  PROTOCOL_INVALID_ENVELOPE: 'validation',
  PROTOCOL_ENVELOPE_TAMPERED: 'integrity',
  PROTOCOL_UNKNOWN_ERROR_CODE: 'unknown',
  PROTOCOL_UNCLASSIFIED_ERROR: 'unknown',
};

export function isProtocolErrorCode(value: unknown): value is ProtocolErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(PROTOCOL_ERROR_CODES).includes(value as ProtocolErrorCode)
  );
}

export function categoryForCode(code: ProtocolErrorCode): ProtocolErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ProtocolErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a ProtocolError. */
export interface ProtocolErrorStruct {
  readonly code: ProtocolErrorCode;
  readonly category: ProtocolErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly category: ProtocolErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ProtocolErrorCode, init: ProtocolErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ProtocolError';
    this.code = code;
    this.category = categoryForCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isProtocolError(value: unknown): value is ProtocolError {
  return value instanceof ProtocolError;
}

export function toStructured(error: ProtocolError): ProtocolErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ProtocolError. Any malformed input — non-object, missing
 * or unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws `ProtocolError` with code `PROTOCOL_UNKNOWN_ERROR_CODE`.
 */
export function fromStructured(value: unknown): ProtocolError {
  const fail = (reason: string): never => {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.UNKNOWN_ERROR_CODE, {
      message: `malformed structured protocol error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isProtocolErrorCode(code)) {
    return fail(`unknown or missing error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForCode(code)) {
    return fail(`category ${String(category)} does not match code ${String(code)}`);
  }
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0) {
    return fail('message must be a non-empty string');
  }

  const details = record['details'];
  if (details !== undefined && (typeof details !== 'object' || details === null || Array.isArray(details))) {
    return fail('details must be a plain object when present');
  }

  const correlationId = record['correlationId'];
  if (correlationId !== undefined && !isCorrelationId(correlationId)) {
    return fail('correlationId must be a valid correlation id when present');
  }

  return new ProtocolError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a ProtocolError. */
export function normalizeUnknownError(error: unknown): ProtocolError {
  if (isProtocolError(error)) return error;
  if (error instanceof Error) {
    return new ProtocolError(PROTOCOL_ERROR_CODES.UNCLASSIFIED_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ProtocolError(PROTOCOL_ERROR_CODES.UNCLASSIFIED_ERROR, {
    message: String(error),
    cause: error,
  });
}
