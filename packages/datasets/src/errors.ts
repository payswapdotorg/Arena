/**
 * Dataset packaging error taxonomy (Work Order A014).
 *
 * @arena/datasets owns its own closed error code set, mirroring the house
 * pattern of @arena/protocol-core's ProtocolError / @arena/artifact-protocol's
 * ArtifactError / @arena/provenance's ProvenanceError: closed codes, category
 * mapping, structured wire-safe form, strictly validating parser (unknown
 * codes are REJECTED at parse time). Dataset-domain failures carry DATASET_*
 * codes here, while underlying failures thrown by the reused A002 primitives
 * (ARTIFACT_INVALID_*, ARTIFACT_TAMPERED on artifact verification, ...) and
 * PROVENANCE_* codes propagate unchanged — this package never reimplements
 * artifact validation, canonicalization or hashing.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const DATASET_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type DatasetErrorCategory = (typeof DATASET_ERROR_CATEGORIES)[number];

export const DATASET_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'DATASET_INVALID_IDENTITY',
  INVALID_ENTRY: 'DATASET_INVALID_ENTRY',
  INVALID_ROLE: 'DATASET_INVALID_ROLE',
  INVALID_PROVENANCE: 'DATASET_INVALID_PROVENANCE',
  TAMPERED: 'DATASET_TAMPERED',
  IDENTITY_CONFLICT: 'DATASET_IDENTITY_CONFLICT',
  UNRESOLVED_ENTRY: 'DATASET_UNRESOLVED_ENTRY',
  UNSUPPORTED_MANIFEST_VERSION: 'DATASET_UNSUPPORTED_MANIFEST_VERSION',
  UNKNOWN_ERROR: 'DATASET_UNKNOWN_ERROR',
} as const);

export type DatasetErrorCode = (typeof DATASET_ERROR_CODES)[keyof typeof DATASET_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<DatasetErrorCode, DatasetErrorCategory>> = {
  DATASET_INVALID_IDENTITY: 'validation',
  DATASET_INVALID_ENTRY: 'validation',
  DATASET_INVALID_ROLE: 'validation',
  DATASET_INVALID_PROVENANCE: 'validation',
  DATASET_TAMPERED: 'integrity',
  DATASET_IDENTITY_CONFLICT: 'integrity',
  DATASET_UNRESOLVED_ENTRY: 'integrity',
  DATASET_UNSUPPORTED_MANIFEST_VERSION: 'versioning',
  DATASET_UNKNOWN_ERROR: 'unknown',
};

export function isDatasetErrorCode(value: unknown): value is DatasetErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(DATASET_ERROR_CODES).includes(value as DatasetErrorCode)
  );
}

export function categoryForDatasetCode(code: DatasetErrorCode): DatasetErrorCategory {
  return CODE_CATEGORY[code];
}

export interface DatasetErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a DatasetError. */
export interface DatasetErrorStruct {
  readonly code: DatasetErrorCode;
  readonly category: DatasetErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class DatasetError extends Error {
  readonly code: DatasetErrorCode;
  readonly category: DatasetErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: DatasetErrorCode, init: DatasetErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'DatasetError';
    this.code = code;
    this.category = categoryForDatasetCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isDatasetError(value: unknown): value is DatasetError {
  return value instanceof DatasetError;
}

export function toDatasetErrorStruct(error: DatasetError): DatasetErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured DatasetError. Any malformed input — non-object, missing
 * or unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws `DatasetError` with code `DATASET_UNKNOWN_ERROR`.
 */
export function fromDatasetErrorStruct(value: unknown): DatasetError {
  const fail = (reason: string): never => {
    throw new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured dataset error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isDatasetErrorCode(code)) {
    return fail(`unknown or missing dataset error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForDatasetCode(code)) {
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

  return new DatasetError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a DatasetError. */
export function normalizeToDatasetError(error: unknown): DatasetError {
  if (isDatasetError(error)) return error;
  if (error instanceof Error) {
    return new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
