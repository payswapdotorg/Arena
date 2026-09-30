/**
 * @arena/environment-structural-engineer — shared constants for the
 * reference structural-engineer environments (A029).
 *
 * A CONTENT package: declares the reference environment definitions as
 * typed ENV1.0 protocol data (A009) and the typed consumption surface
 * for the A010 runtime. No solvers are launched here; the structural
 * world is expressed as pinned, content-addressed declarations.
 */

/** Tenant namespace owning the reference environments. */
export const STRUCTURAL_ENGINEER_ENV_NAMESPACE = 'arena-reference' as const;

/** The primary reference world: a seeded, checkpointable structural-analysis sandbox. */
export const STRUCTURAL_ENGINEER_SANDBOX_NAME = 'structural-analysis-sandbox' as const;
export const STRUCTURAL_ENGINEER_SANDBOX_VERSION = '1.0.0' as const;

/** The offline review variant: derived image, zero egress, no checkpoints. */
export const STRUCTURAL_ENGINEER_HERMETIC_NAME = 'structural-hermetic-review' as const;
export const STRUCTURAL_ENGINEER_HERMETIC_VERSION = '1.0.0' as const;

/** Pinned reference image digests (declared constants, not computed). */
export const STRUCTURAL_ENGINEER_SANDBOX_IMAGE_DIGEST =
  '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a' as const;
export const STRUCTURAL_ENGINEER_HERMETIC_IMAGE_DIGEST =
  '2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c' as const;
export const STRUCTURAL_ENGINEER_HERMETIC_BUILD_DIGEST =
  '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e' as const;

/** Pinned initial-state snapshot digests (declared constants). */
export const STRUCTURAL_ENGINEER_SANDBOX_SNAPSHOT_DIGEST =
  '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d' as const;
export const STRUCTURAL_ENGINEER_HERMETIC_SNAPSHOT_DIGEST =
  '6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f' as const;

/** The reference run seed (captured by the seed policy; deterministic replay). */
export const STRUCTURAL_ENGINEER_RUN_SEED = 'seed-struct-reference-0001' as const;

/** Reference tenant for run declarations. */
export const STRUCTURAL_ENGINEER_RUN_TENANT = 'arena-reference' as const;

/** Fixed provenance timestamps (caller-supplied; no hidden clock reads). */
export const STRUCTURAL_ENGINEER_ENV_T0 = '2026-10-02T08:00:00.000Z' as const;

/** Error codes for this package's declaration surface. */
export const STRUCTURAL_ENGINEER_ENV_ERROR_CODES = Object.freeze({
  INVALID_DECLARATION: 'STRUCTURAL_ENGINEER_ENV_INVALID_DECLARATION',
  POLICY_VIOLATION: 'STRUCTURAL_ENGINEER_ENV_POLICY_VIOLATION',
  UNKNOWN_ERROR: 'STRUCTURAL_ENGINEER_ENV_UNKNOWN_ERROR',
});
