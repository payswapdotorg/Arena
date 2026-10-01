/**
 * Read-model error taxonomy (Work Order B005; issue #71).
 *
 * @arena/read-model owns its own closed error code set, mirroring
 * @arena/persistence's PersistenceError pattern exactly: closed codes, a
 * category mapping over a closed vocabulary, a structured wire-safe form,
 * and a strictly validating parser — unknown codes are REJECTED at parse
 * time (fail closed).
 *
 * Two codes carry the tenant-boundary contract of this work order:
 *   - `READ_MODEL_TENANT_SCOPE_VIOLATION` (scope) — a record EXISTS but
 *     belongs to another tenant; existence is NOT hidden across tenants
 *     (the B003/B004 vocabulary: cross-tenant is distinct from not-found);
 *   - `READ_MODEL_RECORD_NOT_FOUND` — no such record under the requested
 *     identity at all.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const READ_MODEL_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'scope',
  'unknown',
] as const);

export type ReadModelErrorCategory = (typeof READ_MODEL_ERROR_CATEGORIES)[number];

export const READ_MODEL_ERROR_CODES = Object.freeze({
  KIND_MISMATCH: 'READ_MODEL_KIND_MISMATCH',
  INVALID_RECORD: 'READ_MODEL_INVALID_RECORD',
  INVALID_QUERY: 'READ_MODEL_INVALID_QUERY',
  INVALID_CONTINUATION: 'READ_MODEL_INVALID_CONTINUATION',
  INVALID_READ_AT: 'READ_MODEL_INVALID_READ_AT',
  RECORD_NOT_FOUND: 'READ_MODEL_RECORD_NOT_FOUND',
  TENANT_SCOPE_VIOLATION: 'READ_MODEL_TENANT_SCOPE_VIOLATION',
  UNKNOWN_ERROR: 'READ_MODEL_UNKNOWN_ERROR',
} as const);

export type ReadModelErrorCode = (typeof READ_MODEL_ERROR_CODES)[keyof typeof READ_MODEL_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ReadModelErrorCode, ReadModelErrorCategory>> = {
  READ_MODEL_KIND_MISMATCH: 'validation',
  READ_MODEL_INVALID_RECORD: 'validation',
  READ_MODEL_INVALID_QUERY: 'validation',
  READ_MODEL_INVALID_CONTINUATION: 'validation',
  READ_MODEL_INVALID_READ_AT: 'validation',
  READ_MODEL_RECORD_NOT_FOUND: 'validation',
  READ_MODEL_TENANT_SCOPE_VIOLATION: 'scope',
  READ_MODEL_UNKNOWN_ERROR: 'unknown',
};

export function isReadModelErrorCode(value: unknown): value is ReadModelErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(READ_MODEL_ERROR_CODES).includes(value as ReadModelErrorCode)
  );
}

export function categoryForReadModelCode(code: ReadModelErrorCode): ReadModelErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ReadModelErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a ReadModelError. */
export interface ReadModelErrorStruct {
  readonly code: ReadModelErrorCode;
  readonly category: ReadModelErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ReadModelError extends Error {
  readonly code: ReadModelErrorCode;
  readonly category: ReadModelErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ReadModelErrorCode, init: ReadModelErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ReadModelError';
    this.code = code;
    this.category = categoryForReadModelCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isReadModelError(value: unknown): value is ReadModelError {
  return value instanceof ReadModelError;
}

export function toReadModelErrorStruct(error: ReadModelError): ReadModelErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ReadModelError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws a `ReadModelError` with code
 * `READ_MODEL_UNKNOWN_ERROR` (fail closed).
 */
export function fromReadModelErrorStruct(value: unknown): ReadModelError {
  const fail = (reason: string): never => {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured read-model error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isReadModelErrorCode(code)) {
    return fail(`unknown or missing read-model error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForReadModelCode(code)) {
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

  return new ReadModelError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a ReadModelError. */
export function normalizeToReadModelError(error: unknown): ReadModelError {
  if (isReadModelError(error)) return error;
  if (error instanceof Error) {
    return new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
