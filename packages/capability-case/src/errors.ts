/**
 * Capability-case protocol error taxonomy (Work Order A005).
 *
 * @arena/capability-case owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError and the sibling domain
 * packages' taxonomies (@arena/artifact-protocol's ArtifactError,
 * @arena/capability-graph's CapabilityGraphError): closed codes, category
 * mapping, structured wire-safe form, strictly validating parser — unknown
 * codes are REJECTED at parse time. The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * capability-case-domain failures carry CAPABILITY_CASE_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const CAPABILITY_CASE_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'access',
  'unknown',
] as const;

export type CapabilityCaseErrorCategory =
  (typeof CAPABILITY_CASE_ERROR_CATEGORIES)[number];

export const CAPABILITY_CASE_ERROR_CODES = {
  INVALID_IDENTITY: 'CAPABILITY_CASE_INVALID_IDENTITY',
  INVALID_VERSION: 'CAPABILITY_CASE_INVALID_VERSION',
  INVALID_STATUS: 'CAPABILITY_CASE_INVALID_STATUS',
  INVALID_TRANSITION: 'CAPABILITY_CASE_INVALID_TRANSITION',
  TERMINAL_STATE: 'CAPABILITY_CASE_TERMINAL_STATE',
  INVALID_REF: 'CAPABILITY_CASE_INVALID_REF',
  INVALID_EVIDENCE: 'CAPABILITY_CASE_INVALID_EVIDENCE',
  DUPLICATE_EVIDENCE: 'CAPABILITY_CASE_DUPLICATE_EVIDENCE',
  EVIDENCE_REMOVAL: 'CAPABILITY_CASE_EVIDENCE_REMOVAL',
  INVALID_CASE: 'CAPABILITY_CASE_INVALID_CASE',
  INVALID_REQUIREMENTS: 'CAPABILITY_CASE_INVALID_REQUIREMENTS',
  INVALID_PRINCIPAL: 'CAPABILITY_CASE_INVALID_PRINCIPAL',
  INVALID_TIMESTAMP: 'CAPABILITY_CASE_INVALID_TIMESTAMP',
  INVALID_DIGEST: 'CAPABILITY_CASE_INVALID_DIGEST',
  INVALID_SUPERSESSION: 'CAPABILITY_CASE_INVALID_SUPERSESSION',
  INVALID_LIFECYCLE: 'CAPABILITY_CASE_INVALID_LIFECYCLE',
  INVALID_COMPILATION_TARGET: 'CAPABILITY_CASE_INVALID_COMPILATION_TARGET',
  CASE_NOT_FOUND: 'CAPABILITY_CASE_CASE_NOT_FOUND',
  CROSS_TENANT_ACCESS: 'CAPABILITY_CASE_CROSS_TENANT_ACCESS',
  TAMPERED: 'CAPABILITY_CASE_TAMPERED',
  IDENTITY_CONFLICT: 'CAPABILITY_CASE_IDENTITY_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'CAPABILITY_CASE_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'CAPABILITY_CASE_UNKNOWN_ERROR',
} as const;

export type CapabilityCaseErrorCode =
  (typeof CAPABILITY_CASE_ERROR_CODES)[keyof typeof CAPABILITY_CASE_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityCaseErrorCode, CapabilityCaseErrorCategory>
> = {
  CAPABILITY_CASE_INVALID_IDENTITY: 'validation',
  CAPABILITY_CASE_INVALID_VERSION: 'validation',
  CAPABILITY_CASE_INVALID_STATUS: 'validation',
  CAPABILITY_CASE_INVALID_TRANSITION: 'validation',
  CAPABILITY_CASE_TERMINAL_STATE: 'validation',
  CAPABILITY_CASE_INVALID_REF: 'validation',
  CAPABILITY_CASE_INVALID_EVIDENCE: 'validation',
  CAPABILITY_CASE_DUPLICATE_EVIDENCE: 'validation',
  CAPABILITY_CASE_EVIDENCE_REMOVAL: 'integrity',
  CAPABILITY_CASE_INVALID_CASE: 'validation',
  CAPABILITY_CASE_INVALID_REQUIREMENTS: 'validation',
  CAPABILITY_CASE_INVALID_PRINCIPAL: 'validation',
  CAPABILITY_CASE_INVALID_TIMESTAMP: 'validation',
  CAPABILITY_CASE_INVALID_DIGEST: 'validation',
  CAPABILITY_CASE_INVALID_SUPERSESSION: 'validation',
  CAPABILITY_CASE_INVALID_LIFECYCLE: 'validation',
  CAPABILITY_CASE_INVALID_COMPILATION_TARGET: 'validation',
  CAPABILITY_CASE_CASE_NOT_FOUND: 'integrity',
  CAPABILITY_CASE_CROSS_TENANT_ACCESS: 'access',
  CAPABILITY_CASE_TAMPERED: 'integrity',
  CAPABILITY_CASE_IDENTITY_CONFLICT: 'integrity',
  CAPABILITY_CASE_UNSUPPORTED_RECORD_VERSION: 'versioning',
  CAPABILITY_CASE_UNKNOWN_ERROR: 'unknown',
};

export function isCapabilityCaseErrorCode(
  value: unknown,
): value is CapabilityCaseErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CAPABILITY_CASE_ERROR_CODES).includes(
      value as CapabilityCaseErrorCode,
    )
  );
}

export function categoryForCapabilityCaseCode(
  code: CapabilityCaseErrorCode,
): CapabilityCaseErrorCategory {
  return CODE_CATEGORY[code];
}

export interface CapabilityCaseErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a CapabilityCaseError. */
export interface CapabilityCaseErrorStruct {
  readonly code: CapabilityCaseErrorCode;
  readonly category: CapabilityCaseErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class CapabilityCaseError extends Error {
  readonly code: CapabilityCaseErrorCode;
  readonly category: CapabilityCaseErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: CapabilityCaseErrorCode, init: CapabilityCaseErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'CapabilityCaseError';
    this.code = code;
    this.category = categoryForCapabilityCaseCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isCapabilityCaseError(value: unknown): value is CapabilityCaseError {
  return value instanceof CapabilityCaseError;
}

export function toCapabilityCaseErrorStruct(
  error: CapabilityCaseError,
): CapabilityCaseErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured CapabilityCaseError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `CapabilityCaseError` with code
 * `CAPABILITY_CASE_UNKNOWN_ERROR`.
 */
export function fromCapabilityCaseErrorStruct(value: unknown): CapabilityCaseError {
  const fail = (reason: string): never => {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured capability-case error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isCapabilityCaseErrorCode(code)) {
    return fail(`unknown or missing capability-case error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForCapabilityCaseCode(code)) {
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

  return new CapabilityCaseError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a CapabilityCaseError. */
export function normalizeToCapabilityCaseError(error: unknown): CapabilityCaseError {
  if (isCapabilityCaseError(error)) return error;
  if (error instanceof Error) {
    return new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
