/**
 * B015 quota-ceiling tests: the free-tier constants must match
 * docs/deployment/free-tier-architecture.md EXACTLY (the normative
 * architecture document), and the declared-allowance builders must be
 * declarable (positive limits, bounded dimension names).
 */

import { describe, expect, it } from 'vitest';
import {
  APIFY_FREE_TIER_QUOTAS,
  apifyDeclaredAllowances,
  NEON_FREE_TIER_QUOTAS,
  neonDeclaredAllowances,
  QUOTA_SOURCE_DOC,
  R2_FREE_TIER_QUOTAS,
  r2DeclaredAllowances,
  THIRTY_DAY_WINDOW_MS,
  THIRTY_ONE_DAY_WINDOW_MS,
  UPSTASH_FREE_TIER_QUOTAS,
  upstashDeclaredAllowances,
  VERCEL_HOBBY_CONSTRAINTS,
} from './quotas.js';
import type { DeclaredAllowance, FreeTierDimensionCeiling } from './quotas.js';

function limitOf(dimensions: readonly FreeTierDimensionCeiling[], dimension: string): number {
  const entry = dimensions.find((candidate) => candidate.dimension === dimension);
  if (entry === undefined) throw new Error(`missing dimension: ${dimension}`);
  return entry.limit;
}

function windowOf(dimensions: readonly FreeTierDimensionCeiling[], dimension: string): number | null {
  const entry = dimensions.find((candidate) => candidate.dimension === dimension);
  if (entry === undefined) throw new Error(`missing dimension: ${dimension}`);
  return entry.windowMs;
}

describe('B015 free-tier quota ceilings (docs/deployment/free-tier-architecture.md)', () => {
  it('points at the normative source document', () => {
    expect(QUOTA_SOURCE_DOC).toBe('docs/deployment/free-tier-architecture.md');
  });

  it('encodes the Neon Free ceilings verbatim', () => {
    expect(NEON_FREE_TIER_QUOTAS.providerId).toBe('control-plane-store');
    expect(NEON_FREE_TIER_QUOTAS.accountLevel).toEqual({ projects: 100, branchesPerProject: 10 });
    expect(limitOf(NEON_FREE_TIER_QUOTAS.dimensions, 'storage')).toBe(512);
    expect(limitOf(NEON_FREE_TIER_QUOTAS.dimensions, 'compute-hours')).toBe(100);
    expect(limitOf(NEON_FREE_TIER_QUOTAS.dimensions, 'transfer')).toBe(5);
    expect(windowOf(NEON_FREE_TIER_QUOTAS.dimensions, 'compute-hours')).toBe(THIRTY_ONE_DAY_WINDOW_MS);
    expect(windowOf(NEON_FREE_TIER_QUOTAS.dimensions, 'storage')).toBeNull();
  });

  it('encodes the Cloudflare R2 Standard free-tier ceilings verbatim', () => {
    expect(R2_FREE_TIER_QUOTAS.providerId).toBe('object-store');
    expect(limitOf(R2_FREE_TIER_QUOTAS.dimensions, 'storage')).toBe(10);
    expect(limitOf(R2_FREE_TIER_QUOTAS.dimensions, 'class-a-operations')).toBe(1_000_000);
    expect(limitOf(R2_FREE_TIER_QUOTAS.dimensions, 'class-b-operations')).toBe(10_000_000);
    for (const dimension of ['storage', 'class-a-operations', 'class-b-operations']) {
      expect(windowOf(R2_FREE_TIER_QUOTAS.dimensions, dimension)).toBe(THIRTY_DAY_WINDOW_MS);
    }
  });

  it('encodes the Upstash Redis Free ceilings verbatim', () => {
    expect(UPSTASH_FREE_TIER_QUOTAS.providerId).toBe('coordination-store');
    expect(limitOf(UPSTASH_FREE_TIER_QUOTAS.dimensions, 'commands')).toBe(500_000);
    expect(limitOf(UPSTASH_FREE_TIER_QUOTAS.dimensions, 'storage')).toBe(256);
    expect(limitOf(UPSTASH_FREE_TIER_QUOTAS.dimensions, 'bandwidth')).toBe(10);
    expect(windowOf(UPSTASH_FREE_TIER_QUOTAS.dimensions, 'commands')).toBe(THIRTY_DAY_WINDOW_MS);
  });

  it('encodes the Apify Free ceiling verbatim (optional provider)', () => {
    expect(APIFY_FREE_TIER_QUOTAS.optional).toBe(true);
    expect(limitOf(APIFY_FREE_TIER_QUOTAS.dimensions, 'monthly-spend-usd')).toBe(5);
  });

  it('encodes the Vercel Hobby constraints verbatim', () => {
    expect(VERCEL_HOBBY_CONSTRAINTS).toEqual({ priceUsdPerMonth: 0, functionsMaxDurationSeconds: 300 });
  });

  it('uses the provider-published monthly windows', () => {
    expect(THIRTY_DAY_WINDOW_MS).toBe(2_592_000_000);
    expect(THIRTY_ONE_DAY_WINDOW_MS).toBe(2_678_400_000);
  });
});

describe('B015 declared-allowance builders', () => {
  const builders: readonly [string, readonly DeclaredAllowance[]][] = [
    ['neon', neonDeclaredAllowances()],
    ['r2', r2DeclaredAllowances()],
    ['upstash', upstashDeclaredAllowances()],
    ['apify', apifyDeclaredAllowances()],
  ];

  it.each(builders)('declares positive, bounded-dimension allowances for %s', (_name, allowances) => {
    expect(allowances.length).toBeGreaterThan(0);
    for (const allowance of allowances) {
      expect(allowance.limit).toBeGreaterThan(0);
      expect(allowance.dimension).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
      if (allowance.windowMs !== undefined) {
        expect(allowance.windowMs).toBeGreaterThan(0);
      }
    }
  });

  it('returns fresh, equal arrays on every call', () => {
    expect(neonDeclaredAllowances()).not.toBe(neonDeclaredAllowances());
    expect(neonDeclaredAllowances()).toEqual(neonDeclaredAllowances());
  });
});
