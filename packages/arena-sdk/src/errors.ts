/**
 * Arena public/private API error taxonomy (Work Order A025).
 *
 * @arena/arena-sdk owns its own closed error code set, mirroring the
 * pattern of the sibling domain packages' typed errors
 * (@arena/certification's CertificationError, @arena/body-registry's
 * BodyRegistryError — closed codes, category mapping, structured
 * wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). The core taxonomy stays frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * API-surface failures carry ARENA_API_* codes here while core-level
 * failures (canonicalization, envelope shape, correlation ids, schema
 * refs) still propagate the original ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ARENA_API_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'versioning',
  'integrity',
  'scope',
  'unknown',
] as const);

export type ArenaApiErrorCategory = (typeof ARENA_API_ERROR_CATEGORIES)[number];

export const ARENA_API_ERROR_CODES = Object.freeze({
  INVALID_QUERY: 'ARENA_API_INVALID_QUERY',
  INVALID_QUERY_KIND: 'ARENA_API_INVALID_QUERY_KIND',
  INVALID_PARAMS: 'ARENA_API_INVALID_PARAMS',
  INVALID_SCOPE: 'ARENA_API_INVALID_SCOPE',
  INVALID_TENANT: 'ARENA_API_INVALID_TENANT',
  INVALID_CHANNEL: 'ARENA_API_INVALID_CHANNEL',
  INVALID_DIGEST: 'ARENA_API_INVALID_DIGEST',
  INVALID_RECORD: 'ARENA_API_INVALID_RECORD',
  INVALID_RESPONSE: 'ARENA_API_INVALID_RESPONSE',
  INVALID_SCHEMA_REF: 'ARENA_API_INVALID_SCHEMA_REF',
  SCHEMA_MISMATCH: 'ARENA_API_SCHEMA_MISMATCH',
  SCOPE_REQUIRED: 'ARENA_API_SCOPE_REQUIRED',
  CROSS_TENANT_ACCESS: 'ARENA_API_CROSS_TENANT_ACCESS',
  CORRELATION_MISMATCH: 'ARENA_API_CORRELATION_MISMATCH',
  TAMPERED: 'ARENA_API_TAMPERED',
  UNSUPPORTED_VERSION: 'ARENA_API_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'ARENA_API_UNKNOWN_ERROR',
} as const);

export type ArenaApiErrorCode = (typeof ARENA_API_ERROR_CODES)[keyof typeof ARENA_API_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ArenaApiErrorCode, ArenaApiErrorCategory>> = {
  ARENA_API_INVALID_QUERY: 'validation',
  ARENA_API_INVALID_QUERY_KIND: 'validation',
  ARENA_API_INVALID_PARAMS: 'validation',
  ARENA_API_INVALID_SCOPE: 'validation',
  ARENA_API_INVALID_TENANT: 'validation',
  ARENA_API_INVALID_CHANNEL: 'validation',
  ARENA_API_INVALID_DIGEST: 'validation',
  ARENA_API_INVALID_RECORD: 'validation',
  ARENA_API_INVALID_RESPONSE: 'validation',
  ARENA_API_INVALID_SCHEMA_REF: 'validation',
  ARENA_API_SCHEMA_MISMATCH: 'validation',
  ARENA_API_SCOPE_REQUIRED: 'scope',
  ARENA_API_CROSS_TENANT_ACCESS: 'scope',
  ARENA_API_CORRELATION_MISMATCH: 'integrity',
  ARENA_API_TAMPERED: 'integrity',
  ARENA_API_UNSUPPORTED_VERSION: 'versioning',
  ARENA_API_UNKNOWN_ERROR: 'unknown',
};

export function isArenaApiErrorCode(value: unknown): value is ArenaApiErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ARENA_API_ERROR_CODES).includes(value as ArenaApiErrorCode)
  );
}

export function categoryForArenaApiCode(code: ArenaApiErrorCode): ArenaApiErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ArenaApiErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ArenaApiError. */
export interface ArenaApiErrorStruct {
  readonly code: ArenaApiErrorCode;
  readonly category: ArenaApiErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ArenaApiError extends Error {
  readonly code: ArenaApiErrorCode;
  readonly category: ArenaApiErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ArenaApiErrorCode, init: ArenaApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ArenaApiError';
    this.code = code;
    this.category = categoryForArenaApiCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isArenaApiError(value: unknown): value is ArenaApiError {
  return value instanceof ArenaApiError;
}

export function toArenaApiErrorStruct(error: ArenaApiError): ArenaApiErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ArenaApiError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `ArenaApiError` with code
 * `ARENA_API_UNKNOWN_ERROR`.
 */
export function fromArenaApiErrorStruct(value: unknown): ArenaApiError {
  const fail = (reason: string): never => {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured arena api error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isArenaApiErrorCode(code)) {
    return fail(`unknown or missing arena api error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForArenaApiCode(code)) {
    return fail(`category ${String(category)} does not match code ${String(code)}`);
  }
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0) {
    return fail('message must be a non-empty string');
  }

  const details = record['details'];
  if (
    details !== undefined &&
    (typeof details !== 'object' || details === null || Array.isArray(details))
  ) {
    return fail('details must be a plain object when present');
  }

  const correlationId = record['correlationId'];
  if (correlationId !== undefined && !isCorrelationId(correlationId)) {
    return fail('correlationId must be a valid correlation id when present');
  }

  return new ArenaApiError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an ArenaApiError. */
export function normalizeToArenaApiError(error: unknown): ArenaApiError {
  if (isArenaApiError(error)) return error;
  if (error instanceof Error) {
    return new ArenaApiError(ARENA_API_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ArenaApiError(ARENA_API_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
