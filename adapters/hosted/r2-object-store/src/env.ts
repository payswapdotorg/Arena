/**
 * Cloudflare R2 object-store adapter configuration (Work Order B002; issue #64).
 *
 * Reads ONLY server-side environment variables. Values are never committed
 * and never logged: error details carry the NAMES of missing variables,
 * never their contents.
 *
 * Env-var contract (names only):
 *   R2_S3_ENDPOINT      — the S3-compatible endpoint
 *                         (https://<account-id>.r2.cloudflarestorage.com)
 *   R2_ACCOUNT_ID       — used to DERIVE the endpoint when R2_S3_ENDPOINT
 *                         is absent
 *   R2_ACCESS_KEY_ID    — access key id
 *   R2_SECRET_ACCESS_KEY— secret access key
 *   R2_BUCKET           — bucket name
 *
 * R2_S3_ENDPOINT takes precedence over R2_ACCOUNT_ID-derived endpoints.
 */

/** The env-var names this adapter reads (documented contract; values stay server-side). */
export const R2_ENV_VARS = Object.freeze([
  'R2_ACCOUNT_ID',
  'R2_S3_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const);

export type R2EnvVarName = (typeof R2_ENV_VARS)[number];

export interface R2AdapterConfig {
  /** The S3-compatible endpoint (NEVER logged). */
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** The endpoint every R2 account exposes (account id substitutes in). */
const R2_ENDPOINT_TEMPLATE = 'https://%s.r2.cloudflarestorage.com';

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

/** Account ids must be hostname-label safe to derive an endpoint. */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Resolve the object-store configuration from an env source (defaults to
 * process.env). Returns null when required variables are missing/blank —
 * the caller constructs the adapter in its DISABLED posture (fail closed).
 * Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and EITHER
 * R2_S3_ENDPOINT (http(s) URL) OR R2_ACCOUNT_ID (endpoint derived).
 */
export function readR2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): R2AdapterConfig | null {
  const accessKeyId = env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY'];
  const bucket = env['R2_BUCKET'];
  if (!isNonBlank(accessKeyId) || !isNonBlank(secretAccessKey) || !isNonBlank(bucket)) {
    return null;
  }
  const explicitEndpoint = env['R2_S3_ENDPOINT'];
  const accountId = env['R2_ACCOUNT_ID'];
  let endpoint: string | null = null;
  if (isNonBlank(explicitEndpoint)) {
    const trimmed = explicitEndpoint.trim();
    if (!isHttpUrl(trimmed)) return null;
    endpoint = trimmed;
  } else if (accountId !== undefined && ACCOUNT_ID_PATTERN.test(accountId.trim())) {
    endpoint = R2_ENDPOINT_TEMPLATE.replace('%s', accountId.trim());
  }
  if (endpoint === null) return null;
  return {
    endpoint,
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    bucket: bucket.trim(),
  };
}

/** The NAMES of missing configuration variables (for typed error details). */
export function missingR2EnvVarNames(
  env: Record<string, string | undefined> = process.env,
): readonly R2EnvVarName[] {
  const missing: R2EnvVarName[] = [];
  for (const name of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
    if (!isNonBlank(env[name])) missing.push(name);
  }
  // The endpoint pair: missing only when BOTH the explicit endpoint and the
  // account id are absent (either one satisfies the requirement).
  if (!isNonBlank(env['R2_S3_ENDPOINT']) && !isNonBlank(env['R2_ACCOUNT_ID'])) {
    missing.push('R2_S3_ENDPOINT', 'R2_ACCOUNT_ID');
  }
  return missing;
}
