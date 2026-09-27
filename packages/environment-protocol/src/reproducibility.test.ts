/**
 * Reproducibility matrix (Work Order A009 gate 4 — the complete
 * deterministic/nondeterministic truth table):
 *
 *   deterministic + no capture + no seed        ⇒ accepted (preferred)
 *   deterministic + capture                     ⇒ rejected (contradiction)
 *   deterministic + seed                        ⇒ rejected (contradiction)
 *   nondeterministic + full capture + seed      ⇒ accepted
 *   nondeterministic + no capture               ⇒ rejected
 *   nondeterministic + capture missing ANY of
 *   the four groups (seed/versions/external
 *   inputs/timing context)                      ⇒ rejected
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import {
  isNondeterminismCapture,
  isReproducibilityProfile,
  isSeedPolicy,
  toNondeterminismCapture,
  toReproducibilityProfile,
  toSeedPolicy,
} from './reproducibility.js';
import { makeNondeterministicSeedPolicy } from './test-support.js';

const FULL_CAPTURE = {
  seed: 'effective seed recorded in the run evidence',
  versions: 'image and environment versions recorded in the run address',
  externalInputs: 'declared external inputs recorded with their digests',
  timingContext: 'wall-clock and monotonic timing recorded in the trajectory',
};

describe('reproducibility matrix (gate 4)', () => {
  it('deterministic + no capture + no seed is accepted (preferred)', () => {
    const profile = toReproducibilityProfile({ mode: 'deterministic', capture: null, note: null });
    expect(profile.mode).toBe('deterministic');
    expect(profile.capture).toBeNull();
    expect(isReproducibilityProfile(profile)).toBe(true);
  });

  it('deterministic + capture is rejected (contradiction)', () => {
    expect(() =>
      toReproducibilityProfile({ mode: 'deterministic', capture: FULL_CAPTURE, note: null }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
  });

  it('deterministic + seed is rejected (contradiction)', () => {
    expect(() =>
      toSeedPolicy({
        reproducibility: { mode: 'deterministic', capture: null, note: null },
        seed: 'seed-0001',
        seedAlgorithm: 'counter-based-derivation',
        reseedPolicy: 'forbidden',
        note: null,
      }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY }),
    );
  });

  it('nondeterministic + full capture + seed is accepted', () => {
    const policy = toSeedPolicy(makeNondeterministicSeedPolicy());
    expect(policy.reproducibility.mode).toBe('nondeterministic');
    expect(policy.seed).toBe('seed-0001');
    expect(policy.seedAlgorithm).toBe('counter-based-derivation');
    expect(isSeedPolicy(policy)).toBe(true);
  });

  it('nondeterministic + capture missing is rejected', () => {
    expect(() =>
      toReproducibilityProfile({ mode: 'nondeterministic', capture: null, note: null }),
    ).toThrowError(
      expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
  });

  it.each(['seed', 'versions', 'externalInputs', 'timingContext'] as const)(
    'nondeterministic capture missing %s is rejected',
    (field) => {
      const partial = { ...FULL_CAPTURE } as Record<string, string>;
      delete partial[field];
      expect(() =>
        toReproducibilityProfile({
          mode: 'nondeterministic',
          capture: partial as unknown as Parameters<typeof toReproducibilityProfile>[0]['capture'],
          note: null,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
          message: expect.stringContaining(field),
        }),
      );
    },
  );

  it.each(['seed', 'versions', 'externalInputs', 'timingContext'] as const)(
    'nondeterministic capture with EMPTY %s is rejected',
    (field) => {
      const empty = { ...FULL_CAPTURE, [field]: '' };
      expect(() =>
        toNondeterminismCapture(empty),
      ).toThrowError(
        expect.objectContaining({ code: ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY }),
      );
    },
  );

  it('a full capture object validates and is frozen', () => {
    const capture = toNondeterminismCapture(FULL_CAPTURE);
    expect(isNondeterminismCapture(capture)).toBe(true);
    expect(Object.isFrozen(capture)).toBe(true);
    expect(isNondeterminismCapture({ ...FULL_CAPTURE, seed: 42 })).toBe(false);
  });

  it('a seed without a derivation algorithm is rejected', () => {
    expect(() =>
      toSeedPolicy({
        reproducibility: { mode: 'nondeterministic', capture: FULL_CAPTURE, note: null },
        seed: 'seed-0001',
        seedAlgorithm: null,
        reseedPolicy: 'declared-only',
        note: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY,
        message: expect.stringContaining('seedAlgorithm'),
      }),
    );
  });

  it('unknown modes and reseed policies are rejected', () => {
    expect(() =>
      toReproducibilityProfile({ mode: 'chaotic', capture: null, note: null }),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toSeedPolicy({
        reproducibility: { mode: 'deterministic', capture: null, note: null },
        seed: null,
        seedAlgorithm: null,
        reseedPolicy: 'whenever',
        note: null,
      }),
    ).toThrowError(EnvironmentError);
  });

  it('unknown and missing REQUIRED fields are rejected (strict shape)', () => {
    expect(() =>
      toReproducibilityProfile({ mode: 'deterministic' } as unknown as Parameters<typeof toReproducibilityProfile>[0]),
    ).toThrowError(EnvironmentError);
    expect(() =>
      toReproducibilityProfile({ mode: 'deterministic', capture: null, note: null, extra: true } as unknown as Parameters<typeof toReproducibilityProfile>[0]),
    ).toThrowError(EnvironmentError);
    // The optional note field may be absent:
    expect(() =>
      toReproducibilityProfile({ mode: 'deterministic', capture: null }),
    ).not.toThrow();
  });
});
