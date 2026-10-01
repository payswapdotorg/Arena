/**
 * Grant-chain suites (Work Order B003): Identity / TenantMembership /
 * PermissionPolicy / GrantedRole — construction validation, opacity of the
 * permission descriptor, provenance and expiry semantics.
 */

import { describe, expect, it } from 'vitest';
import {
  createIdentity,
  createPermissionPolicy,
  createTenantMembership,
  grantedRoleKey,
  grantRole,
  isGrantedRole,
  isIdentity,
  isMemberOfTenant,
  isPermissionPolicy,
  isRoleGrantActive,
  permissionFingerprint,
  roleGrantInactivityReason,
} from '../index.js';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../index.js';
import { IDENTITY_OWNER_BUILDER, TENANT_A, TENANT_B, T0, T1, T2, T3, T4, T_EXPIRY, T_AFTER_EXPIRY } from '../test-support.js';

describe('identity + tenant membership', () => {
  it('creates and validates identities (neutral, no permissions)', () => {
    const identity = createIdentity({ identityId: IDENTITY_OWNER_BUILDER, displayName: 'Dana' });
    expect(identity.identityId).toBe(IDENTITY_OWNER_BUILDER);
    expect(isIdentity(identity)).toBe(true);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(() => createIdentity({ identityId: 'Bad Id!', displayName: 'Dana' })).toThrowError(
      RoleContextError,
    );
    expect(() => createIdentity({ identityId: IDENTITY_OWNER_BUILDER, displayName: '' })).toThrowError(
      RoleContextError,
    );
    expect(isIdentity({ recordVersion: 1, identityId: 'x', displayName: '' })).toBe(false);
  });

  it('memberships are scope facts; isMemberOfTenant never crosses tenants', () => {
    const membership = createTenantMembership({
      identityId: IDENTITY_OWNER_BUILDER,
      tenantId: TENANT_A,
      joinedAt: T0,
    });
    expect(isMemberOfTenant([membership], IDENTITY_OWNER_BUILDER, TENANT_A)).toBe(true);
    expect(isMemberOfTenant([membership], IDENTITY_OWNER_BUILDER, TENANT_B)).toBe(false);
    expect(isMemberOfTenant([membership], 'other-identity', TENANT_A)).toBe(false);
    expect(() => isMemberOfTenant([membership], IDENTITY_OWNER_BUILDER, 'Bad Tenant')).toThrowError(
      RoleContextError,
    );
  });
});

describe('permission policy (opaque external authority)', () => {
  it('carries the descriptor without interpreting it', () => {
    const policy = createPermissionPolicy({
      policyId: 'policy-acme',
      tenantId: TENANT_A,
      descriptor: { authority: 'external', statements: [{ effect: 'allow', action: 'case.read' }] },
      issuedAt: T0,
    });
    expect(isPermissionPolicy(policy)).toBe(true);
    expect(policy.descriptor).toEqual({
      authority: 'external',
      statements: [{ effect: 'allow', action: 'case.read' }],
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.descriptor)).toBe(true);
  });

  it('fingerprints are byte-stable and content-sensitive', () => {
    const a = createPermissionPolicy({
      policyId: 'policy-acme',
      tenantId: TENANT_A,
      descriptor: { x: 1, y: ['a', 'b'] },
      issuedAt: T0,
    });
    const b = createPermissionPolicy({
      policyId: 'policy-acme',
      tenantId: TENANT_A,
      descriptor: { y: ['a', 'b'], x: 1 },
      issuedAt: T0,
    });
    const c = createPermissionPolicy({
      policyId: 'policy-acme',
      tenantId: TENANT_A,
      descriptor: { x: 2, y: ['a', 'b'] },
      issuedAt: T0,
    });
    // key order does NOT matter (canonical JSON)
    expect(permissionFingerprint(a)).toBe(permissionFingerprint(b));
    // content DOES matter
    expect(permissionFingerprint(a)).not.toBe(permissionFingerprint(c));
  });

  it('rejects non-plain-JSON descriptors (fail closed)', () => {
    expect(() =>
      createPermissionPolicy({
        policyId: 'policy-acme',
        tenantId: TENANT_A,
        descriptor: { bad: new Date() } as unknown as Record<string, unknown>,
        issuedAt: T0,
      }),
    ).toThrowError(RoleContextError);
    expect(
      isPermissionPolicy({ recordVersion: 1, policyId: 'p', tenantId: TENANT_A, descriptor: {}, issuedAt: T0 }),
    ).toBe(true);
    expect(isPermissionPolicy(null)).toBe(false);
  });
});

describe('granted role', () => {
  it('records identity × tenant × role with provenance and recommended expiry', () => {
    const grant = grantRole({
      grantId: 'grant-1',
      identityId: IDENTITY_OWNER_BUILDER,
      tenantId: TENANT_A,
      roleId: 'owner',
      policyId: 'policy-acme',
      grantedBy: 'admin-bootstrap',
      grantedAt: T0,
      note: 'initial bootstrap grant',
      validFrom: T1,
      expiresAt: T_EXPIRY,
    });
    expect(grant.roleId).toBe('owner');
    expect(grant.provenance.grantedBy).toBe('admin-bootstrap');
    expect(grant.provenance.note).toBe('initial bootstrap grant');
    expect(grantedRoleKey(grant)).toBe(`${TENANT_A}:${IDENTITY_OWNER_BUILDER}:owner:grant-1`);
    expect(isGrantedRole(grant)).toBe(true);
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it('rejects unknown role ids at grant time (closed vocabulary)', () => {
    try {
      grantRole({
        grantId: 'grant-1',
        identityId: IDENTITY_OWNER_BUILDER,
        tenantId: TENANT_A,
        roleId: 'superuser',
        policyId: 'policy-acme',
        grantedBy: 'admin-bootstrap',
        grantedAt: T0,
        validFrom: T1,
      });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as RoleContextError).code).toBe(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND);
    }
  });

  it('validates the expiry window and provenance ordering', () => {
    const base = {
      grantId: 'grant-1',
      identityId: IDENTITY_OWNER_BUILDER,
      tenantId: TENANT_A,
      roleId: 'owner',
      policyId: 'policy-acme',
      grantedBy: 'admin-bootstrap',
    } as const;
    // expiresAt must be after validFrom
    expect(() => grantRole({ ...base, grantedAt: T0, validFrom: T2, expiresAt: T1 })).toThrowError(
      RoleContextError,
    );
    // validFrom must not precede grantedAt
    expect(() => grantRole({ ...base, grantedAt: T2, validFrom: T1 })).toThrowError(RoleContextError);
    // invalid timestamps fail closed
    expect(() => grantRole({ ...base, grantedAt: 'nope', validFrom: T1 })).toThrowError(
      RoleContextError,
    );
  });

  it('expiry semantics match the entitlements lineage style', () => {
    const grant = grantRole({
      grantId: 'grant-1',
      identityId: IDENTITY_OWNER_BUILDER,
      tenantId: TENANT_A,
      roleId: 'owner',
      policyId: 'policy-acme',
      grantedBy: 'admin-bootstrap',
      grantedAt: T0,
      validFrom: T1,
      expiresAt: T_EXPIRY,
    });
    expect(isRoleGrantActive(grant, T0)).toBe(false); // not-yet-active
    expect(roleGrantInactivityReason(grant, T0)).toBe('not-yet-active');
    expect(isRoleGrantActive(grant, T1)).toBe(true);
    expect(roleGrantInactivityReason(grant, T1)).toBe('active');
    expect(isRoleGrantActive(grant, T4)).toBe(true);
    // EXPIRED exactly at the expiry instant
    expect(isRoleGrantActive(grant, T_EXPIRY)).toBe(false);
    expect(roleGrantInactivityReason(grant, T_EXPIRY)).toBe('expired');
    expect(isRoleGrantActive(grant, T_AFTER_EXPIRY)).toBe(false);
    // no expiry → stays active
    const open = grantRole({
      grantId: 'grant-2',
      identityId: IDENTITY_OWNER_BUILDER,
      tenantId: TENANT_A,
      roleId: 'expert',
      policyId: 'policy-acme',
      grantedBy: 'admin-bootstrap',
      grantedAt: T0,
      validFrom: T1,
    });
    expect(isRoleGrantActive(open, T3)).toBe(true);
  });

  it('isGrantedRole screens malformed records structurally', () => {
    expect(isGrantedRole(null)).toBe(false);
    expect(isGrantedRole({ recordVersion: 2 })).toBe(false);
    expect(
      isGrantedRole({
        recordVersion: 1,
        grantId: 'g',
        identityId: IDENTITY_OWNER_BUILDER,
        tenantId: TENANT_A,
        roleId: 'nope',
        policyId: 'p',
        provenance: { grantedBy: 'a', grantedAt: T0 },
        validFrom: T1,
      }),
    ).toBe(false);
  });
});
