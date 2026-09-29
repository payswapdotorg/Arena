/**
 * Certification protocol error taxonomy (Work Order A023).
 *
 * @arena/certification owns its own closed error code set, mirroring the
 * pattern of the sibling domain packages' typed errors
 * (@arena/verification's VerificationError, @arena/evaluation's
 * EvaluationError, @arena/compatibility's CompatibilityError — closed
 * codes, core category mapping, structured wire-safe form, strictly
 * validating parser — unknown codes are REJECTED at parse time). The
 * core taxonomy is frozen inside @arena/protocol-core (A001 surface,
 * read-only for this package), so certification-domain failures carry
 * CERTIFICATION_* codes here while core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) still propagate the
 * original ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const CERTIFICATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type CertificationErrorCategory = (typeof CERTIFICATION_ERROR_CATEGORIES)[number];

export const CERTIFICATION_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'CERTIFICATION_INVALID_IDENTITY',
  INVALID_DIGEST: 'CERTIFICATION_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'CERTIFICATION_INVALID_TIMESTAMP',
  INVALID_LEVEL: 'CERTIFICATION_INVALID_LEVEL',
  INVALID_VERDICT: 'CERTIFICATION_INVALID_VERDICT',
  INVALID_STAGE: 'CERTIFICATION_INVALID_STAGE',
  INVALID_SUBJECT: 'CERTIFICATION_INVALID_SUBJECT',
  INVALID_SUITE: 'CERTIFICATION_INVALID_SUITE',
  INVALID_STATEMENT: 'CERTIFICATION_INVALID_STATEMENT',
  INVALID_PROVENANCE: 'CERTIFICATION_INVALID_PROVENANCE',
  INVALID_RECORD: 'CERTIFICATION_INVALID_RECORD',
  INVALID_SCHEMA_REF: 'CERTIFICATION_INVALID_SCHEMA_REF',
  INVALID_SCOPE: 'CERTIFICATION_INVALID_SCOPE',
  INVALID_LIMITATIONS: 'CERTIFICATION_INVALID_LIMITATIONS',
  DUPLICATE_STAGE: 'CERTIFICATION_DUPLICATE_STAGE',
  STAGE_MISMATCH: 'CERTIFICATION_STAGE_MISMATCH',
  EVIDENCE_MISMATCH: 'CERTIFICATION_EVIDENCE_MISMATCH',
  UNSCOPED_STATEMENT: 'CERTIFICATION_UNSCOPED_STATEMENT',
  TIMESTAMP_REGRESSION: 'CERTIFICATION_TIMESTAMP_REGRESSION',
  NOT_FOUND: 'CERTIFICATION_NOT_FOUND',
  IDENTITY_CONFLICT: 'CERTIFICATION_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'CERTIFICATION_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'CERTIFICATION_TAMPERED',
  VERSION_CONFLICT: 'CERTIFICATION_VERSION_CONFLICT',
  SUPERSESSION_CONFLICT: 'CERTIFICATION_SUPERSESSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'CERTIFICATION_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'CERTIFICATION_UNKNOWN_ERROR',
} as const);

export type CertificationErrorCode = (typeof CERTIFICATION_ERROR_CODES)[keyof typeof CERTIFICATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<CertificationErrorCode, CertificationErrorCategory>> = {
  CERTIFICATION_INVALID_IDENTITY: 'validation',
  CERTIFICATION_INVALID_DIGEST: 'validation',
  CERTIFICATION_INVALID_TIMESTAMP: 'validation',
  CERTIFICATION_INVALID_LEVEL: 'validation',
  CERTIFICATION_INVALID_VERDICT: 'validation',
  CERTIFICATION_INVALID_STAGE: 'validation',
  CERTIFICATION_INVALID_SUBJECT: 'validation',
  CERTIFICATION_INVALID_SUITE: 'validation',
  CERTIFICATION_INVALID_STATEMENT: 'validation',
  CERTIFICATION_INVALID_PROVENANCE: 'validation',
  CERTIFICATION_INVALID_RECORD: 'validation',
  CERTIFICATION_INVALID_SCHEMA_REF: 'validation',
  CERTIFICATION_INVALID_SCOPE: 'validation',
  CERTIFICATION_INVALID_LIMITATIONS: 'validation',
  CERTIFICATION_DUPLICATE_STAGE: 'validation',
  CERTIFICATION_STAGE_MISMATCH: 'validation',
  CERTIFICATION_EVIDENCE_MISMATCH: 'validation',
  CERTIFICATION_UNSCOPED_STATEMENT: 'integrity',
  CERTIFICATION_TIMESTAMP_REGRESSION: 'integrity',
  CERTIFICATION_NOT_FOUND: 'validation',
  CERTIFICATION_IDENTITY_CONFLICT: 'integrity',
  CERTIFICATION_IDEMPOTENCY_CONFLICT: 'integrity',
  CERTIFICATION_TAMPERED: 'integrity',
  CERTIFICATION_VERSION_CONFLICT: 'integrity',
  CERTIFICATION_SUPERSESSION_CONFLICT: 'integrity',
  CERTIFICATION_UNSUPPORTED_RECORD_VERSION: 'versioning',
  CERTIFICATION_UNKNOWN_ERROR: 'unknown',
};

export function isCertificationErrorCode(value: unknown): value is CertificationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CERTIFICATION_ERROR_CODES).includes(value as CertificationErrorCode)
  );
}

export function categoryForCertificationCode(code: CertificationErrorCode): CertificationErrorCategory {
  return CODE_CATEGORY[code];
}

export interface CertificationErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a CertificationError. */
export interface CertificationErrorStruct {
  readonly code: CertificationErrorCode;
  readonly category: CertificationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class CertificationError extends Error {
  readonly code: CertificationErrorCode;
  readonly category: CertificationErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: CertificationErrorCode, init: CertificationErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'CertificationError';
    this.code = code;
    this.category = categoryForCertificationCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isCertificationError(value: unknown): value is CertificationError {
  return value instanceof CertificationError;
}

export function toCertificationErrorStruct(error: CertificationError): CertificationErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured CertificationError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `CertificationError` with code
 * `CERTIFICATION_UNKNOWN_ERROR`.
 */
export function fromCertificationErrorStruct(value: unknown): CertificationError {
  const fail = (reason: string): never => {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured certification error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isCertificationErrorCode(code)) {
    return fail(`unknown or missing certification error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForCertificationCode(code)) {
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

  return new CertificationError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a CertificationError. */
export function normalizeToCertificationError(error: unknown): CertificationError {
  if (isCertificationError(error)) return error;
  if (error instanceof Error) {
    return new CertificationError(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new CertificationError(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
