/**
 * Auth error taxonomy (Work Order B004; issue #69; AGENTS.md "Security":
 * authentication failures fail closed with typed errors — never a silent
 * anonymous fallback).
 *
 * @arena/auth owns its own closed error code set, mirroring
 * @arena/persistence's PersistenceError pattern exactly: closed codes, a
 * category mapping over a fixed category vocabulary, a structured wire-safe
 * form, and a strictly validating parser — unknown codes are REJECTED at
 * parse time (fail closed). Sibling-package failures (SecurityError from
 * @arena/security, RoleContextError from @arena/role-context,
 * PersistenceError from the B002 ports) propagate as their original typed
 * errors; auth-domain failures carry AUTH_* codes here.
 *
 * The closed vocabulary is the B004 acceptance contract:
 *   - AUTH_DISABLED                 the session subsystem is DISABLED
 *                                  (missing/short ARENA_SESSION_SECRET) —
 *                                  the sealed-token factory refuses to
 *                                  construct; there is no weak default key
 *                                  anywhere in this package;
 *   - AUTH_MALFORMED_TOKEN / AUTH_TOKEN_TAMPERED / AUTH_TOKEN_VERSION_UNSUPPORTED
 *                                  the sealed envelope is unparseable,
 *                                  fails its HMAC seal, or carries an
 *                                  unknown protocol version;
 *   - AUTH_SESSION_EXPIRED / AUTH_SESSION_REVOKED / AUTH_SESSION_ROTATED /
 *     AUTH_SESSION_NOT_FOUND        the typed lifecycle failures;
 *   - AUTH_TENANT_SCOPE_VIOLATION   a tenant-A session cannot validate in a
 *                                  tenant-B context (B003's
 *                                  TENANT_SCOPE_VIOLATION vocabulary is the
 *                                  precedent).
 */

export const AUTH_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'integrity',
  'access',
  'conflict',
  'versioning',
  'configuration',
  'unavailable',
  'unknown',
] as const);

export type AuthErrorCategory = (typeof AUTH_ERROR_CATEGORIES)[number];

export const AUTH_ERROR_CODES = Object.freeze({
  INVALID_SESSION_ID: 'AUTH_INVALID_SESSION_ID',
  INVALID_SESSION_RECORD: 'AUTH_INVALID_SESSION_RECORD',
  INVALID_PRINCIPAL: 'AUTH_INVALID_PRINCIPAL',
  INVALID_WORKSPACE_CONTEXT: 'AUTH_INVALID_WORKSPACE_CONTEXT',
  INVALID_TENANT_REF: 'AUTH_INVALID_TENANT_REF',
  INVALID_AUTH_METHOD: 'AUTH_INVALID_AUTH_METHOD',
  INVALID_COOKIE: 'AUTH_INVALID_COOKIE',
  INVALID_TTL: 'AUTH_INVALID_TTL',
  INVALID_WINDOW: 'AUTH_INVALID_WINDOW',
  INVALID_SECRET: 'AUTH_INVALID_SECRET',
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  MALFORMED_TOKEN: 'AUTH_MALFORMED_TOKEN',
  TOKEN_TAMPERED: 'AUTH_TOKEN_TAMPERED',
  TOKEN_VERSION_UNSUPPORTED: 'AUTH_TOKEN_VERSION_UNSUPPORTED',
  SESSION_NOT_FOUND: 'AUTH_SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  SESSION_ROTATED: 'AUTH_SESSION_ROTATED',
  SESSION_EXISTS: 'AUTH_SESSION_EXISTS',
  ROTATION_CONFLICT: 'AUTH_ROTATION_CONFLICT',
  TENANT_SCOPE_VIOLATION: 'AUTH_TENANT_SCOPE_VIOLATION',
  DISABLED: 'AUTH_DISABLED',
  STORE_FAILED: 'AUTH_STORE_FAILED',
  UNKNOWN_ERROR: 'AUTH_UNKNOWN_ERROR',
} as const);

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<AuthErrorCode, AuthErrorCategory>> = {
  AUTH_INVALID_SESSION_ID: 'validation',
  AUTH_INVALID_SESSION_RECORD: 'validation',
  AUTH_INVALID_PRINCIPAL: 'validation',
  AUTH_INVALID_WORKSPACE_CONTEXT: 'validation',
  AUTH_INVALID_TENANT_REF: 'validation',
  AUTH_INVALID_AUTH_METHOD: 'validation',
  AUTH_INVALID_COOKIE: 'validation',
  AUTH_INVALID_TTL: 'validation',
  AUTH_INVALID_WINDOW: 'validation',
  AUTH_INVALID_SECRET: 'configuration',
  AUTH_INVALID_CREDENTIALS: 'access',
  AUTH_MALFORMED_TOKEN: 'encoding',
  AUTH_TOKEN_TAMPERED: 'integrity',
  AUTH_TOKEN_VERSION_UNSUPPORTED: 'versioning',
  AUTH_SESSION_NOT_FOUND: 'access',
  AUTH_SESSION_EXPIRED: 'access',
  AUTH_SESSION_REVOKED: 'access',
  AUTH_SESSION_ROTATED: 'access',
  AUTH_SESSION_EXISTS: 'conflict',
  AUTH_ROTATION_CONFLICT: 'conflict',
  AUTH_TENANT_SCOPE_VIOLATION: 'integrity',
  AUTH_DISABLED: 'configuration',
  AUTH_STORE_FAILED: 'unavailable',
  AUTH_UNKNOWN_ERROR: 'unknown',
};

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(AUTH_ERROR_CODES).includes(value as AuthErrorCode)
  );
}

export function categoryForAuthCode(code: AuthErrorCode): AuthErrorCategory {
  return CODE_CATEGORY[code];
}

export interface AuthErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an AuthError. */
export interface AuthErrorStruct {
  readonly code: AuthErrorCode;
  readonly category: AuthErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly category: AuthErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: AuthErrorCode, init: AuthErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'AuthError';
    this.code = code;
    this.category = categoryForAuthCode(code);
    if (init.details !== undefined) this.details = init.details;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}

export function toAuthErrorStruct(error: AuthError): AuthErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

/**
 * Parse a structured AuthError. Any malformed input — non-object, missing or
 * unknown code, category/code mismatch, missing message — throws `AuthError`
 * with code `AUTH_UNKNOWN_ERROR` (fail closed).
 */
export function fromAuthErrorStruct(value: unknown): AuthError {
  const fail = (reason: string): never => {
    throw new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured auth error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isAuthErrorCode(code)) {
    return fail(`unknown or missing auth error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForAuthCode(code)) {
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

  return new AuthError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
  });
}

/** Normalize any thrown value into an AuthError (cause preserved). */
export function normalizeToAuthError(error: unknown): AuthError {
  if (isAuthError(error)) return error;
  if (error instanceof Error) {
    return new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new AuthError(AUTH_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
