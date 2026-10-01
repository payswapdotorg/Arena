/**
 * Shared vocabulary for @arena/auth (Work Order B004; issue #69).
 *
 * Branded identifiers, closed patterns, the injected Clock seam, deep-freeze
 * helpers and the session bounds. Everything here is provider-neutral by
 * construction and PURE: no Next.js imports, no provider names, no clock
 * reads, no I/O, no randomness (session ids are minted by the explicit
 * `newSessionId()` helper on demand, never implicitly).
 *
 * The tenancy vocabulary is IMPORTED from @arena/security (the A034
 * primitive owns tenancy): a session's tenant scope is a security TenantId.
 * Cross-vocabulary comparisons (e.g. against the B003 WorkspaceContext's
 * role-context-branded tenant id) compare the underlying STRING values via
 * `sameTenantScope` — the A015 sibling-brand convention.
 */

import type { Brand } from '@arena/protocol-core';
import { isTenantId as isSecurityTenantId } from '@arena/security';
import { AUTH_ERROR_CODES, AuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Bounded identifiers
// ---------------------------------------------------------------------------

/**
 * Session ids: opaque, server-minted identifiers. Charset is deliberately
 * identical to the control-plane record-id charset (the durable session
 * store embeds the session id in its record ids) and to the UUID form
 * `newSessionId()` mints.
 */
export const SESSION_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const SESSION_ID_PATTERN = new RegExp(SESSION_ID_PATTERN_SOURCE);

export type SessionId = Brand<string, 'AuthSessionId'>;

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/** Validate and brand a session id; throws AuthError when invalid. */
export function toSessionId(value: string): SessionId {
  if (!isSessionId(value)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_ID, {
      message: `invalid session id: ${JSON.stringify(value)}`,
      details: { pattern: SESSION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Re-exported tenancy guard (the A034 primitive owns the charset). */
export const isSessionTenantId = isSecurityTenantId;

/**
 * Cross-vocabulary tenant comparison: security-branded, role-context-branded
 * and raw strings compare by their underlying value (the A015 sibling-brand
 * convention — brands are compile-time only).
 */
export function sameTenantScope(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return String(left) === String(right);
}

// ---------------------------------------------------------------------------
// Injected time (deterministic operations; architecture-lock rule 17 style)
// ---------------------------------------------------------------------------

export interface AuthClock {
  /** Current time in epoch milliseconds. */
  now(): number;
}

// ---------------------------------------------------------------------------
// Session bounds
// ---------------------------------------------------------------------------

/** Minimum session TTL (1 minute). */
export const MIN_SESSION_TTL_MS = 60_000;
/** Maximum session TTL (30 days — mirrors the persistence TTL ceiling). */
export const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum rotation window (30 seconds). */
export const MIN_ROTATION_WINDOW_MS = 30_000;
/** Maximum auth-method provenance note/claim serialization (bounded, opaque). */
export const MAX_AUTH_METHOD_CLAIMS = 32;

// ---------------------------------------------------------------------------
// Deep freeze (returned records are frozen — read discipline)
// ---------------------------------------------------------------------------

/** Recursively freeze a JSON-safe value (records/arrays/leaves). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  // NOTE: recurse even into already-frozen containers — a frozen parent does
  // not imply frozen children when the children were injected from outside
  // (e.g. an embedded B003 snapshot parsed from storage).
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** True iff every path of a JSON-safe value is frozen (read discipline). */
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!isDeepFrozen((value as Record<string, unknown>)[key])) return false;
  }
  return true;
}
