/**
 * Task-spec protocol error taxonomy (Work Order A008).
 *
 * @arena/task-spec owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError and the sibling domain
 * packages' taxonomies (@arena/capability-case's CapabilityCaseError,
 * @arena/evaluation's EvaluationError, @arena/verification's
 * VerificationError): closed codes, category mapping, structured wire-safe
 * form, strictly validating parser — unknown codes are REJECTED at parse
 * time. The core taxonomy is frozen inside @arena/protocol-core (A001
 * surface, read-only for this package), so task-spec-domain failures carry
 * TASK_SPEC_* codes here while core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) still propagate the
 * original ProtocolError from @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const TASK_SPEC_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'access',
  'unknown',
] as const;

export type TaskSpecErrorCategory = (typeof TASK_SPEC_ERROR_CATEGORIES)[number];

export const TASK_SPEC_ERROR_CODES = {
  INVALID_IDENTITY: 'TASK_SPEC_INVALID_IDENTITY',
  INVALID_VERSION: 'TASK_SPEC_INVALID_VERSION',
  INVALID_CLASS: 'TASK_SPEC_INVALID_CLASS',
  INVALID_DIFFICULTY: 'TASK_SPEC_INVALID_DIFFICULTY',
  INVALID_QUALITY: 'TASK_SPEC_INVALID_QUALITY',
  INVALID_BINDING: 'TASK_SPEC_INVALID_BINDING',
  INVALID_REQUIREMENTS: 'TASK_SPEC_INVALID_REQUIREMENTS',
  INVALID_ENVIRONMENT: 'TASK_SPEC_INVALID_ENVIRONMENT',
  INVALID_DATA_RIGHTS: 'TASK_SPEC_INVALID_DATA_RIGHTS',
  INVALID_PROVENANCE: 'TASK_SPEC_INVALID_PROVENANCE',
  INVALID_SPEC: 'TASK_SPEC_INVALID_SPEC',
  INVALID_FIELD_MAPPING: 'TASK_SPEC_INVALID_FIELD_MAPPING',
  INVALID_CLASS_SELECTION: 'TASK_SPEC_INVALID_CLASS_SELECTION',
  INVALID_POLICY: 'TASK_SPEC_INVALID_POLICY',
  INVALID_RECORD: 'TASK_SPEC_INVALID_RECORD',
  INVALID_DIFF: 'TASK_SPEC_INVALID_DIFF',
  INVALID_REF: 'TASK_SPEC_INVALID_REF',
  INVALID_TIMESTAMP: 'TASK_SPEC_INVALID_TIMESTAMP',
  INVALID_DIGEST: 'TASK_SPEC_INVALID_DIGEST',
  INVALID_SUPERSESSION: 'TASK_SPEC_INVALID_SUPERSESSION',
  CROSS_FIELD_CONSISTENCY: 'TASK_SPEC_CROSS_FIELD_CONSISTENCY',
  TASK_NOT_FOUND: 'TASK_SPEC_TASK_NOT_FOUND',
  CASE_NOT_FOUND: 'TASK_SPEC_CASE_NOT_FOUND',
  POLICY_NOT_FOUND: 'TASK_SPEC_POLICY_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'TASK_SPEC_IDEMPOTENCY_CONFLICT',
  CROSS_TENANT_ACCESS: 'TASK_SPEC_CROSS_TENANT_ACCESS',
  TAMPERED: 'TASK_SPEC_TAMPERED',
  IDENTITY_CONFLICT: 'TASK_SPEC_IDENTITY_CONFLICT',
  VERSION_CONFLICT: 'TASK_SPEC_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'TASK_SPEC_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'TASK_SPEC_UNKNOWN_ERROR',
} as const;

export type TaskSpecErrorCode = (typeof TASK_SPEC_ERROR_CODES)[keyof typeof TASK_SPEC_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<TaskSpecErrorCode, TaskSpecErrorCategory>> = {
  TASK_SPEC_INVALID_IDENTITY: 'validation',
  TASK_SPEC_INVALID_VERSION: 'validation',
  TASK_SPEC_INVALID_CLASS: 'validation',
  TASK_SPEC_INVALID_DIFFICULTY: 'validation',
  TASK_SPEC_INVALID_QUALITY: 'validation',
  TASK_SPEC_INVALID_BINDING: 'validation',
  TASK_SPEC_INVALID_REQUIREMENTS: 'validation',
  TASK_SPEC_INVALID_ENVIRONMENT: 'validation',
  TASK_SPEC_INVALID_DATA_RIGHTS: 'validation',
  TASK_SPEC_INVALID_PROVENANCE: 'validation',
  TASK_SPEC_INVALID_SPEC: 'validation',
  TASK_SPEC_INVALID_FIELD_MAPPING: 'validation',
  TASK_SPEC_INVALID_CLASS_SELECTION: 'validation',
  TASK_SPEC_INVALID_POLICY: 'validation',
  TASK_SPEC_INVALID_RECORD: 'validation',
  TASK_SPEC_INVALID_DIFF: 'validation',
  TASK_SPEC_INVALID_REF: 'validation',
  TASK_SPEC_INVALID_TIMESTAMP: 'validation',
  TASK_SPEC_INVALID_DIGEST: 'validation',
  TASK_SPEC_INVALID_SUPERSESSION: 'validation',
  TASK_SPEC_CROSS_FIELD_CONSISTENCY: 'validation',
  TASK_SPEC_TASK_NOT_FOUND: 'integrity',
  TASK_SPEC_CASE_NOT_FOUND: 'integrity',
  TASK_SPEC_POLICY_NOT_FOUND: 'integrity',
  TASK_SPEC_IDEMPOTENCY_CONFLICT: 'integrity',
  TASK_SPEC_CROSS_TENANT_ACCESS: 'access',
  TASK_SPEC_TAMPERED: 'integrity',
  TASK_SPEC_IDENTITY_CONFLICT: 'integrity',
  TASK_SPEC_VERSION_CONFLICT: 'versioning',
  TASK_SPEC_UNSUPPORTED_RECORD_VERSION: 'versioning',
  TASK_SPEC_UNKNOWN_ERROR: 'unknown',
};

export function isTaskSpecErrorCode(value: unknown): value is TaskSpecErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(TASK_SPEC_ERROR_CODES).includes(value as TaskSpecErrorCode)
  );
}

export function categoryForTaskSpecCode(code: TaskSpecErrorCode): TaskSpecErrorCategory {
  return CODE_CATEGORY[code];
}

export interface TaskSpecErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a TaskSpecError. */
export interface TaskSpecErrorStruct {
  readonly code: TaskSpecErrorCode;
  readonly category: TaskSpecErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class TaskSpecError extends Error {
  readonly code: TaskSpecErrorCode;
  readonly category: TaskSpecErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: TaskSpecErrorCode, init: TaskSpecErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'TaskSpecError';
    this.code = code;
    this.category = categoryForTaskSpecCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isTaskSpecError(value: unknown): value is TaskSpecError {
  return value instanceof TaskSpecError;
}

export function toTaskSpecErrorStruct(error: TaskSpecError): TaskSpecErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured TaskSpecError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `TaskSpecError` with code
 * `TASK_SPEC_UNKNOWN_ERROR`.
 */
export function fromTaskSpecErrorStruct(value: unknown): TaskSpecError {
  const fail = (reason: string): never => {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured task-spec error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isTaskSpecErrorCode(code)) {
    return fail(`unknown or missing task-spec error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForTaskSpecCode(code)) {
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

  return new TaskSpecError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a TaskSpecError. */
export function normalizeToTaskSpecError(error: unknown): TaskSpecError {
  if (isTaskSpecError(error)) return error;
  if (error instanceof Error) {
    return new TaskSpecError(TASK_SPEC_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new TaskSpecError(TASK_SPEC_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
