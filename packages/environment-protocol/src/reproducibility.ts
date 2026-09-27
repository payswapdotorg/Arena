/**
 * Reproducibility metadata and seed policy (spec ENV1.0 "Reproducibility"
 * and "seed policy" declare field; requirements R9, R22; Work Order A009
 * gate 4).
 *
 *   - ReproducibilityProfile — deterministic environments are PREFERRED;
 *     nondeterminism MUST capture seed, versions, external inputs and
 *     relevant timing/context metadata (all four capture groups declared,
 *     non-empty). A deterministic profile that also declares capture
 *     metadata, or that declares a seed, is a contradiction and rejected.
 *   - SeedPolicy — how randomness enters the world: the declared seed
 *     (null iff unseeded), the derivation algorithm (a neutral identifier),
 *     and whether mid-run reseeding is allowed.
 *
 * The two objects are cross-validated at the definition level
 * (definition.ts):
 *   - reproducibility.mode === 'deterministic' && seedPolicy.seed !== null
 *     ⇒ rejected (contradiction);
 *   - reproducibility.mode === 'deterministic' && capture !== null ⇒
 *     rejected (contradiction);
 *   - reproducibility.mode === 'nondeterministic' && capture === null or
 *     any capture group missing/empty ⇒ rejected.
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { NeutralId, NeutralText } from './shared.js';
import {
  expectEnumMember,
  expectFields,
  isNeutralText,
  toNeutralId,
  toNeutralText,
} from './shared.js';

// ---------------------------------------------------------------------------
// ReproducibilityProfile (Work Order A009 gate 4)
// ---------------------------------------------------------------------------

export const REPRODUCIBILITY_MODES = Object.freeze(['deterministic', 'nondeterministic'] as const);
export type ReproducibilityMode = (typeof REPRODUCIBILITY_MODES)[number];

/**
 * The four capture groups a NONDETERMINISTIC declaration MUST declare:
 * how the seed, versions, external inputs and relevant timing/context
 * metadata are captured for reproduction (spec ENV1.0 Reproducibility).
 */
export interface NondeterminismCapture {
  readonly seed: NeutralText;
  readonly versions: NeutralText;
  readonly externalInputs: NeutralText;
  readonly timingContext: NeutralText;
}

const CAPTURE_FIELDS = ['seed', 'versions', 'externalInputs', 'timingContext'] as const;

export function isNondeterminismCapture(value: unknown): value is NondeterminismCapture {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return CAPTURE_FIELDS.every((field) => isNeutralText(candidate[field]));
}

/** Validate and freeze a capture declaration (all four groups, non-empty). */
export function toNondeterminismCapture(value: {
  seed: string;
  versions: string;
  externalInputs: string;
  timingContext: string;
}): NondeterminismCapture {
  const record = expectFields(
    value,
    [...CAPTURE_FIELDS],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'nondeterminism capture',
  );
  const capture: NondeterminismCapture = Object.freeze({
    seed: toNeutralText(
      typeof record['seed'] === 'string' ? record['seed'] : '',
      'nondeterminismCapture.seed',
      ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    ),
    versions: toNeutralText(
      typeof record['versions'] === 'string' ? record['versions'] : '',
      'nondeterminismCapture.versions',
      ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    ),
    externalInputs: toNeutralText(
      typeof record['externalInputs'] === 'string' ? record['externalInputs'] : '',
      'nondeterminismCapture.externalInputs',
      ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    ),
    timingContext: toNeutralText(
      typeof record['timingContext'] === 'string' ? record['timingContext'] : '',
      'nondeterminismCapture.timingContext',
      ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    ),
  });
  return capture;
}

/** The reproducibility profile of an environment declaration. */
export interface ReproducibilityProfile {
  readonly mode: ReproducibilityMode;
  readonly capture: NondeterminismCapture | null;
  readonly note: NeutralText | null;
}

export function isReproducibilityProfile(value: unknown): value is ReproducibilityProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['mode'] !== 'string' ||
    !(REPRODUCIBILITY_MODES as readonly string[]).includes(candidate['mode'])
  ) {
    return false;
  }
  if (candidate['capture'] !== null && !isNondeterminismCapture(candidate['capture'])) {
    return false;
  }
  return candidate['note'] === null || isNeutralText(candidate['note']);
}

/**
 * Validate and freeze a reproducibility profile. Structural consistency:
 *   - deterministic ⇒ capture MUST be null;
 *   - nondeterministic ⇒ capture MUST be present and fully declared.
 * (The seed contradiction is enforced at the definition level, where the
 * seed policy and the profile meet.)
 */
export function toReproducibilityProfile(value: {
  mode: string;
  capture: {
    seed: string;
    versions: string;
    externalInputs: string;
    timingContext: string;
  } | null;
  note?: string | null;
}): ReproducibilityProfile {
  const record = expectFields(
    value,
    ['mode', 'capture'],
    ['note'],
    ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'reproducibility profile',
  );
  const mode = expectEnumMember(
    record['mode'],
    REPRODUCIBILITY_MODES,
    'mode',
    ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY,
    'reproducibility profile',
  );
  const rawCapture = record['capture'];
  if (rawCapture !== null && (typeof rawCapture !== 'object' || Array.isArray(rawCapture))) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'reproducibility profile: capture must be a capture object or null',
    });
  }
  const capture =
    rawCapture === null
      ? null
      : toNondeterminismCapture(rawCapture as {
          seed: string;
          versions: string;
          externalInputs: string;
          timingContext: string;
        });
  const rawNote = record['note'];
  if (rawNote !== null && rawNote !== undefined && typeof rawNote !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: 'reproducibility profile: note must be neutral text or null',
    });
  }
  const note =
    rawNote === null || rawNote === undefined
      ? null
      : toNeutralText(rawNote, 'reproducibilityProfile.note', ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY);

  if (mode === 'deterministic' && capture !== null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message:
        'deterministic profile must not declare nondeterminism capture metadata (contradiction)',
    });
  }
  if (mode === 'nondeterministic' && capture === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message:
        'nondeterministic profile MUST declare capture metadata for seed, versions, external inputs and timing/context (spec ENV1.0 Reproducibility)',
      details: { required: [...CAPTURE_FIELDS] },
    });
  }
  return Object.freeze({ mode, capture, note });
}

// ---------------------------------------------------------------------------
// SeedPolicy (spec ENV1.0 declare field 4)
// ---------------------------------------------------------------------------

export const RESEED_POLICIES = Object.freeze(['forbidden', 'declared-only'] as const);
export type ReseedPolicy = (typeof RESEED_POLICIES)[number];

/**
 * The seed policy: how randomness enters the environment. `seed` is the
 * declared seed (null iff unseeded — see the definition-level contradiction
 * rules); `seedAlgorithm` is the neutral identifier of the seed derivation;
 * `reseedPolicy` bounds mid-run reseeding; `note` is free neutral text.
 */
export interface SeedPolicy {
  readonly reproducibility: ReproducibilityProfile;
  readonly seed: string | null;
  readonly seedAlgorithm: NeutralId | null;
  readonly reseedPolicy: ReseedPolicy;
  readonly note: NeutralText | null;
}

export function isSeedPolicy(value: unknown): value is SeedPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isReproducibilityProfile(candidate['reproducibility']) &&
    (candidate['seed'] === null || typeof candidate['seed'] === 'string') &&
    (candidate['seedAlgorithm'] === null || typeof candidate['seedAlgorithm'] === 'string') &&
    typeof candidate['reseedPolicy'] === 'string' &&
    (RESEED_POLICIES as readonly string[]).includes(candidate['reseedPolicy']) &&
    (candidate['note'] === null ||
      candidate['note'] === undefined ||
      isNeutralText(candidate['note']))
  );
}

/** Validate and freeze a seed policy (embeds the reproducibility profile). */
export function toSeedPolicy(value: {
  reproducibility: {
    mode: string;
    capture: {
      seed: string;
      versions: string;
      externalInputs: string;
      timingContext: string;
    } | null;
    note?: string | null;
  };
  seed: string | null;
  seedAlgorithm: string | null;
  reseedPolicy: string;
  note?: string | null;
}): SeedPolicy {
  const record = expectFields(
    value,
    ['reproducibility', 'seed', 'seedAlgorithm', 'reseedPolicy'],
    ['note'],
    ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY,
    'seed policy',
  );
  const rawRepro = record['reproducibility'];
  if (typeof rawRepro !== 'object' || rawRepro === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message: 'seed policy: reproducibility must be a reproducibility profile',
    });
  }
  const reproducibility = toReproducibilityProfile(
    rawRepro as {
      mode: string;
      capture: {
        seed: string;
        versions: string;
        externalInputs: string;
        timingContext: string;
      } | null;
      note?: string | null;
    },
  );
  const rawSeed = record['seed'];
  if (rawSeed !== null && typeof rawSeed !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message: 'seed policy: seed must be a string or null',
    });
  }
  const seed = rawSeed === null ? null : toNeutralText(rawSeed, 'seedPolicy.seed', ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY);
  const rawAlgorithm = record['seedAlgorithm'];
  if (rawAlgorithm !== null && typeof rawAlgorithm !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message: 'seed policy: seedAlgorithm must be a neutral identifier or null',
    });
  }
  const seedAlgorithm =
    rawAlgorithm === null ? null : toNeutralId(rawAlgorithm);
  const reseedPolicy = expectEnumMember(
    record['reseedPolicy'],
    RESEED_POLICIES,
    'reseedPolicy',
    ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY,
    'seed policy',
  );
  const rawNote = record['note'];
  if (rawNote !== null && rawNote !== undefined && typeof rawNote !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message: 'seed policy: note must be neutral text or null',
    });
  }
  const note =
    rawNote === null || rawNote === undefined
      ? null
      : toNeutralText(rawNote, 'seedPolicy.note', ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY);

  // Contradiction rule: a deterministic world has nothing to seed.
  if (reproducibility.mode === 'deterministic' && seed !== null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message:
        'deterministic environment declares a seed (contradiction): a deterministic world is seed-free by construction',
      details: { mode: reproducibility.mode, seed },
    });
  }
  // A seed requires its derivation algorithm to be addressable.
  if (seed !== null && seedAlgorithm === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_SEED_POLICY, {
      message: 'seed policy: a declared seed requires seedAlgorithm (how the seed is applied)',
    });
  }
  return Object.freeze({ reproducibility, seed, seedAlgorithm, reseedPolicy, note });
}
