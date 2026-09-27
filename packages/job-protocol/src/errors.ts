/**
 * Job protocol error taxonomy (Work Order A015).
 *
 * @arena/job-protocol owns its own closed error code set, mirroring the
 * pattern of @arena/artifact-protocol's ArtifactError (closed codes, category
 * mapping, structured wire-safe form, strictly validating parser — unknown
 * codes are REJECTED at parse time). Core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) still propagate the original
 * ProtocolError from @arena/protocol-core; job-domain failures carry JOB_*
 * codes here.
 *
 * Categories reuse the core category vocabulary (encoding / integrity /
 * unknown / validation / versioning) so wire consumers need only one
 * category model, exactly like the A002/A003/A004 domain packages.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const JOB_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type JobErrorCategory = (typeof JOB_ERROR_CATEGORIES)[number];

export const JOB_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'JOB_INVALID_IDENTITY',
  INVALID_DIGEST: 'JOB_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'JOB_INVALID_TIMESTAMP',
  INVALID_PRINCIPAL: 'JOB_INVALID_PRINCIPAL',
  INVALID_INPUT: 'JOB_INVALID_INPUT',
  INVALID_DEFINITION: 'JOB_INVALID_DEFINITION',
  INVALID_RECORD: 'JOB_INVALID_RECORD',
  INVALID_EVENT: 'JOB_INVALID_EVENT',
  INVALID_ATTEMPT: 'JOB_INVALID_ATTEMPT',
  INVALID_POLICY: 'JOB_INVALID_POLICY',
  UNSUPPORTED_RECORD_VERSION: 'JOB_UNSUPPORTED_RECORD_VERSION',
  IDENTITY_CONFLICT: 'JOB_IDENTITY_CONFLICT',
  INVALID_TRANSITION: 'JOB_INVALID_TRANSITION',
  TERMINAL_STATE: 'JOB_TERMINAL_STATE',
  EVENT_OUT_OF_ORDER: 'JOB_EVENT_OUT_OF_ORDER',
  EVENT_SEQUENCE_GAP: 'JOB_EVENT_SEQUENCE_GAP',
  EVENT_SEQUENCE_DUPLICATE: 'JOB_EVENT_SEQUENCE_DUPLICATE',
  AUDIT_CHAIN_BROKEN: 'JOB_AUDIT_CHAIN_BROKEN',
  TAMPERED: 'JOB_TAMPERED',
  UNKNOWN_ERROR: 'JOB_UNKNOWN_ERROR',
} as const);

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<JobErrorCode, JobErrorCategory>> = {
  JOB_INVALID_IDENTITY: 'validation',
  JOB_INVALID_DIGEST: 'validation',
  JOB_INVALID_TIMESTAMP: 'validation',
  JOB_INVALID_PRINCIPAL: 'validation',
  JOB_INVALID_INPUT: 'encoding',
  JOB_INVALID_DEFINITION: 'validation',
  JOB_INVALID_RECORD: 'validation',
  JOB_INVALID_EVENT: 'validation',
  JOB_INVALID_ATTEMPT: 'validation',
  JOB_INVALID_POLICY: 'validation',
  JOB_UNSUPPORTED_RECORD_VERSION: 'versioning',
  JOB_IDENTITY_CONFLICT: 'integrity',
  JOB_INVALID_TRANSITION: 'validation',
  JOB_TERMINAL_STATE: 'validation',
  JOB_EVENT_OUT_OF_ORDER: 'integrity',
  JOB_EVENT_SEQUENCE_GAP: 'integrity',
  JOB_EVENT_SEQUENCE_DUPLICATE: 'integrity',
  JOB_AUDIT_CHAIN_BROKEN: 'integrity',
  JOB_TAMPERED: 'integrity',
  JOB_UNKNOWN_ERROR: 'unknown',
};

export function isJobErrorCode(value: unknown): value is JobErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(JOB_ERROR_CODES).includes(value as JobErrorCode)
  );
}

export function categoryForJobCode(code: JobErrorCode): JobErrorCategory {
  return CODE_CATEGORY[code];
}

export interface JobErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a JobError. */
export interface JobErrorStruct {
  readonly code: JobErrorCode;
  readonly category: JobErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class JobError extends Error {
  readonly code: JobErrorCode;
  readonly category: JobErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: JobErrorCode, init: JobErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'JobError';
    this.code = code;
    this.category = categoryForJobCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isJobError(value: unknown): value is JobError {
  return value instanceof JobError;
}

export function toJobErrorStruct(error: JobError): JobErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured JobError. Any malformed input — non-object, missing or
 * unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws `JobError` with code `JOB_UNKNOWN_ERROR`.
 */
export function fromJobErrorStruct(value: unknown): JobError {
  const fail = (reason: string): never => {
    throw new JobError(JOB_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured job error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isJobErrorCode(code)) {
    return fail(`unknown or missing job error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForJobCode(code)) {
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

  return new JobError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a JobError. */
export function normalizeToJobError(error: unknown): JobError {
  if (isJobError(error)) return error;
  if (error instanceof Error) {
    return new JobError(JOB_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new JobError(JOB_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
