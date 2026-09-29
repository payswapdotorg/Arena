/**
 * Learning protocol error taxonomy (Work Order A020).
 *
 * @arena/learning owns its own closed error code set, mirroring the
 * pattern of @arena/evaluation's EvaluationError, @arena/verification's
 * VerificationError and @arena/skill-extraction's SkillExtractionError
 * (closed codes, core category mapping, structured wire-safe form,
 * strictly validating parser - unknown codes are REJECTED at parse
 * time). The core taxonomy is frozen inside @arena/protocol-core (A001
 * surface, read-only for this package), so learning-domain failures
 * carry LEARNING_* codes here while core-level failures
 * (canonicalization, envelope shape, correlation ids, schema refs)
 * still propagate the original ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const LEARNING_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type LearningErrorCategory = (typeof LEARNING_ERROR_CATEGORIES)[number];

export const LEARNING_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'LEARNING_INVALID_IDENTITY',
  INVALID_DIGEST: 'LEARNING_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'LEARNING_INVALID_TIMESTAMP',
  INVALID_DESCRIPTOR: 'LEARNING_INVALID_DESCRIPTOR',
  INVALID_INTERVENTION: 'LEARNING_INVALID_INTERVENTION',
  INVALID_METRIC: 'LEARNING_INVALID_METRIC',
  INVALID_POPULATION: 'LEARNING_INVALID_POPULATION',
  INVALID_RUN: 'LEARNING_INVALID_RUN',
  INVALID_RECORD: 'LEARNING_INVALID_RECORD',
  INVALID_VERDICT: 'LEARNING_INVALID_VERDICT',
  INVALID_ATTRIBUTION: 'LEARNING_INVALID_ATTRIBUTION',
  INVALID_PROPOSAL: 'LEARNING_INVALID_PROPOSAL',
  INVALID_CALIBRATION: 'LEARNING_INVALID_CALIBRATION',
  INVALID_PROVENANCE: 'LEARNING_INVALID_PROVENANCE',
  INVALID_SCHEMA_REF: 'LEARNING_INVALID_SCHEMA_REF',
  PINNED_POPULATION_MISMATCH: 'LEARNING_PINNED_POPULATION_MISMATCH',
  ENVIRONMENT_MISMATCH: 'LEARNING_ENVIRONMENT_MISMATCH',
  BASELINE_MISMATCH: 'LEARNING_BASELINE_MISMATCH',
  METRIC_MISMATCH: 'LEARNING_METRIC_MISMATCH',
  PROTECTED_CAPABILITY_MISMATCH: 'LEARNING_PROTECTED_CAPABILITY_MISMATCH',
  REWRITE_ATTEMPT: 'LEARNING_REWRITE_ATTEMPT',
  NOT_FOUND: 'LEARNING_NOT_FOUND',
  IDENTITY_CONFLICT: 'LEARNING_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'LEARNING_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'LEARNING_TAMPERED',
  VERSION_CONFLICT: 'LEARNING_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'LEARNING_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'LEARNING_UNKNOWN_ERROR',
} as const);

export type LearningErrorCode = (typeof LEARNING_ERROR_CODES)[keyof typeof LEARNING_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<LearningErrorCode, LearningErrorCategory>> = {
  LEARNING_INVALID_IDENTITY: 'validation',
  LEARNING_INVALID_DIGEST: 'validation',
  LEARNING_INVALID_TIMESTAMP: 'validation',
  LEARNING_INVALID_DESCRIPTOR: 'validation',
  LEARNING_INVALID_INTERVENTION: 'validation',
  LEARNING_INVALID_METRIC: 'validation',
  LEARNING_INVALID_POPULATION: 'validation',
  LEARNING_INVALID_RUN: 'validation',
  LEARNING_INVALID_RECORD: 'validation',
  LEARNING_INVALID_VERDICT: 'validation',
  LEARNING_INVALID_ATTRIBUTION: 'validation',
  LEARNING_INVALID_PROPOSAL: 'validation',
  LEARNING_INVALID_CALIBRATION: 'validation',
  LEARNING_INVALID_PROVENANCE: 'validation',
  LEARNING_INVALID_SCHEMA_REF: 'validation',
  LEARNING_PINNED_POPULATION_MISMATCH: 'validation',
  LEARNING_ENVIRONMENT_MISMATCH: 'validation',
  LEARNING_BASELINE_MISMATCH: 'validation',
  LEARNING_METRIC_MISMATCH: 'validation',
  LEARNING_PROTECTED_CAPABILITY_MISMATCH: 'validation',
  LEARNING_REWRITE_ATTEMPT: 'integrity',
  LEARNING_NOT_FOUND: 'validation',
  LEARNING_IDENTITY_CONFLICT: 'integrity',
  LEARNING_IDEMPOTENCY_CONFLICT: 'integrity',
  LEARNING_TAMPERED: 'integrity',
  LEARNING_VERSION_CONFLICT: 'integrity',
  LEARNING_UNSUPPORTED_RECORD_VERSION: 'versioning',
  LEARNING_UNKNOWN_ERROR: 'unknown',
};

export function isLearningErrorCode(value: unknown): value is LearningErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(LEARNING_ERROR_CODES).includes(value as LearningErrorCode)
  );
}

export function categoryForLearningCode(code: LearningErrorCode): LearningErrorCategory {
  return CODE_CATEGORY[code];
}

export interface LearningErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a LearningError. */
export interface LearningErrorStruct {
  readonly code: LearningErrorCode;
  readonly category: LearningErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class LearningError extends Error {
  readonly code: LearningErrorCode;
  readonly category: LearningErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: LearningErrorCode, init: LearningErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'LearningError';
    this.code = code;
    this.category = categoryForLearningCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isLearningError(value: unknown): value is LearningError {
  return value instanceof LearningError;
}

export function toLearningErrorStruct(error: LearningError): LearningErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured LearningError. Any malformed input - non-object,
 * missing or unknown code, category/code mismatch, missing message,
 * invalid optional fields - throws `LearningError` with code
 * `LEARNING_UNKNOWN_ERROR`.
 */
export function fromLearningErrorStruct(value: unknown): LearningError {
  const fail = (reason: string): never => {
    throw new LearningError(LEARNING_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured learning error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isLearningErrorCode(code)) {
    return fail(`unknown or missing learning error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForLearningCode(code)) {
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

  return new LearningError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a LearningError. */
export function normalizeToLearningError(error: unknown): LearningError {
  if (isLearningError(error)) return error;
  if (error instanceof Error) {
    return new LearningError(LEARNING_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new LearningError(LEARNING_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
