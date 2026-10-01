/**
 * Property tests (Work Order B003) — seeded, deterministic determinism
 * properties over the whole package: identical inputs → identical outputs
 * across repeated calls, for role switching, full-chain resolution,
 * projections and state classification. No Math.random (house discipline:
 * the seeded LCG from test-support).
 */

import { describe, expect, it } from 'vitest';
import {
  activateRole,
  applyRoleProjection,
  CAPABILITY_CASE_LENSES,
  classifyState,
  countStateKinds,
  createWorkspaceContext,
  grantedRoleIds,
  projectCapabilityCase,
  resolveActiveContext,
  workspacePermissionFingerprint,
} from './index.js';
import type { RoleId } from './index.js';
import {
  CANONICAL_CASE,
  Lcg,
  ROLE_IDS_ALL,
  fixtureAllRolesWorkspace,
  fixtureGrant,
  fixtureIdentity,
  fixtureMemberships,
  fixturePolicy,
  TENANT_A,
  T0,
  T1,
  T2,
  T3,
  T_EXPIRY,
  WORKSPACE_MAIN,
} from './test-support.js';

const SEEDS = [1, 42, 20260201, 777, 314159];

/** Deterministic ms-UTC timestamps on a fixed grid (hour granularity). */
function ts(hours: number): string {
  return new Date(Date.parse(T0) + hours * 3_600_000).toISOString();
}

describe('property tests (seeded, deterministic)', () => {
  it('the LCG is deterministic', () => {
    const a = new Lcg(7);
    const b = new Lcg(7);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('P1: activateRole is pure — repeated identical activations are byte-identical', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const workspace = fixtureAllRolesWorkspace();
      for (let i = 0; i < 10; i += 1) {
        const roleId = rng.pick(ROLE_IDS_ALL);
        const at = ts(rng.int(1, 48));
        const a = activateRole(workspace, roleId, at);
        const b = activateRole(workspace, roleId, at);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it('P2: switching NEVER changes the permission fingerprint (invariant under any sequence)', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const workspace = fixtureAllRolesWorkspace();
      const baseline = workspacePermissionFingerprint(workspace);
      let current = workspace;
      for (let i = 0; i < 12; i += 1) {
        const roleId = rng.pick(ROLE_IDS_ALL);
        current = activateRole(current, roleId, ts(100 + i));
        expect(workspacePermissionFingerprint(current)).toBe(baseline);
      }
    }
  });

  it('P3: resolveActiveContext is deterministic and tenant-safe', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const identity = fixtureIdentity();
      const memberships = fixtureMemberships();
      const policy = fixturePolicy();
      const grants = ROLE_IDS_ALL.map((roleId, index) =>
        fixtureGrant(roleId, {
          grantId: `g-${seed}-${String(index).padStart(2, '0')}`,
          ...(rng.next() < 0.4 ? { expiresAt: T_EXPIRY } : {}),
        }),
      );
      const roleId = rng.pick(ROLE_IDS_ALL);
      const at = ts(rng.int(1, 24));
      const a = resolveActiveContext({
        identity,
        memberships,
        policy,
        grantedRoles: grants,
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_MAIN,
        roleId,
        at,
      });
      const b = resolveActiveContext({
        identity,
        memberships,
        policy,
        grantedRoles: grants,
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_MAIN,
        roleId,
        at,
      });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.tenantId).toBe(TENANT_A);
    }
  });

  it('P4: the deterministic grant pick prefers earliest validFrom, then grantId', () => {
    const identity = fixtureIdentity();
    const grants = [
      fixtureGrant('owner', { grantId: 'z-late', validFrom: T2 }),
      fixtureGrant('owner', { grantId: 'a-late', validFrom: T2 }),
      fixtureGrant('owner', { grantId: 'm-early', validFrom: T1 }),
    ];
    const active = resolveActiveContext({
      identity,
      memberships: fixtureMemberships(),
      policy: fixturePolicy(),
      grantedRoles: grants,
      tenantId: TENANT_A,
      workspaceId: WORKSPACE_MAIN,
      roleId: 'owner',
      at: T3,
    });
    expect(active.grantId).toBe('m-early');
  });

  it('P5: projections are pure — repeated application is byte-identical', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      for (let i = 0; i < 8; i += 1) {
        const lens = rng.pick([...CAPABILITY_CASE_LENSES]);
        const a = applyRoleProjection(lens, CANONICAL_CASE);
        const b = applyRoleProjection(lens, CANONICAL_CASE);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.canonical).toEqual(b.canonical);
      }
    }
  });

  it('P6: classifyState and countStateKinds are total and stable', () => {
    const candidates: readonly unknown[] = [
      { stateKind: 'evidence' },
      { stateKind: 'model-output' },
      'pending',
      { stateKind: 'garbage' },
      null,
      42,
      { nope: 'x' },
    ];
    for (let i = 0; i < 5; i += 1) {
      const kinds = candidates.map((candidate) => classifyState(candidate));
      expect(kinds).toEqual([
        'evidence',
        'model-output',
        'pending',
        'unknown',
        'unknown',
        'unknown',
        'unknown',
      ]);
      expect(countStateKinds(candidates)).toEqual({
        evidence: 1,
        'model-output': 1,
        pending: 1,
        unknown: 4,
      });
    }
  });

  it('P7: workspace construction is order-insensitive for granted roles (canonical ordering)', () => {
    for (const seed of SEEDS) {
      const rng = new Lcg(seed);
      const grants = rng
        .pick([['owner', 'expert'], ['researcher', 'operator', 'owner']] as readonly (readonly RoleId[])[])
        .map((roleId, index) => fixtureGrant(roleId, { grantId: `g-${String(index).padStart(2, '0')}` }));
      const shuffled = [...grants].reverse();
      const a = createWorkspaceContext({
        identityId: grants[0]?.identityId ?? 'x',
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_MAIN,
        permissionPolicy: fixturePolicy(),
        grantedRoles: grants,
      });
      const b = createWorkspaceContext({
        identityId: grants[0]?.identityId ?? 'x',
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_MAIN,
        permissionPolicy: fixturePolicy(),
        grantedRoles: shuffled,
      });
      expect(JSON.stringify(a.grantedRoles)).toBe(JSON.stringify(b.grantedRoles));
      expect(grantedRoleIds(a)).toEqual(grantedRoleIds(b));
    }
  });

  it('P8: one canonical case projects differently per role, identically per lens, forever', () => {
    const byRole = new Map<string, string>();
    for (const lens of CAPABILITY_CASE_LENSES) {
      byRole.set(lens.roleId, JSON.stringify(applyRoleProjection(lens, CANONICAL_CASE)));
    }
    expect(byRole.size).toBe(5);
    expect(new Set([...byRole.values()]).size).toBe(5);
    // repeat the whole matrix — stable
    for (const lens of CAPABILITY_CASE_LENSES) {
      expect(JSON.stringify(applyRoleProjection(lens, CANONICAL_CASE))).toBe(
        byRole.get(lens.roleId),
      );
    }
    // and through the convenience API
    expect(JSON.stringify(projectCapabilityCase(CANONICAL_CASE, 'owner'))).toBe(
      byRole.get('owner'),
    );
  });
});
