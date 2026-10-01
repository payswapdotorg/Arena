/**
 * Shared test fixtures for @arena/entitlements (NOT part of the public
 * surface — hygiene.test.ts asserts it is not re-exported from index).
 *
 * Deterministic constants and builders only: fixed tenants, feature keys
 * and timestamps; no randomness.
 */

export const TENANT_A = 'acme' as const;
export const TENANT_B = 'globex' as const;
export const FEATURE_COMPUTE = 'job.compute' as const;
export const FEATURE_EVALUATE = 'evaluation.run' as const;

/** Fixed canonical timestamps (ms-UTC, strictly increasing). */
export const T0 = '2026-02-01T00:00:00.000Z' as const;
export const T1 = '2026-02-01T06:00:00.000Z' as const;
export const T2 = '2026-02-01T12:00:00.000Z' as const;
export const T3 = '2026-02-01T18:00:00.000Z' as const;
export const T4 = '2026-02-02T00:00:00.000Z' as const;
export const T5 = '2026-03-01T00:00:00.000Z' as const;

/** 2026-02-01 is a UTC day window; 2026-02 is a UTC month window. */
export const DAY_WINDOW_START = '2026-02-01T00:00:00.000Z' as const;
export const NEXT_DAY_WINDOW_START = '2026-02-02T00:00:00.000Z' as const;
export const MONTH_WINDOW_START = '2026-02-01T00:00:00.000Z' as const;
export const NEXT_MONTH_WINDOW_START = '2026-03-01T00:00:00.000Z' as const;

export interface QuotaGrantOverrides {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly limit?: number;
  readonly window?: 'day' | 'month';
  readonly issuedAt?: string;
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly note?: string;
}

export function makeQuotaGrantInput(overrides: QuotaGrantOverrides = {}): {
  grantId: string;
  tenantId: string;
  featureKey: string;
  issuedAt: string;
  validFrom: string;
  limit: number;
  window: 'day' | 'month';
  note: string;
  expiresAt?: string;
} {
  return {
    grantId: overrides.grantId ?? 'grant-quota-001',
    tenantId: overrides.tenantId ?? TENANT_A,
    featureKey: overrides.featureKey ?? FEATURE_COMPUTE,
    issuedAt: overrides.issuedAt ?? T0,
    validFrom: overrides.validFrom ?? T0,
    limit: overrides.limit ?? 10,
    window: overrides.window ?? 'day',
    note: overrides.note ?? 'daily compute quota for tests',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}

export interface FlagGrantOverrides {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly enabled?: boolean;
  readonly issuedAt?: string;
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly note?: string;
}

export function makeFlagGrantInput(overrides: FlagGrantOverrides = {}): {
  grantId: string;
  tenantId: string;
  featureKey: string;
  issuedAt: string;
  validFrom: string;
  enabled: boolean;
  note: string;
  expiresAt?: string;
} {
  return {
    grantId: overrides.grantId ?? 'grant-flag-001',
    tenantId: overrides.tenantId ?? TENANT_A,
    featureKey: overrides.featureKey ?? FEATURE_EVALUATE,
    issuedAt: overrides.issuedAt ?? T0,
    validFrom: overrides.validFrom ?? T0,
    enabled: overrides.enabled ?? true,
    note: overrides.note ?? 'evaluation feature flag for tests',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}

export interface RateLimitGrantOverrides {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly limit?: number;
  readonly durationSeconds?: number;
  readonly issuedAt?: string;
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly note?: string;
}

export function makeRateLimitGrantInput(overrides: RateLimitGrantOverrides = {}): {
  grantId: string;
  tenantId: string;
  featureKey: string;
  issuedAt: string;
  validFrom: string;
  limit: number;
  durationSeconds: number;
  note: string;
  expiresAt?: string;
} {
  return {
    grantId: overrides.grantId ?? 'grant-rate-001',
    tenantId: overrides.tenantId ?? TENANT_A,
    featureKey: overrides.featureKey ?? FEATURE_COMPUTE,
    issuedAt: overrides.issuedAt ?? T0,
    validFrom: overrides.validFrom ?? T0,
    limit: overrides.limit ?? 5,
    durationSeconds: overrides.durationSeconds ?? 60,
    note: overrides.note ?? 'compute rate limit for tests',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}
