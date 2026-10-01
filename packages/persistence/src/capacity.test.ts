import { describe, expect, it } from 'vitest';
import {
  aggregateProviderHealth,
  assertCapacityUsable,
  CAPACITY_EXHAUSTION_POLICY,
  CAPACITY_STATUS_SEVERITY,
  deriveCapacityStatus,
  isCapacityUsable,
  isPersistenceCapacityError,
  PersistenceCapacityError,
  toCapacityDimensionReading,
  toCapacitySnapshot,
  toProviderHealth,
} from './index.js';
import type { CapacityDimensionReading, ProviderHealth } from './index.js';

function reading(overrides: Partial<CapacityDimensionReading>): CapacityDimensionReading {
  return toCapacityDimensionReading({
    dimension: 'storage',
    used: 10,
    limit: 100,
    remaining: 90,
    windowMs: null,
    ...overrides,
  });
}

describe('capacity state model (FT2.0)', () => {
  it('exposes exactly the four FT2.0 states', () => {
    expect(CAPACITY_STATUS_SEVERITY).toEqual({
      AVAILABLE: 0,
      DEGRADED: 1,
      EXHAUSTED: 2,
      DISABLED: 3,
    });
  });

  it('derives EXHAUSTED when a known-limit dimension is used up', () => {
    const derived = deriveCapacityStatus([reading({ used: 100, remaining: 0 })]);
    expect(derived.status).toBe('EXHAUSTED');
    expect(derived.reasons).toContainEqual({ code: 'quota-exhausted', dimension: 'storage' });
  });

  it('derives DEGRADED near the limit and AVAILABLE with headroom', () => {
    expect(deriveCapacityStatus([reading({ used: 99, remaining: 1 })]).status).toBe('DEGRADED');
    expect(deriveCapacityStatus([reading({ used: 50, remaining: 50 })]).status).toBe('AVAILABLE');
    const empty = deriveCapacityStatus([]);
    expect(empty.status).toBe('AVAILABLE');
    expect(empty.reasons).toEqual([{ code: 'no-dimensions' }]);
  });

  it('unknown limits never change the status (they add a reason instead)', () => {
    const derived = deriveCapacityStatus([
      reading({ used: null, limit: null, remaining: null }),
    ]);
    expect(derived.status).toBe('AVAILABLE');
    expect(derived.reasons).toEqual([{ code: 'limit-unknown', dimension: 'storage' }]);
  });

  it('validates dimension readings fail-closed', () => {
    expect(() => toCapacityDimensionReading({ dimension: 'Bad Name', used: 1, limit: 2, remaining: 1 })).toThrow();
    expect(() => toCapacityDimensionReading({ dimension: 'storage', used: 5, limit: 4, remaining: -1 })).toThrow();
    expect(() => toCapacityDimensionReading({ dimension: 'storage', used: 5, limit: 10, remaining: 4 })).toThrow();
    expect(() => toCapacityDimensionReading({ dimension: 'storage', used: -1, limit: 10, remaining: 11 })).toThrow();
    expect(() => toCapacityDimensionReading('nope')).toThrow();
    expect(toCapacityDimensionReading({ dimension: 'requests', used: 1, limit: 5, remaining: 4, windowMs: 60_000 })).toEqual({
      dimension: 'requests',
      used: 1,
      limit: 5,
      remaining: 4,
      windowMs: 60_000,
    });
  });

  it('validates snapshots fail-closed (status, dimensions, reasons)', () => {
    expect(() => toCapacitySnapshot({ status: 'HAPPY', checkedAt: 1, dimensions: [], reasons: [] })).toThrow();
    expect(() => toCapacitySnapshot({ status: 'AVAILABLE', checkedAt: -1, dimensions: [], reasons: [] })).toThrow();
    expect(() => toCapacitySnapshot({ status: 'AVAILABLE', checkedAt: 1, dimensions: 'x', reasons: [] })).toThrow();
    expect(() => toCapacitySnapshot({ status: 'AVAILABLE', checkedAt: 1, dimensions: [], reasons: [{ code: 'nope' }] })).toThrow();
    const snapshot = toCapacitySnapshot({
      status: 'DEGRADED',
      checkedAt: 123,
      dimensions: [{ dimension: 'storage', used: 99, limit: 100, remaining: 1 }],
      reasons: [{ code: 'dimension-near-limit', dimension: 'storage' }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.dimensions)).toBe(true);
  });
});

describe('fail-closed exhaustion policy (FT2.0 — no silent paid fallback)', () => {
  it('the policy type has exactly one inhabitant: fail-closed', () => {
    // Compile-time witness: the only assignable value is 'fail-closed'.
    const policy: typeof CAPACITY_EXHAUSTION_POLICY = 'fail-closed';
    expect(policy).toBe('fail-closed');
    expect(CAPACITY_EXHAUSTION_POLICY).toBe('fail-closed');
  });

  it('assertCapacityUsable throws the typed exhaustion error on EXHAUSTED', () => {
    expect(() =>
      assertCapacityUsable({ status: 'EXHAUSTED', reasons: [{ code: 'quota-exhausted', dimension: 'storage' }] }),
    ).toThrow(PersistenceCapacityError);
    try {
      assertCapacityUsable({ status: 'EXHAUSTED' });
      expect.unreachable('expected the capacity gate to throw');
    } catch (error) {
      expect(isPersistenceCapacityError(error)).toBe(true);
      const capacityError = error as PersistenceCapacityError;
      expect(capacityError.code).toBe('PERSISTENCE_CAPACITY_EXHAUSTED');
      expect(capacityError.capacityStatus).toBe('EXHAUSTED');
      expect(capacityError.capacityReasons).toEqual([{ code: 'quota-exhausted' }]);
      expect(capacityError.details).toMatchObject({ policy: 'fail-closed' });
    }
  });

  it('assertCapacityUsable throws the typed disabled error on DISABLED', () => {
    try {
      assertCapacityUsable({ status: 'DISABLED' });
      expect.unreachable('expected the capacity gate to throw');
    } catch (error) {
      expect(isPersistenceCapacityError(error)).toBe(true);
      const capacityError = error as PersistenceCapacityError;
      expect(capacityError.code).toBe('PERSISTENCE_CAPACITY_DISABLED');
      expect(capacityError.capacityStatus).toBe('DISABLED');
    }
  });

  it('AVAILABLE and DEGRADED pass the gate (usable statuses)', () => {
    expect(() => assertCapacityUsable({ status: 'AVAILABLE' })).not.toThrow();
    expect(() => assertCapacityUsable({ status: 'DEGRADED' })).not.toThrow();
    expect(isCapacityUsable('AVAILABLE')).toBe(true);
    expect(isCapacityUsable('DEGRADED')).toBe(true);
    expect(isCapacityUsable('EXHAUSTED')).toBe(false);
    expect(isCapacityUsable('DISABLED')).toBe(false);
  });

  it('exhaustion propagates: a gated async operation surfaces the typed error, never a fallback', async () => {
    const gated = async (): Promise<string> => {
      assertCapacityUsable({ status: 'EXHAUSTED' });
      return 'alternate-result';
    };
    await expect(gated()).rejects.toMatchObject({
      code: 'PERSISTENCE_CAPACITY_EXHAUSTED',
      capacityStatus: 'EXHAUSTED',
    });
  });
});

describe('aggregate provider health', () => {
  const base = toCapacitySnapshot({
    status: 'AVAILABLE',
    checkedAt: 50,
    dimensions: [],
    reasons: [],
  });

  it('worst-of severity wins across providers', () => {
    const snapshot = aggregateProviderHealth(
      [
        toProviderHealth('control-plane', base),
        toProviderHealth('blob-store', toCapacitySnapshot({ status: 'EXHAUSTED', checkedAt: 60, dimensions: [], reasons: [{ code: 'quota-exhausted' }] })),
        toProviderHealth('coordination', toCapacitySnapshot({ status: 'DEGRADED', checkedAt: 70, dimensions: [], reasons: [] })),
      ],
      80,
    );
    expect(snapshot.overall).toBe('EXHAUSTED');
    expect(snapshot.checkedAt).toBe(80);
    expect(snapshot.providers.map((entry) => entry.providerId)).toEqual([
      'control-plane',
      'blob-store',
      'coordination',
    ]);
  });

  it('DISABLED outranks EXHAUSTED; empty aggregates are AVAILABLE', () => {
    const disabled: ProviderHealth = toProviderHealth(
      'blob-store',
      toCapacitySnapshot({ status: 'DISABLED', checkedAt: 1, dimensions: [], reasons: [{ code: 'configuration-missing' }] }),
    );
    const exhausted: ProviderHealth = toProviderHealth(
      'control-plane',
      toCapacitySnapshot({ status: 'EXHAUSTED', checkedAt: 1, dimensions: [], reasons: [] }),
    );
    expect(aggregateProviderHealth([disabled, exhausted], 2).overall).toBe('DISABLED');
    expect(aggregateProviderHealth([], 2).overall).toBe('AVAILABLE');
    expect(aggregateProviderHealth([], 2).providers).toEqual([]);
  });

  it('rejects invalid provider ids (fail closed)', () => {
    expect(() => toProviderHealth('Bad Id', base)).toThrow();
    expect(() => aggregateProviderHealth([{ ...toProviderHealth('ok-id', base), providerId: 'BAD' }], 1)).toThrow();
  });
});
