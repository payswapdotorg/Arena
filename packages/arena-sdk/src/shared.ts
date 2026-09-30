/**
 * Shared vocabulary for @arena/arena-sdk (Work Order A025).
 *
 * Pattern sources, branded scalars, non-throwing guards, throwing
 * constructors and the strict closed-shape helper — mirroring the
 * sibling domain packages' shared.ts conventions
 * (@arena/certification, @arena/body-registry).
 *
 * Single-source-of-truth policy: `deepFreeze` and the release-channel
 * vocabulary are REUSED from the owning sibling packages (never
 * redefined) — @arena/agent-body owns deepFreeze, @arena/body-registry
 * owns RELEASE_CHANNELS. The tenant-scope pattern mirrors
 * @arena/expert-registry's TenantScope (including the reserved `public`
 * namespace) because the API surface unifies the sibling scoping
 * disciplines into one read scope.
 */

import type { Brand, CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';
import { ARENA_API_ERROR_CODES, ArenaApiError } from './errors.js';

export { deepFreeze } from '@arena/agent-body';
export { RELEASE_CHANNELS, isReleaseChannel } from '@arena/body-registry';
export type { ReleaseChannel } from '@arena/body-registry';

// ---------------------------------------------------------------------------
// Pattern sources (parity-checked against contracts/api by
// contracts.parity.test.ts and the generator's duplicated constants)
// ---------------------------------------------------------------------------

export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const ARENA_API_TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ARENA_API_BODY_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const ARENA_API_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ARENA_API_SEMVER_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const ARENA_API_CORRELATION_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const ARENA_API_TENANT_PATTERN = new RegExp(ARENA_API_TENANT_PATTERN_SOURCE);
const ARENA_API_BODY_NAME_PATTERN = new RegExp(ARENA_API_BODY_NAME_PATTERN_SOURCE);
const ARENA_API_NAMESPACE_PATTERN = new RegExp(ARENA_API_NAMESPACE_PATTERN_SOURCE);
const ARENA_API_SEMVER_PATTERN = new RegExp(ARENA_API_SEMVER_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

/**
 * The tenant a reader acts in. The reserved namespace `public` reads
 * only records explicitly published for public visibility (mirrors
 * @arena/expert-registry's TenantScope; lock rule 11).
 */
export type TenantScope = Brand<string, 'ArenaApiTenantScope'>;

/** The reserved public tenant namespace (globally visible records). */
export const PUBLIC_TENANT = 'public' as const;

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && ARENA_API_TENANT_PATTERN.test(value);
}

/** True iff a record tenant is visible to a reader tenant (same tenant or public). */
export function isTenantVisible(recordTenant: string, readerTenant: string): boolean {
  return recordTenant === readerTenant || recordTenant === PUBLIC_TENANT;
}

export function toTenantScope(value: string, context: string): TenantScope {
  if (!isTenantScope(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_TENANT, {
      message: `${context}: invalid tenant scope: ${JSON.stringify(value)} (expected lowercase kebab tenant id, or the reserved namespace 'public')`,
      details: { pattern: ARENA_API_TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a content digest (lowercase sha256 hex) or throw INVALID_DIGEST. */
export function toContentDigest(value: string, context: string): string {
  if (typeof value !== 'string' || !CONTENT_DIGEST_PATTERN.test(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function isContentDigestValue(value: unknown): boolean {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

/** Validate a body/namespace tenant-scoped name or throw INVALID_PARAMS. */
export function toBodyName(value: string, context: string): string {
  if (typeof value !== 'string' || !ARENA_API_BODY_NAME_PATTERN.test(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
      message: `${context}: invalid body name: ${JSON.stringify(value)}`,
      details: { pattern: ARENA_API_BODY_NAME_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNamespace(value: string, context: string): string {
  if (typeof value !== 'string' || !ARENA_API_NAMESPACE_PATTERN.test(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
      message: `${context}: invalid release namespace: ${JSON.stringify(value)}`,
      details: { pattern: ARENA_API_NAMESPACE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSemver(value: string, context: string): string {
  if (typeof value !== 'string' || !ARENA_API_SEMVER_PATTERN.test(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_PARAMS, {
      message: `${context}: invalid semver: ${JSON.stringify(value)}`,
      details: { pattern: ARENA_API_SEMVER_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCorrelationId(value: string, context: string): CorrelationId {
  if (typeof value !== 'string' || !isCorrelationId(value)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY, {
      message: `${context}: invalid correlation id: ${JSON.stringify(value)}`,
      details: { pattern: ARENA_API_CORRELATION_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict closed-shape helpers (runtime twin of additionalProperties:false)
// ---------------------------------------------------------------------------

/**
 * Require `value` to be a plain object with EXACTLY the required keys
 * plus any of the optional keys — no more, no less.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: (typeof ARENA_API_ERROR_CODES)[keyof typeof ARENA_API_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArenaApiError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in record)) {
      throw new ArenaApiError(code, {
        message: `${context}: missing required field ${JSON.stringify(key)}`,
        details: { missing: key },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ArenaApiError(code, {
        message: `${context}: unknown field ${JSON.stringify(key)} (closed shape)`,
        details: { unknown: key, allowed: [...allowed] },
      });
    }
  }
  return record;
}

/** Require `value` to be one of the closed enum members. */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: (typeof ARENA_API_ERROR_CODES)[keyof typeof ARENA_API_ERROR_CODES],
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new ArenaApiError(code, {
      message: `${context}: field ${JSON.stringify(field)} must be one of ${JSON.stringify([...members])}, got ${JSON.stringify(String(value))}`,
      details: { field, allowed: [...members] },
    });
  }
  return value as T;
}

/** Structural (non-throwing) plain-object check. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
