/**
 * Expert-registry protocol error taxonomy (Work Order A006).
 *
 * @arena/expert-registry owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError and the sibling domain
 * packages' taxonomies (@arena/artifact-protocol's ArtifactError,
 * @arena/capability-case's CapabilityCaseError): closed codes, category
 * mapping, structured wire-safe form, strictly validating parser — unknown
 * codes are REJECTED at parse time. The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * expert-registry-domain failures carry EXPERT_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Two codes are load-bearing for architecture-lock rule 9:
 *   - EXPERT_AUTHORITY_FIELD_REJECTED — the separation-of-concerns screen
 *     (a profile field asserting system authority/roles/permissions is
 *     rejected; authorization is a separate future protocol);
 *   - EXPERT_PII_FIELD_REJECTED — the PII-minimization screen (identity is
 *     a neutral expert id plus declared identity refs; personal data has
 *     no field anywhere on the profile).
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const EXPERT_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'access',
  'unknown',
] as const;

export type ExpertErrorCategory = (typeof EXPERT_ERROR_CATEGORIES)[number];

export const EXPERT_ERROR_CODES = {
  INVALID_IDENTITY: 'EXPERT_INVALID_IDENTITY',
  INVALID_VERSION: 'EXPERT_INVALID_VERSION',
  INVALID_STATUS: 'EXPERT_INVALID_STATUS',
  INVALID_TRANSITION: 'EXPERT_INVALID_TRANSITION',
  TERMINAL_STATE: 'EXPERT_TERMINAL_STATE',
  INVALID_REF: 'EXPERT_INVALID_REF',
  INVALID_IDENTITY_REF: 'EXPERT_INVALID_IDENTITY_REF',
  INVALID_COMPETENCY: 'EXPERT_INVALID_COMPETENCY',
  INVALID_QUALIFICATION: 'EXPERT_INVALID_QUALIFICATION',
  INVALID_CREDENTIAL_REF: 'EXPERT_INVALID_CREDENTIAL_REF',
  INVALID_EVIDENCE: 'EXPERT_INVALID_EVIDENCE',
  DUPLICATE_EVIDENCE: 'EXPERT_DUPLICATE_EVIDENCE',
  EVIDENCE_REMOVAL: 'EXPERT_EVIDENCE_REMOVAL',
  INVALID_TASK_HISTORY: 'EXPERT_INVALID_TASK_HISTORY',
  TASK_HISTORY_REMOVAL: 'EXPERT_TASK_HISTORY_REMOVAL',
  INVALID_RELIABILITY: 'EXPERT_INVALID_RELIABILITY',
  RELIABILITY_MUTATION: 'EXPERT_RELIABILITY_MUTATION',
  INVALID_AVAILABILITY: 'EXPERT_INVALID_AVAILABILITY',
  INVALID_DOMAIN_SCOPE: 'EXPERT_INVALID_DOMAIN_SCOPE',
  INVALID_LIMITATION: 'EXPERT_INVALID_LIMITATION',
  INVALID_JURISDICTION: 'EXPERT_INVALID_JURISDICTION',
  INVALID_PRIVACY_POLICY: 'EXPERT_INVALID_PRIVACY_POLICY',
  INVALID_PUBLIC_VIEW: 'EXPERT_INVALID_PUBLIC_VIEW',
  INVALID_PROFILE: 'EXPERT_INVALID_PROFILE',
  INVALID_PRINCIPAL: 'EXPERT_INVALID_PRINCIPAL',
  INVALID_TIMESTAMP: 'EXPERT_INVALID_TIMESTAMP',
  INVALID_DIGEST: 'EXPERT_INVALID_DIGEST',
  INVALID_SUPERSESSION: 'EXPERT_INVALID_SUPERSESSION',
  INVALID_LIFECYCLE: 'EXPERT_INVALID_LIFECYCLE',
  INVALID_DOMAIN_PACK: 'EXPERT_INVALID_DOMAIN_PACK',
  UNKNOWN_DOMAIN_COMPETENCY_TYPE: 'EXPERT_UNKNOWN_DOMAIN_COMPETENCY_TYPE',
  INVALID_DOMAIN_METADATA: 'EXPERT_INVALID_DOMAIN_METADATA',
  AUTHORITY_FIELD_REJECTED: 'EXPERT_AUTHORITY_FIELD_REJECTED',
  PII_FIELD_REJECTED: 'EXPERT_PII_FIELD_REJECTED',
  EXPERT_NOT_FOUND: 'EXPERT_EXPERT_NOT_FOUND',
  CROSS_TENANT_ACCESS: 'EXPERT_CROSS_TENANT_ACCESS',
  TAMPERED: 'EXPERT_TAMPERED',
  IDENTITY_CONFLICT: 'EXPERT_IDENTITY_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'EXPERT_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'EXPERT_UNKNOWN_ERROR',
} as const;

export type ExpertErrorCode = (typeof EXPERT_ERROR_CODES)[keyof typeof EXPERT_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertErrorCode, ExpertErrorCategory>> = {
  EXPERT_INVALID_IDENTITY: 'validation',
  EXPERT_INVALID_VERSION: 'validation',
  EXPERT_INVALID_STATUS: 'validation',
  EXPERT_INVALID_TRANSITION: 'validation',
  EXPERT_TERMINAL_STATE: 'validation',
  EXPERT_INVALID_REF: 'validation',
  EXPERT_INVALID_IDENTITY_REF: 'validation',
  EXPERT_INVALID_COMPETENCY: 'validation',
  EXPERT_INVALID_QUALIFICATION: 'validation',
  EXPERT_INVALID_CREDENTIAL_REF: 'validation',
  EXPERT_INVALID_EVIDENCE: 'validation',
  EXPERT_DUPLICATE_EVIDENCE: 'validation',
  EXPERT_EVIDENCE_REMOVAL: 'integrity',
  EXPERT_INVALID_TASK_HISTORY: 'validation',
  EXPERT_TASK_HISTORY_REMOVAL: 'integrity',
  EXPERT_INVALID_RELIABILITY: 'validation',
  EXPERT_RELIABILITY_MUTATION: 'integrity',
  EXPERT_INVALID_AVAILABILITY: 'validation',
  EXPERT_INVALID_DOMAIN_SCOPE: 'validation',
  EXPERT_INVALID_LIMITATION: 'validation',
  EXPERT_INVALID_JURISDICTION: 'validation',
  EXPERT_INVALID_PRIVACY_POLICY: 'validation',
  EXPERT_INVALID_PUBLIC_VIEW: 'validation',
  EXPERT_INVALID_PROFILE: 'validation',
  EXPERT_INVALID_PRINCIPAL: 'validation',
  EXPERT_INVALID_TIMESTAMP: 'validation',
  EXPERT_INVALID_DIGEST: 'validation',
  EXPERT_INVALID_SUPERSESSION: 'validation',
  EXPERT_INVALID_LIFECYCLE: 'validation',
  EXPERT_INVALID_DOMAIN_PACK: 'validation',
  EXPERT_UNKNOWN_DOMAIN_COMPETENCY_TYPE: 'validation',
  EXPERT_INVALID_DOMAIN_METADATA: 'validation',
  // Lock rule 9 and PII minimization are separation/access concerns: the
  // profile structurally may not carry the data those screens reject.
  EXPERT_AUTHORITY_FIELD_REJECTED: 'access',
  EXPERT_PII_FIELD_REJECTED: 'access',
  EXPERT_EXPERT_NOT_FOUND: 'integrity',
  EXPERT_CROSS_TENANT_ACCESS: 'access',
  EXPERT_TAMPERED: 'integrity',
  EXPERT_IDENTITY_CONFLICT: 'integrity',
  EXPERT_UNSUPPORTED_RECORD_VERSION: 'versioning',
  EXPERT_UNKNOWN_ERROR: 'unknown',
};

export function isExpertErrorCode(value: unknown): value is ExpertErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EXPERT_ERROR_CODES).includes(value as ExpertErrorCode)
  );
}

export function categoryForExpertCode(code: ExpertErrorCode): ExpertErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ExpertErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ExpertRegistryError. */
export interface ExpertErrorStruct {
  readonly code: ExpertErrorCode;
  readonly category: ExpertErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ExpertRegistryError extends Error {
  readonly code: ExpertErrorCode;
  readonly category: ExpertErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ExpertErrorCode, init: ExpertErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ExpertRegistryError';
    this.code = code;
    this.category = categoryForExpertCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isExpertRegistryError(value: unknown): value is ExpertRegistryError {
  return value instanceof ExpertRegistryError;
}

export function toExpertErrorStruct(error: ExpertRegistryError): ExpertErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ExpertRegistryError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `ExpertRegistryError` with code
 * `EXPERT_UNKNOWN_ERROR`.
 */
export function fromExpertErrorStruct(value: unknown): ExpertRegistryError {
  const fail = (reason: string): never => {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured expert-registry error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isExpertErrorCode(code)) {
    return fail(`unknown or missing expert-registry error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForExpertCode(code)) {
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

  return new ExpertRegistryError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an ExpertRegistryError. */
export function normalizeToExpertRegistryError(error: unknown): ExpertRegistryError {
  if (isExpertRegistryError(error)) return error;
  if (error instanceof Error) {
    return new ExpertRegistryError(EXPERT_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ExpertRegistryError(EXPERT_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
