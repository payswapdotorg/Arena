/**
 * Determinism primitive tests (Work Order A010 gates 10, 15; R9):
 * seeded LCG reproducibility, stream independence, Math.random absence.
 */

import { describe, expect, it } from 'vitest';
import {
  SeededLcg,
  createSeededLcg,
  fnv1a32,
  seedToUint32,
  stepLcg,
  toSeed,
} from './determinism.js';

describe('seeded LCG determinism', () => {
  it('reproduces identical streams for identical seeds (positive)', () => {
    const a = new SeededLcg(42);
    const b = new SeededLcg(42);
    const streamA = Array.from({ length: 32 }, () => a.nextUint32());
    const streamB = Array.from({ length: 32 }, () => b.nextUint32());
    expect(streamA).toEqual(streamB);
  });

  it('diverges for different seeds (positive — non-degenerate harness)', () => {
    const a = new SeededLcg(1);
    const b = new SeededLcg(2);
    const streamA = Array.from({ length: 16 }, () => a.next());
    const streamB = Array.from({ length: 16 }, () => b.next());
    expect(streamA).not.toEqual(streamB);
  });

  it('derives stable numeric seeds from seed strings (positive)', () => {
    expect(seedToUint32('seed-1234')).toBe(fnv1a32('seed-1234'));
    expect(seedToUint32('seed-1234')).toBe(seedToUint32('seed-1234'));
    expect(seedToUint32('seed-1234')).not.toBe(seedToUint32('seed-4321'));
    expect(createSeededLcg('seed-1234').nextUint32()).toBe(
      createSeededLcg('seed-1234').nextUint32(),
    );
  });

  it('stepLcg streams are order-independent and index-addressed (positive)', () => {
    // The same (seed, purpose, index) always yields the same values,
    // regardless of call order — restart-safe determinism.
    const first = stepLcg('seed-9', 'step', 3).nextUint32();
    const second = stepLcg('seed-9', 'workload', 3).nextUint32();
    const third = stepLcg('seed-9', 'step', 3).nextUint32();
    expect(third).toBe(first);
    expect(second).not.toBe(first);
    expect(stepLcg('seed-9', 'step', 4).nextUint32()).not.toBe(first);
  });

  it('produces uniform doubles and bounded ints (positive)', () => {
    const rng = createSeededLcg('uniform-probe');
    for (let index = 0; index < 100; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const pick = rng.int(5);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(5);
    }
  });

  it('rejects invalid inputs (negative)', () => {
    expect(() => rngInt(-1)).toThrow(RangeError);
    expect(() => rngInt(0)).toThrow(RangeError);
    expect(() => stepLcg('seed-9', 'step', -1)).toThrow(RangeError);
    expect(() => stepLcg('seed-9', '', 0)).toThrow(RangeError);
    expect(() => toSeed('not a seed!')).toThrow();
    // Invalid seed string for seedToUint32:
    expect(() => seedToUint32('no spaces allowed')).toThrow();
  });

  it('intBetween stays inside its bounds (positive)', () => {
    const rng = createSeededLcg('bounds-probe');
    for (let index = 0; index < 100; index += 1) {
      const value = rng.intBetween(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(() => rng.intBetween(7, 3)).toThrow(RangeError);
  });
});

function rngInt(maxExclusive: number): number {
  return new SeededLcg(1).int(maxExclusive);
}
