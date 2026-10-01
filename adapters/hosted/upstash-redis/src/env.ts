/**
 * Upstash Redis adapter configuration (Work Order B002; issue #64).
 *
 * Reads ONLY server-side environment variables. Values are never committed
 * and never logged: error details carry the NAMES of missing variables,
 * never their contents.
 *
 * Env-var contract (names only):
 *   UPSTASH_REDIS_REST_URL    — the REST endpoint (https)
 *   UPSTASH_REDIS_REST_TOKEN  — the REST bearer token
 */

/** The env-var names this adapter reads (documented contract; values stay server-side). */
export const UPSTASH_ENV_VARS = Object.freeze([
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const);

export type UpstashEnvVarName = (typeof UPSTASH_ENV_VARS)[number];

export interface UpstashAdapterConfig {
  /** The REST endpoint (NEVER logged). */
  readonly url: string;
  /** The REST bearer token (NEVER logged). */
  readonly token: string;
}

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Resolve the REST configuration from an env source (defaults to
 * process.env). Returns null when a required variable is missing/blank or
 * the URL is not an http(s) URL — the caller constructs the adapter in its
 * DISABLED posture (fail closed).
 */
export function readUpstashConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): UpstashAdapterConfig | null {
  const url = env['UPSTASH_REDIS_REST_URL'];
  const token = env['UPSTASH_REDIS_REST_TOKEN'];
  if (!isNonBlank(url) || !isNonBlank(token)) return null;
  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('http://')) return null;
  return { url: trimmedUrl, token: token.trim() };
}

/** The NAMES of missing configuration variables (for typed error details). */
export function missingUpstashEnvVarNames(
  env: Record<string, string | undefined> = process.env,
): readonly UpstashEnvVarName[] {
  return UPSTASH_ENV_VARS.filter((name) => !isNonBlank(env[name]));
}
