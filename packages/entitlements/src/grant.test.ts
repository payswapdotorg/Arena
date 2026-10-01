import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  amendEntitlementGrant,
  createFeatureFlagGrant,
  createQuotaGrant,
  createRateLimitGrant,
  grantInactivityReason,
  isEntitlementGrant,
  isGrantActive,
  revokeEntitlementGrant,
  toEntitlementGrant,
} from './index.js';
import type { EntitlementGrant, QuotaGrant } from './index.js';
import { FEATURE_COMPUTE, TENANT_A, T0, T1, T2, T3, T4 } from './test-support.js';

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

describe('entitlement grant construction (positive)', () => {
  it('creates a frozen quota grant with a granted lineage root', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 100,
      window: 'day',
    });
    expect(grant.kind).toBe('quota');
    expect(grant.limit).toBe(100);
    expect(grant.window).toBe('day');
    expect(grant.lineage).toHaveLength(1);
    expect(grant.lineage[0]?.kind).toBe('granted');
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.lineage)).toBe(true);
    expect(isEntitlementGrant(grant)).toBe(true);
  });

  it('creates feature-flag and rate-limit grants', () => {
    const flag = createFeatureFlagGrant({
      grantId: 'g2',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T0,
      validFrom: T0,
      enabled: true,
    });
    expect(flag.kind).toBe('feature-flag');
    expect(flag.enabled).toBe(true);
    const rate = createRateLimitGrant({
      grantId: 'g3',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 5,
      durationSeconds: 60,
    });
    expect(rate.kind).toBe('rate-limit');
    expect(rate.durationSeconds).toBe(60);
  });

  it('accepts a future validFrom and an expiresAt after it', () => {
    const grant = createQuotaGrant({
      grantId: 'g4',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T1,
      expiresAt: T3,
      limit: 1,
      window: 'month',
    });
    expect(grant.validFrom).toBe(T1);
    expect(grant.expiresAt).toBe(T3);
  });
});

describe('entitlement grant construction (negative)', () => {
  it('rejects invalid tenant ids, feature keys and grant ids', () => {
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: 'Not-Lowercase',
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T0,
          limit: 1,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY,
    );
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: 'Job.Compute',
          issuedAt: T0,
          validFrom: T0,
          limit: 1,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY,
    );
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'bad id!',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T0,
          limit: 1,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY,
    );
  });

  it('rejects non-positive limits, unknown windows and bad durations', () => {
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T0,
          limit: 0,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_GRANT,
    );
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T0,
          limit: 5,
          window: 'week',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_GRANT,
    );
    expectCode(
      () =>
        createRateLimitGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T0,
          limit: 5,
          durationSeconds: 0,
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_GRANT,
    );
  });

  it('rejects expiresAt at or before validFrom', () => {
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: T0,
          validFrom: T1,
          expiresAt: T1,
          limit: 1,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_GRANT,
    );
  });

  it('rejects malformed timestamps', () => {
    expectCode(
      () =>
        createQuotaGrant({
          grantId: 'g',
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          issuedAt: '2026-02-01T00:00:00Z',
          validFrom: T0,
          limit: 1,
          window: 'day',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_TIMESTAMP,
    );
  });
});

describe('append-only lineage', () => {
  it('amend appends a lineage event and returns a NEW frozen record', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const amended = amendEntitlementGrant(grant, { limit: 20, note: 'limit raised' }, T1);
    expect((amended as QuotaGrant).limit).toBe(20);
    expect(amended.lineage).toHaveLength(2);
    expect(amended.lineage[1]?.kind).toBe('amended');
    // the original record is untouched (append-only, never rewritten)
    expect(grant.limit).toBe(10);
    expect(grant.lineage).toHaveLength(1);
    expect(Object.isFrozen(amended)).toBe(true);
  });

  it('revoke appends a final lineage event; double revocation is rejected', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const revoked = revokeEntitlementGrant(grant, T1, 'contract ended');
    expect(revoked.lineage).toHaveLength(2);
    expect(revoked.lineage[1]?.kind).toBe('revoked');
    expectCode(() => revokeEntitlementGrant(revoked, T2), ENTITLEMENT_ERROR_CODES.GRANT_REVOKED);
    expectCode(
      () => amendEntitlementGrant(revoked, { limit: 5 }, T2),
      ENTITLEMENT_ERROR_CODES.GRANT_REVOKED,
    );
  });

  it('rejects lineage timestamps that precede the last entry', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const amended = amendEntitlementGrant(grant, { limit: 20 }, T2);
    expectCode(
      () => amendEntitlementGrant(amended, { limit: 30 }, T1),
      ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE,
    );
  });

  it('rejects kind-inappropriate amendments', () => {
    const flag = createFeatureFlagGrant({
      grantId: 'g2',
      tenantId: TENANT_A,
      featureKey: 'evaluation.run',
      issuedAt: T0,
      validFrom: T0,
      enabled: true,
    });
    expectCode(
      () => amendEntitlementGrant(flag, { limit: 5 }, T1),
      ENTITLEMENT_ERROR_CODES.INVALID_GRANT,
    );
  });

  it('mutation of a frozen grant throws (immutability tripwire)', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    expect(() => {
      (grant as unknown as Record<string, unknown>)['limit'] = 999;
    }).toThrow();
    expect(() => {
      (grant.lineage as unknown as Record<string, unknown>)['0'] = {};
    }).toThrow();
  });
});

describe('expiry semantics', () => {
  it('a grant is inactive exactly at its expiresAt instant', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      expiresAt: T2,
      limit: 10,
      window: 'day',
    });
    expect(isGrantActive(grant, T1)).toBe(true);
    expect(isGrantActive(grant, T2)).toBe(false);
    expect(grantInactivityReason(grant, T2)).toBe('expired');
  });

  it('a grant is not-yet-active before validFrom and revoked after revocation', () => {
    const future = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T2,
      limit: 10,
      window: 'day',
    });
    expect(isGrantActive(future, T1)).toBe(false);
    expect(grantInactivityReason(future, T1)).toBe('not-yet-active');
    const grant = createQuotaGrant({
      grantId: 'g2',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const revoked = revokeEntitlementGrant(grant, T1);
    expect(isGrantActive(revoked, T2)).toBe(false);
    expect(grantInactivityReason(revoked, T2)).toBe('revoked');
  });
});

describe('toEntitlementGrant (strict loads)', () => {
  it('rejects lineage that does not start with granted', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const tampered = {
      ...grant,
      lineage: [{ sequence: 1, kind: 'amended', occurredAt: T0, note: 'nope' }],
    };
    expectCode(() => toEntitlementGrant(tampered), ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE);
  });

  it('rejects lineage with gaps and revoked-not-last shapes', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    const gapped = {
      ...grant,
      lineage: [
        grant.lineage[0],
        { sequence: 3, kind: 'amended', occurredAt: T1, note: 'gap' },
      ],
    };
    expect(isEntitlementGrant(gapped)).toBe(false);
    const revokedMid = {
      ...grant,
      lineage: [
        { sequence: 1, kind: 'granted', occurredAt: T0, note: 'root' },
        { sequence: 2, kind: 'revoked', occurredAt: T1, note: 'bye' },
        { sequence: 3, kind: 'amended', occurredAt: T2, note: 'zombie' },
      ],
    };
    expectCode(() => toEntitlementGrant(revokedMid), ENTITLEMENT_ERROR_CODES.INVALID_LINEAGE);
  });

  it('rejects an unsupported record version', () => {
    const grant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    expectCode(
      () => toEntitlementGrant({ ...grant, recordVersion: 2 }),
      ENTITLEMENT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION,
    );
  });

  it('validates a fully-evolved grant built through the public surface', () => {
    let grant: EntitlementGrant = createQuotaGrant({
      grantId: 'g1',
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: T0,
      limit: 10,
      window: 'day',
    });
    grant = amendEntitlementGrant(grant, { limit: 20 }, T1);
    grant = amendEntitlementGrant(grant, { expiresAt: T4 }, T2);
    grant = revokeEntitlementGrant(grant, T3);
    expect(toEntitlementGrant(grant)).toEqual(grant);
    expect(grant.lineage.map((event) => event.kind)).toEqual([
      'granted',
      'amended',
      'amended',
      'revoked',
    ]);
  });
});
