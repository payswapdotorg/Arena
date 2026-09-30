/**
 * Security protocol error taxonomy (Work Order A034; spec/security.md
 * S1.0).
 *
 * @arena/security owns its own closed error code set, mirroring the
 * pattern of the sibling domain packages' typed errors
 * (@arena/job-protocol's JobError, @arena/certification's
 * CertificationError — closed codes, core category mapping, structured
 * wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). Core-level failures (canonicalization,
 * envelope shape, correlation ids, schema refs) propagate the original
 * @arena/protocol-core ProtocolError; security-domain failures carry
 * SECURITY_* codes.
 *
 * The category set adds an `authorization` category: every allow/deny
 * decision failure and every tenancy boundary violation is classified
 * here, so callers can never confuse "the engine said no" (a typed,
 * auditable decision) with "the engine could not decide" (a fail-closed
 * error).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const SECURITY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'authorization',
  'tenancy',
  'integrity',
  'versioning',
  'unknown',
] as const);

export type SecurityErrorCategory = (typeof SECURITY_ERROR_CATEGORIES)[number];

export const SECURITY_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'SECURITY_INVALID_IDENTITY',
  INVALID_TENANT: 'SECURITY_INVALID_TENANT',
  INVALID_TIMESTAMP: 'SECURITY_INVALID_TIMESTAMP',
  INVALID_PRINCIPAL: 'SECURITY_INVALID_PRINCIPAL',
  INVALID_ROLE: 'SECURITY_INVALID_ROLE',
  INVALID_ACTION: 'SECURITY_INVALID_ACTION',
  INVALID_BOUNDARY_CLASS: 'SECURITY_INVALID_BOUNDARY_CLASS',
  INVALID_RESOURCE: 'SECURITY_INVALID_RESOURCE',
  INVALID_POLICY: 'SECURITY_INVALID_POLICY',
  INVALID_DECISION: 'SECURITY_INVALID_DECISION',
  INVALID_DATA_RIGHTS: 'SECURITY_INVALID_DATA_RIGHTS',
  INVALID_PERMITTED_USE: 'SECURITY_INVALID_PERMITTED_USE',
  INVALID_RETENTION: 'SECURITY_INVALID_RETENTION',
  INVALID_PUBLICATION: 'SECURITY_INVALID_PUBLICATION',
  INVALID_GRANT: 'SECURITY_INVALID_GRANT',
  INVALID_EXPERT_RIGHTS: 'SECURITY_INVALID_EXPERT_RIGHTS',
  INVALID_MODEL_DATA_POLICY: 'SECURITY_INVALID_MODEL_DATA_POLICY',
  INVALID_AUDIT_EVENT: 'SECURITY_INVALID_AUDIT_EVENT',
  INVALID_SCHEMA_REF: 'SECURITY_INVALID_SCHEMA_REF',
  TENANT_MISMATCH: 'SECURITY_TENANT_MISMATCH',
  UNAUTHENTICATED: 'SECURITY_UNAUTHENTICATED',
  FORBIDDEN: 'SECURITY_FORBIDDEN',
  RETENTION_EXPIRED: 'SECURITY_RETENTION_EXPIRED',
  PUBLICATION_FORBIDDEN: 'SECURITY_PUBLICATION_FORBIDDEN',
  DATA_RIGHTS_FORBIDDEN: 'SECURITY_DATA_RIGHTS_FORBIDDEN',
  GRANT_MISSING: 'SECURITY_GRANT_MISSING',
  GRANT_EXPIRED: 'SECURITY_GRANT_EXPIRED',
  GRANT_REVOKED: 'SECURITY_GRANT_REVOKED',
  SECRET_DETECTED: 'SECURITY_SECRET_DETECTED',
  AUDIT_CHAIN_BROKEN: 'SECURITY_AUDIT_CHAIN_BROKEN',
  AUDIT_SEQUENCE_CONFLICT: 'SECURITY_AUDIT_SEQUENCE_CONFLICT',
  AUDIT_REPLAY: 'SECURITY_AUDIT_REPLAY',
  IDENTITY_CONFLICT: 'SECURITY_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'SECURITY_IDEMPOTENCY_CONFLICT',
  NOT_FOUND: 'SECURITY_NOT_FOUND',
  TAMPERED: 'SECURITY_TAMPERED',
  UNSUPPORTED_RECORD_VERSION: 'SECURITY_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'SECURITY_UNKNOWN_ERROR',
} as const);

export type SecurityErrorCode = (typeof SECURITY_ERROR_CODES)[keyof typeof SECURITY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<SecurityErrorCode, SecurityErrorCategory>> = {
  SECURITY_INVALID_IDENTITY: 'validation',
  SECURITY_INVALID_TENANT: 'validation',
  SECURITY_INVALID_TIMESTAMP: 'validation',
  SECURITY_INVALID_PRINCIPAL: 'validation',
  SECURITY_INVALID_ROLE: 'validation',
  SECURITY_INVALID_ACTION: 'validation',
  SECURITY_INVALID_BOUNDARY_CLASS: 'validation',
  SECURITY_INVALID_RESOURCE: 'validation',
  SECURITY_INVALID_POLICY: 'validation',
  SECURITY_INVALID_DECISION: 'validation',
  SECURITY_INVALID_DATA_RIGHTS: 'validation',
  SECURITY_INVALID_PERMITTED_USE: 'validation',
  SECURITY_INVALID_RETENTION: 'validation',
  SECURITY_INVALID_PUBLICATION: 'validation',
  SECURITY_INVALID_GRANT: 'validation',
  SECURITY_INVALID_EXPERT_RIGHTS: 'validation',
  SECURITY_INVALID_MODEL_DATA_POLICY: 'validation',
  SECURITY_INVALID_AUDIT_EVENT: 'validation',
  SECURITY_INVALID_SCHEMA_REF: 'validation',
  SECURITY_TENANT_MISMATCH: 'tenancy',
  SECURITY_UNAUTHENTICATED: 'authorization',
  SECURITY_FORBIDDEN: 'authorization',
  SECURITY_RETENTION_EXPIRED: 'authorization',
  SECURITY_PUBLICATION_FORBIDDEN: 'authorization',
  SECURITY_DATA_RIGHTS_FORBIDDEN: 'authorization',
  SECURITY_GRANT_MISSING: 'authorization',
  SECURITY_GRANT_EXPIRED: 'authorization',
  SECURITY_GRANT_REVOKED: 'authorization',
  SECURITY_SECRET_DETECTED: 'authorization',
  SECURITY_AUDIT_CHAIN_BROKEN: 'integrity',
  SECURITY_AUDIT_SEQUENCE_CONFLICT: 'integrity',
  SECURITY_AUDIT_REPLAY: 'integrity',
  SECURITY_IDENTITY_CONFLICT: 'integrity',
  SECURITY_IDEMPOTENCY_CONFLICT: 'integrity',
  SECURITY_NOT_FOUND: 'validation',
  SECURITY_TAMPERED: 'integrity',
  SECURITY_UNSUPPORTED_RECORD_VERSION: 'versioning',
  SECURITY_UNKNOWN_ERROR: 'unknown',
};

/** Wire-safe structured error details. */
export interface SecurityErrorDetails {
  readonly message: string;
  readonly field?: string;
  readonly code?: string;
  readonly pattern?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

/**
 * Typed security-domain error. `category` is derived (closed map); the
 * code set is closed and validated on parse. Never carries a stack trace
 * on the wire (see toWireSafeSecurityError).
 */
export class SecurityError extends Error {
  readonly code: SecurityErrorCode;
  readonly category: SecurityErrorCategory;
  readonly details: SecurityErrorDetails;

  constructor(code: SecurityErrorCode, details: SecurityErrorDetails) {
    super(details.message);
    this.name = 'SecurityError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = details;
  }
}

/** Structured, wire-safe form (no stack, no prototype noise). */
export interface WireSafeSecurityError {
  readonly name: 'SecurityError';
  readonly code: SecurityErrorCode;
  readonly category: SecurityErrorCategory;
  readonly message: string;
  readonly details: SecurityErrorDetails;
}

export function toWireSafeSecurityError(error: SecurityError): WireSafeSecurityError {
  return Object.freeze({
    name: 'SecurityError',
    code: error.code,
    category: error.category,
    message: error.details.message,
    details: error.details,
  });
}

/** Structural (non-throwing) check for the wire-safe form. */
export function isWireSafeSecurityError(value: unknown): value is WireSafeSecurityError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['name'] !== 'SecurityError') return false;
  if (
    typeof candidate['code'] !== 'string' ||
    !(Object.values(SECURITY_ERROR_CODES) as readonly string[]).includes(candidate['code'])
  ) {
    return false;
  }
  if (typeof candidate['category'] !== 'string') return false;
  if (!(candidate['category'] in Object.fromEntries(
    SECURITY_ERROR_CATEGORIES.map((category) => [category, category]),
  ))) return false;
  if (typeof candidate['message'] !== 'string') return false;
  const details = candidate['details'];
  if (typeof details !== 'object' || details === null) return false;
  const detailRecord = details as Record<string, unknown>;
  if (typeof detailRecord['message'] !== 'string') return false;
  if (detailRecord['correlationId'] !== undefined && !isCorrelationId(detailRecord['correlationId'])) {
    return false;
  }
  return true;
}

/**
 * Strictly validating parser for the wire-safe form — unknown codes and
 * mismatched categories are REJECTED (fail-closed), mirroring the
 * sibling error parsers.
 */
export function parseWireSafeSecurityError(value: unknown): WireSafeSecurityError {
  if (!isWireSafeSecurityError(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: 'value is not a wire-safe SecurityError',
      details: { received: JSON.stringify(value) },
    });
  }
  const code = value.code as SecurityErrorCode;
  if (CODE_CATEGORY[code] !== value.category) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `security error category mismatch for ${String(code)}: ${String(value.category)}`,
      details: { expected: CODE_CATEGORY[code] },
    });
  }
  return value;
}

/**
 * Normalize any thrown value into a typed SecurityError. Unknown values
 * become SECURITY_UNKNOWN_ERROR — fail-closed: callers NEVER have to
 * handle a bare Error from this package's surface.
 */
export function normalizeToSecurityError(
  error: unknown,
  correlationId?: CorrelationId,
): SecurityError {
  if (error instanceof SecurityError) {
    if (correlationId !== undefined && error.details.correlationId === undefined) {
      return new SecurityError(error.code, {
        ...error.details,
        ...(correlationId !== undefined ? { correlationId } : {}),
      });
    }
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SecurityError(SECURITY_ERROR_CODES.UNKNOWN_ERROR, {
    message: `unexpected security failure: ${message}`,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(error instanceof Error && error.stack !== undefined
      ? { details: { stack: error.stack } }
      : {}),
  });
}

/** True iff the code is a member of the closed error code set. */
export function isSecurityErrorCode(value: unknown): value is SecurityErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(SECURITY_ERROR_CODES) as readonly string[]).includes(value)
  );
}
