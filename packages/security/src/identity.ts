/**
 * Tenant and principal model (Work Order A034; spec/security.md S1.0
 * "Tenancy"; AGENTS.md "Identity, tenancy, authorization, policy and
 * expert qualification are separate concerns").
 *
 * Identity and tenancy are SEPARATE concerns: a Principal carries BOTH a
 * tenant scope and a principal kind/role set, but the tenant scope is a
 * validated branded value on its own — every tenant-scoped record in
 * Arena addresses resources by TenantId, and the tenancy validators
 * (tenancy.ts) compare tenant ids, never principal identity.
 *
 * The anonymous principal is modeled EXPLICITLY (never as a null or
 * missing value): `makeAnonymousPrincipal()` mints a principal whose
 * kind is 'anonymous' and whose tenant scope is 'untenanted'. The
 * authorization engine denies anonymous principals every action (closed
 * reason 'principal-unauthenticated') — fail-closed, never a silent
 * fallback.
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember, toNeutralId } from './shared.js';
import { toPrincipalId, toTenantId } from './shared.js';
import type { NeutralId, PrincipalId, SecurityTimestamp, TenantId } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * Principal kinds — the S1.0 tenant-boundary actors. 'customer-identity'
 * covers tenant-scoped customer identities; 'expert' covers expert
 * contributors; 'service-principal' covers internal services; '
 * platform-operator' covers Arena operators acting OUTSIDE any tenant;
 * 'system-agent' covers agent bodies acting on behalf of a tenant; '
 * anonymous' is the explicit unauthenticated principal.
 */
export const PRINCIPAL_KINDS = Object.freeze([
  'customer-identity',
  'expert',
  'service-principal',
  'platform-operator',
  'system-agent',
  'anonymous',
] as const);

export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/**
 * Role vocabulary — coarse, closed, and deliberately NOT a permission
 * system: roles are inputs to policy statements, never authority by
 * themselves. The authorization engine NEVER grants an action because of
 * a role alone; a matching allow policy statement is always required
 * (fail-closed default 'no-matching-policy').
 */
export const PRINCIPAL_ROLES = Object.freeze([
  'tenant-owner',
  'tenant-admin',
  'tenant-member',
  'expert-contributor',
  'auditor',
  'platform-operator',
  'system',
] as const);

export type PrincipalRole = (typeof PRINCIPAL_ROLES)[number];

export function isPrincipalKind(value: unknown): value is PrincipalKind {
  return isEnumMember(value, PRINCIPAL_KINDS);
}

export function isPrincipalRole(value: unknown): value is PrincipalRole {
  return isEnumMember(value, PRINCIPAL_ROLES);
}

// ---------------------------------------------------------------------------
// Principal shape
// ---------------------------------------------------------------------------

/** Wire version of the principal record shape. */
export const PRINCIPAL_RECORD_VERSION = 1 as const;

/**
 * A validated security principal. `tenantScope` is 'untenanted' for the
 * anonymous principal and platform operators acting cross-tenant; every
 * other kind MUST carry an explicit tenant id (validated — an
 * untenanted customer-identity or expert principal is REJECTED at
 * construction).
 */
export interface SecurityPrincipal {
  readonly recordVersion: typeof PRINCIPAL_RECORD_VERSION;
  readonly principalId: PrincipalId;
  readonly kind: PrincipalKind;
  readonly tenantScope: TenantId | 'untenanted';
  readonly roles: readonly PrincipalRole[];
  /** Optional display label (never an authority input). */
  readonly label?: NeutralId | null;
}

const CONTEXT = 'SecurityPrincipal';

export function isSecurityPrincipal(value: unknown): value is SecurityPrincipal {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== PRINCIPAL_RECORD_VERSION) return false;
  if (typeof record['principalId'] !== 'string') return false;
  if (!isPrincipalKind(record['kind'])) return false;
  const tenantScope = record['tenantScope'];
  if (tenantScope !== 'untenanted' && typeof tenantScope !== 'string') return false;
  if (typeof tenantScope === 'string' && tenantScope !== 'untenanted') {
    // tenant charset check without throwing
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(tenantScope)) return false;
  }
  const roles = record['roles'];
  if (!Array.isArray(roles)) return false;
  for (const role of roles) {
    if (!isPrincipalRole(role)) return false;
  }
  const label = record['label'];
  if (label !== undefined && label !== null && typeof label !== 'string') return false;
  return true;
}

/** Validate and brand the principal shape (strict fields, closed enums). */
export function toSecurityPrincipal(value: unknown): SecurityPrincipal {
  const record = expectFields(
    value,
    ['recordVersion', 'principalId', 'kind', 'tenantScope', 'roles'],
    ['label'],
    SECURITY_ERROR_CODES.INVALID_PRINCIPAL,
    CONTEXT,
  );
  if (record['recordVersion'] !== PRINCIPAL_RECORD_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${CONTEXT}: unsupported principal recordVersion: ${String(record['recordVersion'])} (expected ${String(PRINCIPAL_RECORD_VERSION)})`,
    });
  }
  const principalId = toPrincipalId(String(record['principalId']), `${CONTEXT}.principalId`);
  const kind = expectEnumMember(
    record['kind'],
    PRINCIPAL_KINDS,
    'kind',
    SECURITY_ERROR_CODES.INVALID_PRINCIPAL,
    CONTEXT,
  );
  const rawTenantScope = record['tenantScope'];
  let tenantScope: TenantId | 'untenanted';
  if (rawTenantScope === 'untenanted') {
    tenantScope = 'untenanted';
  } else {
    tenantScope = toTenantId(String(rawTenantScope), `${CONTEXT}.tenantScope`);
  }
  const rawRoles = record['roles'];
  if (!Array.isArray(rawRoles)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_ROLE, {
      message: `${CONTEXT}: roles must be an array of closed-vocabulary roles`,
      details: { receivedType: typeof rawRoles },
    });
  }
  const roles = rawRoles.map((role, index) =>
    expectEnumMember(
      role,
      PRINCIPAL_ROLES,
      `roles[${String(index)}]`,
      SECURITY_ERROR_CODES.INVALID_ROLE,
      CONTEXT,
    ),
  );
  if (new Set(roles).size !== roles.length) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_ROLE, {
      message: `${CONTEXT}: roles must be unique (duplicates rejected)`,
      details: { roles: [...roles] },
    });
  }

  // Tenancy discipline: tenant-bound principal kinds MUST carry a tenant.
  if (tenantScope === 'untenanted' && kind !== 'anonymous' && kind !== 'platform-operator') {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${CONTEXT}: principal kind '${kind}' must carry an explicit tenantScope (only anonymous and platform-operator principals may be untenanted)`,
      details: { kind },
    });
  }

  const label = record['label'] === null || record['label'] === undefined
    ? null
    : toNeutralId(String(record['label']), `${CONTEXT}.label`);

  return deepFreeze({
    recordVersion: PRINCIPAL_RECORD_VERSION,
    principalId,
    kind,
    tenantScope,
    roles: Object.freeze([...roles]),
    ...(label !== null ? { label } : {}),
  });
}

/**
 * The explicit anonymous principal. Its id is the reserved neutral id
 * 'anonymous' — a constant, not a minted identity. The authorization
 * engine denies it every action with reason 'principal-unauthenticated'.
 */
export const ANONYMOUS_PRINCIPAL_ID = 'anonymous' as PrincipalId;

export function makeAnonymousPrincipal(): SecurityPrincipal {
  return toSecurityPrincipal({
    recordVersion: PRINCIPAL_RECORD_VERSION,
    principalId: ANONYMOUS_PRINCIPAL_ID,
    kind: 'anonymous',
    tenantScope: 'untenanted',
    roles: [],
    label: null,
  });
}

/** True iff the principal is the explicit unauthenticated principal. */
export function isAnonymousPrincipal(principal: SecurityPrincipal): boolean {
  return principal.kind === 'anonymous' && principal.tenantScope === 'untenanted';
}

// ---------------------------------------------------------------------------
// Tenant model
// ---------------------------------------------------------------------------

/** Wire version of the tenant record shape. */
export const TENANT_RECORD_VERSION = 1 as const;

/**
 * A validated tenant record — the isolation boundary owner. Tenants are
 * addressed by TenantId; the record carries only descriptive metadata
 * (never authority). `status` is an append-only lifecycle projection:
 * active | suspended (suspension denies NEW authorizations; existing
 * audit history remains readable).
 */
export const TENANT_STATUSES = Object.freeze(['active', 'suspended'] as const);
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface TenantRecord {
  readonly recordVersion: typeof TENANT_RECORD_VERSION;
  readonly tenantId: TenantId;
  readonly status: TenantStatus;
  readonly displayName: NeutralId | null;
  readonly createdAt: SecurityTimestamp;
}

const TENANT_CONTEXT = 'TenantRecord';

export function isTenantRecord(value: unknown): value is TenantRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== TENANT_RECORD_VERSION) return false;
  if (typeof record['tenantId'] !== 'string') return false;
  if (!isEnumMember(record['status'], TENANT_STATUSES)) return false;
  if (record['displayName'] !== null && typeof record['displayName'] !== 'string') return false;
  if (typeof record['createdAt'] !== 'string') return false;
  return true;
}

export function toTenantRecord(value: unknown): TenantRecord {
  const record = expectFields(
    value,
    ['recordVersion', 'tenantId', 'status', 'displayName', 'createdAt'],
    [],
    SECURITY_ERROR_CODES.INVALID_TENANT,
    TENANT_CONTEXT,
  );
  if (record['recordVersion'] !== TENANT_RECORD_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${TENANT_CONTEXT}: unsupported tenant recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const tenantId = toTenantId(String(record['tenantId']), `${TENANT_CONTEXT}.tenantId`);
  const status = expectEnumMember(
    record['status'],
    TENANT_STATUSES,
    'status',
    SECURITY_ERROR_CODES.INVALID_TENANT,
    TENANT_CONTEXT,
  );
  const displayName =
    record['displayName'] === null || record['displayName'] === undefined
      ? null
      : toNeutralId(String(record['displayName']), `${TENANT_CONTEXT}.displayName`);
  const createdAt = record['createdAt'] as string;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${TENANT_CONTEXT}.createdAt: invalid security timestamp: ${JSON.stringify(createdAt)}`,
    });
  }
  return deepFreeze({
    recordVersion: TENANT_RECORD_VERSION,
    tenantId,
    status,
    displayName,
    createdAt: createdAt as SecurityTimestamp,
  });
}
