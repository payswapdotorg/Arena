/**
 * @arena/auth-service — the versioned contract surface B005/B007 consume
 * (Work Order B004; issue #69; spec/service-boundaries.md: services
 * communicate through versioned contracts).
 *
 * `AuthenticatedSession` is the session VIEW record: everything a consumer
 * needs (session identity, tenant scope + provenance, the B003 workspace
 * context snapshot, the opaque auth-method provenance, the lifecycle
 * windows) — and NOTHING that decides permissions. The B003
 * PermissionPolicy rides inside the workspace context, untouched and
 * unread.
 *
 * `SessionIssuance` is the issuance envelope: the view record plus the
 * materialized cookie contract (the exact spec the web boundary must set).
 */

import type { AuthMethodDescriptor, SessionRecord } from '@arena/auth';
import { requiresSessionRotation, toSessionRecord } from '@arena/auth';
import type { SessionCookieSpec } from '@arena/auth';
import { AUTH_ERROR_CODES, AuthError } from '@arena/auth';
import type { SecurityPrincipal, TenantScopedRef } from '@arena/security';
import type { WorkspaceContext } from '@arena/role-context';

/** Wire version of the service's contract records. */
export const AUTH_SERVICE_RECORD_VERSION = 1 as const;

/** The authenticated-session VIEW (versioned; frozen on construction). */
export interface AuthenticatedSession {
  readonly recordVersion: typeof AUTH_SERVICE_RECORD_VERSION;
  readonly sessionId: string;
  readonly principal: SecurityPrincipal;
  readonly tenantId: string;
  readonly tenantRef: TenantScopedRef;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly rotatesAt: number;
  /** Whether the rotation window elapsed at validation time (a hint, not a failure). */
  readonly requiresRotation: boolean;
  readonly workspaceContext: WorkspaceContext;
  /** OPAQUE issuance provenance (carried, never interpreted). */
  readonly authMethod: AuthMethodDescriptor;
}

/** Build the view from a validated session record at time `now`. */
export function makeAuthenticatedSession(
  session: SessionRecord,
  now: number,
): AuthenticatedSession {
  return deepFrozenView({
    recordVersion: AUTH_SERVICE_RECORD_VERSION,
    sessionId: session.sessionId,
    principal: session.principal,
    tenantId: session.tenantId,
    tenantRef: session.tenantRef,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    rotatesAt: session.rotatesAt,
    requiresRotation: requiresSessionRotation(session, now),
    workspaceContext: session.workspaceContext,
    authMethod: session.authMethod,
  });
}

/** The issuance envelope: the session view + the cookie contract to set. */
export interface SessionIssuance {
  readonly recordVersion: typeof AUTH_SERVICE_RECORD_VERSION;
  readonly session: AuthenticatedSession;
  readonly cookie: SessionCookieSpec;
}

/**
 * Strict parser for a transported AuthenticatedSession (fail closed) —
 * every field is re-derived through the domain record parser, so a
 * corrupted view can never masquerade as a session.
 */
export function toAuthenticatedSession(value: unknown): AuthenticatedSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: 'an authenticated-session view must be a plain object',
    });
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== AUTH_SERVICE_RECORD_VERSION) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `unsupported authenticated-session recordVersion ${String(record['recordVersion'])}`,
    });
  }
  // Re-validate the embedded domain record through the strict parser.
  const domain = toSessionRecord({
    recordVersion: 1,
    sessionId: record['sessionId'],
    principal: record['principal'],
    tenantId: record['tenantId'],
    tenantRef: record['tenantRef'],
    issuedAt: record['issuedAt'],
    expiresAt: record['expiresAt'],
    rotatesAt: record['rotatesAt'],
    workspaceContext: record['workspaceContext'],
    authMethod: record['authMethod'],
    revocationEpoch: 0,
  });
  if (typeof record['requiresRotation'] !== 'boolean') {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: 'requiresRotation must be a boolean',
    });
  }
  return deepFrozenView({
    recordVersion: AUTH_SERVICE_RECORD_VERSION,
    sessionId: domain.sessionId,
    principal: domain.principal,
    tenantId: domain.tenantId,
    tenantRef: domain.tenantRef,
    issuedAt: domain.issuedAt,
    expiresAt: domain.expiresAt,
    rotatesAt: domain.rotatesAt,
    requiresRotation: record['requiresRotation'],
    workspaceContext: domain.workspaceContext,
    authMethod: domain.authMethod,
  });
}

/** Deep-freeze helper for the view records (read discipline). */
function deepFrozenView<T extends object>(value: T): T {
  const freezeDeep = (input: unknown): void => {
    if (typeof input !== 'object' || input === null) return;
    for (const key of Object.keys(input as Record<string, unknown>)) {
      freezeDeep((input as Record<string, unknown>)[key]);
    }
    Object.freeze(input);
  };
  freezeDeep(value);
  return value;
}
