/**
 * Artifact service error taxonomy (Work Order A014).
 *
 * The A014 service layer owns a SMALL closed error set for concerns the
 * A002 domain taxonomy does not cover: tenant-scope violations on reads
 * and lookups of unknown content. Artifact-level failures REUSE the A002
 * codes and propagate unchanged (ARTIFACT_IDENTITY_CONFLICT for
 * identity↔digest binding permanence, ARTIFACT_TAMPERED for content
 * verification, ARTIFACT_UNRESOLVED_REF, PROVENANCE_* for lineage
 * validation) — this service never reimplements artifact validation,
 * canonicalization, hashing or publication semantics.
 *
 * Mirrors the house pattern (protocol-core / artifact-protocol /
 * provenance / datasets): closed codes, category mapping, structured
 * wire-safe form, strictly validating parser (unknown codes REJECTED at
 * parse time).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ARTIFACTS_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type ArtifactsErrorCategory = (typeof ARTIFACTS_ERROR_CATEGORIES)[number];

export const ARTIFACTS_ERROR_CODES = Object.freeze({
  TENANT_FORBIDDEN: 'ARTIFACTS_TENANT_FORBIDDEN',
  NOT_FOUND: 'ARTIFACTS_NOT_FOUND',
  UNKNOWN_ERROR: 'ARTIFACTS_UNKNOWN_ERROR',
} as const);

export type ArtifactsErrorCode = (typeof ARTIFACTS_ERROR_CODES)[keyof typeof ARTIFACTS_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ArtifactsErrorCode, ArtifactsErrorCategory>> = {
  ARTIFACTS_TENANT_FORBIDDEN: 'validation',
  ARTIFACTS_NOT_FOUND: 'validation',
  ARTIFACTS_UNKNOWN_ERROR: 'unknown',
};

export function isArtifactsErrorCode(value: unknown): value is ArtifactsErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ARTIFACTS_ERROR_CODES).includes(value as ArtifactsErrorCode)
  );
}

export function categoryForArtifactsCode(code: ArtifactsErrorCode): ArtifactsErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ArtifactsErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ArtifactsError. */
export interface ArtifactsErrorStruct {
  readonly code: ArtifactsErrorCode;
  readonly category: ArtifactsErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ArtifactsError extends Error {
  readonly code: ArtifactsErrorCode;
  readonly category: ArtifactsErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ArtifactsErrorCode, init: ArtifactsErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ArtifactsError';
    this.code = code;
    this.category = categoryForArtifactsCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isArtifactsError(value: unknown): value is ArtifactsError {
  return value instanceof ArtifactsError;
}

export function toArtifactsErrorStruct(error: ArtifactsError): ArtifactsErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ArtifactsError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message,
 * invalid optional fields — throws `ArtifactsError` with code
 * `ARTIFACTS_UNKNOWN_ERROR`.
 */
export function fromArtifactsErrorStruct(value: unknown): ArtifactsError {
  const fail = (reason: string): never => {
    throw new ArtifactsError(ARTIFACTS_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured artifact-service error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isArtifactsErrorCode(code)) {
    return fail(`unknown or missing artifact-service error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForArtifactsCode(code)) {
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

  return new ArtifactsError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an ArtifactsError. */
export function normalizeToArtifactsError(error: unknown): ArtifactsError {
  if (isArtifactsError(error)) return error;
  if (error instanceof Error) {
    return new ArtifactsError(ARTIFACTS_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ArtifactsError(ARTIFACTS_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
