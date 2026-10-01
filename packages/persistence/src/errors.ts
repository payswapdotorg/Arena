/**
 * Persistence error taxonomy (Work Order B002; issue #64).
 *
 * @arena/persistence owns its own closed error code set, mirroring
 * @arena/entitlements' EntitlementError pattern exactly: closed codes, a
 * category mapping over a closed vocabulary, a structured wire-safe form,
 * and a strictly validating parser — unknown codes are REJECTED at parse
 * time (fail closed).
 *
 * The capacity codes carry the FT2.0 fail-closed contract:
 * `PERSISTENCE_CAPACITY_EXHAUSTED` and `PERSISTENCE_CAPACITY_DISABLED` are
 * the ONLY representable outcomes when a hosted dimension runs out or an
 * adapter is unconfigured. There is no alternate-route code and no
 * escalation code in this taxonomy — a silent billable switch is not
 * representable in the vocabulary itself.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const PERSISTENCE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'capacity',
  'conflict',
  'integrity',
  'unavailable',
  'unknown',
] as const);

export type PersistenceErrorCategory = (typeof PERSISTENCE_ERROR_CATEGORIES)[number];

export const PERSISTENCE_ERROR_CODES = Object.freeze({
  INVALID_RECORD_ID: 'PERSISTENCE_INVALID_RECORD_ID',
  INVALID_TENANT_ID: 'PERSISTENCE_INVALID_TENANT_ID',
  INVALID_RECORD_KIND: 'PERSISTENCE_INVALID_RECORD_KIND',
  INVALID_RECORD_VERSION: 'PERSISTENCE_INVALID_RECORD_VERSION',
  INVALID_RECORD_DATA: 'PERSISTENCE_INVALID_RECORD_DATA',
  INVALID_REVISION: 'PERSISTENCE_INVALID_REVISION',
  INVALID_COORDINATION_KEY: 'PERSISTENCE_INVALID_COORDINATION_KEY',
  INVALID_COORDINATION_VALUE: 'PERSISTENCE_INVALID_COORDINATION_VALUE',
  INVALID_TTL: 'PERSISTENCE_INVALID_TTL',
  INVALID_WINDOW: 'PERSISTENCE_INVALID_WINDOW',
  INVALID_LIMIT: 'PERSISTENCE_INVALID_LIMIT',
  INVALID_HOLDER: 'PERSISTENCE_INVALID_HOLDER',
  INVALID_BLOB_CONTENT: 'PERSISTENCE_INVALID_BLOB_CONTENT',
  INVALID_BLOB_CONTENT_TYPE: 'PERSISTENCE_INVALID_BLOB_CONTENT_TYPE',
  INVALID_BLOB_METADATA: 'PERSISTENCE_INVALID_BLOB_METADATA',
  INVALID_BLOB_KEY: 'PERSISTENCE_INVALID_BLOB_KEY',
  INVALID_CAPACITY_READING: 'PERSISTENCE_INVALID_CAPACITY_READING',
  INVALID_PROVIDER_ID: 'PERSISTENCE_INVALID_PROVIDER_ID',
  INVALID_MIGRATION: 'PERSISTENCE_INVALID_MIGRATION',
  MIGRATION_FAILED: 'PERSISTENCE_MIGRATION_FAILED',
  SEED_MISMATCH: 'PERSISTENCE_SEED_MISMATCH',
  RECORD_NOT_FOUND: 'PERSISTENCE_RECORD_NOT_FOUND',
  RECORD_EXISTS: 'PERSISTENCE_RECORD_EXISTS',
  REVISION_CONFLICT: 'PERSISTENCE_REVISION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'PERSISTENCE_IDEMPOTENCY_CONFLICT',
  LEASE_NOT_HELD: 'PERSISTENCE_LEASE_NOT_HELD',
  TRANSPORT_FAILED: 'PERSISTENCE_TRANSPORT_FAILED',
  CAPACITY_EXHAUSTED: 'PERSISTENCE_CAPACITY_EXHAUSTED',
  CAPACITY_DISABLED: 'PERSISTENCE_CAPACITY_DISABLED',
  UNKNOWN_ERROR: 'PERSISTENCE_UNKNOWN_ERROR',
} as const);

export type PersistenceErrorCode =
  (typeof PERSISTENCE_ERROR_CODES)[keyof typeof PERSISTENCE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<PersistenceErrorCode, PersistenceErrorCategory>> = {
  PERSISTENCE_INVALID_RECORD_ID: 'validation',
  PERSISTENCE_INVALID_TENANT_ID: 'validation',
  PERSISTENCE_INVALID_RECORD_KIND: 'validation',
  PERSISTENCE_INVALID_RECORD_VERSION: 'validation',
  PERSISTENCE_INVALID_RECORD_DATA: 'validation',
  PERSISTENCE_INVALID_REVISION: 'validation',
  PERSISTENCE_INVALID_COORDINATION_KEY: 'validation',
  PERSISTENCE_INVALID_COORDINATION_VALUE: 'validation',
  PERSISTENCE_INVALID_TTL: 'validation',
  PERSISTENCE_INVALID_WINDOW: 'validation',
  PERSISTENCE_INVALID_LIMIT: 'validation',
  PERSISTENCE_INVALID_HOLDER: 'validation',
  PERSISTENCE_INVALID_BLOB_CONTENT: 'validation',
  PERSISTENCE_INVALID_BLOB_CONTENT_TYPE: 'validation',
  PERSISTENCE_INVALID_BLOB_METADATA: 'validation',
  PERSISTENCE_INVALID_BLOB_KEY: 'validation',
  PERSISTENCE_INVALID_CAPACITY_READING: 'validation',
  PERSISTENCE_INVALID_PROVIDER_ID: 'validation',
  PERSISTENCE_INVALID_MIGRATION: 'validation',
  PERSISTENCE_MIGRATION_FAILED: 'unavailable',
  PERSISTENCE_SEED_MISMATCH: 'integrity',
  PERSISTENCE_RECORD_NOT_FOUND: 'validation',
  PERSISTENCE_RECORD_EXISTS: 'conflict',
  PERSISTENCE_REVISION_CONFLICT: 'conflict',
  PERSISTENCE_IDEMPOTENCY_CONFLICT: 'conflict',
  PERSISTENCE_LEASE_NOT_HELD: 'conflict',
  PERSISTENCE_TRANSPORT_FAILED: 'unavailable',
  PERSISTENCE_CAPACITY_EXHAUSTED: 'capacity',
  PERSISTENCE_CAPACITY_DISABLED: 'capacity',
  PERSISTENCE_UNKNOWN_ERROR: 'unknown',
};

export function isPersistenceErrorCode(value: unknown): value is PersistenceErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(PERSISTENCE_ERROR_CODES).includes(value as PersistenceErrorCode)
  );
}

export function categoryForPersistenceCode(code: PersistenceErrorCode): PersistenceErrorCategory {
  return CODE_CATEGORY[code];
}

export interface PersistenceErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a PersistenceError. */
export interface PersistenceErrorStruct {
  readonly code: PersistenceErrorCode;
  readonly category: PersistenceErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly category: PersistenceErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: PersistenceErrorCode, init: PersistenceErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'PersistenceError';
    this.code = code;
    this.category = categoryForPersistenceCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isPersistenceError(value: unknown): value is PersistenceError {
  return value instanceof PersistenceError;
}

export function toPersistenceErrorStruct(error: PersistenceError): PersistenceErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured PersistenceError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `PersistenceError` with code
 * `PERSISTENCE_UNKNOWN_ERROR` (fail closed).
 */
export function fromPersistenceErrorStruct(value: unknown): PersistenceError {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured persistence error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isPersistenceErrorCode(code)) {
    return fail(`unknown or missing persistence error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForPersistenceCode(code)) {
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

  return new PersistenceError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a PersistenceError. */
export function normalizeToPersistenceError(error: unknown): PersistenceError {
  if (isPersistenceError(error)) return error;
  if (error instanceof Error) {
    return new PersistenceError(PERSISTENCE_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new PersistenceError(PERSISTENCE_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
