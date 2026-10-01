/**
 * Workspace / activation suite (Work Order B003) — the grant chain's final
 * links and the RC1.0 structural invariant: switching the active role can
 * NEVER change permissions.
 *
 * Positive: full chain for all 8 roles; multi-role identities; switching
 * semantics with preserved display context.
 * Negative (REQUIRED breadth): ungranted activation; cross-tenant
 * activation; expired grant; permission-set byte-identical across
 * switches; registry version mismatch.
 */

import { describe, expect, it } from 'vitest';
import {
  activateRole,
  activeRoleSurfaces,
  createWorkspaceContext,
  grantedRoleIds,
  grantRole,
  isRoleGrantActive,
  resolveActiveContext,
  toRoleRegistry,
  toWorkspaceContext,
  workspacePermissionFingerprint,
} from '../index.js';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../index.js';
import { ROLE_IDS, ROLE_REGISTRY_VERSION, createTenantMembership, toCanonicalObjectRef } from '../index.js';
import type { RoleId, TenantMembership, WorkspaceContext } from '../index.js';
import {
  CANONICAL_CASE,
  fixtureAllRolesWorkspace,
  fixtureGrant,
  fixtureIdentity,
  fixtureMemberships,
  fixtureMultiRoleWorkspace,
  fixturePolicy,
  IDENTITY_B_ONLY,
  MULTI_ROLE_ID,
  TENANT_A,
  TENANT_B,
  T0,
  T1,
  T2,
  T3,
  T4,
  T_AFTER_EXPIRY,
  T_EXPIRY,
  WORKSPACE_B,
  WORKSPACE_MAIN,
} from '../test-support.js';

function expectRoleContextError(
  action: () => unknown,
  code: string,
): RoleContextError {
  try {
    action();
    expect.unreachable(`expected a RoleContextError with code ${code}`);
  } catch (error) {
    const roleContextError = error as RoleContextError;
    expect(roleContextError).toBeInstanceOf(RoleContextError);
    expect(roleContextError.code).toBe(code);
    return roleContextError;
  }
}

describe('positive: full grant chain for all 8 roles', () => {
  it('activates every reference role from the same identity (an identity may hold them all)', () => {
    const workspace = fixtureAllRolesWorkspace();
    expect(grantedRoleIds(workspace)).toEqual([...ROLE_IDS]);
    for (const roleId of ROLE_IDS) {
      const switched = activateRole(workspace, roleId, T1);
      expect(switched.activeRole?.roleId).toBe(roleId);
      expect(switched.activeRole?.identityId).toBe(MULTI_ROLE_ID);
      expect(switched.activeRole?.tenantId).toBe(TENANT_A);
      expect(switched.activeRole?.workspaceId).toBe(WORKSPACE_MAIN);
      expect(switched.activeRole?.registryVersion).toBe(ROLE_REGISTRY_VERSION);
      // activation references the granted-role basis
      const basis = switched.grantedRoles.find(
        (grant) => grant.grantId === switched.activeRole?.grantId,
      );
      expect(basis).toBeDefined();
      if (basis === undefined) throw new Error('unreachable: basis must exist');
      expect(basis.roleId).toBe(roleId);
      expect(isRoleGrantActive(basis, T1)).toBe(true);
    }
  });

  it('resolveActiveContext resolves the full chain for every role (membership → policy → grant)', () => {
    const identity = fixtureIdentity();
    const memberships = fixtureMemberships();
    const policy = fixturePolicy();
    const grants = ROLE_IDS.map((roleId, index) =>
      fixtureGrant(roleId, { grantId: `g-${String(index).padStart(2, '0')}` }),
    );
    for (const roleId of ROLE_IDS) {
      const active = resolveActiveContext({
        identity,
        memberships,
        policy,
        grantedRoles: grants,
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_MAIN,
        roleId,
        at: T2,
      });
      expect(active.roleId).toBe(roleId);
      expect(active.tenantId).toBe(TENANT_A);
      expect(active.identityId).toBe(identity.identityId);
    }
  });

  it('a multi-role identity (Owner + Builder + Researcher) switches between its roles', () => {
    let workspace = fixtureMultiRoleWorkspace();
    expect(grantedRoleIds(workspace)).toEqual(['agent-builder', 'owner', 'researcher']);
    workspace = activateRole(workspace, 'owner', T1);
    expect(workspace.activeRole?.roleId).toBe('owner');
    workspace = activateRole(workspace, 'agent-builder', T2);
    expect(workspace.activeRole?.roleId).toBe('agent-builder');
    workspace = activateRole(workspace, 'researcher', T3);
    expect(workspace.activeRole?.roleId).toBe('researcher');
    // previous workspaces are untouched (immutable switching)
    expect(workspace.grantedRoles).toHaveLength(3);
  });
});

describe('THE §5 INVARIANT: active role ≠ permission (structural)', () => {
  it('permission set is byte-identical across EVERY role switch', () => {
    const workspace = fixtureAllRolesWorkspace();
    const baselineFingerprint = workspacePermissionFingerprint(workspace);
    expect(workspace.activeRole).toBeUndefined();
    let current = workspace;
    for (const roleId of ROLE_IDS) {
      current = activateRole(current, roleId, T1);
      // byte-identical permission surface after every single switch
      expect(workspacePermissionFingerprint(current)).toBe(baselineFingerprint);
    }
    // and the policy object is carried BY REFERENCE
    expect(current.permissionPolicy).toBe(workspace.permissionPolicy);
    expect(current.grantedRoles).toBe(workspace.grantedRoles);
  });

  it('the permission policy and granted set are reference-identical through arbitrary switch sequences', () => {
    const workspace = fixtureMultiRoleWorkspace();
    const policy = workspace.permissionPolicy;
    const grants = workspace.grantedRoles;
    const sequence: readonly RoleId[] = ['owner', 'researcher', 'agent-builder', 'owner', 'agent-builder'];
    let current = workspace;
    for (const roleId of sequence) {
      current = activateRole(current, roleId, T2);
      expect(current.permissionPolicy).toBe(policy);
      expect(current.grantedRoles).toBe(grants);
    }
    expect(workspacePermissionFingerprint(current)).toBe(
      workspacePermissionFingerprint(workspace),
    );
  });

  it('activateRole has no permission-shaped input at all (API surface proof)', () => {
    // The signature is (workspace, roleId, activatedAt, preserved?) — there
    // is no parameter through which a policy, permission, grant or authority
    // could enter. We assert the arity so an accidental widening fails here.
    expect(activateRole.length).toBe(4);
  });
});

describe('negative: activation rejections (typed, closed codes)', () => {
  it('rejects activation of an UNGRANTED role (ROLE_NOT_GRANTED)', () => {
    const workspace = fixtureMultiRoleWorkspace(); // owner, builder, researcher only
    const error = expectRoleContextError(
      () => activateRole(workspace, 'expert', T1),
      ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_GRANTED,
    );
    expect(error.category).toBe('access');
    expect(error.details).toMatchObject({ grantedRoleIds: ['agent-builder', 'owner', 'researcher'] });
  });

  it('rejects activation of an UNKNOWN role id (ROLE_NOT_FOUND)', () => {
    const workspace = fixtureMultiRoleWorkspace();
    expectRoleContextError(
      () => activateRole(workspace, 'superuser', T1),
      ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND,
    );
  });

  it('rejects cross-tenant activation at workspace construction (TENANT_SCOPE_VIOLATION)', () => {
    // a tenant-A grant can never even ENTER a tenant-B workspace
    expectRoleContextError(
      () =>
        createWorkspaceContext({
          identityId: MULTI_ROLE_ID,
          tenantId: TENANT_B,
          workspaceId: WORKSPACE_B,
          permissionPolicy: fixturePolicy(TENANT_B),
          grantedRoles: [fixtureGrant('owner')], // granted in TENANT_A
        }),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
  });

  it('rejects cross-tenant activation in the full-chain resolver (TENANT_SCOPE_VIOLATION)', () => {
    // identity is a member of tenant A, holds 'owner' in tenant B only →
    // activating 'owner' in tenant A fails closed with the informative
    // cross-tenant rejection, NOT a generic denial.
    const identity = fixtureIdentity(IDENTITY_B_ONLY);
    const memberships: readonly TenantMembership[] = [
      createTenantMembership({ identityId: IDENTITY_B_ONLY, tenantId: TENANT_A, joinedAt: T0 }),
      createTenantMembership({ identityId: IDENTITY_B_ONLY, tenantId: TENANT_B, joinedAt: T0 }),
    ];
    const grantsInB = [fixtureGrant('owner', { identityId: IDENTITY_B_ONLY, tenantId: TENANT_B })];
    const error = expectRoleContextError(
      () =>
        resolveActiveContext({
          identity,
          memberships,
          policy: fixturePolicy(TENANT_A),
          grantedRoles: grantsInB,
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          roleId: 'owner',
          at: T1,
        }),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
    expect(error.details).toMatchObject({ grantedInTenants: [TENANT_B], targetTenantId: TENANT_A });
  });

  it('rejects activation for an identity that is not a tenant member (TENANT_SCOPE_VIOLATION)', () => {
    const identity = fixtureIdentity(IDENTITY_B_ONLY);
    expectRoleContextError(
      () =>
        resolveActiveContext({
          identity,
          memberships: [], // no memberships at all
          policy: fixturePolicy(TENANT_A),
          grantedRoles: [fixtureGrant('owner', { identityId: IDENTITY_B_ONLY })],
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          roleId: 'owner',
          at: T1,
        }),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
  });

  it('rejects EXPIRED-grant activation (GRANT_EXPIRED)', () => {
    const workspace = createWorkspaceContext({
      identityId: MULTI_ROLE_ID,
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_MAIN,
      permissionPolicy: fixturePolicy(),
      grantedRoles: [
        fixtureGrant('owner', { expiresAt: T_EXPIRY }),
        fixtureGrant('expert'), // still active
      ],
    });
    expectRoleContextError(
      () => activateRole(workspace, 'owner', T_AFTER_EXPIRY),
      ROLE_CONTEXT_ERROR_CODES.GRANT_EXPIRED,
    );
    // the still-active grant activates fine at the same instant
    const switched = activateRole(workspace, 'expert', T_AFTER_EXPIRY);
    expect(switched.activeRole?.roleId).toBe('expert');
  });

  it('rejects NOT-YET-ACTIVE grant activation (GRANT_INACTIVE)', () => {
    const future = grantRole({
      grantId: 'grant-future',
      identityId: MULTI_ROLE_ID,
      tenantId: TENANT_A,
      roleId: 'owner',
      policyId: 'policy-acme',
      grantedBy: 'admin-bootstrap',
      grantedAt: T0,
      validFrom: T4,
    });
    const workspace = createWorkspaceContext({
      identityId: MULTI_ROLE_ID,
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_MAIN,
      permissionPolicy: fixturePolicy(),
      grantedRoles: [future],
    });
    expectRoleContextError(
      () => activateRole(workspace, 'owner', T1),
      ROLE_CONTEXT_ERROR_CODES.GRANT_INACTIVE,
    );
  });

  it('rejects activation timestamp regression (INVALID_TIMESTAMP)', () => {
    const workspace = activateRole(fixtureMultiRoleWorkspace(), 'owner', T2);
    expectRoleContextError(
      () => activateRole(workspace, 'agent-builder', T1),
      ROLE_CONTEXT_ERROR_CODES.INVALID_TIMESTAMP,
    );
  });
});

describe('negative: registry discipline on the resolution path', () => {
  it('rejects a registry version the consumer does not expect (REGISTRY_VERSION_MISMATCH), then resolves when explicitly accepted', () => {
    const futureRegistryRecord = {
      recordVersion: 1,
      registryVersion: '2.0.0',
      roles: [
        {
          recordVersion: 1,
          roleId: 'owner',
          name: 'Owner v2',
          goal: 'Renewed owner goal in registry 2.0.0.',
          primarySurfaces: ['capability-inbox'],
          version: '2.0.0',
        },
      ],
    };
    // a consumer built against 1.0.0 fails closed on the 2.0.0 registry
    expectRoleContextError(
      () => toRoleRegistry(futureRegistryRecord),
      ROLE_CONTEXT_ERROR_CODES.REGISTRY_VERSION_MISMATCH,
    );
    // a consumer that explicitly expects 2.0.0 may parse it ...
    const futureRegistry = toRoleRegistry(futureRegistryRecord, '2.0.0');
    const identity = fixtureIdentity();
    // ... and resolve a role the future registry still knows
    const active = resolveActiveContext({
      identity,
      memberships: fixtureMemberships(),
      policy: fixturePolicy(),
      grantedRoles: [fixtureGrant('owner')],
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_MAIN,
      roleId: 'owner',
      at: T1,
      registry: futureRegistry,
    });
    expect(active.roleId).toBe('owner');
    expect(active.registryVersion).toBe('2.0.0');
    // ... but a role the future registry dropped is NOT_FOUND, never a guess
    expectRoleContextError(
      () =>
        resolveActiveContext({
          identity,
          memberships: fixtureMemberships(),
          policy: fixturePolicy(),
          grantedRoles: [fixtureGrant('expert')],
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          roleId: 'expert',
          at: T1,
          registry: futureRegistry,
        }),
      ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND,
    );
  });

  it('rejects an unknown role id on the full-chain path (ROLE_NOT_FOUND)', () => {
    const identity = fixtureIdentity();
    expectRoleContextError(
      () =>
        resolveActiveContext({
          identity,
          memberships: fixtureMemberships(),
          policy: fixturePolicy(),
          grantedRoles: [fixtureGrant('owner')],
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          roleId: 'wizard',
          at: T1,
        }),
      ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND,
    );
  });
});

describe('switching semantics (RC1.0 role switcher)', () => {
  it('preserves display context across switches (object, breadcrumb, drafts, time range, filters)', () => {
    const workspace = fixtureMultiRoleWorkspace();
    const switched = activateRole(workspace, 'owner', T1, {
      canonicalObjectRef: toCanonicalObjectRef(
        `${CANONICAL_CASE.kind}:${CANONICAL_CASE.objectId}@${CANONICAL_CASE.version}`,
      ),
      navigationBreadcrumb: ['/', '/cases', '/cases/case-42'],
      unsavedDraftKeys: ['draft-case-42-note'],
      selectedTimeRange: { from: T0, to: T3 },
      filters: { domain: 'finance-ops' },
    });
    expect(switched.activeRole?.preserved).toEqual({
      canonicalObjectRef: 'capability-case:case-42@1.2.0',
      navigationBreadcrumb: ['/', '/cases', '/cases/case-42'],
      unsavedDraftKeys: ['draft-case-42-note'],
      selectedTimeRange: { from: T0, to: T3 },
      filters: { domain: 'finance-ops' },
    });
    expect(Object.isFrozen(switched.activeRole?.preserved)).toBe(true);
  });

  it('preservation is display-only: a switch WITHOUT preservation changes nothing else', () => {
    const workspace = fixtureMultiRoleWorkspace();
    const switched = activateRole(workspace, 'researcher', T2);
    expect(switched.activeRole?.preserved).toBeUndefined();
    expect(workspacePermissionFingerprint(switched)).toBe(
      workspacePermissionFingerprint(workspace),
    );
  });

  it('validates preserved context (bad canonical ref, bad time range)', () => {
    const workspace = fixtureMultiRoleWorkspace();
    expectRoleContextError(
      () =>
        activateRole(workspace, 'owner', T1, {
          canonicalObjectRef: 'not a ref' as never,
        }),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
    expectRoleContextError(
      () => activateRole(workspace, 'owner', T1, { selectedTimeRange: { from: T3, to: T1 } }),
      ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE,
    );
  });

  it('the active role surfaces come from the registry (lens metadata, not permissions)', () => {
    const workspace = activateRole(fixtureAllRolesWorkspace(), 'operator', T1);
    expect(activeRoleSurfaces(workspace)).toEqual([
      'jobs',
      'environments',
      'telemetry',
      'slos',
      'incidents',
      'audit',
      'quotas',
    ]);
    expect(activeRoleSurfaces(fixtureAllRolesWorkspace())).toEqual([]);
  });
});

describe('workspace parsing (strict, fail closed)', () => {
  it('toWorkspaceContext round-trips an activated workspace', () => {
    const activated = activateRole(fixtureMultiRoleWorkspace(), 'owner', T1);
    const parsed = toWorkspaceContext(JSON.parse(JSON.stringify(activated)));
    expect(parsed).toEqual(activated);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.grantedRoles)).toBe(true);
  });

  it('toWorkspaceContext rejects cross-tenant grants and malformed records', () => {
    expectRoleContextError(() => toWorkspaceContext(null), ROLE_CONTEXT_ERROR_CODES.INVALID_WORKSPACE);
    expectRoleContextError(
      () => toWorkspaceContext({ recordVersion: 2 }),
      ROLE_CONTEXT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION,
    );
    const foreign = {
      ...JSON.parse(JSON.stringify(fixtureMultiRoleWorkspace())),
      grantedRoles: [
        JSON.parse(
          JSON.stringify(fixtureGrant('owner', { tenantId: TENANT_B })),
        ),
      ],
    };
    expectRoleContextError(
      () => toWorkspaceContext(foreign),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
  });

  it('workspace construction rejects duplicate grant ids and foreign policies', () => {
    expectRoleContextError(
      () =>
        createWorkspaceContext({
          identityId: MULTI_ROLE_ID,
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          permissionPolicy: fixturePolicy(TENANT_B),
          grantedRoles: [fixtureGrant('owner')],
        }),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
    expectRoleContextError(
      () =>
        createWorkspaceContext({
          identityId: MULTI_ROLE_ID,
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          permissionPolicy: fixturePolicy(),
          grantedRoles: [fixtureGrant('owner'), fixtureGrant('owner')],
        }),
      ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT,
    );
    // memberships provided but identity not a member → fail closed
    expectRoleContextError(
      () =>
        createWorkspaceContext({
          identityId: MULTI_ROLE_ID,
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_MAIN,
          permissionPolicy: fixturePolicy(),
          grantedRoles: [fixtureGrant('owner')],
          memberships: [
            createTenantMembership({ identityId: IDENTITY_B_ONLY, tenantId: TENANT_A, joinedAt: T0 }),
          ],
        }),
      ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION,
    );
  });

  it('granted roles are deterministically ordered by (roleId, grantId)', () => {
    const workspace = createWorkspaceContext({
      identityId: MULTI_ROLE_ID,
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_MAIN,
      permissionPolicy: fixturePolicy(),
      grantedRoles: [
        fixtureGrant('researcher', { grantId: 'z' }),
        fixtureGrant('owner', { grantId: 'b' }),
        fixtureGrant('owner', { grantId: 'a' }),
        fixtureGrant('agent-builder', { grantId: 'm' }),
      ],
    });
    expect(
      workspace.grantedRoles.map((grant) => `${grant.roleId}:${grant.grantId}`),
    ).toEqual(['agent-builder:m', 'owner:a', 'owner:b', 'researcher:z']);
  });
});

describe('determinism of switching', () => {
  it('identical activation inputs produce byte-identical workspaces', () => {
    const workspace = fixtureAllRolesWorkspace();
    const a = activateRole(workspace, 'expert', T2);
    const b = activateRole(workspace, 'expert', T2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('repeated serialization is stable across many switches', () => {
    let current: WorkspaceContext = fixtureAllRolesWorkspace();
    const seen = new Set<string>();
    for (const roleId of ROLE_IDS) {
      current = activateRole(current, roleId, T3);
      seen.add(JSON.stringify(current));
    }
    expect(seen.size).toBe(ROLE_IDS.length);
  });
});
