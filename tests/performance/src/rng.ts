/**
 * Deterministic PRNG (mulberry32). Same seed → same stream, on every
 * machine, forever. The load shapes are pure functions of their seed.
 */

export type Rng = () => number;

/** Create a seeded 32-bit PRNG (mulberry32 — small, fast, stable). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer in [minInclusive, maxExclusive). */
export function intBetween(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}
