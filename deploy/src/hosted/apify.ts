/**
 * Optional Apify wiring for the hosted Arena preview (Work Order B015).
 *
 * Apify is the OPTIONAL web/data-acquisition provider of the hosted
 * topology (FT1.0). There is NO Apify adapter in the B002 layer (by
 * design — B002 owns adapters); what B015 owns is the wiring contract:
 *
 *   - the env contract (APIFY_TOKEN) with the same name-only discipline;
 *   - resolution: absent token => disabled, and that is a PASSING state —
 *     "Apify is optional and must never be required for the primary
 *     capability-development lifecycle" (spec/free-tier-contract.md);
 *   - the declared free-tier ceiling ($5 monthly platform spend; the
 *     provider itself blocks further usage after the allowance is
 *     exhausted until the next cycle — fail-closed at the provider);
 *   - a dry-run check that reports the optional posture without ever
 *     contacting the platform.
 *
 * No network calls, no SDK, no credentials — pure wiring metadata.
 */

import { APIFY_FREE_TIER_QUOTAS, apifyDeclaredAllowances } from './quotas.js';

/** The env-var names this wiring reads (documented contract; values stay server-side). */
export const APIFY_ENV_VARS = Object.freeze(['APIFY_TOKEN'] as const);

export type ApifyEnvVarName = (typeof APIFY_ENV_VARS)[number];

/** Apify wiring configuration (present only when the token is set). */
export interface ApifyAdapterConfig {
  /** The platform token (NEVER logged). */
  readonly token: string;
}

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Resolve the Apify configuration from an env source. Returns null when
 * APIFY_TOKEN is absent/blank — the optional adapter stays DISABLED (fail
 * closed, never required).
 */
export function readApifyConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ApifyAdapterConfig | null {
  const token = env['APIFY_TOKEN'];
  if (!isNonBlank(token)) return null;
  return { token: token.trim() };
}

/** The resolved optional Apify wiring state. */
export interface ApifyWiring {
  /** True only when a token is present (the adapter would be enabled). */
  readonly enabled: boolean;
  readonly config: ApifyAdapterConfig | null;
  /** Always empty unless a stricter profile demands the token (B015 never does). */
  readonly missingEnvVarNames: readonly ApifyEnvVarName[];
}

/**
 * Resolve the Apify wiring posture. Optional by construction: the missing
 * list is ALWAYS empty in this wiring (an absent token is a valid disabled
 * state, not a failure) — surfaced as `enabled: false`.
 */
export function resolveApifyWiring(env: Record<string, string | undefined>): ApifyWiring {
  const config = readApifyConfigFromEnv(env);
  return {
    enabled: config !== null,
    config,
    missingEnvVarNames: [],
  };
}

export { APIFY_FREE_TIER_QUOTAS, apifyDeclaredAllowances };
