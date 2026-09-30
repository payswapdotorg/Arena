/**
 * Body-registry error taxonomy (Work Order A024; the RELEASE stage of the
 * Arena loop — README "Completion target": … Certification → Release →
 * Epoch consumption; requirements R23/R24 publication lineage).
 *
 * @arena/body-registry owns its own closed error code set, mirroring the
 * pattern of @arena/body-forge's BodyForgeError and @arena/certification's
 * CertificationError (closed codes, core category mapping, structured
 * wire-safe form, strictly validating parser — unknown codes are REJECTED
 * at parse time). The core taxonomy is frozen inside @arena/protocol-core
 * (A001 surface, read-only for this package), so body-registry-domain
 * failures carry BODY_REGISTRY_* codes here while core-level failures
 * (canonicalization, envelope shape, correlation ids, schema refs) still
 * propagate the original ProtocolError.
 *
 * Failures raised by the REAL sibling-protocol guards the gate projects
 * through (@arena/certification, @arena/compatibility, @arena/agent-body,
 * @arena/body-forge) propagate as their own typed errors where the guard
 * itself throws; gate ADMISSION refusals are structured
 * ReleaseGateRejection values (gate.ts), and only true domain failures
 * (malformed candidates, ledger conflicts, tamper detection) raise
 * BodyRegistryError here.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const BODY_REGISTRY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type BodyRegistryErrorCategory = (typeof BODY_REGISTRY_ERROR_CATEGORIES)[number];

export const BODY_REGISTRY_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'BODY_REGISTRY_INVALID_IDENTITY',
  INVALID_DIGEST: 'BODY_REGISTRY_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'BODY_REGISTRY_INVALID_TIMESTAMP',
  INVALID_REF: 'BODY_REGISTRY_INVALID_REF',
  INVALID_CITATION: 'BODY_REGISTRY_INVALID_CITATION',
  INVALID_CHANNEL: 'BODY_REGISTRY_INVALID_CHANNEL',
  INVALID_TAG: 'BODY_REGISTRY_INVALID_TAG',
  INVALID_GATE: 'BODY_REGISTRY_INVALID_GATE',
  INVALID_RECORD: 'BODY_REGISTRY_INVALID_RECORD',
  INVALID_PROVENANCE: 'BODY_REGISTRY_INVALID_PROVENANCE',
  INVALID_PUBLICATION: 'BODY_REGISTRY_INVALID_PUBLICATION',
  INVALID_RIGHTS: 'BODY_REGISTRY_INVALID_RIGHTS',
  INVALID_SCHEMA_REF: 'BODY_REGISTRY_INVALID_SCHEMA_REF',
  REQUIREMENT_VIOLATION: 'BODY_REGISTRY_REQUIREMENT_VIOLATION',
  CERTIFICATION_GATE_FAILED: 'BODY_REGISTRY_CERTIFICATION_GATE_FAILED',
  COMPATIBILITY_GATE_FAILED: 'BODY_REGISTRY_COMPATIBILITY_GATE_FAILED',
  FORGE_LINEAGE_REJECTED: 'BODY_REGISTRY_FORGE_LINEAGE_REJECTED',
  EVIDENCE_UNRESOLVABLE: 'BODY_REGISTRY_EVIDENCE_UNRESOLVABLE',
  REGISTRATION_REJECTED: 'BODY_REGISTRY_REGISTRATION_REJECTED',
  CONFLICT: 'BODY_REGISTRY_CONFLICT',
  LINEAGE_VIOLATION: 'BODY_REGISTRY_LINEAGE_VIOLATION',
  NOT_FOUND: 'BODY_REGISTRY_NOT_FOUND',
  IDENTITY_CONFLICT: 'BODY_REGISTRY_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'BODY_REGISTRY_IDEMPOTENCY_CONFLICT',
  PUBLICATION_CONFLICT: 'BODY_REGISTRY_PUBLICATION_CONFLICT',
  TAMPERED: 'BODY_REGISTRY_TAMPERED',
  VERSION_CONFLICT: 'BODY_REGISTRY_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'BODY_REGISTRY_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'BODY_REGISTRY_UNKNOWN_ERROR',
} as const);

export type BodyRegistryErrorCode = (typeof BODY_REGISTRY_ERROR_CODES)[keyof typeof BODY_REGISTRY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<BodyRegistryErrorCode, BodyRegistryErrorCategory>> = {
  BODY_REGISTRY_INVALID_IDENTITY: 'validation',
  BODY_REGISTRY_INVALID_DIGEST: 'validation',
  BODY_REGISTRY_INVALID_TIMESTAMP: 'validation',
  BODY_REGISTRY_INVALID_REF: 'validation',
  BODY_REGISTRY_INVALID_CITATION: 'validation',
  BODY_REGISTRY_INVALID_CHANNEL: 'validation',
  BODY_REGISTRY_INVALID_TAG: 'validation',
  BODY_REGISTRY_INVALID_GATE: 'validation',
  BODY_REGISTRY_INVALID_RECORD: 'validation',
  BODY_REGISTRY_INVALID_PROVENANCE: 'validation',
  BODY_REGISTRY_INVALID_PUBLICATION: 'validation',
  BODY_REGISTRY_INVALID_RIGHTS: 'validation',
  BODY_REGISTRY_INVALID_SCHEMA_REF: 'validation',
  BODY_REGISTRY_REQUIREMENT_VIOLATION: 'validation',
  BODY_REGISTRY_CERTIFICATION_GATE_FAILED: 'integrity',
  BODY_REGISTRY_COMPATIBILITY_GATE_FAILED: 'integrity',
  BODY_REGISTRY_FORGE_LINEAGE_REJECTED: 'integrity',
  BODY_REGISTRY_EVIDENCE_UNRESOLVABLE: 'integrity',
  BODY_REGISTRY_REGISTRATION_REJECTED: 'integrity',
  BODY_REGISTRY_CONFLICT: 'integrity',
  BODY_REGISTRY_LINEAGE_VIOLATION: 'integrity',
  BODY_REGISTRY_NOT_FOUND: 'validation',
  BODY_REGISTRY_IDENTITY_CONFLICT: 'integrity',
  BODY_REGISTRY_IDEMPOTENCY_CONFLICT: 'integrity',
  BODY_REGISTRY_PUBLICATION_CONFLICT: 'integrity',
  BODY_REGISTRY_TAMPERED: 'integrity',
  BODY_REGISTRY_VERSION_CONFLICT: 'integrity',
  BODY_REGISTRY_UNSUPPORTED_RECORD_VERSION: 'versioning',
  BODY_REGISTRY_UNKNOWN_ERROR: 'unknown',
};

export function isBodyRegistryErrorCode(value: unknown): value is BodyRegistryErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(BODY_REGISTRY_ERROR_CODES).includes(value as BodyRegistryErrorCode)
  );
}

export function categoryForBodyRegistryCode(code: BodyRegistryErrorCode): BodyRegistryErrorCategory {
  return CODE_CATEGORY[code];
}

export interface BodyRegistryErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a BodyRegistryError. */
export interface BodyRegistryErrorStruct {
  readonly code: BodyRegistryErrorCode;
  readonly category: BodyRegistryErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class BodyRegistryError extends Error {
  readonly code: BodyRegistryErrorCode;
  readonly category: BodyRegistryErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: BodyRegistryErrorCode, init: BodyRegistryErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'BodyRegistryError';
    this.code = code;
    this.category = categoryForBodyRegistryCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isBodyRegistryError(value: unknown): value is BodyRegistryError {
  return value instanceof BodyRegistryError;
}

export function toBodyRegistryErrorStruct(error: BodyRegistryError): BodyRegistryErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured BodyRegistryError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `BodyRegistryError` with code
 * `BODY_REGISTRY_UNKNOWN_ERROR`.
 */
export function fromBodyRegistryErrorStruct(value: unknown): BodyRegistryError {
  const fail = (reason: string): never => {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured body-registry error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isBodyRegistryErrorCode(code)) {
    return fail(`unknown or missing body-registry error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForBodyRegistryCode(code)) {
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

  return new BodyRegistryError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a BodyRegistryError. */
export function normalizeToBodyRegistryError(error: unknown): BodyRegistryError {
  if (isBodyRegistryError(error)) return error;
  if (error instanceof Error) {
    return new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
