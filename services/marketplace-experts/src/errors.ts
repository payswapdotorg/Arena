/**
 * Expert-marketplace error taxonomy (Work Order A031).
 *
 * @arena/marketplace-experts-fabric owns its own closed error code set,
 * mirroring the sibling services' typed errors (@arena/expert-
 * qualification's ExpertQualificationError pattern — closed codes, core
 * category mapping, structured wire-safe form). The taxonomy covers
 * validation of commercial records, gate failures (qualification /
 * certification / release evidence), integrity (tamper, digest),
 * versioning, tenancy and idempotency conflicts.
 *
 * COMMERCIAL LISTING IS DATA, NEVER AUTHORIZATION (architecture-lock
 * rule 9, R46): no error code, message or structured detail in this
 * taxonomy grants, implies or records an authority claim, a professional
 * license or an entitlement; the vocabulary is about validation,
 * integrity, tenancy and versioning of commercial DATA only.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const MARKETPLACE_EXPERTS_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'tenancy',
  'unknown',
] as const);

export type MarketplaceExpertsErrorCategory =
  (typeof MARKETPLACE_EXPERTS_ERROR_CATEGORIES)[number];

export const MARKETPLACE_EXPERTS_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'MARKETPLACE_EXPERTS_INVALID_IDENTITY',
  INVALID_DIGEST: 'MARKETPLACE_EXPERTS_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'MARKETPLACE_EXPERTS_INVALID_TIMESTAMP',
  INVALID_TEXT: 'MARKETPLACE_EXPERTS_INVALID_TEXT',
  INVALID_LISTING: 'MARKETPLACE_EXPERTS_INVALID_LISTING',
  INVALID_OFFER: 'MARKETPLACE_EXPERTS_INVALID_OFFER',
  INVALID_ENGAGEMENT: 'MARKETPLACE_EXPERTS_INVALID_ENGAGEMENT',
  INVALID_REVIEW: 'MARKETPLACE_EXPERTS_INVALID_REVIEW',
  INVALID_QUERY: 'MARKETPLACE_EXPERTS_INVALID_QUERY',
  INVALID_TERMS: 'MARKETPLACE_EXPERTS_INVALID_TERMS',
  INVALID_REF: 'MARKETPLACE_EXPERTS_INVALID_REF',
  MISSING_EVIDENCE: 'MARKETPLACE_EXPERTS_MISSING_EVIDENCE',
  NOT_FOUND: 'MARKETPLACE_EXPERTS_NOT_FOUND',
  TENANT_VIOLATION: 'MARKETPLACE_EXPERTS_TENANT_VIOLATION',
  IDENTITY_CONFLICT: 'MARKETPLACE_EXPERTS_IDENTITY_CONFLICT',
  SUPERSESSION_CONFLICT: 'MARKETPLACE_EXPERTS_SUPERSESSION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'MARKETPLACE_EXPERTS_IDEMPOTENCY_CONFLICT',
  GATE_FAILURE: 'MARKETPLACE_EXPERTS_GATE_FAILURE',
  LIFECYCLE_VIOLATION: 'MARKETPLACE_EXPERTS_LIFECYCLE_VIOLATION',
  TAMPERED: 'MARKETPLACE_EXPERTS_TAMPERED',
  VERSION_CONFLICT: 'MARKETPLACE_EXPERTS_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'MARKETPLACE_EXPERTS_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'MARKETPLACE_EXPERTS_UNKNOWN_ERROR',
} as const);

export type MarketplaceExpertsErrorCode =
  (typeof MARKETPLACE_EXPERTS_ERROR_CODES)[keyof typeof MARKETPLACE_EXPERTS_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<MarketplaceExpertsErrorCode, MarketplaceExpertsErrorCategory>
> = {
  MARKETPLACE_EXPERTS_INVALID_IDENTITY: 'validation',
  MARKETPLACE_EXPERTS_INVALID_DIGEST: 'validation',
  MARKETPLACE_EXPERTS_INVALID_TIMESTAMP: 'validation',
  MARKETPLACE_EXPERTS_INVALID_TEXT: 'validation',
  MARKETPLACE_EXPERTS_INVALID_LISTING: 'validation',
  MARKETPLACE_EXPERTS_INVALID_OFFER: 'validation',
  MARKETPLACE_EXPERTS_INVALID_ENGAGEMENT: 'validation',
  MARKETPLACE_EXPERTS_INVALID_REVIEW: 'validation',
  MARKETPLACE_EXPERTS_INVALID_QUERY: 'validation',
  MARKETPLACE_EXPERTS_INVALID_TERMS: 'validation',
  MARKETPLACE_EXPERTS_INVALID_REF: 'validation',
  MARKETPLACE_EXPERTS_MISSING_EVIDENCE: 'validation',
  MARKETPLACE_EXPERTS_NOT_FOUND: 'validation',
  MARKETPLACE_EXPERTS_TENANT_VIOLATION: 'tenancy',
  MARKETPLACE_EXPERTS_IDENTITY_CONFLICT: 'integrity',
  MARKETPLACE_EXPERTS_SUPERSESSION_CONFLICT: 'integrity',
  MARKETPLACE_EXPERTS_IDEMPOTENCY_CONFLICT: 'integrity',
  MARKETPLACE_EXPERTS_GATE_FAILURE: 'validation',
  MARKETPLACE_EXPERTS_LIFECYCLE_VIOLATION: 'validation',
  MARKETPLACE_EXPERTS_TAMPERED: 'integrity',
  MARKETPLACE_EXPERTS_VERSION_CONFLICT: 'versioning',
  MARKETPLACE_EXPERTS_UNSUPPORTED_RECORD_VERSION: 'versioning',
  MARKETPLACE_EXPERTS_UNKNOWN_ERROR: 'unknown',
};

export function categoryForMarketplaceExpertsCode(
  code: MarketplaceExpertsErrorCode,
): MarketplaceExpertsErrorCategory {
  return CODE_CATEGORY[code];
}

export interface MarketplaceExpertsErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a MarketplaceExpertsError. */
export interface MarketplaceExpertsErrorStruct {
  readonly code: MarketplaceExpertsErrorCode;
  readonly category: MarketplaceExpertsErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class MarketplaceExpertsError extends Error {
  readonly code: MarketplaceExpertsErrorCode;
  readonly category: MarketplaceExpertsErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: MarketplaceExpertsErrorCode, init: MarketplaceExpertsErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'MarketplaceExpertsError';
    this.code = code;
    this.category = categoryForMarketplaceExpertsCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isMarketplaceExpertsError(value: unknown): value is MarketplaceExpertsError {
  return value instanceof MarketplaceExpertsError;
}

export function toMarketplaceExpertsErrorStruct(
  error: MarketplaceExpertsError,
): MarketplaceExpertsErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

const KNOWN_CODES: readonly string[] = Object.values(MARKETPLACE_EXPERTS_ERROR_CODES);

export function isMarketplaceExpertsErrorCode(value: unknown): value is MarketplaceExpertsErrorCode {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value);
}

/**
 * Parse a structured MarketplaceExpertsError. Any malformed input —
 * non-object, missing or unknown code, category/code mismatch, missing
 * message, invalid optional fields — throws `MarketplaceExpertsError`
 * with code `MARKETPLACE_EXPERTS_UNKNOWN_ERROR`.
 */
export function fromMarketplaceExpertsErrorStruct(value: unknown): MarketplaceExpertsError {
  const fail = (reason: string): never => {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured expert-marketplace error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isMarketplaceExpertsErrorCode(code)) {
    return fail(`unknown or missing expert-marketplace error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForMarketplaceExpertsCode(code)) {
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

  return new MarketplaceExpertsError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}
