/**
 * Environment-runtime error taxonomy (Work Order A010).
 *
 * @arena/environment-runtime owns its own closed error code set, mirroring
 * the pattern of @arena/environment-protocol's EnvironmentError and
 * @arena/job-protocol's JobError (closed codes, core category mapping,
 * structured wire-safe form, strictly validating parser — unknown codes
 * are REJECTED at parse time). Core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) propagate the original
 * ProtocolError from @arena/protocol-core; environment-runtime-domain
 * failures carry ENVIRONMENT_RUNTIME_* codes here.
 *
 * Lifecycle illegal transitions throw ILLEGAL_TRANSITION with the
 * offending from/to states in `details` (Work Order A010 gate 3).
 *
 * Categories reuse the core category vocabulary so wire consumers need
 * only one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ENVIRONMENT_RUNTIME_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type EnvironmentRuntimeErrorCategory =
  (typeof ENVIRONMENT_RUNTIME_ERROR_CATEGORIES)[number];

export const ENVIRONMENT_RUNTIME_ERROR_CODES = Object.freeze({
  INVALID_RUN_ID: 'ENVIRONMENT_RUNTIME_INVALID_RUN_ID',
  INVALID_TENANT: 'ENVIRONMENT_RUNTIME_INVALID_TENANT',
  INVALID_RECORD: 'ENVIRONMENT_RUNTIME_INVALID_RECORD',
  INVALID_ENVIRONMENT_REF: 'ENVIRONMENT_RUNTIME_INVALID_ENVIRONMENT_REF',
  INVALID_JOB_REF: 'ENVIRONMENT_RUNTIME_INVALID_JOB_REF',
  INVALID_SNAPSHOT_DIGEST: 'ENVIRONMENT_RUNTIME_INVALID_SNAPSHOT_DIGEST',
  INVALID_SEED: 'ENVIRONMENT_RUNTIME_INVALID_SEED',
  INVALID_TIMESTAMP: 'ENVIRONMENT_RUNTIME_INVALID_TIMESTAMP',
  INVALID_RESOURCE_ENVELOPE: 'ENVIRONMENT_RUNTIME_INVALID_RESOURCE_ENVELOPE',
  INVALID_NETWORK_ENVELOPE: 'ENVIRONMENT_RUNTIME_INVALID_NETWORK_ENVELOPE',
  INVALID_FILESYSTEM_ENVELOPE: 'ENVIRONMENT_RUNTIME_INVALID_FILESYSTEM_ENVELOPE',
  INVALID_SECRET_ENVELOPE: 'ENVIRONMENT_RUNTIME_INVALID_SECRET_ENVELOPE',
  INVALID_ADMISSION_VIEW: 'ENVIRONMENT_RUNTIME_INVALID_ADMISSION_VIEW',
  INVALID_EVENT: 'ENVIRONMENT_RUNTIME_INVALID_EVENT',
  EVENT_OUT_OF_ORDER: 'ENVIRONMENT_RUNTIME_EVENT_OUT_OF_ORDER',
  EVENT_SEQUENCE_GAP: 'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_GAP',
  EVENT_SEQUENCE_DUPLICATE: 'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_DUPLICATE',
  ILLEGAL_TRANSITION: 'ENVIRONMENT_RUNTIME_ILLEGAL_TRANSITION',
  TIME_LIMIT_EXCEEDED: 'ENVIRONMENT_RUNTIME_TIME_LIMIT_EXCEEDED',
  ADMISSION_REJECTED: 'ENVIRONMENT_RUNTIME_ADMISSION_REJECTED',
  TENANT_ISOLATION_VIOLATION: 'ENVIRONMENT_RUNTIME_TENANT_ISOLATION_VIOLATION',
  CHECKPOINT_REJECTED: 'ENVIRONMENT_RUNTIME_CHECKPOINT_REJECTED',
  INVALID_CHECKPOINT: 'ENVIRONMENT_RUNTIME_INVALID_CHECKPOINT',
  INVALID_RUN_RESULT: 'ENVIRONMENT_RUNTIME_INVALID_RUN_RESULT',
  RUN_RESULT_INCOMPLETE: 'ENVIRONMENT_RUNTIME_RUN_RESULT_INCOMPLETE',
  IDENTITY_CONFLICT: 'ENVIRONMENT_RUNTIME_IDENTITY_CONFLICT',
  RUNTIME_LEAKAGE: 'ENVIRONMENT_RUNTIME_RUNTIME_LEAKAGE',
  CREDENTIAL_REJECTED: 'ENVIRONMENT_RUNTIME_CREDENTIAL_REJECTED',
  TAMPERED: 'ENVIRONMENT_RUNTIME_TAMPERED',
  UNKNOWN_ERROR: 'ENVIRONMENT_RUNTIME_UNKNOWN_ERROR',
} as const);

export type EnvironmentRuntimeErrorCode =
  (typeof ENVIRONMENT_RUNTIME_ERROR_CODES)[keyof typeof ENVIRONMENT_RUNTIME_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<EnvironmentRuntimeErrorCode, EnvironmentRuntimeErrorCategory>
> = {
  ENVIRONMENT_RUNTIME_INVALID_RUN_ID: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_TENANT: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_RECORD: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_ENVIRONMENT_REF: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_JOB_REF: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_SNAPSHOT_DIGEST: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_SEED: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_TIMESTAMP: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_RESOURCE_ENVELOPE: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_NETWORK_ENVELOPE: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_FILESYSTEM_ENVELOPE: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_SECRET_ENVELOPE: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_ADMISSION_VIEW: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_EVENT: 'validation',
  ENVIRONMENT_RUNTIME_EVENT_OUT_OF_ORDER: 'integrity',
  ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_GAP: 'integrity',
  ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_DUPLICATE: 'integrity',
  ENVIRONMENT_RUNTIME_ILLEGAL_TRANSITION: 'validation',
  ENVIRONMENT_RUNTIME_TIME_LIMIT_EXCEEDED: 'validation',
  ENVIRONMENT_RUNTIME_ADMISSION_REJECTED: 'validation',
  ENVIRONMENT_RUNTIME_TENANT_ISOLATION_VIOLATION: 'validation',
  ENVIRONMENT_RUNTIME_CHECKPOINT_REJECTED: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_CHECKPOINT: 'validation',
  ENVIRONMENT_RUNTIME_INVALID_RUN_RESULT: 'validation',
  ENVIRONMENT_RUNTIME_RUN_RESULT_INCOMPLETE: 'validation',
  ENVIRONMENT_RUNTIME_IDENTITY_CONFLICT: 'integrity',
  ENVIRONMENT_RUNTIME_RUNTIME_LEAKAGE: 'validation',
  ENVIRONMENT_RUNTIME_CREDENTIAL_REJECTED: 'validation',
  ENVIRONMENT_RUNTIME_TAMPERED: 'integrity',
  ENVIRONMENT_RUNTIME_UNKNOWN_ERROR: 'unknown',
};

export function isEnvironmentRuntimeErrorCode(
  value: unknown,
): value is EnvironmentRuntimeErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ENVIRONMENT_RUNTIME_ERROR_CODES).includes(
      value as EnvironmentRuntimeErrorCode,
    )
  );
}

export function categoryForEnvironmentRuntimeCode(
  code: EnvironmentRuntimeErrorCode,
): EnvironmentRuntimeErrorCategory {
  return CODE_CATEGORY[code];
}

export interface EnvironmentRuntimeErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an EnvironmentRuntimeError. */
export interface EnvironmentRuntimeErrorStruct {
  readonly code: EnvironmentRuntimeErrorCode;
  readonly category: EnvironmentRuntimeErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class EnvironmentRuntimeError extends Error {
  readonly code: EnvironmentRuntimeErrorCode;
  readonly category: EnvironmentRuntimeErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: EnvironmentRuntimeErrorCode, init: EnvironmentRuntimeErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'EnvironmentRuntimeError';
    this.code = code;
    this.category = categoryForEnvironmentRuntimeCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isEnvironmentRuntimeError(value: unknown): value is EnvironmentRuntimeError {
  return value instanceof EnvironmentRuntimeError;
}

export function toEnvironmentRuntimeErrorStruct(
  error: EnvironmentRuntimeError,
): EnvironmentRuntimeErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured EnvironmentRuntimeError. Any malformed input —
 * non-object, missing or unknown code, category/code mismatch, missing
 * message, invalid optional fields — throws EnvironmentRuntimeError with
 * code ENVIRONMENT_RUNTIME_UNKNOWN_ERROR.
 */
export function fromEnvironmentRuntimeErrorStruct(value: unknown): EnvironmentRuntimeError {
  const fail = (reason: string): never => {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured environment-runtime error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isEnvironmentRuntimeErrorCode(code)) {
    return fail(`unknown or missing error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForEnvironmentRuntimeCode(code)) {
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

  return new EnvironmentRuntimeError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an EnvironmentRuntimeError. */
export function normalizeToEnvironmentRuntimeError(
  error: unknown,
): EnvironmentRuntimeError {
  if (isEnvironmentRuntimeError(error)) return error;
  if (error instanceof Error) {
    return new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
