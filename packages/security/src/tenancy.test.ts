/**
 * Tenancy isolation tests (Work Order A034): the cross-tenant denial
 * matrix over EVERY S1.0 boundary class, fail-closed invalid inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  assertTenantBoundary,
  checkTenantBoundary,
  makeTenantScopedRef,
  SECURITY_ERROR_CODES,
  SecurityError,
  SPEC_S1_BOUNDARY_CLASSES,
  TENANT_BOUNDARY_CLASSES,
  toTenantScopedRef,
  validateTenantScopedClaims,
} from './index.js';
import {
  captureSecurityError,
  makeTenantScopedRefInput,
  TENANT_A,
  TENANT_B,
} from './test-support.js';

describe('the S1.0 boundary class vocabulary', () => {
  it('covers exactly the nine spec classes', () => {
    expect([...TENANT_BOUNDARY_CLASSES].sort()).toEqual([
      'body',
      'certification-evidence',
      'customer-identity',
      'dataset',
      'environment',
      'expert-record',
      'model-interaction',
      'task',
      'trajectory',
    ]);
  });

  it('maps 1:1 onto the spec enumeration (hygiene pin)', () => {
    const spec = SPEC_S1_BOUNDARY_CLASSES.map((name) =>
      name.replace(/ /g, '-').replace(/ies$/, 'y').replace(/s$/, ''),
    );
    for (const boundaryClass of TENANT_BOUNDARY_CLASSES) {
      expect(spec).toContain(boundaryClass);
    }
    expect(spec.length).toBe(TENANT_BOUNDARY_CLASSES.length);
  });
});

describe('cross-tenant denial matrix (every boundary class)', () => {
  it('denies tenant-B access to every tenant-A resource class', () => {
    for (const boundaryClass of TENANT_BOUNDARY_CLASSES) {
      const resource = makeTenantScopedRef(TENANT_A, boundaryClass, `record-${boundaryClass}`);
      const decision = checkTenantBoundary(TENANT_B, resource);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('tenant-mismatch');
      expect(decision.resourceTenant).toBe(TENANT_A);
    }
  });

  it('allows same-tenant access for every boundary class', () => {
    for (const boundaryClass of TENANT_BOUNDARY_CLASSES) {
      const resource = makeTenantScopedRef(TENANT_A, boundaryClass, `record-${boundaryClass}`);
      const decision = checkTenantBoundary(TENANT_A, resource);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('tenant-match');
    }
  });

  it('the guard form throws typed SECURITY_TENANT_MISMATCH on crossing', () => {
    const resource = makeTenantScopedRef(TENANT_A, 'trajectory', 'trajectory-1');
    expect(() => assertTenantBoundary(TENANT_B, resource)).toThrowError(SecurityError);
    try {
      assertTenantBoundary(TENANT_B, resource);
    } catch (error) {
      expect((error as SecurityError).code).toBe(SECURITY_ERROR_CODES.TENANT_MISMATCH);
      expect((error as SecurityError).category).toBe('tenancy');
    }
  });
});

describe('fail-closed tenancy inputs', () => {
  it('untenanted accessors get no implicit cross-tenant read', () => {
    const resource = makeTenantScopedRef(TENANT_A, 'dataset', 'dataset-1');
    for (const accessor of ['untenanted' as const, null, undefined]) {
      const decision = checkTenantBoundary(accessor, resource);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('untenanted-accessor');
    }
  });

  it('invalid resources never evaluate to an allowed crossing', () => {
    for (const resource of [null, undefined, { nope: true } as never]) {
      const decision = checkTenantBoundary(TENANT_A, resource);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('invalid-resource');
      expect(decision.resourceTenant).toBe('unknown');
    }
  });
});

describe('tenant-scoped ref validation', () => {
  it('rejects unknown boundary classes and malformed tenants', () => {
    expect(() =>
      toTenantScopedRef(makeTenantScopedRefInput({ boundaryClass: 'credits' })),
    ).toThrowError(/must be one of/);
    expect(() => toTenantScopedRef(makeTenantScopedRefInput({ tenantId: 'NOT-LOWERCASE' })))
      .toThrowError(SecurityError);
  });

  it('rejects unknown fields (strict shape)', () => {
    expect(() => toTenantScopedRef(makeTenantScopedRefInput({ extra: 1 }))).toThrowError(
      /unknown field/,
    );
  });

  it('claims of another tenant fail validateTenantScopedClaims', () => {
    const claim = makeTenantScopedRef(TENANT_B, 'dataset', 'dataset-b-9');
    expect(captureSecurityError(() => validateTenantScopedClaims(TENANT_A, [claim])).code).toBe(
      SECURITY_ERROR_CODES.TENANT_MISMATCH,
    );
  });
});
