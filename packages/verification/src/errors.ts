/**
 * Verification protocol error taxonomy (Work Order A013).
 *
 * @arena/verification owns its own closed error code set, mirroring the
 * pattern of the sibling domain packages' typed errors
 * (@arena/trajectory's TrajectoryError, @arena/artifact-protocol's
 * ArtifactError, @arena/capability-case's CapabilityCaseError — closed
 * codes, core category mapping, structured wire-safe form, strictly
 * validating parser — unknown codes are REJECTED at parse time). The
 * core taxonomy is frozen inside @arena/protocol-core (A001 surface,
 * read-only for this package), so verification-domain failures carry
 * VERIFICATION_* codes here while core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) still propagate the
 * original ProtocolError. Artifact-level failures caught during evidence
 * validation propagate the original ArtifactError from
 * @arena/artifact-protocol where appropriate (A002 surface, read-only
 * for this package).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const VERIFICATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type VerificationErrorCategory = (typeof VERIFICATION_ERROR_CATEGORIES)[number];

export const VERIFICATION_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'VERIFICATION_INVALID_IDENTITY',
  INVALID_DIGEST: 'VERIFICATION_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'VERIFICATION_INVALID_TIMESTAMP',
  INVALID_METHOD: 'VERIFICATION_INVALID_METHOD',
  INVALID_OUTCOME: 'VERIFICATION_INVALID_OUTCOME',
  INVALID_EVIDENCE: 'VERIFICATION_INVALID_EVIDENCE',
  INVALID_REQUIREMENT: 'VERIFICATION_INVALID_REQUIREMENT',
  INVALID_DESCRIPTOR: 'VERIFICATION_INVALID_DESCRIPTOR',
  INVALID_REPRODUCIBILITY: 'VERIFICATION_INVALID_REPRODUCIBILITY',
  INVALID_PROVENANCE: 'VERIFICATION_INVALID_PROVENANCE',
  INVALID_RECORD: 'VERIFICATION_INVALID_RECORD',
  INVALID_SCHEMA_REF: 'VERIFICATION_INVALID_SCHEMA_REF',
  DUPLICATE_REQUIREMENT: 'VERIFICATION_DUPLICATE_REQUIREMENT',
  REQUIREMENT_MISMATCH: 'VERIFICATION_REQUIREMENT_MISMATCH',
  EVIDENCE_MISMATCH: 'VERIFICATION_EVIDENCE_MISMATCH',
  TIMESTAMP_REGRESSION: 'VERIFICATION_TIMESTAMP_REGRESSION',
  NOT_FOUND: 'VERIFICATION_NOT_FOUND',
  IDENTITY_CONFLICT: 'VERIFICATION_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'VERIFICATION_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'VERIFICATION_TAMPERED',
  VERSION_CONFLICT: 'VERIFICATION_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'VERIFICATION_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'VERIFICATION_UNKNOWN_ERROR',
} as const);

export type VerificationErrorCode = (typeof VERIFICATION_ERROR_CODES)[keyof typeof VERIFICATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<VerificationErrorCode, VerificationErrorCategory>> = {
  VERIFICATION_INVALID_IDENTITY: 'validation',
  VERIFICATION_INVALID_DIGEST: 'validation',
  VERIFICATION_INVALID_TIMESTAMP: 'validation',
  VERIFICATION_INVALID_METHOD: 'validation',
  VERIFICATION_INVALID_OUTCOME: 'validation',
  VERIFICATION_INVALID_EVIDENCE: 'validation',
  VERIFICATION_INVALID_REQUIREMENT: 'validation',
  VERIFICATION_INVALID_DESCRIPTOR: 'validation',
  VERIFICATION_INVALID_REPRODUCIBILITY: 'validation',
  VERIFICATION_INVALID_PROVENANCE: 'validation',
  VERIFICATION_INVALID_RECORD: 'validation',
  VERIFICATION_INVALID_SCHEMA_REF: 'validation',
  VERIFICATION_DUPLICATE_REQUIREMENT: 'validation',
  VERIFICATION_REQUIREMENT_MISMATCH: 'validation',
  VERIFICATION_EVIDENCE_MISMATCH: 'validation',
  VERIFICATION_TIMESTAMP_REGRESSION: 'integrity',
  VERIFICATION_NOT_FOUND: 'validation',
  VERIFICATION_IDENTITY_CONFLICT: 'integrity',
  VERIFICATION_IDEMPOTENCY_CONFLICT: 'integrity',
  VERIFICATION_TAMPERED: 'integrity',
  VERIFICATION_VERSION_CONFLICT: 'integrity',
  VERIFICATION_UNSUPPORTED_RECORD_VERSION: 'versioning',
  VERIFICATION_UNKNOWN_ERROR: 'unknown',
};

export function isVerificationErrorCode(value: unknown): value is VerificationErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(VERIFICATION_ERROR_CODES).includes(value as VerificationErrorCode)
  );
}

export function categoryForVerificationCode(code: VerificationErrorCode): VerificationErrorCategory {
  return CODE_CATEGORY[code];
}

export interface VerificationErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a VerificationError. */
export interface VerificationErrorStruct {
  readonly code: VerificationErrorCode;
  readonly category: VerificationErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class VerificationError extends Error {
  readonly code: VerificationErrorCode;
  readonly category: VerificationErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: VerificationErrorCode, init: VerificationErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'VerificationError';
    this.code = code;
    this.category = categoryForVerificationCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isVerificationError(value: unknown): value is VerificationError {
  return value instanceof VerificationError;
}

export function toVerificationErrorStruct(error: VerificationError): VerificationErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured VerificationError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `VerificationError` with code
 * `VERIFICATION_UNKNOWN_ERROR`.
 */
export function fromVerificationErrorStruct(value: unknown): VerificationError {
  const fail = (reason: string): never => {
    throw new VerificationError(VERIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured verification error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isVerificationErrorCode(code)) {
    return fail(`unknown or missing verification error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForVerificationCode(code)) {
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

  return new VerificationError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a VerificationError. */
export function normalizeToVerificationError(error: unknown): VerificationError {
  if (isVerificationError(error)) return error;
  if (error instanceof Error) {
    return new VerificationError(VERIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new VerificationError(VERIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
