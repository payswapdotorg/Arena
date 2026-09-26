/**
 * Artifact protocol error taxonomy (Work Order A002).
 *
 * @arena/artifact-protocol owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError (closed codes, category
 * mapping, structured wire-safe form, strictly validating parser — unknown
 * codes are REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * artifact-domain failures carry ARTIFACT_* codes here while core-level
 * failures (canonicalization, envelope shape, correlation ids, schema refs)
 * still propagate the original ProtocolError from @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ARTIFACT_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const;

export type ArtifactErrorCategory = (typeof ARTIFACT_ERROR_CATEGORIES)[number];

export const ARTIFACT_ERROR_CODES = {
  INVALID_IDENTITY: 'ARTIFACT_INVALID_IDENTITY',
  INVALID_DIGEST: 'ARTIFACT_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'ARTIFACT_INVALID_TIMESTAMP',
  INVALID_PRINCIPAL: 'ARTIFACT_INVALID_PRINCIPAL',
  INVALID_RIGHTS: 'ARTIFACT_INVALID_RIGHTS',
  MISSING_RIGHTS: 'ARTIFACT_MISSING_RIGHTS',
  INVALID_ARTIFACT: 'ARTIFACT_INVALID_ARTIFACT',
  TAMPERED: 'ARTIFACT_TAMPERED',
  IDENTITY_CONFLICT: 'ARTIFACT_IDENTITY_CONFLICT',
  UNRESOLVED_REF: 'ARTIFACT_UNRESOLVED_REF',
  INVALID_PUBLICATION: 'ARTIFACT_INVALID_PUBLICATION',
  ALREADY_PUBLISHED: 'ARTIFACT_ALREADY_PUBLISHED',
  UNSUPPORTED_RECORD_VERSION: 'ARTIFACT_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'ARTIFACT_UNKNOWN_ERROR',
} as const;

export type ArtifactErrorCode = (typeof ARTIFACT_ERROR_CODES)[keyof typeof ARTIFACT_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ArtifactErrorCode, ArtifactErrorCategory>> = {
  ARTIFACT_INVALID_IDENTITY: 'validation',
  ARTIFACT_INVALID_DIGEST: 'validation',
  ARTIFACT_INVALID_TIMESTAMP: 'validation',
  ARTIFACT_INVALID_PRINCIPAL: 'validation',
  ARTIFACT_INVALID_RIGHTS: 'validation',
  ARTIFACT_MISSING_RIGHTS: 'validation',
  ARTIFACT_INVALID_ARTIFACT: 'validation',
  ARTIFACT_TAMPERED: 'integrity',
  ARTIFACT_IDENTITY_CONFLICT: 'integrity',
  ARTIFACT_UNRESOLVED_REF: 'integrity',
  ARTIFACT_INVALID_PUBLICATION: 'validation',
  ARTIFACT_ALREADY_PUBLISHED: 'validation',
  ARTIFACT_UNSUPPORTED_RECORD_VERSION: 'versioning',
  ARTIFACT_UNKNOWN_ERROR: 'unknown',
};

export function isArtifactErrorCode(value: unknown): value is ArtifactErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ARTIFACT_ERROR_CODES).includes(value as ArtifactErrorCode)
  );
}

export function categoryForArtifactCode(code: ArtifactErrorCode): ArtifactErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ArtifactErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ArtifactError. */
export interface ArtifactErrorStruct {
  readonly code: ArtifactErrorCode;
  readonly category: ArtifactErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  readonly category: ArtifactErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ArtifactErrorCode, init: ArtifactErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ArtifactError';
    this.code = code;
    this.category = categoryForArtifactCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isArtifactError(value: unknown): value is ArtifactError {
  return value instanceof ArtifactError;
}

export function toArtifactErrorStruct(error: ArtifactError): ArtifactErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ArtifactError. Any malformed input — non-object, missing
 * or unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws `ArtifactError` with code `ARTIFACT_UNKNOWN_ERROR`.
 */
export function fromArtifactErrorStruct(value: unknown): ArtifactError {
  const fail = (reason: string): never => {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured artifact error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isArtifactErrorCode(code)) {
    return fail(`unknown or missing artifact error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForArtifactCode(code)) {
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

  return new ArtifactError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an ArtifactError. */
export function normalizeToArtifactError(error: unknown): ArtifactError {
  if (isArtifactError(error)) return error;
  if (error instanceof Error) {
    return new ArtifactError(ARTIFACT_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ArtifactError(ARTIFACT_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
