/**
 * Role-context error taxonomy (Work Order B003; spec/roles-and-contexts.md
 * RC1.0; issue #65).
 *
 * @arena/role-context owns its own closed error code set, mirroring
 * @arena/entitlements' EntitlementError pattern exactly: closed codes, a
 * category mapping over a fixed category vocabulary, a structured wire-safe
 * form, and a strictly validating parser — unknown codes are REJECTED at
 * parse time (fail closed). Core-level failures still propagate the original
 * ProtocolError from @arena/protocol-core; role-context domain failures carry
 * ROLE_CONTEXT_* codes here.
 *
 * The three RC1.0 structural rejections get dedicated codes so the UI and
 * tests can distinguish them without string matching:
 *   - ROLE_NOT_GRANTED          activating a role the identity does not hold;
 *   - TENANT_SCOPE_VIOLATION    a tenant-A grant can never activate in
 *                               tenant B (cross-tenant fail closed);
 *   - GRANT_EXPIRED / GRANT_INACTIVE
 *                               temporal inactivity of the grant itself.
 */

export const ROLE_CONTEXT_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'access',
  'unknown',
] as const);

export type RoleContextErrorCategory = (typeof ROLE_CONTEXT_ERROR_CATEGORIES)[number];

export const ROLE_CONTEXT_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'ROLE_CONTEXT_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'ROLE_CONTEXT_INVALID_TIMESTAMP',
  INVALID_ROLE: 'ROLE_CONTEXT_INVALID_ROLE',
  INVALID_GRANT: 'ROLE_CONTEXT_INVALID_GRANT',
  INVALID_POLICY: 'ROLE_CONTEXT_INVALID_POLICY',
  INVALID_REGISTRY: 'ROLE_CONTEXT_INVALID_REGISTRY',
  INVALID_WORKSPACE: 'ROLE_CONTEXT_INVALID_WORKSPACE',
  INVALID_PROJECTION: 'ROLE_CONTEXT_INVALID_PROJECTION',
  INVALID_STATE: 'ROLE_CONTEXT_INVALID_STATE',
  UNSUPPORTED_RECORD_VERSION: 'ROLE_CONTEXT_UNSUPPORTED_RECORD_VERSION',
  ROLE_NOT_FOUND: 'ROLE_CONTEXT_ROLE_NOT_FOUND',
  ROLE_NOT_GRANTED: 'ROLE_CONTEXT_ROLE_NOT_GRANTED',
  GRANT_INACTIVE: 'ROLE_CONTEXT_GRANT_INACTIVE',
  GRANT_EXPIRED: 'ROLE_CONTEXT_GRANT_EXPIRED',
  TENANT_SCOPE_VIOLATION: 'ROLE_CONTEXT_TENANT_SCOPE_VIOLATION',
  REGISTRY_VERSION_MISMATCH: 'ROLE_CONTEXT_REGISTRY_VERSION_MISMATCH',
  CANONICAL_KIND_MISMATCH: 'ROLE_CONTEXT_CANONICAL_KIND_MISMATCH',
  TAMPERED: 'ROLE_CONTEXT_TAMPERED',
  UNKNOWN_ERROR: 'ROLE_CONTEXT_UNKNOWN_ERROR',
} as const);

export type RoleContextErrorCode =
  (typeof ROLE_CONTEXT_ERROR_CODES)[keyof typeof ROLE_CONTEXT_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<RoleContextErrorCode, RoleContextErrorCategory>> = {
  ROLE_CONTEXT_INVALID_IDENTITY: 'validation',
  ROLE_CONTEXT_INVALID_TIMESTAMP: 'validation',
  ROLE_CONTEXT_INVALID_ROLE: 'validation',
  ROLE_CONTEXT_INVALID_GRANT: 'validation',
  ROLE_CONTEXT_INVALID_POLICY: 'validation',
  ROLE_CONTEXT_INVALID_REGISTRY: 'validation',
  ROLE_CONTEXT_INVALID_WORKSPACE: 'validation',
  ROLE_CONTEXT_INVALID_PROJECTION: 'validation',
  ROLE_CONTEXT_INVALID_STATE: 'validation',
  ROLE_CONTEXT_UNSUPPORTED_RECORD_VERSION: 'versioning',
  ROLE_CONTEXT_ROLE_NOT_FOUND: 'validation',
  ROLE_CONTEXT_ROLE_NOT_GRANTED: 'access',
  ROLE_CONTEXT_GRANT_INACTIVE: 'access',
  ROLE_CONTEXT_GRANT_EXPIRED: 'access',
  ROLE_CONTEXT_TENANT_SCOPE_VIOLATION: 'integrity',
  ROLE_CONTEXT_REGISTRY_VERSION_MISMATCH: 'versioning',
  ROLE_CONTEXT_CANONICAL_KIND_MISMATCH: 'validation',
  ROLE_CONTEXT_TAMPERED: 'integrity',
  ROLE_CONTEXT_UNKNOWN_ERROR: 'unknown',
};

export function isRoleContextErrorCode(value: unknown): value is RoleContextErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ROLE_CONTEXT_ERROR_CODES).includes(value as RoleContextErrorCode)
  );
}

export function categoryForRoleContextCode(code: RoleContextErrorCode): RoleContextErrorCategory {
  return CODE_CATEGORY[code];
}

export interface RoleContextErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a RoleContextError. */
export interface RoleContextErrorStruct {
  readonly code: RoleContextErrorCode;
  readonly category: RoleContextErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class RoleContextError extends Error {
  readonly code: RoleContextErrorCode;
  readonly category: RoleContextErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: RoleContextErrorCode, init: RoleContextErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'RoleContextError';
    this.code = code;
    this.category = categoryForRoleContextCode(code);
    if (init.details !== undefined) this.details = init.details;
  }
}

export function isRoleContextError(value: unknown): value is RoleContextError {
  return value instanceof RoleContextError;
}

export function toRoleContextErrorStruct(error: RoleContextError): RoleContextErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

/**
 * Parse a structured RoleContextError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message — throws
 * `RoleContextError` with code `ROLE_CONTEXT_UNKNOWN_ERROR` (fail closed).
 */
export function fromRoleContextErrorStruct(value: unknown): RoleContextError {
  const fail = (reason: string): never => {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured role-context error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isRoleContextErrorCode(code)) {
    return fail(`unknown or missing role-context error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForRoleContextCode(code)) {
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

  return new RoleContextError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
  });
}

/** Normalize any thrown value into a RoleContextError. */
export function normalizeToRoleContextError(error: unknown): RoleContextError {
  if (isRoleContextError(error)) return error;
  if (error instanceof Error) {
    return new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
