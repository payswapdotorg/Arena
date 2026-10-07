/**
 * Cross-tenant pack reuse authorization tests (Work Order C018
 * acceptance: adversarial — cross-tenant policy read without explicit
 * typed authorization must fail closed).
 */

import { describe, expect, it } from 'vitest';
import {
  assertCrossTenantPackAuthorized,
  checkCrossTenantPackAuthorization,
  createCrossTenantPackAuthorization,
  revokeCrossTenantPackAuthorization,
} from './tenancy.js';
import { ExpertSessionPolicyError } from './errors.js';
import { TENANT_A, TENANT_B, T0, T1, T2, validPolicyPack } from './test-support.js';

describe('cross-tenant authorization grants', () => {
  it('builds a frozen grant bound to the exact pack id + version + consuming tenant', () => {
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0001',
      packId: 'pack-enterprise-eu',
      packVersion: 2,
      sourceTenantId: TENANT_A,
      consumingTenantId: TENANT_B,
      now: T0,
      expiresAt: T2,
    });
    expect(grant.authorizationId).toBe('auth-0001');
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it('rejects same-tenant grants (not cross-tenant) and non-future expiries', () => {
    expect(() =>
      createCrossTenantPackAuthorization({
        authorizationId: 'auth-bad',
        packId: 'pack-enterprise-eu',
        packVersion: 1,
        sourceTenantId: TENANT_A,
        consumingTenantId: TENANT_A,
        now: T0,
      }),
    ).toThrow(ExpertSessionPolicyError);
    expect(() =>
      createCrossTenantPackAuthorization({
        authorizationId: 'auth-bad-2',
        packId: 'pack-enterprise-eu',
        packVersion: 1,
        sourceTenantId: TENANT_A,
        consumingTenantId: TENANT_B,
        now: T1,
        expiresAt: T0,
      }),
    ).toThrow(ExpertSessionPolicyError);
  });

  it('revocation is a single status transition (records stay auditable)', () => {
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0002',
      packId: 'pack-enterprise-eu',
      packVersion: 1,
      sourceTenantId: TENANT_A,
      consumingTenantId: TENANT_B,
      now: T0,
    });
    const revoked = revokeCrossTenantPackAuthorization(grant, T1);
    expect(revoked.revokedAt).toBe(T1);
    expect(() => revokeCrossTenantPackAuthorization(revoked, T2)).toThrow(ExpertSessionPolicyError);
  });
});

describe('cross-tenant authorization verdicts (closed reasons)', () => {
  it('allows an exact, unexpired, unrevoked grant', async () => {
    const pack = await validPolicyPack({ tenantId: TENANT_A, version: 2 });
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0003',
      packId: pack.packId,
      packVersion: pack.version,
      sourceTenantId: TENANT_A,
      consumingTenantId: TENANT_B,
      now: T0,
      expiresAt: T2,
    });
    const verdict = checkCrossTenantPackAuthorization(grant, pack, TENANT_B, T1);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('authorized');
  });

  it('denies on a missing grant (the default cross-tenant posture)', async () => {
    const pack = await validPolicyPack({ tenantId: TENANT_A });
    const verdict = checkCrossTenantPackAuthorization(null, pack, TENANT_B, T1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('authorization-missing');
  });

  it('denies on version mismatch (a v1 grant cannot authorize v2 reuse)', async () => {
    const pack = await validPolicyPack({ tenantId: TENANT_A, version: 2 });
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0004',
      packId: pack.packId,
      packVersion: 1,
      sourceTenantId: TENANT_A,
      consumingTenantId: TENANT_B,
      now: T0,
    });
    expect(checkCrossTenantPackAuthorization(grant, pack, TENANT_B, T1).reason).toBe('authorization-version-mismatch');
  });

  it('denies on expiry, revocation and tenant mismatch (fail-closed)', async () => {
    const pack = await validPolicyPack({ tenantId: TENANT_A });
    const grant = createCrossTenantPackAuthorization({
      authorizationId: 'auth-0005',
      packId: pack.packId,
      packVersion: pack.version,
      sourceTenantId: TENANT_A,
      consumingTenantId: TENANT_B,
      now: T0,
      expiresAt: T1,
    });
    expect(checkCrossTenantPackAuthorization(grant, pack, TENANT_B, T1).reason).toBe('authorization-expired');
    expect(checkCrossTenantPackAuthorization(grant, pack, TENANT_A, T0).reason).toBe('authorization-tenant-mismatch');
    const revoked = revokeCrossTenantPackAuthorization(grant, T1);
    expect(checkCrossTenantPackAuthorization(revoked, pack, TENANT_B, T2).reason).toBe('authorization-revoked');
  });

  it('the guard form throws the typed CROSS_TENANT_POLICY failure', async () => {
    const pack = await validPolicyPack({ tenantId: TENANT_A });
    expect(() => assertCrossTenantPackAuthorized(null, pack, TENANT_B, T1)).toThrow(ExpertSessionPolicyError);
  });
});
