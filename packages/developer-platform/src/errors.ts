/**
 * Developer-platform error taxonomy (Work Order C017). Mirrors the
 * sibling domain packages' typed errors (@arena/escalation's
 * EscalationError, @arena/payments' PaymentError): closed code set,
 * category mapping, structured wire-safe form. Every authorization
 * outcome is machine-readable (never a bare boolean — house verdict
 * style).
 */

export const DEVELOPER_PLATFORM_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'tenancy',
  'capacity',
  'unknown',
] as const);
export type DeveloperPlatformErrorCategory =
  (typeof DEVELOPER_PLATFORM_ERROR_CATEGORIES)[number];

export const DEVELOPER_PLATFORM_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'DEVELOPER_INVALID_REQUEST',
  INVALID_KEY: 'DEVELOPER_INVALID_KEY',
  INVALID_SECRET: 'DEVELOPER_INVALID_SECRET',
  INVALID_SCOPE: 'DEVELOPER_INVALID_SCOPE',
  INVALID_ENVIRONMENT: 'DEVELOPER_INVALID_ENVIRONMENT',
  INVALID_WEBHOOK: 'DEVELOPER_INVALID_WEBHOOK',
  INVALID_CLIENT_APP: 'DEVELOPER_INVALID_CLIENT_APP',
  KEY_NOT_FOUND: 'DEVELOPER_KEY_NOT_FOUND',
  KEY_REVOKED: 'DEVELOPER_KEY_REVOKED',
  KEY_ROTATED: 'DEVELOPER_KEY_ROTATED',
  SECRET_INVALID: 'DEVELOPER_SECRET_INVALID',
  SCOPE_MISSING: 'DEVELOPER_SCOPE_MISSING',
  ENVIRONMENT_MISMATCH: 'DEVELOPER_ENVIRONMENT_MISMATCH',
  CROSS_TENANT_ACCESS: 'DEVELOPER_CROSS_TENANT_ACCESS',
  CLIENT_APP_NOT_FOUND: 'DEVELOPER_CLIENT_APP_NOT_FOUND',
  SANDBOX_CAPACITY_EXHAUSTED: 'DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED',
  SANDBOX_CAPACITY_DISABLED: 'DEVELOPER_SANDBOX_CAPACITY_DISABLED',
  UNKNOWN_ERROR: 'DEVELOPER_UNKNOWN_ERROR',
} as const);
export type DeveloperPlatformErrorCode =
  (typeof DEVELOPER_PLATFORM_ERROR_CODES)[keyof typeof DEVELOPER_PLATFORM_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<DeveloperPlatformErrorCode, DeveloperPlatformErrorCategory>> = {
  DEVELOPER_INVALID_REQUEST: 'validation',
  DEVELOPER_INVALID_KEY: 'validation',
  DEVELOPER_INVALID_SECRET: 'validation',
  DEVELOPER_INVALID_SCOPE: 'validation',
  DEVELOPER_INVALID_ENVIRONMENT: 'validation',
  DEVELOPER_INVALID_WEBHOOK: 'validation',
  DEVELOPER_INVALID_CLIENT_APP: 'validation',
  DEVELOPER_KEY_NOT_FOUND: 'scope',
  DEVELOPER_KEY_REVOKED: 'scope',
  DEVELOPER_KEY_ROTATED: 'scope',
  DEVELOPER_SECRET_INVALID: 'scope',
  DEVELOPER_SCOPE_MISSING: 'scope',
  DEVELOPER_ENVIRONMENT_MISMATCH: 'scope',
  DEVELOPER_CROSS_TENANT_ACCESS: 'tenancy',
  DEVELOPER_CLIENT_APP_NOT_FOUND: 'scope',
  DEVELOPER_SANDBOX_CAPACITY_EXHAUSTED: 'capacity',
  DEVELOPER_SANDBOX_CAPACITY_DISABLED: 'capacity',
  DEVELOPER_UNKNOWN_ERROR: 'unknown',
};

export function isDeveloperPlatformErrorCode(
  value: unknown,
): value is DeveloperPlatformErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(DEVELOPER_PLATFORM_ERROR_CODES).includes(value as DeveloperPlatformErrorCode)
  );
}

export function categoryForDeveloperPlatformCode(
  code: DeveloperPlatformErrorCode,
): DeveloperPlatformErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe developer-platform failure (fail-closed). */
export class DeveloperPlatformError extends Error {
  readonly code: DeveloperPlatformErrorCode;
  readonly category: DeveloperPlatformErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DeveloperPlatformErrorCode,
    options: {
      message: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(options.message);
    this.name = 'DeveloperPlatformError';
    this.code = code;
    this.category = categoryForDeveloperPlatformCode(code);
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

  /** Wire-safe projection (never carries secret material). */
  toWire(): {
    readonly code: DeveloperPlatformErrorCode;
    readonly category: DeveloperPlatformErrorCategory;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  } {
    return Object.freeze({
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
    });
  }
}

export function developerPlatformError(
  code: DeveloperPlatformErrorCode,
  options: { message: string; details?: Record<string, unknown> },
): DeveloperPlatformError {
  return new DeveloperPlatformError(code, options);
}
