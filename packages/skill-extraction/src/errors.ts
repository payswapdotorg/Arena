/**
 * Skill-extraction error taxonomy (Work Order A019; requirement R17).
 *
 * @arena/skill-extraction owns its own closed error code set, mirroring
 * the pattern of @arena/trajectory's TrajectoryError,
 * @arena/evaluation's EvaluationError and @arena/verification's
 * VerificationError (closed codes, core category mapping, structured
 * wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * skill-extraction-domain failures carry SKILL_EXTRACTION_* codes here
 * while core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) still propagate the original
 * ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const SKILL_EXTRACTION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type SkillExtractionErrorCategory = (typeof SKILL_EXTRACTION_ERROR_CATEGORIES)[number];

export const SKILL_EXTRACTION_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'SKILL_EXTRACTION_INVALID_IDENTITY',
  INVALID_DIGEST: 'SKILL_EXTRACTION_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'SKILL_EXTRACTION_INVALID_TIMESTAMP',
  INVALID_REF: 'SKILL_EXTRACTION_INVALID_REF',
  INVALID_POLICY: 'SKILL_EXTRACTION_INVALID_POLICY',
  INVALID_CANDIDATE: 'SKILL_EXTRACTION_INVALID_CANDIDATE',
  INVALID_DRAFT: 'SKILL_EXTRACTION_INVALID_DRAFT',
  INVALID_RECORD: 'SKILL_EXTRACTION_INVALID_RECORD',
  INVALID_PROVENANCE: 'SKILL_EXTRACTION_INVALID_PROVENANCE',
  INVALID_SCHEMA_REF: 'SKILL_EXTRACTION_INVALID_SCHEMA_REF',
  UNVALIDATED_TRAJECTORY: 'SKILL_EXTRACTION_UNVALIDATED_TRAJECTORY',
  TRAJECTORY_NOT_COMPLETED: 'SKILL_EXTRACTION_TRAJECTORY_NOT_COMPLETED',
  EVIDENCE_MISMATCH: 'SKILL_EXTRACTION_EVIDENCE_MISMATCH',
  TIMESTAMP_REGRESSION: 'SKILL_EXTRACTION_TIMESTAMP_REGRESSION',
  NOT_FOUND: 'SKILL_EXTRACTION_NOT_FOUND',
  IDENTITY_CONFLICT: 'SKILL_EXTRACTION_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'SKILL_EXTRACTION_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'SKILL_EXTRACTION_TAMPERED',
  VERSION_CONFLICT: 'SKILL_EXTRACTION_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'SKILL_EXTRACTION_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'SKILL_EXTRACTION_UNKNOWN_ERROR',
} as const);

export type SkillExtractionErrorCode =
  (typeof SKILL_EXTRACTION_ERROR_CODES)[keyof typeof SKILL_EXTRACTION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<SkillExtractionErrorCode, SkillExtractionErrorCategory>> = {
  SKILL_EXTRACTION_INVALID_IDENTITY: 'validation',
  SKILL_EXTRACTION_INVALID_DIGEST: 'validation',
  SKILL_EXTRACTION_INVALID_TIMESTAMP: 'validation',
  SKILL_EXTRACTION_INVALID_REF: 'validation',
  SKILL_EXTRACTION_INVALID_POLICY: 'validation',
  SKILL_EXTRACTION_INVALID_CANDIDATE: 'validation',
  SKILL_EXTRACTION_INVALID_DRAFT: 'validation',
  SKILL_EXTRACTION_INVALID_RECORD: 'validation',
  SKILL_EXTRACTION_INVALID_PROVENANCE: 'validation',
  SKILL_EXTRACTION_INVALID_SCHEMA_REF: 'validation',
  SKILL_EXTRACTION_UNVALIDATED_TRAJECTORY: 'validation',
  SKILL_EXTRACTION_TRAJECTORY_NOT_COMPLETED: 'validation',
  SKILL_EXTRACTION_EVIDENCE_MISMATCH: 'validation',
  SKILL_EXTRACTION_TIMESTAMP_REGRESSION: 'integrity',
  SKILL_EXTRACTION_NOT_FOUND: 'validation',
  SKILL_EXTRACTION_IDENTITY_CONFLICT: 'integrity',
  SKILL_EXTRACTION_IDEMPOTENCY_CONFLICT: 'integrity',
  SKILL_EXTRACTION_TAMPERED: 'integrity',
  SKILL_EXTRACTION_VERSION_CONFLICT: 'integrity',
  SKILL_EXTRACTION_UNSUPPORTED_RECORD_VERSION: 'versioning',
  SKILL_EXTRACTION_UNKNOWN_ERROR: 'unknown',
};

export function isSkillExtractionErrorCode(value: unknown): value is SkillExtractionErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(SKILL_EXTRACTION_ERROR_CODES).includes(value as SkillExtractionErrorCode)
  );
}

export function categoryForSkillExtractionCode(
  code: SkillExtractionErrorCode,
): SkillExtractionErrorCategory {
  return CODE_CATEGORY[code];
}

export interface SkillExtractionErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a SkillExtractionError. */
export interface SkillExtractionErrorStruct {
  readonly code: SkillExtractionErrorCode;
  readonly category: SkillExtractionErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class SkillExtractionError extends Error {
  readonly code: SkillExtractionErrorCode;
  readonly category: SkillExtractionErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: SkillExtractionErrorCode, init: SkillExtractionErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'SkillExtractionError';
    this.code = code;
    this.category = categoryForSkillExtractionCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isSkillExtractionError(value: unknown): value is SkillExtractionError {
  return value instanceof SkillExtractionError;
}

export function toSkillExtractionErrorStruct(
  error: SkillExtractionError,
): SkillExtractionErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured SkillExtractionError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `SkillExtractionError` with code
 * `SKILL_EXTRACTION_UNKNOWN_ERROR`.
 */
export function fromSkillExtractionErrorStruct(value: unknown): SkillExtractionError {
  const fail = (reason: string): never => {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured skill-extraction error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isSkillExtractionErrorCode(code)) {
    return fail(`unknown or missing skill-extraction error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForSkillExtractionCode(code)) {
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

  return new SkillExtractionError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a SkillExtractionError. */
export function normalizeToSkillExtractionError(error: unknown): SkillExtractionError {
  if (isSkillExtractionError(error)) return error;
  if (error instanceof Error) {
    return new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
