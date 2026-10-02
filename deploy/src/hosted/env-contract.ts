/**
 * Hosted-preview environment contract (Work Order B015).
 *
 * The single source of truth for every environment variable the hosted
 * preview wiring reads. Provider names and connection details appear ONLY
 * here, in the adapter env modules (B002) and in the deploy runbooks —
 * never in domain packages (A-series architecture law; enforced by the
 * per-package hygiene suites and `pnpm boundary`).
 *
 * Rules encoded here:
 *   - names only, never values: every helper reports missing NAMES; the
 *     template renderer emits EMPTY placeholders (`NAME=`) so a committed
 *     `.env.example` can never carry a credential;
 *   - the contract stays in sync with the B002 adapters by construction:
 *     the adapter env modules own the authoritative name lists
 *     (NEON_ENV_VARS / R2_ENV_VARS / UPSTASH_ENV_VARS) and
 *     `env-contract.test.ts` cross-checks this registry against them;
 *   - the template file `deploy/env/hosted-preview.env.example` is the
 *     rendered artifact of this registry (same test asserts byte-equality
 *     with `renderHostedPreviewEnvTemplate()`), so "env presence" checks in
 *     the deploy workflow validate a real file, not a copy-paste.
 *
 * Normative env surface (docs/deployment/free-tier-architecture.md
 * "Required environment variables"): DATABASE_URL, R2
 * endpoint/bucket/access keys, UPSTASH_REDIS_REST_URL and token, optional
 * APIFY token, authentication/session secrets — all server-side only.
 */

/** Logical surface a hosted env var belongs to. */
export type HostedEnvSurface =
  | 'neon'
  | 'r2'
  | 'upstash'
  | 'apify'
  | 'session'
  | 'vercel-ci';

/** One env-var contract entry. */
export interface HostedEnvVarSpec {
  /** The variable name (server-side contract). */
  readonly name: string;
  /** Which provider/wiring surface reads it. */
  readonly surface: HostedEnvSurface;
  /** Required for the hosted preview (strict mode fails closed when absent). */
  readonly required: boolean;
  /** Secret value: never rendered with a value, never logged. */
  readonly secret: boolean;
  /**
   * Whether the variable belongs in the runtime env template. CI-only
   * deploy credentials (vercel-ci) are injected as GitHub repository
   * secrets by the Tech Lead (launch gate B019) — documented in
   * ops/deployment/provider-setup.md, not in the runtime template.
   */
  readonly inTemplate: boolean;
  /** Short human description (name-level facts only). */
  readonly description: string;
}

/**
 * The hosted-preview env contract. Neon accepts DATABASE_URL (preferred)
 * OR NEON_CONNECTION_STRING; R2 accepts R2_S3_ENDPOINT OR R2_ACCOUNT_ID
 * (endpoint derived from the account id).
 */
export const HOSTED_ENV_VARS: readonly HostedEnvVarSpec[] = Object.freeze([
  Object.freeze({
    name: 'DATABASE_URL',
    surface: 'neon',
    required: true,
    secret: true,
    inTemplate: true,
    description: 'Neon PostgreSQL connection string (postgres:// or postgresql://); authoritative control-plane store.',
  }),
  Object.freeze({
    name: 'NEON_CONNECTION_STRING',
    surface: 'neon',
    required: false,
    secret: true,
    inTemplate: true,
    description: 'Alternative to DATABASE_URL for the Neon adapter (same scheme rules); DATABASE_URL wins when both are set.',
  }),
  Object.freeze({
    name: 'R2_ACCESS_KEY_ID',
    surface: 'r2',
    required: true,
    secret: true,
    inTemplate: true,
    description: 'Cloudflare R2 access key id (S3-compatible API token).',
  }),
  Object.freeze({
    name: 'R2_SECRET_ACCESS_KEY',
    surface: 'r2',
    required: true,
    secret: true,
    inTemplate: true,
    description: 'Cloudflare R2 secret access key.',
  }),
  Object.freeze({
    name: 'R2_BUCKET',
    surface: 'r2',
    required: true,
    secret: false,
    inTemplate: true,
    description: 'Cloudflare R2 bucket name for trajectories, datasets, evidence bundles and releases.',
  }),
  Object.freeze({
    name: 'R2_S3_ENDPOINT',
    surface: 'r2',
    required: false,
    secret: false,
    inTemplate: true,
    description: 'Explicit S3-compatible endpoint (https://<account-id>.r2.cloudflarestorage.com); takes precedence over R2_ACCOUNT_ID.',
  }),
  Object.freeze({
    name: 'R2_ACCOUNT_ID',
    surface: 'r2',
    required: false,
    secret: false,
    inTemplate: true,
    description: 'Cloudflare account id — the endpoint is derived when R2_S3_ENDPOINT is absent (one of the two is required).',
  }),
  Object.freeze({
    name: 'UPSTASH_REDIS_REST_URL',
    surface: 'upstash',
    required: true,
    secret: false,
    inTemplate: true,
    description: 'Upstash Redis REST endpoint (http/https) for bounded, rebuildable coordination state.',
  }),
  Object.freeze({
    name: 'UPSTASH_REDIS_REST_TOKEN',
    surface: 'upstash',
    required: true,
    secret: true,
    inTemplate: true,
    description: 'Upstash Redis REST bearer token.',
  }),
  Object.freeze({
    name: 'APIFY_TOKEN',
    surface: 'apify',
    required: false,
    secret: true,
    inTemplate: true,
    description: 'Optional Apify platform token; absent wiring stays disabled — Apify is never required for the primary lifecycle.',
  }),
  Object.freeze({
    name: 'ARENA_SESSION_SECRET',
    surface: 'session',
    required: true,
    secret: true,
    inTemplate: true,
    description: 'Session signing secret (min 32 characters; shorter fails closed with AUTH_DISABLED — B004 session boundary).',
  }),
  Object.freeze({
    name: 'VERCEL_TOKEN',
    surface: 'vercel-ci',
    required: true,
    secret: true,
    inTemplate: false,
    description: 'Vercel deploy token — GitHub repository secret injected by the Tech Lead (B019); CI deploy only, never app runtime env.',
  }),
  Object.freeze({
    name: 'VERCEL_ORG_ID',
    surface: 'vercel-ci',
    required: true,
    secret: true,
    inTemplate: false,
    description: 'Vercel org/team id — GitHub repository secret (B019); CI deploy only.',
  }),
  Object.freeze({
    name: 'VERCEL_PROJECT_ID',
    surface: 'vercel-ci',
    required: true,
    secret: true,
    inTemplate: false,
    description: 'Vercel project id (root directory apps/web) — GitHub repository secret (B019); CI deploy only.',
  }),
] as const);

/** Path of the rendered template relative to the repository root. */
export const HOSTED_PREVIEW_ENV_TEMPLATE_PATH = 'deploy/env/hosted-preview.env.example';

const SURFACE_SECTION_TITLES: Readonly<Record<HostedEnvSurface, string>> = Object.freeze({
  neon: 'Neon PostgreSQL (control-plane store) — B002 hosted adapter',
  r2: 'Cloudflare R2 (object store) — B002 hosted adapter',
  upstash: 'Upstash Redis (coordination store) — B002 hosted adapter',
  apify: 'Apify (optional data acquisition)',
  session: 'Session boundary (B004 auth)',
  'vercel-ci': 'CI deploy credentials (GitHub repository secrets — Tech Lead injects at B019)',
});

const SURFACE_ORDER: readonly HostedEnvSurface[] = Object.freeze([
  'neon',
  'r2',
  'upstash',
  'apify',
  'session',
]);

/**
 * Render the hosted-preview env template: EMPTY placeholders only.
 * Deterministic (stable ordering, no timestamps) so the committed template
 * and this renderer stay byte-identical — asserted by
 * `env-contract.test.ts`.
 */
export function renderHostedPreviewEnvTemplate(): string {
  const lines: string[] = [
    '# Arena hosted preview — environment contract (Work Order B015).',
    '#',
    '# EMPTY placeholders by design: NEVER commit real credentials. Live values',
    '# are injected server-side by the Tech Lead at the launch gate (B019); see',
    `# ${HOSTED_PREVIEW_ENV_TEMPLATE_PATH} consumers in ops/deployment/provider-setup.md.`,
    '#',
    `# Source of truth: this file is the rendered artifact of`,
    '# deploy/src/hosted/env-contract.ts (HOSTED_ENV_VARS).',
    '# Quota ceilings: docs/deployment/free-tier-architecture.md (fail-closed).',
    '',
  ];
  for (const surface of SURFACE_ORDER) {
    const specs = HOSTED_ENV_VARS.filter((spec) => spec.inTemplate && spec.surface === surface);
    if (specs.length === 0) continue;
    lines.push(`# --- ${SURFACE_SECTION_TITLES[surface]} ---`);
    for (const spec of specs) {
      lines.push(`# ${spec.description}`);
      lines.push(`${spec.name}=`);
    }
    lines.push('');
  }
  lines.push('# CI deploy credentials (VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID)');
  lines.push('# are GitHub repository secrets — never runtime env; see');
  lines.push('# ops/deployment/provider-setup.md (secret injection at the B019 gate).');
  return `${lines.join('\n')}\n`;
}

/**
 * Parse the assignment keys (`NAME=`) out of an env-template text —
 * the deterministic inverse of the renderer (comments ignored).
 */
export function parseEnvTemplateKeys(text: string): readonly string[] {
  const keys: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match !== null) keys.push(match[1] as string);
  }
  return keys;
}

/** The template names for one surface (template-visible entries only). */
export function hostedEnvVarNamesFor(surface: HostedEnvSurface): readonly string[] {
  return HOSTED_ENV_VARS.filter((spec) => spec.surface === surface).map((spec) => spec.name);
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * The NAMES of required hosted-preview variables that are missing/blank in
 * an env source (runtime surface only — vercel-ci credentials are checked
 * separately by ./vercel.ts). The Neon alternative pair collapses:
 * DATABASE_URL counts as present when NEON_CONNECTION_STRING is set (the
 * adapter's own reader is the enforcement source of truth; the R2
 * endpoint/account-id pair is validated jointly by the adapter reader —
 * see ./wiring.ts resolveR2Wiring).
 */
export function missingHostedPreviewEnvVarNames(
  env: Record<string, string | undefined>,
): readonly string[] {
  const missing: string[] = [];
  for (const spec of HOSTED_ENV_VARS) {
    if (!spec.required || spec.surface === 'vercel-ci') continue;
    if (!isBlank(env[spec.name])) continue;
    if (spec.name === 'DATABASE_URL' && !isBlank(env['NEON_CONNECTION_STRING'])) continue;
    missing.push(spec.name);
  }
  return missing;
}
