/**
 * Neon PostgreSQL adapter configuration (Work Order B002; issue #64).
 *
 * Reads ONLY server-side environment variables. Values are never
 * committed and never logged: error details carry the NAMES of missing
 * variables, never their contents.
 */

/** The env-var names this adapter reads (documented contract; values stay server-side). */
export const NEON_ENV_VARS = Object.freeze(['DATABASE_URL', 'NEON_CONNECTION_STRING'] as const);

export type NeonEnvVarName = (typeof NEON_ENV_VARS)[number];

export interface NeonAdapterConfig {
  /** The connection string (NEVER logged). */
  readonly connectionString: string;
}

/** Connection schemes this adapter can use (serverless HTTP driver requirement). */
const SUPPORTED_SCHEMES = ['postgres://', 'postgresql://'] as const;

function isUsableConnectionString(value: string): boolean {
  return SUPPORTED_SCHEMES.some((scheme) => value.startsWith(scheme));
}

/**
 * Resolve the connection configuration from an env source (defaults to
 * process.env). Returns null when no variable is present/usable — the
 * caller constructs the adapter in its DISABLED posture (fail closed).
 * DATABASE_URL takes precedence over NEON_CONNECTION_STRING. Only
 * postgres:// / postgresql:// connection strings are usable; anything
 * else (including an unrelated DATABASE_URL with a different scheme)
 * resolves to null so the adapter stays DISABLED instead of crashing.
 */
export function readNeonConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): NeonAdapterConfig | null {
  const value = env['DATABASE_URL'] ?? env['NEON_CONNECTION_STRING'];
  if (value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!isUsableConnectionString(trimmed)) return null;
  return { connectionString: trimmed };
}

/** The NAMES of missing configuration variables (for typed error details). */
export function missingNeonEnvVarNames(
  env: Record<string, string | undefined> = process.env,
): readonly NeonEnvVarName[] {
  return NEON_ENV_VARS.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === '';
  });
}
