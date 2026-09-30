/**
 * @arena/environment-software-engineer — shared constants for the
 * reference software-engineer environments (A028).
 *
 * A CONTENT package: declares the reference environment definitions as
 * typed ENV1.0 protocol data (A009) and the typed consumption surface
 * for the A010 runtime. No containers are launched here.
 */

/** Tenant namespace owning the reference environments. */
export const SOFTWARE_ENGINEER_ENV_NAMESPACE = 'arena-reference' as const;

/** The primary reference sandbox: a seeded, checkpointable dev sandbox. */
export const SOFTWARE_ENGINEER_SANDBOX_NAME = 'software-engineer-sandbox' as const;
export const SOFTWARE_ENGINEER_SANDBOX_VERSION = '1.0.0' as const;

/** The offline review variant: derived image, zero egress, no checkpoints. */
export const SOFTWARE_ENGINEER_HERMETIC_NAME = 'software-engineer-hermetic-review' as const;
export const SOFTWARE_ENGINEER_HERMETIC_VERSION = '1.0.0' as const;

/** Pinned reference image digests (declared constants, not computed). */
export const SOFTWARE_ENGINEER_SANDBOX_IMAGE_DIGEST =
  'abababababababababababababababababababababababababababababababab' as const;
export const SOFTWARE_ENGINEER_HERMETIC_IMAGE_DIGEST =
  'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' as const;
export const SOFTWARE_ENGINEER_HERMETIC_BUILD_DIGEST =
  'cececececececececececececececececececececececececececececececece' as const;

/** Pinned initial-state snapshot digests (declared constants). */
export const SOFTWARE_ENGINEER_SANDBOX_SNAPSHOT_DIGEST =
  '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e' as const;
export const SOFTWARE_ENGINEER_HERMETIC_SNAPSHOT_DIGEST =
  '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f' as const;

/** The reference run seed (captured by the seed policy; deterministic replay). */
export const SOFTWARE_ENGINEER_RUN_SEED = 'seed-se-reference-0001' as const;

/** Reference tenant for run declarations. */
export const SOFTWARE_ENGINEER_RUN_TENANT = 'arena-reference' as const;

/** Fixed provenance timestamps (caller-supplied; no hidden clock reads). */
export const SOFTWARE_ENGINEER_ENV_T0 = '2026-10-01T08:00:00.000Z' as const;

/** Error codes for this package's declaration surface. */
export const SOFTWARE_ENGINEER_ENV_ERROR_CODES = Object.freeze({
  INVALID_DECLARATION: 'SOFTWARE_ENGINEER_ENV_INVALID_DECLARATION',
  POLICY_VIOLATION: 'SOFTWARE_ENGINEER_ENV_POLICY_VIOLATION',
  UNKNOWN_ERROR: 'SOFTWARE_ENGINEER_ENV_UNKNOWN_ERROR',
});
