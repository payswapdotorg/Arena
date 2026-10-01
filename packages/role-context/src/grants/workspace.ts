/**
 * WorkspaceContext + ActiveRoleContext — the final links of the RC1.0 grant
 * chain, and the STRUCTURAL home of the "active role ≠ permission"
 * invariant.
 *
 *   Identity → TenantMembership → PermissionPolicy → GrantedRole →
 *   ActiveRoleContext → UI workflow
 *
 * RC1.0: "Changing the active role context changes how the product helps
 * the user. It never grants new permissions."
 *
 * THE INVARIANT IS STRUCTURAL, not merely tested:
 *
 *   - `activateRole(workspace, roleId, at, preserved?)` has NO parameter
 *     through which permissions, policies or grants could enter — its only
 *     inputs are the workspace, a role id, a timestamp and UI preservation
 *     hints;
 *   - the returned workspace copies `permissionPolicy` and `grantedRoles`
 *     BY REFERENCE from the input workspace (they are frozen);
 *   - `resolveActiveContext` builds an ActiveRoleContext that CARRIES the
 *     policy untouched and can only reference an already-granted role.
 *
 * No mutation of the permission surface is expressible through this API.
 * The dedicated invariant test (workspace.test.ts, "permission set is
 * byte-identical across role switches") asserts the fingerprints stay
 * byte-identical across every switch anyway — defense in depth.
 *
 * Cross-tenant fail-closed (architecture-lock rule 11): a role granted in
 * tenant A can never activate in tenant B — enforced BOTH at workspace
 * construction (a foreign grant cannot even enter the workspace) and at
 * activation/resolution (TENANT_SCOPE_VIOLATION).
 *
 * Everything here is pure and deterministic: no clock, no I/O, no
 * randomness. Identical inputs always produce identical outputs.
 */

import { canonicalJson } from '@arena/protocol-core';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import { getRoleDefinition, REFERENCE_ROLE_REGISTRY } from '../roles/registry.js';
import type { RoleRegistry } from '../roles/registry.js';
import { isGrantedRole, isRoleGrantActive, roleGrantInactivityReason } from './granted-role.js';
import type { GrantedRole } from './granted-role.js';
import { isMemberOfTenant, isTenantMembership } from './identity.js';
import type { Identity, TenantMembership } from './identity.js';
import { isPermissionPolicy, permissionFingerprint } from './permission.js';
import type { PermissionPolicy } from './permission.js';
import {
  deepFreeze,
  isIdentityId,
  isRoleId,
  isRoleContextTimestamp,
  isRoleGrantId,
  isTenantId,
  isWorkspaceId,
  toCanonicalObjectRef,
  toIdentityId,
  toRoleId,
  toRoleContextTimestamp,
  toTenantId,
  toWorkspaceId,
} from '../shared.js';
import type {
  CanonicalObjectRef,
  IdentityId,
  RoleContextTimestamp,
  RoleGrantId,
  RoleId,
  SurfaceId,
  TenantId,
  WorkspaceId,
} from '../shared.js';

export const WORKSPACE_CONTEXT_RECORD_VERSION = 1 as const;
export const ACTIVE_ROLE_CONTEXT_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Switch preservation (RC1.0 "Role switcher")
// ---------------------------------------------------------------------------

/**
 * What a role switch PRESERVES (RC1.0 verbatim semantics): the current
 * object/case where safe, the navigation breadcrumb, unsaved drafts when
 * supported, and the selected time range / filters where meaningful.
 *
 * It can NEVER carry a mutation capability: it is a plain display-context
 * record, and switching never preserves "a mutation capability that the new
 * role does not have" — that is decided by the permission authority, not by
 * this record.
 */
export interface SwitchPreservation {
  /** Canonical object ref (`<kind>:<id>@<version>`) of the object kept in view. */
  readonly canonicalObjectRef?: CanonicalObjectRef;
  readonly navigationBreadcrumb?: readonly string[];
  readonly unsavedDraftKeys?: readonly string[];
  readonly selectedTimeRange?: { readonly from: RoleContextTimestamp; readonly to: RoleContextTimestamp };
  readonly filters?: Readonly<Record<string, string>>;
}

function validateSwitchPreservation(value: SwitchPreservation): SwitchPreservation {
  if (typeof value !== 'object' || value === null) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: `switch preservation must be a plain object, got ${typeof value}`,
    });
  }
  const canonicalObjectRef =
    value.canonicalObjectRef !== undefined
      ? toCanonicalObjectRef(value.canonicalObjectRef)
      : undefined;
  const navigationBreadcrumb =
    value.navigationBreadcrumb !== undefined
      ? validateBreadcrumb(value.navigationBreadcrumb)
      : undefined;
  const unsavedDraftKeys =
    value.unsavedDraftKeys !== undefined ? validateDraftKeys(value.unsavedDraftKeys) : undefined;
  const selectedTimeRange =
    value.selectedTimeRange !== undefined ? validateTimeRange(value.selectedTimeRange) : undefined;
  const filters =
    value.filters !== undefined ? validateFilters(value.filters) : undefined;
  return deepFreeze({
    ...(canonicalObjectRef !== undefined ? { canonicalObjectRef } : {}),
    ...(navigationBreadcrumb !== undefined ? { navigationBreadcrumb } : {}),
    ...(unsavedDraftKeys !== undefined ? { unsavedDraftKeys } : {}),
    ...(selectedTimeRange !== undefined ? { selectedTimeRange } : {}),
    ...(filters !== undefined ? { filters } : {}),
  } satisfies SwitchPreservation);
}

function validateBreadcrumb(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'navigationBreadcrumb must be a non-empty array of route segments',
    });
  }
  if (!value.every((segment) => typeof segment === 'string' && segment.length > 0 && segment.length <= 200)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'navigationBreadcrumb segments must be non-empty strings of at most 200 characters',
    });
  }
  return Object.freeze([...value]);
}

function validateDraftKeys(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'unsavedDraftKeys must be a non-empty array of draft keys',
    });
  }
  if (!value.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 200)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'unsavedDraftKeys entries must be non-empty strings of at most 200 characters',
    });
  }
  return Object.freeze([...value]);
}

function validateTimeRange(value: {
  readonly from: RoleContextTimestamp;
  readonly to: RoleContextTimestamp;
}): { readonly from: RoleContextTimestamp; readonly to: RoleContextTimestamp } {
  const from = toRoleContextTimestamp(value.from);
  const to = toRoleContextTimestamp(value.to);
  if (to < from) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: `selectedTimeRange end must not precede its start (from: ${from}, to: ${to})`,
      details: { from, to },
    });
  }
  return deepFreeze({ from, to });
}

function validateFilters(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: `filters must be a plain object, got ${typeof value}`,
    });
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'filters must contain at least one entry when present',
    });
  }
  for (const [key, filterValue] of entries) {
    if (key.length === 0 || key.length > 100) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
        message: `filter keys must be 1..100 characters, got ${JSON.stringify(key)}`,
      });
    }
    if (typeof filterValue !== 'string' || filterValue.length > 200) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
        message: `filter values must be strings of at most 200 characters, got ${JSON.stringify(filterValue)}`,
      });
    }
  }
  return deepFreeze({ ...value });
}

// ---------------------------------------------------------------------------
// ActiveRoleContext
// ---------------------------------------------------------------------------

/**
 * The single currently-selected role within one workspace: WHICH granted
 * role the UI is now lensing through. Carries the grant it is based on
 * (provenance), the registry snapshot it validated against, and the
 * display-context preserved across the switch. It carries NO permission of
 * its own — the policy stays on the workspace, untouched.
 */
export interface ActiveRoleContext {
  readonly recordVersion: typeof ACTIVE_ROLE_CONTEXT_RECORD_VERSION;
  readonly identityId: IdentityId;
  readonly tenantId: TenantId;
  readonly workspaceId: WorkspaceId;
  readonly roleId: RoleId;
  /** The granted-role basis of this activation (activation provenance). */
  readonly grantId: RoleGrantId;
  readonly activatedAt: RoleContextTimestamp;
  readonly registryVersion: string;
  /** Display context preserved across the switch (never a permission). */
  readonly preserved?: SwitchPreservation;
}

// ---------------------------------------------------------------------------
// WorkspaceContext
// ---------------------------------------------------------------------------

/**
 * Tenant/workspace-scoped context: the granted-role set, the OPAQUE
 * permission policy (carried, never interpreted, never changed by
 * activation) and the optional active role.
 */
export interface WorkspaceContext {
  readonly recordVersion: typeof WORKSPACE_CONTEXT_RECORD_VERSION;
  readonly identityId: IdentityId;
  readonly tenantId: TenantId;
  readonly workspaceId: WorkspaceId;
  /** Deterministically ordered by (roleId, grantId); all same tenant + identity. */
  readonly grantedRoles: readonly GrantedRole[];
  /** Opaque — byte-identical across every role switch (the §5 invariant). */
  readonly permissionPolicy: PermissionPolicy;
  readonly activeRole?: ActiveRoleContext;
}

function sortGrantedRoles(grants: readonly GrantedRole[]): readonly GrantedRole[] {
  return Object.freeze(
    [...grants].sort((a, b) => {
      if (a.roleId !== b.roleId) return a.roleId < b.roleId ? -1 : 1;
      return a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0;
    }),
  );
}

function validateGrantedRolesForWorkspace(
  grants: readonly GrantedRole[],
  identityId: IdentityId,
  tenantId: TenantId,
): readonly GrantedRole[] {
  if (!Array.isArray(grants)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `grantedRoles must be an array, got ${typeof grants}`,
    });
  }
  const seenGrantIds = new Set<string>();
  for (const grant of grants) {
    if (!isGrantedRole(grant)) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
        message: `invalid granted role: ${JSON.stringify(grant)}`,
      });
    }
    if (grant.identityId !== identityId) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `granted role ${grant.grantId} belongs to identity ${grant.identityId}, not workspace identity ${identityId}`,
        details: { grantIdentityId: grant.identityId, workspaceIdentityId: identityId },
      });
    }
    if (grant.tenantId !== tenantId) {
      // Cross-tenant fail closed: a tenant-A grant can never even ENTER a
      // tenant-B workspace (architecture-lock rule 11).
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `granted role ${grant.grantId} belongs to tenant ${grant.tenantId}, not workspace tenant ${tenantId}`,
        details: { grantTenantId: grant.tenantId, workspaceTenantId: tenantId },
      });
    }
    if (seenGrantIds.has(grant.grantId)) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
        message: `duplicate granted role id: ${grant.grantId}`,
        details: { grantId: grant.grantId },
      });
    }
    seenGrantIds.add(grant.grantId);
  }
  return sortGrantedRoles(grants);
}

/**
 * Create a workspace context. Fails closed on cross-tenant grants (a
 * tenant-A grant cannot enter a tenant-B workspace), identity mismatches,
 * duplicate grant ids and policy/tenant mismatch. When `memberships` is
 * provided, the identity must be a member of the tenant.
 */
export function createWorkspaceContext(input: {
  readonly identityId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly permissionPolicy: PermissionPolicy;
  readonly grantedRoles: readonly GrantedRole[];
  readonly memberships?: readonly TenantMembership[];
}): WorkspaceContext {
  const identityId = toIdentityId(input.identityId);
  const tenantId = toTenantId(input.tenantId);
  const workspaceId = toWorkspaceId(input.workspaceId);
  if (!isPermissionPolicy(input.permissionPolicy)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_POLICY, {
      message: `invalid permission policy: ${JSON.stringify(input.permissionPolicy)}`,
    });
  }
  if (input.permissionPolicy.tenantId !== tenantId) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `permission policy ${input.permissionPolicy.policyId} belongs to tenant ${input.permissionPolicy.tenantId}, not workspace tenant ${tenantId}`,
      details: {
        policyTenantId: input.permissionPolicy.tenantId,
        workspaceTenantId: tenantId,
      },
    });
  }
  if (input.memberships !== undefined) {
    if (!Array.isArray(input.memberships) || !input.memberships.every((m) => isTenantMembership(m))) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
        message: 'memberships must be an array of TenantMembership records',
      });
    }
    if (!isMemberOfTenant(input.memberships, identityId, tenantId)) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `identity ${identityId} is not a member of tenant ${tenantId}`,
        details: { identityId, tenantId },
      });
    }
  }
  const grantedRoles = validateGrantedRolesForWorkspace(
    input.grantedRoles,
    identityId,
    tenantId,
  );
  return deepFreeze({
    recordVersion: WORKSPACE_CONTEXT_RECORD_VERSION,
    identityId,
    tenantId,
    workspaceId,
    grantedRoles,
    permissionPolicy: input.permissionPolicy,
  } satisfies WorkspaceContext);
}

/**
 * Activate (switch to) a role inside a workspace — THE role switcher.
 *
 * Structural note (the RC1.0 invariant made impossible to violate): this
 * function receives NO permission input. It validates the role is granted
 * and active, then returns a NEW workspace whose `permissionPolicy` and
 * `grantedRoles` are the SAME frozen objects as the input's. Switching
 * changes only `activeRole`.
 *
 * Typed rejections (closed set):
 *   - unknown role id                     → ROLE_NOT_FOUND;
 *   - role not granted to this identity   → ROLE_NOT_GRANTED;
 *   - grant belongs to another tenant     → TENANT_SCOPE_VIOLATION;
 *   - grant expired at `activatedAt`      → GRANT_EXPIRED;
 *   - grant not yet active                → GRANT_INACTIVE;
 *   - activation timestamp regression     → INVALID_TIMESTAMP.
 */
export function activateRole(
  workspace: WorkspaceContext,
  roleId: string,
  activatedAt: string,
  preserved?: SwitchPreservation,
): WorkspaceContext {
  const at = toRoleContextTimestamp(activatedAt);
  if (workspace.activeRole !== undefined && at < workspace.activeRole.activatedAt) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `activation timestamp must not precede the current activation (${workspace.activeRole.activatedAt}, attempted: ${at})`,
      details: { current: workspace.activeRole.activatedAt, attempted: at },
    });
  }
  // 1. The role must exist in the reference registry (unknown id → typed rejection).
  getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
  const role = toRoleId(roleId);
  // 2. The role must be granted to this identity in this workspace.
  const candidates = workspace.grantedRoles.filter(
    (grant) => grant.roleId === role && grant.identityId === workspace.identityId,
  );
  if (candidates.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_GRANTED, {
      message: `role ${JSON.stringify(roleId)} is not granted to identity ${workspace.identityId} in tenant ${workspace.tenantId}`,
      details: {
        identityId: workspace.identityId,
        tenantId: workspace.tenantId,
        roleId,
        grantedRoleIds: workspace.grantedRoles.map((grant) => grant.roleId),
      },
    });
  }
  // 3. Tenant scope (defensive; constructors already enforce this — a
  //    parsed record could still carry a foreign grant, so fail closed).
  for (const grant of candidates) {
    if (grant.tenantId !== workspace.tenantId) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `granted role ${grant.grantId} belongs to tenant ${grant.tenantId}, not workspace tenant ${workspace.tenantId}`,
        details: { grantTenantId: grant.tenantId, workspaceTenantId: workspace.tenantId },
      });
    }
  }
  // 4. The grant must be active at `at` (deterministic pick: earliest
  //    validFrom, then grantId — the entitlements ordering discipline).
  const active = candidates
    .filter((grant) => isRoleGrantActive(grant, at))
    .sort((a, b) => {
      if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
      return a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0;
    });
  const basis = active[0];
  if (basis === undefined) {
    const reason = roleGrantInactivityReason(candidates[0] as GrantedRole, at);
    if (reason === 'expired') {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.GRANT_EXPIRED, {
        message: `grant for role ${roleId} expired before ${at}`,
        details: { roleId, at, ...(candidates[0]?.expiresAt !== undefined ? { expiresAt: candidates[0].expiresAt } : {}) },
      });
    }
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.GRANT_INACTIVE, {
      message: `grant for role ${roleId} is not yet active at ${at} (validFrom: ${String(candidates[0]?.validFrom)})`,
      details: { roleId, at, validFrom: String(candidates[0]?.validFrom) },
    });
  }
  const preservation = preserved !== undefined ? validateSwitchPreservation(preserved) : undefined;
  const activeRole: ActiveRoleContext = deepFreeze({
    recordVersion: ACTIVE_ROLE_CONTEXT_RECORD_VERSION,
    identityId: workspace.identityId,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    roleId: role,
    grantId: basis.grantId,
    activatedAt: at,
    registryVersion: REFERENCE_ROLE_REGISTRY.registryVersion,
    ...(preservation !== undefined ? { preserved: preservation } : {}),
  } satisfies ActiveRoleContext);
  // THE INVARIANT: permissionPolicy and grantedRoles are carried over BY
  // REFERENCE — untouched, unfiltered, uninterpreted.
  return deepFreeze({
    recordVersion: WORKSPACE_CONTEXT_RECORD_VERSION,
    identityId: workspace.identityId,
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    grantedRoles: workspace.grantedRoles,
    permissionPolicy: workspace.permissionPolicy,
    activeRole,
  } satisfies WorkspaceContext);
}

// ---------------------------------------------------------------------------
// Full-chain resolution (Identity → membership → policy → grant → context)
// ---------------------------------------------------------------------------

/**
 * Resolve an ActiveRoleContext from the RAW grant chain: identity,
 * memberships, policy, granted roles, target tenant/workspace, role and
 * time. This is the natural home of the cross-tenant rejection: if the
 * identity holds the role in ANOTHER tenant but not in the target tenant,
 * the resolution fails closed with TENANT_SCOPE_VIOLATION (informative),
 * not a generic denial.
 *
 * Pure and deterministic: the active-grant pick is ordered by
 * (validFrom, grantId); identical inputs always yield identical outputs.
 */
export function resolveActiveContext(input: {
  readonly identity: Identity;
  readonly memberships: readonly TenantMembership[];
  readonly policy: PermissionPolicy;
  readonly grantedRoles: readonly GrantedRole[];
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly roleId: string;
  readonly at: string;
  readonly registry?: RoleRegistry;
}): ActiveRoleContext {
  const registry = input.registry ?? REFERENCE_ROLE_REGISTRY;
  const tenantId = toTenantId(input.tenantId);
  const workspaceId = toWorkspaceId(input.workspaceId);
  const at = toRoleContextTimestamp(input.at);
  // 1. The role must exist in the registry (unknown id → typed rejection).
  getRoleDefinition(registry, input.roleId);
  const role = toRoleId(input.roleId);
  // 2. The identity must be a member of the target tenant (tenant scope).
  if (!isMemberOfTenant(input.memberships, input.identity.identityId, tenantId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `identity ${input.identity.identityId} is not a member of tenant ${tenantId}`,
      details: { identityId: input.identity.identityId, tenantId },
    });
  }
  // 3. The policy must belong to the target tenant.
  if (!isPermissionPolicy(input.policy)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_POLICY, {
      message: `invalid permission policy: ${JSON.stringify(input.policy)}`,
    });
  }
  if (input.policy.tenantId !== tenantId) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `permission policy ${input.policy.policyId} belongs to tenant ${input.policy.tenantId}, not target tenant ${tenantId}`,
      details: { policyTenantId: input.policy.tenantId, tenantId },
    });
  }
  // 4. Grant lookup, tenant-scoped, with the informative cross-tenant path.
  const grants = input.grantedRoles.filter(
    (grant) =>
      grant.roleId === role &&
      grant.identityId === input.identity.identityId &&
      isGrantedRole(grant),
  );
  if (grants.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_GRANTED, {
      message: `role ${JSON.stringify(input.roleId)} is not granted to identity ${input.identity.identityId}`,
      details: { identityId: input.identity.identityId, roleId: input.roleId },
    });
  }
  const inTenant = grants.filter((grant) => grant.tenantId === tenantId);
  if (inTenant.length === 0) {
    const otherTenants = [...new Set(grants.map((grant) => grant.tenantId))].sort();
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `role ${input.roleId} is granted to identity ${input.identity.identityId} in tenant(s) ${otherTenants.join(', ')} but not in tenant ${tenantId} — a cross-tenant grant can never activate in another tenant`,
      details: { roleId: input.roleId, grantedInTenants: otherTenants, targetTenantId: tenantId },
    });
  }
  const active = inTenant
    .filter((grant) => isRoleGrantActive(grant, at))
    .sort((a, b) => {
      if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
      return a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0;
    });
  const basis = active[0];
  if (basis === undefined) {
    const reason = roleGrantInactivityReason(inTenant[0] as GrantedRole, at);
    if (reason === 'expired') {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.GRANT_EXPIRED, {
        message: `grant for role ${input.roleId} in tenant ${tenantId} expired before ${at}`,
        details: { roleId: input.roleId, at },
      });
    }
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.GRANT_INACTIVE, {
      message: `grant for role ${input.roleId} in tenant ${tenantId} is not yet active at ${at}`,
      details: { roleId: input.roleId, at, validFrom: String(inTenant[0]?.validFrom) },
    });
  }
  return deepFreeze({
    recordVersion: ACTIVE_ROLE_CONTEXT_RECORD_VERSION,
    identityId: input.identity.identityId,
    tenantId,
    workspaceId,
    roleId: role,
    grantId: basis.grantId,
    activatedAt: at,
    registryVersion: registry.registryVersion,
  } satisfies ActiveRoleContext);
}

// ---------------------------------------------------------------------------
// Inspectors (for the role switcher UI)
// ---------------------------------------------------------------------------

/** The role ids granted in this workspace, in canonical order. */
export function grantedRoleIds(workspace: WorkspaceContext): readonly RoleId[] {
  const ids = new Set<RoleId>(workspace.grantedRoles.map((grant) => grant.roleId));
  return [...ids].sort();
}

/** The surfaces emphasized by the ACTIVE role (empty when none is active). */
export function activeRoleSurfaces(workspace: WorkspaceContext): readonly SurfaceId[] {
  if (workspace.activeRole === undefined) return Object.freeze([]);
  return getRoleDefinition(REFERENCE_ROLE_REGISTRY, workspace.activeRole.roleId).primarySurfaces;
}

/**
 * Canonical byte-level fingerprint of the ENTIRE permission surface of a
 * workspace: the opaque policy plus every grant's (roleId, grantId,
 * policyId, window). Byte-identical fingerprints ⟺ byte-identical
 * permission surfaces — the comparison the §5 invariant test uses across
 * role switches.
 */
export function workspacePermissionFingerprint(workspace: WorkspaceContext): string {
  return canonicalJson({
    policy: {
      recordVersion: workspace.permissionPolicy.recordVersion,
      policyId: workspace.permissionPolicy.policyId,
      tenantId: workspace.permissionPolicy.tenantId,
      descriptor: workspace.permissionPolicy.descriptor,
      issuedAt: workspace.permissionPolicy.issuedAt,
    },
    grants: workspace.grantedRoles.map((grant) => ({
      roleId: grant.roleId,
      grantId: grant.grantId,
      policyId: grant.policyId,
      validFrom: grant.validFrom,
      ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
    })),
    // fingerprints: policy alone (policy descriptor identical) and full surface
    policyFingerprint: permissionFingerprint(workspace.permissionPolicy),
  });
}

// ---------------------------------------------------------------------------
// Structural parsing (loads from stores) — kept minimal and strict
// ---------------------------------------------------------------------------

function validateActiveRoleContext(
  value: ActiveRoleContext,
  workspaceTenantId: TenantId,
  workspaceIdentityId: IdentityId,
): ActiveRoleContext {
  if (typeof value !== 'object' || value === null) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'activeRole must be a plain object',
    });
  }
  if (value.identityId !== workspaceIdentityId) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `active role identity ${value.identityId} does not match workspace identity ${workspaceIdentityId}`,
    });
  }
  if (value.tenantId !== workspaceTenantId) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `active role tenant ${value.tenantId} does not match workspace tenant ${workspaceTenantId}`,
    });
  }
  if (!isRoleGrantId(value.grantId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: `invalid active role grantId: ${JSON.stringify(value.grantId)}`,
    });
  }
  if (!isRoleContextTimestamp(value.activatedAt)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid active role activatedAt: ${JSON.stringify(value.activatedAt)}`,
    });
  }
  if (!isRoleId(value.roleId) || !isWorkspaceId(value.workspaceId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: 'active role carries an invalid roleId or workspaceId',
    });
  }
  return value;
}

/**
 * Strict parser for a WorkspaceContext loaded from a store. Validates the
 * frozen invariants (tenant/identity coherence, grant tenant scope, policy
 * shape) and deep-freezes the result. Cross-tenant grants fail closed.
 */
export function toWorkspaceContext(value: unknown): WorkspaceContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE, {
      message: `a workspace context must be a plain object, got ${typeof value}`,
    });
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== WORKSPACE_CONTEXT_RECORD_VERSION) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported workspace context record version: ${String(candidate['recordVersion'])} (expected ${String(WORKSPACE_CONTEXT_RECORD_VERSION)})`,
    });
  }
  if (!isIdentityId(candidate['identityId'])) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid workspace identityId: ${JSON.stringify(candidate['identityId'])}`,
    });
  }
  if (!isTenantId(candidate['tenantId'])) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid workspace tenantId: ${JSON.stringify(candidate['tenantId'])}`,
    });
  }
  if (!isWorkspaceId(candidate['workspaceId'])) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid workspace workspaceId: ${JSON.stringify(candidate['workspaceId'])}`,
    });
  }
  const identityId = candidate['identityId'] as IdentityId;
  const tenantId = candidate['tenantId'] as TenantId;
  const policy = candidate['permissionPolicy'];
  if (!isPermissionPolicy(policy)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_POLICY, {
      message: `invalid permission policy: ${JSON.stringify(policy)}`,
    });
  }
  if (policy.tenantId !== tenantId) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: `permission policy ${policy.policyId} belongs to tenant ${policy.tenantId}, not workspace tenant ${tenantId}`,
    });
  }
  const grantedRoles = candidate['grantedRoles'];
  if (!Array.isArray(grantedRoles)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: 'grantedRoles must be an array',
    });
  }
  const ordered = validateGrantedRolesForWorkspace(grantedRoles, identityId, tenantId);
  const activeRole = candidate['activeRole'];
  let parsedActive: ActiveRoleContext | undefined;
  if (activeRole !== undefined) {
    parsedActive = validateActiveRoleContext(activeRole as ActiveRoleContext, tenantId, identityId);
  }
  return deepFreeze({
    recordVersion: WORKSPACE_CONTEXT_RECORD_VERSION,
    identityId,
    tenantId,
    workspaceId: candidate['workspaceId'] as WorkspaceId,
    grantedRoles: ordered,
    permissionPolicy: deepFreeze(policy),
    ...(parsedActive !== undefined ? { activeRole: parsedActive } : {}),
  } satisfies WorkspaceContext);
}
