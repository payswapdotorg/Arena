/**
 * Evaluation protocol error taxonomy (Work Order A012).
 *
 * @arena/evaluation owns its own closed error code set, mirroring the
 * pattern of @arena/artifact-protocol's ArtifactError,
 * @arena/trajectory's TrajectoryError and @arena/capability-case's
 * CapabilityCaseError (closed codes, core category mapping, structured
 * wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * evaluation-domain failures carry EVALUATION_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation
 * ids, schema refs) still propagate the original ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const EVALUATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type EvaluationErrorCategory = (typeof EVALUATION_ERROR_CATEGORIES)[number];

export const EVALUATION_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'EVALUATION_INVALID_IDENTITY',
  INVALID_DIGEST: 'EVALUATION_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'EVALUATION_INVALID_TIMESTAMP',
  INVALID_KIND: 'EVALUATION_INVALID_KIND',
  INVALID_CRITERIA: 'EVALUATION_INVALID_CRITERIA',
  INVALID_DESCRIPTOR: 'EVALUATION_INVALID_DESCRIPTOR',
  INVALID_INPUT_CONTRACT: 'EVALUATION_INVALID_INPUT_CONTRACT',
  INVALID_REPRODUCIBILITY: 'EVALUATION_INVALID_REPRODUCIBILITY',
  INVALID_PROVENANCE: 'EVALUATION_INVALID_PROVENANCE',
  INVALID_RECORD: 'EVALUATION_INVALID_RECORD',
  INVALID_VERDICT: 'EVALUATION_INVALID_VERDICT',
  INVALID_AGGREGATION: 'EVALUATION_INVALID_AGGREGATION',
  INVALID_SCHEMA_REF: 'EVALUATION_INVALID_SCHEMA_REF',
  DUPLICATE_CRITERION: 'EVALUATION_DUPLICATE_CRITERION',
  CRITERION_MISMATCH: 'EVALUATION_CRITERION_MISMATCH',
  THRESHOLD_OUT_OF_RANGE: 'EVALUATION_THRESHOLD_OUT_OF_RANGE',
  TIMESTAMP_REGRESSION: 'EVALUATION_TIMESTAMP_REGRESSION',
  NOT_FOUND: 'EVALUATION_NOT_FOUND',
  IDENTITY_CONFLICT: 'EVALUATION_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'EVALUATION_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'EVALUATION_TAMPERED',
  VERSION_CONFLICT: 'EVALUATION_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'EVALUATION_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'EVALUATION_UNKNOWN_ERROR',
} as const);

export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[keyof typeof EVALUATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EvaluationErrorCode, EvaluationErrorCategory>> = {
  EVALUATION_INVALID_IDENTITY: 'validation',
  EVALUATION_INVALID_DIGEST: 'validation',
  EVALUATION_INVALID_TIMESTAMP: 'validation',
  EVALUATION_INVALID_KIND: 'validation',
  EVALUATION_INVALID_CRITERIA: 'validation',
  EVALUATION_INVALID_DESCRIPTOR: 'validation',
  EVALUATION_INVALID_INPUT_CONTRACT: 'validation',
  EVALUATION_INVALID_REPRODUCIBILITY: 'validation',
  EVALUATION_INVALID_PROVENANCE: 'validation',
  EVALUATION_INVALID_RECORD: 'validation',
  EVALUATION_INVALID_VERDICT: 'validation',
  EVALUATION_INVALID_AGGREGATION: 'validation',
  EVALUATION_INVALID_SCHEMA_REF: 'validation',
  EVALUATION_DUPLICATE_CRITERION: 'validation',
  EVALUATION_CRITERION_MISMATCH: 'validation',
  EVALUATION_THRESHOLD_OUT_OF_RANGE: 'validation',
  EVALUATION_TIMESTAMP_REGRESSION: 'integrity',
  EVALUATION_NOT_FOUND: 'validation',
  EVALUATION_IDENTITY_CONFLICT: 'integrity',
  EVALUATION_IDEMPOTENCY_CONFLICT: 'integrity',
  EVALUATION_TAMPERED: 'integrity',
  EVALUATION_VERSION_CONFLICT: 'integrity',
  EVALUATION_UNSUPPORTED_RECORD_VERSION: 'versioning',
  EVALUATION_UNKNOWN_ERROR: 'unknown',
};

export function isEvaluationErrorCode(value: unknown): value is EvaluationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EVALUATION_ERROR_CODES).includes(value as EvaluationErrorCode)
  );
}

export function categoryForEvaluationCode(code: EvaluationErrorCode): EvaluationErrorCategory {
  return CODE_CATEGORY[code];
}

export interface EvaluationErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an EvaluationError. */
export interface EvaluationErrorStruct {
  readonly code: EvaluationErrorCode;
  readonly category: EvaluationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class EvaluationError extends Error {
  readonly code: EvaluationErrorCode;
  readonly category: EvaluationErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: EvaluationErrorCode, init: EvaluationErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'EvaluationError';
    this.code = code;
    this.category = categoryForEvaluationCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isEvaluationError(value: unknown): value is EvaluationError {
  return value instanceof EvaluationError;
}

export function toEvaluationErrorStruct(error: EvaluationError): EvaluationErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured EvaluationError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `EvaluationError` with code
 * `EVALUATION_UNKNOWN_ERROR`.
 */
export function fromEvaluationErrorStruct(value: unknown): EvaluationError {
  const fail = (reason: string): never => {
    throw new EvaluationError(EVALUATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured evaluation error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isEvaluationErrorCode(code)) {
    return fail(`unknown or missing evaluation error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForEvaluationCode(code)) {
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

  return new EvaluationError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an EvaluationError. */
export function normalizeToEvaluationError(error: unknown): EvaluationError {
  if (isEvaluationError(error)) return error;
  if (error instanceof Error) {
    return new EvaluationError(EVALUATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new EvaluationError(EVALUATION_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
