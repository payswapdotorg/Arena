/**
 * Provenance error taxonomy (Work Order A002).
 *
 * Mirrors the pattern of the artifact-protocol and protocol-core taxonomies:
 * closed code set, category mapping, structured wire-safe form, strictly
 * validating parser (unknown codes REJECTED at parse time). Core-level
 * failures (canonicalization, envelope shape, correlation ids, schema refs)
 * propagate the original ProtocolError from @arena/protocol-core.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const PROVENANCE_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const;

export type ProvenanceErrorCategory = (typeof PROVENANCE_ERROR_CATEGORIES)[number];

export const PROVENANCE_ERROR_CODES = {
  INVALID_RECORD: 'PROVENANCE_INVALID_RECORD',
  INVALID_REF: 'PROVENANCE_INVALID_REF',
  INVALID_TIMESTAMP: 'PROVENANCE_INVALID_TIMESTAMP',
  INVALID_PRINCIPAL: 'PROVENANCE_INVALID_PRINCIPAL',
  INVALID_RIGHTS: 'PROVENANCE_INVALID_RIGHTS',
  MISSING_RIGHTS: 'PROVENANCE_MISSING_RIGHTS',
  CYCLE_DETECTED: 'PROVENANCE_CYCLE_DETECTED',
  IDENTITY_CONFLICT: 'PROVENANCE_IDENTITY_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'PROVENANCE_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'PROVENANCE_UNKNOWN_ERROR',
} as const;

export type ProvenanceErrorCode = (typeof PROVENANCE_ERROR_CODES)[keyof typeof PROVENANCE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ProvenanceErrorCode, ProvenanceErrorCategory>> = {
  PROVENANCE_INVALID_RECORD: 'validation',
  PROVENANCE_INVALID_REF: 'validation',
  PROVENANCE_INVALID_TIMESTAMP: 'validation',
  PROVENANCE_INVALID_PRINCIPAL: 'validation',
  PROVENANCE_INVALID_RIGHTS: 'validation',
  PROVENANCE_MISSING_RIGHTS: 'validation',
  PROVENANCE_CYCLE_DETECTED: 'integrity',
  PROVENANCE_IDENTITY_CONFLICT: 'integrity',
  PROVENANCE_UNSUPPORTED_RECORD_VERSION: 'versioning',
  PROVENANCE_UNKNOWN_ERROR: 'unknown',
};

export function isProvenanceErrorCode(value: unknown): value is ProvenanceErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(PROVENANCE_ERROR_CODES).includes(value as ProvenanceErrorCode)
  );
}

export function categoryForProvenanceCode(code: ProvenanceErrorCode): ProvenanceErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ProvenanceErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a ProvenanceError. */
export interface ProvenanceErrorStruct {
  readonly code: ProvenanceErrorCode;
  readonly category: ProvenanceErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ProvenanceError extends Error {
  readonly code: ProvenanceErrorCode;
  readonly category: ProvenanceErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ProvenanceErrorCode, init: ProvenanceErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ProvenanceError';
    this.code = code;
    this.category = categoryForProvenanceCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isProvenanceError(value: unknown): value is ProvenanceError {
  return value instanceof ProvenanceError;
}

export function toProvenanceErrorStruct(error: ProvenanceError): ProvenanceErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ProvenanceError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `ProvenanceError` with code
 * `PROVENANCE_UNKNOWN_ERROR`.
 */
export function fromProvenanceErrorStruct(value: unknown): ProvenanceError {
  const fail = (reason: string): never => {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured provenance error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isProvenanceErrorCode(code)) {
    return fail(`unknown or missing provenance error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForProvenanceCode(code)) {
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

  return new ProvenanceError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a ProvenanceError. */
export function normalizeToProvenanceError(error: unknown): ProvenanceError {
  if (isProvenanceError(error)) return error;
  if (error instanceof Error) {
    return new ProvenanceError(PROVENANCE_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ProvenanceError(PROVENANCE_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
