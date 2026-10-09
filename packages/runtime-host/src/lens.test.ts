import { describe, expect, it } from 'vitest';
import {
  assertLensMatches,
  DEMO_TENANT_ID,
  isTruthLens,
  LENS_ERROR_CODES,
  LensError,
  lensForTenant,
  toTruthLens,
  TRUTH_LENSES,
} from './lens.js';

describe('truth lens (ADR-P001-02)', () => {
  it('has exactly two values — no third lens is representable', () => {
    expect(TRUTH_LENSES).toEqual(['demo', 'customer']);
    expect(TRUTH_LENSES).toHaveLength(2);
  });

  it('validates the closed vocabulary', () => {
    expect(toTruthLens('demo')).toBe('demo');
    expect(toTruthLens('customer')).toBe('customer');
    expect(isTruthLens('demo')).toBe(true);
    expect(isTruthLens('customer')).toBe(true);
    expect(isTruthLens('sandbox')).toBe(false);
    expect(isTruthLens(null)).toBe(false);
    expect(isTruthLens(1)).toBe(false);
  });

  it('fails closed with the typed error on an invalid lens', () => {
    expect(() => toTruthLens('production')).toThrow(LensError);
    try {
      toTruthLens('production');
      expect.unreachable('toTruthLens must throw');
    } catch (error) {
      expect(error instanceof LensError).toBe(true);
      expect((error as LensError).code).toBe(LENS_ERROR_CODES.INVALID_LENS);
      expect((error as LensError).details['representable']).toEqual(['demo', 'customer']);
    }
  });

  it('resolves the reserved demo tenant to demo and every other tenant to customer', () => {
    expect(DEMO_TENANT_ID).toBe('demo');
    expect(lensForTenant('demo')).toBe('demo');
    expect(lensForTenant('tenant-alpha')).toBe('customer');
    expect(lensForTenant('acme')).toBe('customer');
  });

  it('fails closed on cross-lens reads (never a silent merge)', () => {
    expect(() => assertLensMatches('demo', 'customer')).toThrow(LensError);
    try {
      assertLensMatches('demo', 'customer');
      expect.unreachable('assertLensMatches must throw');
    } catch (error) {
      expect((error as LensError).code).toBe(LENS_ERROR_CODES.LENS_CONFLICT);
      expect((error as LensError).details).toEqual({ recorded: 'demo', caller: 'customer' });
    }
    expect(() => assertLensMatches('customer', 'customer')).not.toThrow();
    expect(() => assertLensMatches('demo', 'demo')).not.toThrow();
  });
});
