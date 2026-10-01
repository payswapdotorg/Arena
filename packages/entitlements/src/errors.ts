/**
 * Entitlement error taxonomy (Work Order A033; requirements R31, R34, R48).
 *
 * @arena/entitlements owns its own closed error code set, mirroring
 * @arena/job-protocol's JobError pattern exactly: closed codes, category
 * mapping over the core category vocabulary, a structured wire-safe form,
 * and a strictly validating parser — unknown codes are REJECTED at parse
 * time (fail closed). Core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) still propagate the original ProtocolError
 * from @arena/protocol-core; entitlement-domain failures carry
 * ENTITLEMENT_* codes here.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ENTITLEMENT_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type EntitlementErrorCategory = (typeof ENTITLEMENT_ERROR_CATEGORIES)[number];

export const ENTITLEMENT_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'ENTITLEMENT_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'ENTITLEMENT_INVALID_TIMESTAMP',
  INVALID_GRANT: 'ENTITLEMENT_INVALID_GRANT',
  INVALID_LINEAGE: 'ENTITLEMENT_INVALID_LINEAGE',
  INVALID_EVENT: 'ENTITLEMENT_INVALID_EVENT',
  INVALID_METER_EVENT: 'ENTITLEMENT_INVALID_METER_EVENT',
  INVALID_COMMAND: 'ENTITLEMENT_INVALID_COMMAND',
  UNSUPPORTED_RECORD_VERSION: 'ENTITLEMENT_UNSUPPORTED_RECORD_VERSION',
  GRANT_INACTIVE: 'ENTITLEMENT_GRANT_INACTIVE',
  GRANT_REVOKED: 'ENTITLEMENT_GRANT_REVOKED',
  TENANT_MISMATCH: 'ENTITLEMENT_TENANT_MISMATCH',
  FEATURE_DISABLED: 'ENTITLEMENT_FEATURE_DISABLED',
  METER_SEQUENCE_GAP: 'ENTITLEMENT_METER_SEQUENCE_GAP',
  METER_SEQUENCE_DUPLICATE: 'ENTITLEMENT_METER_SEQUENCE_DUPLICATE',
  METER_NEGATIVE_TOTAL: 'ENTITLEMENT_METER_NEGATIVE_TOTAL',
  TAMPERED: 'ENTITLEMENT_TAMPERED',
  UNKNOWN_ERROR: 'ENTITLEMENT_UNKNOWN_ERROR',
} as const);

export type EntitlementErrorCode =
  (typeof ENTITLEMENT_ERROR_CODES)[keyof typeof ENTITLEMENT_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EntitlementErrorCode, EntitlementErrorCategory>> = {
  ENTITLEMENT_INVALID_IDENTITY: 'validation',
  ENTITLEMENT_INVALID_TIMESTAMP: 'validation',
  ENTITLEMENT_INVALID_GRANT: 'validation',
  ENTITLEMENT_INVALID_LINEAGE: 'validation',
  ENTITLEMENT_INVALID_EVENT: 'validation',
  ENTITLEMENT_INVALID_METER_EVENT: 'validation',
  ENTITLEMENT_INVALID_COMMAND: 'validation',
  ENTITLEMENT_UNSUPPORTED_RECORD_VERSION: 'versioning',
  ENTITLEMENT_GRANT_INACTIVE: 'validation',
  ENTITLEMENT_GRANT_REVOKED: 'validation',
  ENTITLEMENT_TENANT_MISMATCH: 'integrity',
  ENTITLEMENT_FEATURE_DISABLED: 'validation',
  ENTITLEMENT_METER_SEQUENCE_GAP: 'integrity',
  ENTITLEMENT_METER_SEQUENCE_DUPLICATE: 'integrity',
  ENTITLEMENT_METER_NEGATIVE_TOTAL: 'integrity',
  ENTITLEMENT_TAMPERED: 'integrity',
  ENTITLEMENT_UNKNOWN_ERROR: 'unknown',
};

export function isEntitlementErrorCode(value: unknown): value is EntitlementErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ENTITLEMENT_ERROR_CODES).includes(value as EntitlementErrorCode)
  );
}

export function categoryForEntitlementCode(code: EntitlementErrorCode): EntitlementErrorCategory {
  return CODE_CATEGORY[code];
}

export interface EntitlementErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an EntitlementError. */
export interface EntitlementErrorStruct {
  readonly code: EntitlementErrorCode;
  readonly category: EntitlementErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly category: EntitlementErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: EntitlementErrorCode, init: EntitlementErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'EntitlementError';
    this.code = code;
    this.category = categoryForEntitlementCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isEntitlementError(value: unknown): value is EntitlementError {
  return value instanceof EntitlementError;
}

export function toEntitlementErrorStruct(error: EntitlementError): EntitlementErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured EntitlementError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `EntitlementError` with code
 * `ENTITLEMENT_UNKNOWN_ERROR` (fail closed).
 */
export function fromEntitlementErrorStruct(value: unknown): EntitlementError {
  const fail = (reason: string): never => {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured entitlement error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isEntitlementErrorCode(code)) {
    return fail(`unknown or missing entitlement error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForEntitlementCode(code)) {
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

  return new EntitlementError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an EntitlementError. */
export function normalizeToEntitlementError(error: unknown): EntitlementError {
  if (isEntitlementError(error)) return error;
  if (error instanceof Error) {
    return new EntitlementError(ENTITLEMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new EntitlementError(ENTITLEMENT_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
