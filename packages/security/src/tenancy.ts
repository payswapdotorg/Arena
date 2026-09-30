/**
 * Tenancy isolation validators (Work Order A034; spec/security.md S1.0
 * "Tenancy"; requirement R29; AGENTS.md "Customer data is never silently
 * reused across tenants").
 *
 * The S1.0 boundary-class list is the CLOSED vocabulary
 * TENANT_BOUNDARY_CLASSES — exactly the nine classes the spec names:
 * customer identities, expert records, tasks, environments,
 * trajectories, datasets, bodies, model interactions, certification
 * evidence. hygiene.test.ts asserts the list character-for-character
 * against the spec's enumeration so it can never drift silently.
 *
 * Every tenant-scoped resource in Arena addresses itself as a
 * TenantScopedRef {tenantId, boundaryClass, recordId}. The validators
 * here are PURE functions:
 *
 *   - assertTenantBoundary throws typed SECURITY_TENANT_MISMATCH on any
 *     cross-tenant access (the guard form);
 *   - checkTenantBoundary returns a closed TenancyDecision (the value
 *     form the service audits);
 *   - a null/missing/invalid tenant scope or resource FAILS CLOSED — it
 *     can never evaluate to an allowed boundary crossing.
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toTenantId } from './shared.js';
import type { TenantId } from './shared.js';

// ---------------------------------------------------------------------------
// The S1.0 boundary-class vocabulary (CLOSED)
// ---------------------------------------------------------------------------

/**
 * EXACTLY the nine tenant boundary classes of spec/security.md S1.0.
 * Appending a class requires a spec revision; the hygiene test pins this
 * list to the spec enumeration.
 */
export const TENANT_BOUNDARY_CLASSES = Object.freeze([
  'customer-identity',
  'expert-record',
  'task',
  'environment',
  'trajectory',
  'dataset',
  'body',
  'model-interaction',
  'certification-evidence',
] as const);

export type TenantBoundaryClass = (typeof TENANT_BOUNDARY_CLASSES)[number];

/** The spec/security.md S1.0 enumeration, for the hygiene parity pin. */
export const SPEC_S1_BOUNDARY_CLASSES = Object.freeze([
  'customer identities',
  'expert records',
  'tasks',
  'environments',
  'trajectories',
  'datasets',
  'bodies',
  'model interactions',
  'certification evidence',
] as const);

export function isTenantBoundaryClass(value: unknown): value is TenantBoundaryClass {
  return isEnumMember(value, TENANT_BOUNDARY_CLASSES);
}

// ---------------------------------------------------------------------------
// Tenant-scoped resource references
// ---------------------------------------------------------------------------

/** Wire version of the tenant-scoped ref shape. */
export const TENANT_SCOPED_REF_VERSION = 1 as const;

/**
 * The addressing form for EVERY tenant-scoped resource: which tenant
 * owns it, which S1.0 boundary class it belongs to, and its record id.
 */
export interface TenantScopedRef {
  readonly recordVersion: typeof TENANT_SCOPED_REF_VERSION;
  readonly tenantId: TenantId;
  readonly boundaryClass: TenantBoundaryClass;
  readonly recordId: string;
}

const REF_CONTEXT = 'TenantScopedRef';

export function isTenantScopedRef(value: unknown): value is TenantScopedRef {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== TENANT_SCOPED_REF_VERSION) return false;
  if (typeof record['tenantId'] !== 'string') return false;
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(record['tenantId'])) return false;
  if (!isTenantBoundaryClass(record['boundaryClass'])) return false;
  if (typeof record['recordId'] !== 'string') return false;
  return true;
}

export function toTenantScopedRef(value: unknown): TenantScopedRef {
  const record = expectFields(
    value,
    ['recordVersion', 'tenantId', 'boundaryClass', 'recordId'],
    [],
    SECURITY_ERROR_CODES.INVALID_RESOURCE,
    REF_CONTEXT,
  );
  if (record['recordVersion'] !== TENANT_SCOPED_REF_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${REF_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const tenantId = toTenantId(String(record['tenantId']), `${REF_CONTEXT}.tenantId`);
  const boundaryClass = expectEnumMember(
    record['boundaryClass'],
    TENANT_BOUNDARY_CLASSES,
    'boundaryClass',
    SECURITY_ERROR_CODES.INVALID_BOUNDARY_CLASS,
    REF_CONTEXT,
  );
  const recordId = record['recordId'];
  if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 128) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RESOURCE, {
      message: `${REF_CONTEXT}.recordId: must be a 1..128 character record identifier`,
      details: { received: JSON.stringify(recordId) },
    });
  }
  return deepFreeze({
    recordVersion: TENANT_SCOPED_REF_VERSION,
    tenantId,
    boundaryClass,
    recordId,
  });
}

/** Build a validated tenant-scoped ref (constructor form). */
export function makeTenantScopedRef(
  tenantId: string,
  boundaryClass: TenantBoundaryClass,
  recordId: string,
): TenantScopedRef {
  return toTenantScopedRef({
    recordVersion: TENANT_SCOPED_REF_VERSION,
    tenantId,
    boundaryClass,
    recordId,
  });
}

// ---------------------------------------------------------------------------
// Tenancy decisions (closed reasons, fail-closed)
// ---------------------------------------------------------------------------

/** The closed tenancy-decision reason vocabulary. */
export const TENANCY_DECISION_REASONS = Object.freeze([
  'tenant-match',
  'tenant-mismatch',
  'untenanted-accessor',
  'invalid-resource',
] as const);

export type TenancyDecisionReason = (typeof TENANCY_DECISION_REASONS)[number];

/** Machine-readable tenancy boundary decision. */
export interface TenancyDecision {
  readonly allowed: boolean;
  readonly reason: TenancyDecisionReason;
  readonly accessorTenant: TenantId | 'untenanted';
  readonly resourceTenant: TenantId | 'unknown';
}

/**
 * PURE tenancy boundary check: does `accessorTenant` scope-match the
 * tenant-scoped `resource`?
 *
 *   - same tenant            ⇒ allowed ('tenant-match');
 *   - different tenant       ⇒ denied ('tenant-mismatch');
 *   - untenanted accessor    ⇒ denied ('untenanted-accessor') — a
 *                               platform operator acting outside a tenant
 *                               gets NO implicit cross-tenant read;
 *   - invalid resource       ⇒ denied ('invalid-resource') — fail
 *                               closed, never an allowed crossing.
 */
export function checkTenantBoundary(
  accessorTenant: TenantId | 'untenanted' | null | undefined,
  resource: TenantScopedRef | null | undefined,
): TenancyDecision {
  if (resource === null || resource === undefined || !isTenantScopedRef(resource)) {
    return deepFreeze({
      allowed: false,
      reason: 'invalid-resource',
      accessorTenant: accessorTenant ?? 'untenanted',
      resourceTenant: 'unknown',
    });
  }
  if (accessorTenant === null || accessorTenant === undefined) {
    return deepFreeze({
      allowed: false,
      reason: 'untenanted-accessor',
      accessorTenant: 'untenanted',
      resourceTenant: resource.tenantId,
    });
  }
  if (accessorTenant === 'untenanted') {
    return deepFreeze({
      allowed: false,
      reason: 'untenanted-accessor',
      accessorTenant: 'untenanted',
      resourceTenant: resource.tenantId,
    });
  }
  if (accessorTenant !== resource.tenantId) {
    return deepFreeze({
      allowed: false,
      reason: 'tenant-mismatch',
      accessorTenant,
      resourceTenant: resource.tenantId,
    });
  }
  return deepFreeze({
    allowed: true,
    reason: 'tenant-match',
    accessorTenant,
    resourceTenant: resource.tenantId,
  });
}

/**
 * Guard form: throws typed SECURITY_TENANT_MISMATCH on any denied
 * boundary decision (cross-tenant access, untenanted accessor, invalid
 * resource). The guard exists for imperative call sites; the service
 * surface uses checkTenantBoundary so denials become AUDIT EVENTS, not
 * just exceptions.
 */
export function assertTenantBoundary(
  accessorTenant: TenantId | 'untenanted' | null | undefined,
  resource: TenantScopedRef | null | undefined,
): void {
  const decision = checkTenantBoundary(accessorTenant, resource);
  if (!decision.allowed) {
    throw new SecurityError(SECURITY_ERROR_CODES.TENANT_MISMATCH, {
      message: `tenancy boundary violation: ${decision.reason} (accessor=${String(decision.accessorTenant)}, resource tenant=${String(decision.resourceTenant)}, class=${resource !== null && resource !== undefined ? resource.boundaryClass : 'unknown'})`,
      details: {
        reason: decision.reason,
        accessorTenant: decision.accessorTenant,
        resourceTenant: decision.resourceTenant,
        boundaryClass: resource?.boundaryClass ?? null,
      },
    });
  }
}

/**
 * Validate a tenant-scoped record claim from ANY sibling package: the
 * claim must be a structurally valid TenantScopedRef whose boundaryClass
 * is in the closed S1.0 vocabulary and whose tenant owns the claim.
 * Used by the cross-tenant learning gate to pin dataset claims to
 * tenants.
 */
export function validateTenantScopedClaims(
  tenantId: TenantId,
  refs: readonly TenantScopedRef[],
): TenantScopedRef[] {
  const validated: TenantScopedRef[] = [];
  for (const ref of refs) {
    if (!isTenantScopedRef(ref)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_RESOURCE, {
        message: 'tenant-scoped claim is not a structurally valid TenantScopedRef',
        details: { received: JSON.stringify(ref) },
      });
    }
    if (ref.tenantId !== tenantId) {
      throw new SecurityError(SECURITY_ERROR_CODES.TENANT_MISMATCH, {
        message: `tenant-scoped claim for class '${ref.boundaryClass}' does not belong to tenant ${String(tenantId)}`,
        details: { claimTenant: ref.tenantId, expectedTenant: tenantId },
      });
    }
    validated.push(ref);
  }
  return validated;
}
