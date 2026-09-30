/**
 * Identity + principal model tests (Work Order A034).
 */

import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_PRINCIPAL_ID,
  isAnonymousPrincipal,
  isSecurityPrincipal,
  makeAnonymousPrincipal,
  PRINCIPAL_KINDS,
  PRINCIPAL_ROLES,
  SECURITY_ERROR_CODES,
  SecurityError,
  TENANT_STATUSES,
  toSecurityPrincipal,
  toTenantRecord,
} from './index.js';
import { makePrincipalInput, T0, TENANT_A } from './test-support.js';

describe('SecurityPrincipal validation', () => {
  it('accepts a well-formed tenant-scoped principal', () => {
    const principal = toSecurityPrincipal(makePrincipalInput());
    expect(principal.principalId).toBe('principal-test-1');
    expect(principal.tenantScope).toBe(TENANT_A);
    expect(principal.roles).toEqual(['tenant-member']);
    expect(isSecurityPrincipal(principal)).toBe(true);
  });

  it('rejects unknown kinds, roles and record versions (closed vocabularies)', () => {
    expect(() => toSecurityPrincipal(makePrincipalInput({ kind: 'superuser' }))).toThrowError(
      SecurityError,
    );
    expect(() => toSecurityPrincipal(makePrincipalInput({ roles: ['root'] }))).toThrowError(
      SecurityError,
    );
    expect(() => toSecurityPrincipal(makePrincipalInput({ recordVersion: 2 }))).toThrowError(
      SecurityError,
    );
  });

  it('rejects unknown fields (strict shape)', () => {
    expect(() =>
      toSecurityPrincipal(makePrincipalInput({ isAdmin: true })),
    ).toThrowError(/unknown field 'isAdmin'/);
  });

  it('rejects duplicate roles', () => {
    expect(() =>
      toSecurityPrincipal(makePrincipalInput({ roles: ['tenant-member', 'tenant-member'] })),
    ).toThrowError(/unique/);
  });

  it('fail-closed: tenant-bound kinds cannot be untenanted', () => {
    expect(() =>
      toSecurityPrincipal(makePrincipalInput({ tenantScope: 'untenanted' })),
    ).toThrowError(/must carry an explicit tenantScope/);
  });

  it('the principal record is deeply frozen', () => {
    const principal = toSecurityPrincipal(makePrincipalInput());
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.roles)).toBe(true);
    expect(() => {
      (principal as unknown as Record<string, unknown>)['roles'] = ['tenant-owner'];
    }).toThrow();
  });
});

describe('anonymous principal (explicit, never null)', () => {
  it('is a valid principal with kind anonymous and no roles', () => {
    const anonymous = makeAnonymousPrincipal();
    expect(anonymous.principalId).toBe(ANONYMOUS_PRINCIPAL_ID);
    expect(anonymous.kind).toBe('anonymous');
    expect(anonymous.tenantScope).toBe('untenanted');
    expect(anonymous.roles).toEqual([]);
    expect(isAnonymousPrincipal(anonymous)).toBe(true);
  });
});

describe('TenantRecord validation', () => {
  it('accepts a well-formed tenant record', () => {
    const tenant = toTenantRecord({
      recordVersion: 1,
      tenantId: TENANT_A,
      status: 'active',
      displayName: 'tenant-alpha-display',
      createdAt: T0,
    });
    expect(tenant.status).toBe('active');
  });

  it('rejects unknown statuses (closed vocabulary)', () => {
    expect(() =>
      toTenantRecord({
        recordVersion: 1,
        tenantId: TENANT_A,
        status: 'deleted',
        displayName: null,
        createdAt: T0,
      }),
    ).toThrowError(SecurityError);
  });
});

describe('closed vocabularies are frozen and complete', () => {
  it('principal kinds cover the S1.0 actor set', () => {
    expect(Object.isFrozen(PRINCIPAL_KINDS)).toBe(true);
    expect(PRINCIPAL_KINDS).toContain('customer-identity');
    expect(PRINCIPAL_KINDS).toContain('expert');
    expect(PRINCIPAL_KINDS).toContain('anonymous');
  });

  it('roles are coarse and closed', () => {
    expect(Object.isFrozen(PRINCIPAL_ROLES)).toBe(true);
    expect(PRINCIPAL_ROLES).not.toContain('root');
    expect(PRINCIPAL_ROLES).not.toContain('*');
  });

  it('tenant statuses never include deletion (append-only projection)', () => {
    expect(TENANT_STATUSES).toEqual(['active', 'suspended']);
  });

  it('the error taxonomy keeps authorization and tenancy categories', () => {
    expect(SECURITY_ERROR_CODES.TENANT_MISMATCH).toBe('SECURITY_TENANT_MISMATCH');
    expect(SECURITY_ERROR_CODES.FORBIDDEN).toBe('SECURITY_FORBIDDEN');
    expect(SECURITY_ERROR_CODES.SECRET_DETECTED).toBe('SECURITY_SECRET_DETECTED');
  });
});
