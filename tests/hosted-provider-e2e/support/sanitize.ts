/**
 * P004 sanitized-environment support (tests/hosted-provider-e2e).
 *
 * The zero-credential check (release gate: "the app still boots/runs with
 * NO provider credentials") needs an environment in which every hosted
 * provider credential name is absent. The authoritative name list is the
 * hosted env contract itself (`deploy/src/hosted/env-contract.ts`,
 * HOSTED_ENV_VARS — the rendered artifact is
 * `deploy/env/hosted-preview.env.example`), extended with the sandbox-only
 * provider variables (Cloudflare/Neon management keys) that never appear
 * in the contract but must also be stripped here.
 */

import { HOSTED_ENV_VARS } from '@arena/deploy/env-contract';

/** Provider/credential env names from the hosted env contract (all surfaces). */
export const CONTRACT_PROVIDER_ENV_NAMES: readonly string[] = HOSTED_ENV_VARS.map(
  (spec) => spec.name,
);

/** Extra sandbox-side provider variables stripped for the sanitized env. */
export const EXTRA_PROVIDER_ENV_NAMES: readonly string[] = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'NEON_API_KEY',
  'NEON_API_KEY_ALT',
  'UPSTASH_MCP_API_KEY',
  'UPSTASH_MCP_URL',
  'UPSTASH_ACCOUNT_EMAIL',
  'UPSTASH_REDIS_REST_TOKEN_ALT',
  'UPSTASH_REDIS_REST_TOKEN_OLD',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  // P004 e2e gates (never credentials, but they select live behavior).
  'ARENA_HOSTED_E2E_R2_BUCKET',
  'ARENA_HOSTED_EVIDENCE_OUT',
];

/** Every env name this battery treats as a provider credential. */
export const PROVIDER_ENV_NAMES: readonly string[] = [
  ...new Set([...CONTRACT_PROVIDER_ENV_NAMES, ...EXTRA_PROVIDER_ENV_NAMES]),
];

/**
 * A sanitized copy of the given env: every provider credential name is
 * REMOVED (undefined), everything else passes through. Used both for
 * adapter construction (zero-credential posture) and for spawning the
 * built app with no provider credentials set.
 */
export function sanitizedEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const sanitized: Record<string, string | undefined> = { ...source };
  for (const name of PROVIDER_ENV_NAMES) {
    delete sanitized[name];
  }
  return sanitized;
}

/** Which of the provider env names were actually present (and removed). */
export function removedProviderEnvNames(
  source: Record<string, string | undefined> = process.env,
): readonly string[] {
  return PROVIDER_ENV_NAMES.filter((name) => {
    const value = source[name];
    return value !== undefined && value.trim() !== '';
  });
}
