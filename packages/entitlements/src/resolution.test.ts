import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  assertEntitlementTenant,
  createFeatureFlagGrant,
  createQuotaGrant,
  evaluateFeatureFlag,
  resolveEntitlements,
  revokeEntitlementGrant,
} from './index.js';
import { FEATURE_COMPUTE, TENANT_A, TENANT_B, T0, T1, T2 } from './test-support.js';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected EntitlementError ${code}`);
}

const acmeQuota = createQuotaGrant({
  grantId: 'g-acme',
  tenantId: TENANT_A,
  featureKey: FEATURE_COMPUTE,
  issuedAt: T0,
  validFrom: T0,
  limit: 100,
  window: 'day',
});

describe('tenant-scoped grant resolution (positive)', () => {
  it('allows an active tenant-matching grant and returns it deterministically', () => {
    const resolution = resolveEntitlements([acmeQuota], TENANT_A, FEATURE_COMPUTE, T1);
    expect(resolution.allowed).toBe(true);
    expect(resolution.reason).toBe('grant-match');
    expect(resolution.grants).toEqual([acmeQuota]);
  });

  it('orders multiple active grants by (issuedAt, grantId)', () => {
    const later = createQuotaGrant({
      grantId: 'a-later',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T1,
      validFrom: T0,
      limit: 200,
      window: 'day',
    });
    const resolution = resolveEntitlements([later, acmeQuota], TENANT_A, FEATURE_COMPUTE, T2);
    expect(resolution.grants.map((grant) => grant.grantId)).toEqual(['g-acme', 'a-later']);
  });
});

describe('tenant-scoped grant resolution (fail-closed)', () => {
  it('denies with no-matching-feature when nothing targets the feature', () => {
    const resolution = resolveEntitlements([acmeQuota], TENANT_A, 'evaluation.run', T1);
    expect(resolution.allowed).toBe(false);
    expect(resolution.reason).toBe('no-matching-feature');
    expect(resolution.grants).toEqual([]);
  });

  it('denies cross-tenant access: another tenant\u2019s grants never allow', () => {
    const resolution = resolveEntitlements([acmeQuota], TENANT_B, FEATURE_COMPUTE, T1);
    expect(resolution.allowed).toBe(false);
    expect(resolution.reason).toBe('tenant-mismatch');
    expect(resolution.grants).toEqual([]);
  });

  it('denies when the only matching grant is expired (expired-grant rejection)', () => {
    const expired = createQuotaGrant({
      grantId: 'g-exp',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      expiresAt: T1,
      limit: 10,
      window: 'day',
    });
    const resolution = resolveEntitlements([expired], TENANT_A, FEATURE_COMPUTE, T2);
    expect(resolution.allowed).toBe(false);
    expect(resolution.reason).toBe('grant-expired');
  });

  it('denies not-yet-active and revoked grants with closed reasons', () => {
    const future = createQuotaGrant({
      grantId: 'g-fut',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T2,
      limit: 10,
      window: 'day',
    });
    expect(resolveEntitlements([future], TENANT_A, FEATURE_COMPUTE, T1).reason).toBe(
      'grant-not-yet-active',
    );
    const active = createQuotaGrant({
      grantId: 'g-act',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    expect(
      resolveEntitlements(
        [revokeEntitlementGrant(active, T1)],
        TENANT_A,
        FEATURE_COMPUTE,
        T2,
      ).reason,
    ).toBe('grant-revoked');
  });

  it('inactivity precedence is revoked > expired > not-yet-active', () => {
    const expiredAndRevoked = createQuotaGrant({
      grantId: 'g-both',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      expiresAt: T1,
      limit: 10,
      window: 'day',
    });
    const revoked = revokeEntitlementGrant(expiredAndRevoked, T1);
    expect(resolveEntitlements([revoked], TENANT_A, FEATURE_COMPUTE, T2).reason).toBe(
      'grant-revoked',
    );
  });

  it('an active grant alongside inactive ones still allows', () => {
    const expired = createQuotaGrant({
      grantId: 'g-exp',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      expiresAt: T1,
      limit: 10,
      window: 'day',
    });
    const resolution = resolveEntitlements([expired, acmeQuota], TENANT_A, FEATURE_COMPUTE, T2);
    expect(resolution.allowed).toBe(true);
    expect(resolution.grants).toEqual([acmeQuota]);
  });
});

describe('feature flags (deny overrides)', () => {
  it('permits an active enabled flag', () => {
    const flag = createFeatureFlagGrant({
      grantId: 'f1',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T0,
      validFrom: T0,
      enabled: true,
    });
    expect(evaluateFeatureFlag([flag], TENANT_A, 'evaluation.run', T1)).toEqual({
      permitted: true,
      reason: 'flag-enabled',
    });
  });

  it('a disabled flag denies even when an enabled flag coexists', () => {
    const enabled = createFeatureFlagGrant({
      grantId: 'f1',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T0,
      validFrom: T0,
      enabled: true,
    });
    const disabled = createFeatureFlagGrant({
      grantId: 'f2',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T1,
      validFrom: T0,
      enabled: false,
    });
    expect(evaluateFeatureFlag([enabled, disabled], TENANT_A, 'evaluation.run', T2)).toEqual({
      permitted: false,
      reason: 'flag-disabled',
    });
  });

  it('flags of other tenants are invisible (tenant scoping)', () => {
    const flag = createFeatureFlagGrant({
      grantId: 'f1',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T0,
      validFrom: T0,
      enabled: true,
    });
    expect(evaluateFeatureFlag([flag], TENANT_B, 'evaluation.run', T1).reason).toBe('flag-absent');
  });
});

describe('assertEntitlementTenant (guard form)', () => {
  it('passes for the owning tenant and fails closed otherwise', () => {
    expect(() => assertEntitlementTenant(TENANT_A, TENANT_A)).not.toThrow();
    expectCode(() => assertEntitlementTenant(TENANT_A, TENANT_B), ENTITLEMENT_ERROR_CODES.TENANT_MISMATCH);
    expectCode(
      () => assertEntitlementTenant(TENANT_A, 'not a tenant'),
      ENTITLEMENT_ERROR_CODES.TENANT_MISMATCH,
    );
  });
});
