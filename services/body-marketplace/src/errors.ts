/**
 * The typed fail-closed error taxonomy for @arena/body-marketplace-service
 * (Work Order C014). House pattern (A031/A032 service precedent): a
 * frozen closed code map, a structured wire-safe error class and a
 * total normalizer. Every failure normalizes into a
 * BodyMarketplaceError carrying a closed-vocabulary machine-readable
 * code plus structured details — never a bare string, never a silent
 * partial result.
 */

/** The closed error-code map. */
export const BODY_MARKETPLACE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'BODY_MARKETPLACE_INVALID_REQUEST',
  INVALID_LISTING: 'BODY_MARKETPLACE_INVALID_LISTING',
  INVALID_GRANT: 'BODY_MARKETPLACE_INVALID_GRANT',
  INVALID_ENVELOPE: 'BODY_MARKETPLACE_INVALID_ENVELOPE',
  INVALID_PROVENANCE: 'BODY_MARKETPLACE_INVALID_PROVENANCE',
  PRETRAINING_BLOCKED: 'BODY_MARKETPLACE_PRETRAINING_BLOCKED',
  FORGE_REJECTED: 'BODY_MARKETPLACE_FORGE_REJECTED',
  CERTIFICATION_UNAVAILABLE: 'BODY_MARKETPLACE_CERTIFICATION_UNAVAILABLE',
  REGISTRATION_REJECTED: 'BODY_MARKETPLACE_REGISTRATION_REJECTED',
  LISTING_NOT_FOUND: 'BODY_MARKETPLACE_LISTING_NOT_FOUND',
  LISTING_TRANSITION_REJECTED: 'BODY_MARKETPLACE_LISTING_TRANSITION_REJECTED',
  CERTIFICATION_NOT_RECORD_BACKED: 'BODY_MARKETPLACE_CERTIFICATION_NOT_RECORD_BACKED',
  RELEASE_NOT_PUBLISHED: 'BODY_MARKETPLACE_RELEASE_NOT_PUBLISHED',
  TENANT_ACCESS_DENIED: 'BODY_MARKETPLACE_TENANT_ACCESS_DENIED',
  IDEMPOTENCY_CONFLICT: 'BODY_MARKETPLACE_IDEMPOTENCY_CONFLICT',
} as const);
export type BodyMarketplaceErrorCode =
  (typeof BODY_MARKETPLACE_ERROR_CODES)[keyof typeof BODY_MARKETPLACE_ERROR_CODES];

/** Structural (non-throwing) check for the error-code vocabulary. */
export function isBodyMarketplaceErrorCode(value: unknown): value is BodyMarketplaceErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(BODY_MARKETPLACE_ERROR_CODES).includes(value as BodyMarketplaceErrorCode)
  );
}

/** Error details: a human-readable message plus structured machine detail. */
export interface BodyMarketplaceErrorDetails {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  /** The upstream error this one normalizes (never rethrown raw). */
  readonly cause?: unknown;
}

/** The typed marketplace error. */
export class BodyMarketplaceError extends Error {
  readonly code: BodyMarketplaceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  override readonly cause: unknown;

  constructor(code: BodyMarketplaceErrorCode, info: BodyMarketplaceErrorDetails) {
    super(info.message);
    this.name = 'BodyMarketplaceError';
    this.code = code;
    this.details = info.details === undefined ? {} : { ...info.details };
    this.cause = info.cause;
  }
}

/** Structural (non-throwing) check for the typed error. */
export function isBodyMarketplaceError(value: unknown): value is BodyMarketplaceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    value instanceof BodyMarketplaceError &&
    isBodyMarketplaceErrorCode(value.code)
  );
}

/**
 * Normalize any thrown value into a BodyMarketplaceError (fail-closed
 * wiring discipline — an unknown failure is NEVER surfaced raw).
 */
export function normalizeToBodyMarketplaceError(
  error: unknown,
  correlationId?: string,
): BodyMarketplaceError {
  if (isBodyMarketplaceError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_REQUEST, {
    message: `body-marketplace failure (fail closed): ${message}`,
    details:
      correlationId === undefined
        ? {}
        : { correlationId },
    cause: error,
  });
}
