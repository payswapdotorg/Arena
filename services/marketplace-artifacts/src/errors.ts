/**
 * Error taxonomy for @arena/marketplace-artifacts-fabric (Work Order
 * A032). House pattern: a frozen closed code map, a category map, a
 * structured wire-safe round trip and a total normalizer. Domain errors
 * (A002/A009-A014/A034 codes) propagate unchanged where they originate;
 * this taxonomy covers the marketplace service's OWN failure surface.
 */

export const MARKETPLACE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'tenancy',
  'authorization',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type MarketplaceErrorCategory = (typeof MARKETPLACE_ERROR_CATEGORIES)[number];

export const MARKETPLACE_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'MARKETPLACE_INVALID_RECORD',
  INVALID_OFFER: 'MARKETPLACE_INVALID_OFFER',
  INVALID_EVIDENCE: 'MARKETPLACE_INVALID_EVIDENCE',
  INVALID_QUERY: 'MARKETPLACE_INVALID_QUERY',
  INVALID_PARAMS: 'MARKETPLACE_INVALID_PARAMS',
  INVALID_SCOPE: 'MARKETPLACE_INVALID_SCOPE',
  INVALID_GRANT: 'MARKETPLACE_INVALID_GRANT',
  INVALID_REVIEW: 'MARKETPLACE_INVALID_REVIEW',
  INVALID_PRINCIPAL: 'MARKETPLACE_INVALID_PRINCIPAL',
  INVALID_RIGHTS: 'MARKETPLACE_INVALID_RIGHTS',
  TENANT_FORBIDDEN: 'MARKETPLACE_TENANT_FORBIDDEN',
  CROSS_TENANT_ACCESS: 'MARKETPLACE_CROSS_TENANT_ACCESS',
  REGISTRATION_REJECTED: 'MARKETPLACE_REGISTRATION_REJECTED',
  GRANT_FORBIDDEN: 'MARKETPLACE_GRANT_FORBIDDEN',
  GRANT_NOT_ACTIVE: 'MARKETPLACE_GRANT_NOT_ACTIVE',
  REVIEW_UNAUTHORIZED: 'MARKETPLACE_REVIEW_UNAUTHORIZED',
  NOT_FOUND: 'MARKETPLACE_NOT_FOUND',
  IDENTITY_CONFLICT: 'MARKETPLACE_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'MARKETPLACE_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'MARKETPLACE_TAMPERED',
  UNSUPPORTED_RECORD_VERSION: 'MARKETPLACE_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'MARKETPLACE_UNKNOWN_ERROR',
} as const);
export type MarketplaceErrorCode =
  (typeof MARKETPLACE_ERROR_CODES)[keyof typeof MARKETPLACE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<MarketplaceErrorCode, MarketplaceErrorCategory>> =
  Object.freeze({
    [MARKETPLACE_ERROR_CODES.INVALID_RECORD]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_OFFER]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_QUERY]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_PARAMS]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_SCOPE]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_GRANT]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_REVIEW]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_PRINCIPAL]: 'validation',
    [MARKETPLACE_ERROR_CODES.INVALID_RIGHTS]: 'validation',
    [MARKETPLACE_ERROR_CODES.TENANT_FORBIDDEN]: 'tenancy',
    [MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS]: 'tenancy',
    [MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED]: 'authorization',
    [MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN]: 'authorization',
    [MARKETPLACE_ERROR_CODES.GRANT_NOT_ACTIVE]: 'authorization',
    [MARKETPLACE_ERROR_CODES.REVIEW_UNAUTHORIZED]: 'authorization',
    [MARKETPLACE_ERROR_CODES.NOT_FOUND]: 'validation',
    [MARKETPLACE_ERROR_CODES.IDENTITY_CONFLICT]: 'integrity',
    [MARKETPLACE_ERROR_CODES.IDEMPOTENCY_CONFLICT]: 'integrity',
    [MARKETPLACE_ERROR_CODES.TAMPERED]: 'integrity',
    [MARKETPLACE_ERROR_CODES.UNSUPPORTED_RECORD_VERSION]: 'versioning',
    [MARKETPLACE_ERROR_CODES.UNKNOWN_ERROR]: 'unknown',
  });

const KNOWN_CODES: readonly string[] = Object.values(MARKETPLACE_ERROR_CODES);

/** Closed code-vocabulary guard. */
export function isMarketplaceErrorCode(value: unknown): value is MarketplaceErrorCode {
  return typeof value === 'string' && KNOWN_CODES.includes(value);
}

/** Category of a known code ('unknown' for unknown codes). */
export function categoryForMarketplaceCode(code: string): MarketplaceErrorCategory {
  return isMarketplaceErrorCode(code) ? CODE_CATEGORY[code] : 'unknown';
}

export interface MarketplaceErrorInit {
  readonly message: string;
  readonly details?: unknown | undefined;
  readonly correlationId?: string | undefined;
  readonly cause?: unknown | undefined;
}

/** Wire-safe structured error shape (closed vocabulary). */
export interface MarketplaceErrorStruct {
  readonly code: MarketplaceErrorCode;
  readonly category: MarketplaceErrorCategory;
  readonly message: string;
  readonly details?: unknown;
  readonly correlationId?: string;
}

/** The marketplace service error. Domain errors from dependencies are
 * normalized INTO this taxonomy at the service boundary. */
export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  readonly category: MarketplaceErrorCategory;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(code: MarketplaceErrorCode, init: MarketplaceErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'MarketplaceError';
    this.code = code;
    this.category = categoryForMarketplaceCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

/** Instance guard. */
export function isMarketplaceError(value: unknown): value is MarketplaceError {
  return value instanceof MarketplaceError;
}

/** Wire-safe struct projection. */
export function toMarketplaceErrorStruct(error: MarketplaceError): MarketplaceErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/** Fail-closed struct parse (unknown codes are rejected, not guessed). */
export function fromMarketplaceErrorStruct(value: unknown): MarketplaceError {
  if (typeof value !== 'object' || value === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
      message: 'marketplace error struct must be a plain object',
    });
  }
  const record = value as Record<string, unknown>;
  const code = record['code'];
  if (!isMarketplaceErrorCode(code)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
      message: `unknown marketplace error code: ${JSON.stringify(code)}`,
      details: { known: KNOWN_CODES },
    });
  }
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
      message: 'marketplace error struct requires a non-empty message',
    });
  }
  return new MarketplaceError(code, {
    message,
    ...(record['details'] !== undefined ? { details: record['details'] } : {}),
    ...(typeof record['correlationId'] === 'string'
      ? { correlationId: record['correlationId'] }
      : {}),
  });
}

/** Total normalizer (every boundary funnels failures through this). */
export function normalizeToMarketplaceError(
  error: unknown,
  correlationId?: string,
): MarketplaceError {
  if (isMarketplaceError(error)) {
    if (correlationId !== undefined && error.correlationId === undefined) {
      return new MarketplaceError(error.code, {
        message: error.message,
        details: error.details,
        correlationId,
        cause: error,
      });
    }
    return error;
  }
  const message =
    error instanceof Error ? error.message : 'unclassified marketplace failure';
  return new MarketplaceError(MARKETPLACE_ERROR_CODES.UNKNOWN_ERROR, {
    message,
    correlationId,
    cause: error,
  });
}
