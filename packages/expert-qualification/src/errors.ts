/**
 * Expert-qualification protocol error taxonomy (Work Order A007).
 *
 * @arena/expert-qualification owns its own closed error code set, mirroring
 * the pattern of the sibling domain packages' typed errors
 * (@arena/expert-registry's ExpertRegistryError,
 * @arena/verification's VerificationError — closed codes, core category
 * mapping, structured wire-safe form, strictly validating parser — unknown
 * codes are REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * expert-qualification-domain failures carry EXPERT_QUALIFICATION_* codes
 * here while core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) still propagate the original ProtocolError.
 *
 * QUALIFICATION IS DATA, NEVER AUTHORIZATION (architecture-lock rule 9):
 * no error code, message or structured detail in this taxonomy grants,
 * implies or records a permission; the vocabulary is about validation,
 * integrity and versioning of qualification/matching DATA only.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const EXPERT_QUALIFICATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type ExpertQualificationErrorCategory = (typeof EXPERT_QUALIFICATION_ERROR_CATEGORIES)[number];

export const EXPERT_QUALIFICATION_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'EXPERT_QUALIFICATION_INVALID_IDENTITY',
  INVALID_DIGEST: 'EXPERT_QUALIFICATION_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'EXPERT_QUALIFICATION_INVALID_TIMESTAMP',
  INVALID_EVIDENCE: 'EXPERT_QUALIFICATION_INVALID_EVIDENCE',
  INVALID_CLAIM: 'EXPERT_QUALIFICATION_INVALID_CLAIM',
  INVALID_POLICY: 'EXPERT_QUALIFICATION_INVALID_POLICY',
  INVALID_RECORD: 'EXPERT_QUALIFICATION_INVALID_RECORD',
  INVALID_REQUEST: 'EXPERT_QUALIFICATION_INVALID_REQUEST',
  INVALID_MATCHING_POLICY: 'EXPERT_QUALIFICATION_INVALID_MATCHING_POLICY',
  INVALID_EXPERT_CARD: 'EXPERT_QUALIFICATION_INVALID_EXPERT_CARD',
  INVALID_RESULT: 'EXPERT_QUALIFICATION_INVALID_RESULT',
  INVALID_REF: 'EXPERT_QUALIFICATION_INVALID_REF',
  MISSING_EVIDENCE: 'EXPERT_QUALIFICATION_MISSING_EVIDENCE',
  DUPLICATE_EVIDENCE: 'EXPERT_QUALIFICATION_DUPLICATE_EVIDENCE',
  DUPLICATE_REQUIREMENT: 'EXPERT_QUALIFICATION_DUPLICATE_REQUIREMENT',
  SUPERSESSION_CONFLICT: 'EXPERT_QUALIFICATION_SUPERSESSION_CONFLICT',
  NOT_FOUND: 'EXPERT_QUALIFICATION_NOT_FOUND',
  IDENTITY_CONFLICT: 'EXPERT_QUALIFICATION_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'EXPERT_QUALIFICATION_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'EXPERT_QUALIFICATION_TAMPERED',
  VERSION_CONFLICT: 'EXPERT_QUALIFICATION_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'EXPERT_QUALIFICATION_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'EXPERT_QUALIFICATION_UNKNOWN_ERROR',
} as const);

export type ExpertQualificationErrorCode =
  (typeof EXPERT_QUALIFICATION_ERROR_CODES)[keyof typeof EXPERT_QUALIFICATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<ExpertQualificationErrorCode, ExpertQualificationErrorCategory>
> = {
  EXPERT_QUALIFICATION_INVALID_IDENTITY: 'validation',
  EXPERT_QUALIFICATION_INVALID_DIGEST: 'validation',
  EXPERT_QUALIFICATION_INVALID_TIMESTAMP: 'validation',
  EXPERT_QUALIFICATION_INVALID_EVIDENCE: 'validation',
  EXPERT_QUALIFICATION_INVALID_CLAIM: 'validation',
  EXPERT_QUALIFICATION_INVALID_POLICY: 'validation',
  EXPERT_QUALIFICATION_INVALID_RECORD: 'validation',
  EXPERT_QUALIFICATION_INVALID_REQUEST: 'validation',
  EXPERT_QUALIFICATION_INVALID_MATCHING_POLICY: 'validation',
  EXPERT_QUALIFICATION_INVALID_EXPERT_CARD: 'validation',
  EXPERT_QUALIFICATION_INVALID_RESULT: 'validation',
  EXPERT_QUALIFICATION_INVALID_REF: 'validation',
  EXPERT_QUALIFICATION_MISSING_EVIDENCE: 'validation',
  EXPERT_QUALIFICATION_DUPLICATE_EVIDENCE: 'validation',
  EXPERT_QUALIFICATION_DUPLICATE_REQUIREMENT: 'validation',
  EXPERT_QUALIFICATION_SUPERSESSION_CONFLICT: 'integrity',
  EXPERT_QUALIFICATION_NOT_FOUND: 'validation',
  EXPERT_QUALIFICATION_IDENTITY_CONFLICT: 'integrity',
  EXPERT_QUALIFICATION_IDEMPOTENCY_CONFLICT: 'integrity',
  EXPERT_QUALIFICATION_TAMPERED: 'integrity',
  EXPERT_QUALIFICATION_VERSION_CONFLICT: 'integrity',
  EXPERT_QUALIFICATION_UNSUPPORTED_RECORD_VERSION: 'versioning',
  EXPERT_QUALIFICATION_UNKNOWN_ERROR: 'unknown',
};

export function isExpertQualificationErrorCode(
  value: unknown,
): value is ExpertQualificationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EXPERT_QUALIFICATION_ERROR_CODES).includes(
      value as ExpertQualificationErrorCode,
    )
  );
}

export function categoryForExpertQualificationCode(
  code: ExpertQualificationErrorCode,
): ExpertQualificationErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ExpertQualificationErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ExpertQualificationError. */
export interface ExpertQualificationErrorStruct {
  readonly code: ExpertQualificationErrorCode;
  readonly category: ExpertQualificationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ExpertQualificationError extends Error {
  readonly code: ExpertQualificationErrorCode;
  readonly category: ExpertQualificationErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ExpertQualificationErrorCode, init: ExpertQualificationErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ExpertQualificationError';
    this.code = code;
    this.category = categoryForExpertQualificationCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isExpertQualificationError(
  value: unknown,
): value is ExpertQualificationError {
  return value instanceof ExpertQualificationError;
}

export function toExpertQualificationErrorStruct(
  error: ExpertQualificationError,
): ExpertQualificationErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ExpertQualificationError. Any malformed input —
 * non-object, missing or unknown code, category/code mismatch, missing
 * message, invalid optional fields — throws `ExpertQualificationError`
 * with code `EXPERT_QUALIFICATION_UNKNOWN_ERROR`.
 */
export function fromExpertQualificationErrorStruct(value: unknown): ExpertQualificationError {
  const fail = (reason: string): never => {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured expert-qualification error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isExpertQualificationErrorCode(code)) {
    return fail(`unknown or missing expert-qualification error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForExpertQualificationCode(code)) {
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

  return new ExpertQualificationError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an ExpertQualificationError. */
export function normalizeToExpertQualificationError(
  error: unknown,
): ExpertQualificationError {
  if (isExpertQualificationError(error)) return error;
  if (error instanceof Error) {
    return new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
