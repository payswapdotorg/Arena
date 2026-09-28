/**
 * Determinism primitives (Work Order A010 gates 10, 15; requirement R9
 * — reproducible isolated environments).
 *
 * The reference runner simulates workload execution deterministically
 * with a SEEDED LCG (Numerical Recipes 32-bit constants) — the ONLY
 * randomness source in this package; `Math.random` is never used. Real
 * isolation runtimes may reuse the same primitive to derive per-step
 * world randomness from a run's declared seed, so trajectories are
 * reproducible across runner implementations.
 *
 * `stepSeed` derives an INDEPENDENT stream per (seed, purpose, index)
 * triple: operations are stateless and order-independent (a restart or
 * a re-derivation reproduces the same values), while a single seed
 * still addresses the whole deterministic world.
 */

import { toRunSeed } from './shared.js';
import type { RunSeed } from './shared.js';

/** Numerical Recipes 32-bit LCG constants. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const NONZERO_SEED = 0x2f6e2b1;

/** A deterministic 32-bit linear congruential generator. */
export class SeededLcg {
  private state: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.state = (seed >>> 0) || NONZERO_SEED;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return this.state;
  }

  /** Uniform double in [0, 1). */
  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`maxExclusive must be a positive integer, got ${String(maxExclusive)}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Uniform integer in [minInclusive, maxInclusive]. */
  intBetween(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) {
      throw new RangeError(
        `maxInclusive (${String(maxInclusive)}) must be >= minInclusive (${String(minInclusive)})`,
      );
    }
    return minInclusive + this.int(maxInclusive - minInclusive + 1);
  }

  /** Fair coin flip. */
  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}

/** FNV-1a 32-bit hash — deterministic string → uint32 (platform-stable). */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Derive the numeric LCG seed of a run seed string (validated neutral seed). */
export function seedToUint32(seed: string | RunSeed): number {
  const validated = toRunSeed(seed);
  return fnv1a32(validated);
}

/**
 * An INDEPENDENT deterministic stream per (seed, purpose, index):
 * `stepSeed('seed-42', 'step', 3)` always yields the same generator,
 * regardless of call order — restart-safe, replay-safe determinism.
 */
export function stepLcg(
  seed: string | RunSeed,
  purpose: string,
  index: number,
): SeededLcg {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`index must be a non-negative integer, got ${String(index)}`);
  }
  if (typeof purpose !== 'string' || purpose.length === 0) {
    throw new RangeError('purpose must be a non-empty string');
  }
  return new SeededLcg(fnv1a32(`${seed}:${purpose}:${String(index)}`));
}

/** Create a fresh generator over a run seed string. */
export function createSeededLcg(seed: string | RunSeed): SeededLcg {
  return new SeededLcg(seedToUint32(seed));
}

/** Validate a seed string (neutral charset) and return it branded. */
export function toSeed(value: string): RunSeed {
  return toRunSeed(value);
}
