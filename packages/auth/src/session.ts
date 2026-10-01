/**
 * The versioned SessionRecord (Work Order B004; issue #69).
 *
 * A session record carries EVERYTHING the secure browser session boundary
 * needs, and NOTHING it must not decide:
 *
 *   - the A034 `SecurityPrincipal` (identity/tenancy primitive — imported
 *     from @arena/security, never re-modeled here);
 *   - the session's tenant id + a `TenantScopedRef` provenance ref (the
 *     S1.0 'customer-identity' boundary class by default);
 *   - issued-at / expires-at / rotates-at (the rotation window);
 *   - the B003 `WorkspaceContext` SNAPSHOT (disclosed choice: a snapshot,
 *     not a resolvable reference — validation never needs a second store
 *     read, and the snapshot is re-taken on rotation);
 *   - the OPAQUE auth-method issuance provenance descriptor (like B003's
 *     PermissionPolicy: carried, never interpreted — no function in this
 *     package reads any field of `claims`);
 *   - the revocation epoch marker stamped at issuance (revoke-all bumps the
 *     principal's epoch; older sessions fail closed as REVOKED).
 *
 * Fail-closed construction: the anonymous principal and untenanted
 * principals CANNOT hold sessions (typed rejections — a session is by
 * definition an authenticated, tenant-scoped state); cross-tenant material
 * (principal scope, tenant ref, workspace context) is rejected with
 * AUTH_TENANT_SCOPE_VIOLATION, never silently accepted.
 *
 * Authorization stays OUT: the WorkspaceContext's PermissionPolicy
 * descriptor is carried untouched and is never read by this package.
 */

import { toSecurityPrincipal, toTenantScopedRef, isSecurityPrincipal, isAnonymousPrincipal, isTenantScopedRef, makeTenantScopedRef } from '@arena/security';
import type { SecurityPrincipal, TenantId, TenantScopedRef } from '@arena/security';
import {
  isIdentityId,
  isPermissionPolicy,
  isTenantId as isRoleContextTenantId,
  isWorkspaceId,
  toWorkspaceContext,
  WORKSPACE_CONTEXT_RECORD_VERSION,
} from '@arena/role-context';
import type { WorkspaceContext } from '@arena/role-context';
import { AUTH_ERROR_CODES, AuthError } from './errors.js';
import {
  deepFreeze,
  isSessionId,
  isSessionTenantId,
  MAX_AUTH_METHOD_CLAIMS,
  MAX_SESSION_TTL_MS,
  MIN_ROTATION_WINDOW_MS,
  MIN_SESSION_TTL_MS,
  sameTenantScope,
  toSessionId,
} from './shared.js';
import type { SessionId } from './shared.js';

/** Wire version of the session record shape. */
export const SESSION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Auth-method provenance (OPAQUE — never interpreted)
// ---------------------------------------------------------------------------

/** Wire version of the auth-method descriptor shape. */
export const AUTH_METHOD_RECORD_VERSION = 1 as const;

/** Neutral method vocabulary pattern (closed lowercase ids — e.g. 'local'). */
export const AUTH_METHOD_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
const AUTH_METHOD_PATTERN = new RegExp(AUTH_METHOD_PATTERN_SOURCE);

/**
 * The issuance provenance: HOW the principal authenticated. `method` is a
 * neutral id; `claims` is plain-JSON opaque data owned by the credential
 * verifier. Like B003's PermissionPolicy descriptor, NOTHING in this
 * package interprets it.
 */
export interface AuthMethodDescriptor {
  readonly recordVersion: typeof AUTH_METHOD_RECORD_VERSION;
  readonly method: string;
  readonly claims?: Readonly<Record<string, unknown>>;
}

export function isAuthMethodDescriptor(value: unknown): value is AuthMethodDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== AUTH_METHOD_RECORD_VERSION) return false;
  if (typeof record['method'] !== 'string' || !AUTH_METHOD_PATTERN.test(record['method'])) {
    return false;
  }
  const claims = record['claims'];
  if (claims === undefined) return true;
  return typeof claims === 'object' && claims !== null && !Array.isArray(claims);
}

export function createAuthMethodDescriptor(input: {
  readonly method: string;
  readonly claims?: Readonly<Record<string, unknown>>;
}): AuthMethodDescriptor {
  if (typeof input.method !== 'string' || !AUTH_METHOD_PATTERN.test(input.method)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_AUTH_METHOD, {
      message: `auth method must match ${AUTH_METHOD_PATTERN_SOURCE}, got ${JSON.stringify(input.method)}`,
      details: { pattern: AUTH_METHOD_PATTERN_SOURCE },
    });
  }
  let claims: Readonly<Record<string, unknown>> | undefined;
  if (input.claims !== undefined) {
    if (
      typeof input.claims !== 'object' ||
      input.claims === null ||
      Array.isArray(input.claims)
    ) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_AUTH_METHOD, {
        message: 'auth method claims must be a plain object when present',
      });
    }
    const entries = Object.entries(input.claims);
    if (entries.length > MAX_AUTH_METHOD_CLAIMS) {
      throw new AuthError(AUTH_ERROR_CODES.INVALID_AUTH_METHOD, {
        message: `auth method claims are bounded to ${String(MAX_AUTH_METHOD_CLAIMS)} entries`,
        details: { received: entries.length },
      });
    }
    claims = deepFreeze({ ...input.claims });
  }
  return deepFreeze({
    recordVersion: AUTH_METHOD_RECORD_VERSION,
    method: input.method,
    ...(claims !== undefined ? { claims } : {}),
  } satisfies AuthMethodDescriptor);
}

// ---------------------------------------------------------------------------
// Session policy (bounds; deterministic windows)
// ---------------------------------------------------------------------------

/** The session lifetime + rotation window contract. */
export interface SessionPolicy {
  /** How long a session lives from issuance (ms). */
  readonly sessionTtlMs: number;
  /** How often the session id should rotate (ms from issuance; <= TTL). */
  readonly rotationWindowMs: number;
}

/** Default policy: 12-hour sessions, hourly id rotation. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({
  sessionTtlMs: 12 * 60 * 60 * 1000,
  rotationWindowMs: 60 * 60 * 1000,
});

/** Validate a session policy (typed bounds; fail closed). */
export function validateSessionPolicy(policy: SessionPolicy): SessionPolicy {
  if (typeof policy !== 'object' || policy === null) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_TTL, {
      message: 'session policy must be a plain object',
    });
  }
  const ttl = policy.sessionTtlMs;
  if (
    !Number.isInteger(ttl) ||
    ttl < MIN_SESSION_TTL_MS ||
    ttl > MAX_SESSION_TTL_MS
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_TTL, {
      message: `sessionTtlMs must be an integer in ${String(MIN_SESSION_TTL_MS)}..${String(MAX_SESSION_TTL_MS)}`,
      details: { received: ttl },
    });
  }
  const rotation = policy.rotationWindowMs;
  if (
    !Number.isInteger(rotation) ||
    rotation < MIN_ROTATION_WINDOW_MS ||
    rotation > ttl
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_WINDOW, {
      message: `rotationWindowMs must be an integer in ${String(MIN_ROTATION_WINDOW_MS)}..sessionTtlMs (${String(ttl)})`,
      details: { received: rotation },
    });
  }
  return Object.freeze({ sessionTtlMs: ttl, rotationWindowMs: rotation });
}

// ---------------------------------------------------------------------------
// SessionRecord
// ---------------------------------------------------------------------------

/**
 * The versioned session record. The tenant vocabulary is the A034
 * `TenantId`; the embedded B003 `WorkspaceContext` keeps the role-context
 * brand — cross-vocabulary comparisons are value-level (`sameTenantScope`).
 */
export interface SessionRecord {
  readonly recordVersion: typeof SESSION_RECORD_VERSION;
  readonly sessionId: SessionId;
  /** The A034 principal (tenant-bound, never anonymous). */
  readonly principal: SecurityPrincipal;
  readonly tenantId: TenantId;
  /** Provenance: the tenant-scoped resource ref this session addresses. */
  readonly tenantRef: TenantScopedRef;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly rotatesAt: number;
  /** The B003 workspace context SNAPSHOT (opaque permission policy carried, never interpreted). */
  readonly workspaceContext: WorkspaceContext;
  /** OPAQUE issuance provenance (never interpreted). */
  readonly authMethod: AuthMethodDescriptor;
  /** Principal's revocation epoch at issuance (revoke-all bumps it). */
  readonly revocationEpoch: number;
}

/** Structural (non-throwing) check for a session record's OUTER shape. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== SESSION_RECORD_VERSION) return false;
  if (!isSessionId(record['sessionId'])) return false;
  if (!isSecurityPrincipal(record['principal'])) return false;
  if (!isSessionTenantId(record['tenantId'])) return false;
  if (!isTenantScopedRef(record['tenantRef'])) return false;
  for (const field of ['issuedAt', 'expiresAt', 'rotatesAt', 'revocationEpoch'] as const) {
    const valueAt = record[field];
    if (typeof valueAt !== 'number' || !Number.isFinite(valueAt) || !Number.isInteger(valueAt)) {
      return false;
    }
  }
  const issuedAt = record['issuedAt'] as number;
  const expiresAt = record['expiresAt'] as number;
  const rotatesAt = record['rotatesAt'] as number;
  if (expiresAt <= issuedAt || rotatesAt < issuedAt) {
    return false;
  }
  if (!isAuthMethodDescriptor(record['authMethod'])) return false;
  return isWorkspaceContextSnapshot(record['workspaceContext']);
}

/** Structural (non-throwing) check for the embedded B003 workspace snapshot. */
export function isWorkspaceContextSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== WORKSPACE_CONTEXT_RECORD_VERSION) return false;
  if (!isIdentityId(record['identityId'])) return false;
  if (!isRoleContextTenantId(record['tenantId'])) return false;
  if (!isWorkspaceId(record['workspaceId'])) return false;
  if (!isPermissionPolicy(record['permissionPolicy'])) return false;
  return Array.isArray(record['grantedRoles']);
}

const SESSION_CONTEXT = 'SessionRecord';

/** Cross-field tenant-scope discipline (fail closed, typed violations). */
function assertTenantScopeConsistency(
  principal: SecurityPrincipal,
  tenantId: TenantId,
  tenantRef: TenantScopedRef,
  workspaceContext: WorkspaceContext,
): void {
  if (isAnonymousPrincipal(principal)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${SESSION_CONTEXT}: the anonymous principal cannot hold a session (fail closed — there is no silent anonymous session)`,
    });
  }
  if (principal.tenantScope === 'untenanted') {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${SESSION_CONTEXT}: untenanted principals cannot hold tenant-scoped browser sessions (cross-tenant operator tooling is out of B004 scope)`,
      details: { principalId: principal.principalId },
    });
  }
  if (!sameTenantScope(principal.tenantScope, tenantId)) {
    throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `${SESSION_CONTEXT}: principal scope ${String(principal.tenantScope)} does not match session tenant ${String(tenantId)}`,
      details: {
        principalTenant: String(principal.tenantScope),
        sessionTenant: String(tenantId),
      },
    });
  }
  if (!sameTenantScope(tenantRef.tenantId, tenantId)) {
    throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `${SESSION_CONTEXT}: tenant ref belongs to tenant ${String(tenantRef.tenantId)}, not session tenant ${String(tenantId)}`,
      details: {
        refTenant: String(tenantRef.tenantId),
        sessionTenant: String(tenantId),
      },
    });
  }
  if (!sameTenantScope(workspaceContext.tenantId, tenantId)) {
    throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `${SESSION_CONTEXT}: workspace context belongs to tenant ${String(workspaceContext.tenantId)}, not session tenant ${String(tenantId)}`,
      details: {
        workspaceTenant: String(workspaceContext.tenantId),
        sessionTenant: String(tenantId),
      },
    });
  }
}

/**
 * Create a session record (constructor form). Fails closed on anonymous or
 * untenanted principals, cross-tenant material, malformed windows and
 * malformed provenance. `expiresAt`/`rotatesAt` derive deterministically
 * from `issuedAt` + `policy`.
 */
export function createSessionRecord(input: {
  readonly sessionId: string;
  readonly principal: SecurityPrincipal;
  readonly tenantId: string;
  readonly tenantRef?: TenantScopedRef;
  readonly workspaceContext: WorkspaceContext;
  readonly authMethod: AuthMethodDescriptor;
  readonly issuedAt: number;
  readonly policy: SessionPolicy;
  /** Optional pre-stamped epoch (0 by default; stores stamp the live value). */
  readonly revocationEpoch?: number;
}): SessionRecord {
  const sessionId = toSessionId(input.sessionId);
  if (!isSessionTenantId(input.tenantId)) {
    throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `${SESSION_CONTEXT}: invalid session tenant id: ${JSON.stringify(input.tenantId)}`,
    });
  }
  const tenantId = input.tenantId as TenantId;
  if (!isSecurityPrincipal(input.principal)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${SESSION_CONTEXT}: principal must be a structurally valid SecurityPrincipal`,
    });
  }
  const tenantRef =
    input.tenantRef !== undefined
      ? input.tenantRef
      : makeTenantScopedRef(tenantId, 'customer-identity', input.principal.principalId);
  if (!isTenantScopedRef(tenantRef)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_TENANT_REF, {
      message: `${SESSION_CONTEXT}: tenantRef must be a structurally valid TenantScopedRef`,
    });
  }
  if (!isWorkspaceContextSnapshot(input.workspaceContext)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_WORKSPACE_CONTEXT, {
      message: `${SESSION_CONTEXT}: workspaceContext must be a structurally valid B003 WorkspaceContext`,
    });
  }
  if (!isAuthMethodDescriptor(input.authMethod)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_AUTH_METHOD, {
      message: `${SESSION_CONTEXT}: authMethod must be a structurally valid AuthMethodDescriptor`,
    });
  }
  if (!Number.isInteger(input.issuedAt) || input.issuedAt < 0) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: issuedAt must be a non-negative integer (epoch ms)`,
      details: { received: input.issuedAt },
    });
  }
  const policy = validateSessionPolicy(input.policy);
  const revocationEpoch =
    input.revocationEpoch !== undefined ? input.revocationEpoch : 0;
  if (!Number.isInteger(revocationEpoch) || revocationEpoch < 0) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: revocationEpoch must be a non-negative integer`,
      details: { received: revocationEpoch },
    });
  }

  assertTenantScopeConsistency(input.principal, tenantId, tenantRef, input.workspaceContext);

  return deepFreeze({
    recordVersion: SESSION_RECORD_VERSION,
    sessionId,
    principal: input.principal,
    tenantId,
    tenantRef,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + policy.sessionTtlMs,
    rotatesAt: input.issuedAt + policy.rotationWindowMs,
    workspaceContext: input.workspaceContext,
    authMethod: input.authMethod,
    revocationEpoch,
  } satisfies SessionRecord);
}

/**
 * Strict parser for stored/transported session records: every embedded
 * contract is re-validated through ITS owner's parser (A034 principal,
 * A034 tenant ref, B003 workspace context), then the cross-field tenant
 * discipline runs. Sibling parser failures are wrapped as typed AUTH_*
 * errors with the original as `cause` (fail closed — corrupted storage can
 * never yield a usable session).
 */
export function toSessionRecord(value: unknown): SessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: a session record must be a plain object`,
    });
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== SESSION_RECORD_VERSION) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: unsupported recordVersion ${String(record['recordVersion'])} (expected ${String(SESSION_RECORD_VERSION)})`,
    });
  }

  let principal: SecurityPrincipal;
  try {
    principal = toSecurityPrincipal(record['principal']);
  } catch (cause) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${SESSION_CONTEXT}: embedded principal failed A034 validation`,
      cause,
    });
  }

  if (!isSessionTenantId(record['tenantId'])) {
    throw new AuthError(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `${SESSION_CONTEXT}: invalid session tenant id`,
    });
  }
  const tenantId = record['tenantId'] as TenantId;

  let tenantRef: TenantScopedRef;
  try {
    tenantRef = toTenantScopedRef(record['tenantRef']);
  } catch (cause) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_TENANT_REF, {
      message: `${SESSION_CONTEXT}: embedded tenant ref failed A034 validation`,
      cause,
    });
  }

  let workspaceContext: WorkspaceContext;
  try {
    workspaceContext = toWorkspaceContext(record['workspaceContext']);
  } catch (cause) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_WORKSPACE_CONTEXT, {
      message: `${SESSION_CONTEXT}: embedded workspace context failed B003 validation`,
      cause,
    });
  }

  const issuedAt = record['issuedAt'];
  if (typeof issuedAt !== 'number' || !Number.isInteger(issuedAt) || issuedAt < 0) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: issuedAt must be a non-negative integer (epoch ms)`,
    });
  }
  const expiresAt = record['expiresAt'];
  if (
    typeof expiresAt !== 'number' ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= issuedAt
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: expiresAt must be an integer after issuedAt`,
    });
  }
  const rotatesAt = record['rotatesAt'];
  if (
    typeof rotatesAt !== 'number' ||
    !Number.isInteger(rotatesAt) ||
    rotatesAt < issuedAt ||
    rotatesAt > expiresAt
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: rotatesAt must be an integer within the [issuedAt, expiresAt] window`,
    });
  }
  const revocationEpoch = record['revocationEpoch'];
  if (
    typeof revocationEpoch !== 'number' ||
    !Number.isInteger(revocationEpoch) ||
    revocationEpoch < 0
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: `${SESSION_CONTEXT}: revocationEpoch must be a non-negative integer`,
    });
  }

  const authMethod = record['authMethod'];
  if (!isAuthMethodDescriptor(authMethod)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_AUTH_METHOD, {
      message: `${SESSION_CONTEXT}: authMethod must be a structurally valid AuthMethodDescriptor`,
    });
  }

  const sessionId = isSessionId(record['sessionId'])
    ? (record['sessionId'] as SessionId)
    : toSessionId(String(record['sessionId']));

  assertTenantScopeConsistency(principal, tenantId, tenantRef, workspaceContext);

  return deepFreeze({
    recordVersion: SESSION_RECORD_VERSION,
    sessionId,
    principal,
    tenantId,
    tenantRef,
    issuedAt,
    expiresAt,
    rotatesAt,
    workspaceContext,
    authMethod,
    revocationEpoch,
  } satisfies SessionRecord);
}

// ---------------------------------------------------------------------------
// Lifecycle predicates (pure)
// ---------------------------------------------------------------------------

/** True iff the session is expired at `now` (expired exactly at expiresAt). */
export function isSessionExpired(session: SessionRecord, now: number): boolean {
  return now >= session.expiresAt;
}

/**
 * True iff the session's id should rotate at `now` (the rotation window
 * elapsed but the session is still live). Rotation is a hygiene window —
 * NOT a failure: a rotation-due session still validates as `valid`.
 */
export function requiresSessionRotation(session: SessionRecord, now: number): boolean {
  return now >= session.rotatesAt && now < session.expiresAt;
}
