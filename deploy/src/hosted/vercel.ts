/**
 * Vercel project profile for the hosted Arena preview (Work Order B015).
 *
 * The hosted preview is a Vercel Hobby deployment of apps/web (Next.js App
 * Router, @arena/web). This module is the typed, validated description of
 * that deployment target — wiring metadata only: no API calls, no
 * credentials, no provider SDK. Live deploys happen through the Vercel CLI
 * driven by `.github/workflows/deploy-preview.yml`; the deploy credentials
 * (VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID) are GitHub repository
 * secrets injected by the Tech Lead at the launch gate (B019) and are
 * validated here by NAME only (fail fast, names never values).
 *
 * Free-tier posture: the profile is Hobby-compatible by construction — the
 * function duration bound is the Hobby ceiling (300 s, FT1.0), so
 * long-running Arena jobs must not depend on one request (the durable-job
 * pattern of docs/deployment/free-tier-architecture.md).
 */

import { VERCEL_HOBBY_CONSTRAINTS } from './quotas.js';

/** The env-var names the CI deploy requires (GitHub repository secrets). */
export const VERCEL_DEPLOY_ENV_VARS = Object.freeze([
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
] as const);

export type VercelDeployEnvVarName = (typeof VERCEL_DEPLOY_ENV_VARS)[number];

/** The typed Vercel deployment profile for the hosted preview. */
export interface VercelProjectProfile {
  /** Monorepo-relative app root (matches the Vercel project Root Directory). */
  readonly rootDirectory: string;
  /** The Vercel framework preset for apps/web. */
  readonly framework: 'nextjs';
  /** Install command (repo root; frozen lockfile — A001 frozen dependency policy). */
  readonly installCommand: string;
  /** Node runtime for builds and functions (.nvmrc parity). */
  readonly nodeVersion: string;
  /** Deploy target for pushes to main (the hosted preview IS the production alias). */
  readonly target: 'production';
  /** Hobby ceiling: functions max duration in seconds. */
  readonly functionMaxDurationSeconds: number;
}

/** The hosted-preview Vercel profile (the deployed default). */
export const HOSTED_PREVIEW_VERCEL_PROFILE: VercelProjectProfile = Object.freeze({
  rootDirectory: 'apps/web',
  framework: 'nextjs',
  installCommand: 'corepack pnpm install --frozen-lockfile',
  nodeVersion: '22.x',
  target: 'production',
  functionMaxDurationSeconds: VERCEL_HOBBY_CONSTRAINTS.functionsMaxDurationSeconds,
} as const);

/** Validation outcome: either ok, or the collected problems (fail closed). */
export type VercelProfileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly string[] };

const ROOT_DIRECTORY_PATTERN = /^(?!\/)(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*$/;
const NODE_VERSION_PATTERN = /^\d+(?:\.\d+)?(?:\.x)?$/;

/**
 * Validate a Vercel project profile (fail closed). Checks: monorepo-safe
 * relative root directory, Next.js framework preset, frozen-lockfile
 * install command, .nvmrc-parity node version, production target, and the
 * Hobby function-duration ceiling (FT1.0).
 */
export function validateVercelProjectProfile(profile: VercelProjectProfile): VercelProfileValidation {
  const problems: string[] = [];
  if (!ROOT_DIRECTORY_PATTERN.test(profile.rootDirectory)) {
    problems.push(`rootDirectory must be a relative monorepo path (got ${JSON.stringify(profile.rootDirectory)})`);
  }
  if (profile.rootDirectory !== 'apps/web') {
    problems.push('rootDirectory must be apps/web (the @arena/web app — B001 surface)');
  }
  if (profile.framework !== 'nextjs') {
    problems.push(`framework must be nextjs (got ${JSON.stringify(profile.framework)})`);
  }
  if (!profile.installCommand.includes('--frozen-lockfile')) {
    problems.push('installCommand must use --frozen-lockfile (A001 frozen dependency policy)');
  }
  if (!NODE_VERSION_PATTERN.test(profile.nodeVersion)) {
    problems.push(`nodeVersion must be a major/minor/x spec (got ${JSON.stringify(profile.nodeVersion)})`);
  }
  if (profile.nodeVersion.split('.')[0] !== '22') {
    problems.push('nodeVersion must track .nvmrc (Node 22)');
  }
  if (profile.target !== 'production') {
    problems.push('target must be production (the hosted preview is the production alias)');
  }
  if (
    profile.functionMaxDurationSeconds !== VERCEL_HOBBY_CONSTRAINTS.functionsMaxDurationSeconds ||
    profile.functionMaxDurationSeconds > 300
  ) {
    problems.push(
      `functionMaxDurationSeconds must equal the Vercel Hobby ceiling ${VERCEL_HOBBY_CONSTRAINTS.functionsMaxDurationSeconds}s`,
    );
  }
  return problems.length > 0 ? { ok: false, problems: Object.freeze(problems) } : { ok: true };
}

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/** The NAMES of missing CI deploy credentials (never their values). */
export function missingVercelDeployEnvVarNames(
  env: Record<string, string | undefined>,
): readonly VercelDeployEnvVarName[] {
  return VERCEL_DEPLOY_ENV_VARS.filter((name) => !isNonBlank(env[name]));
}

/** Resolved CI deploy credentials (token/org/project by NAME-bearing value). */
export interface VercelDeployConfig {
  readonly token: string;
  readonly orgId: string;
  readonly projectId: string;
}

/**
 * Resolve CI deploy credentials from an env source, or null when any is
 * missing/blank — callers fail closed (the deploy workflow refuses with
 * the missing NAMES; see ops/deployment/provider-setup.md).
 */
export function resolveVercelDeployConfig(
  env: Record<string, string | undefined>,
): VercelDeployConfig | null {
  const token = env['VERCEL_TOKEN'];
  const orgId = env['VERCEL_ORG_ID'];
  const projectId = env['VERCEL_PROJECT_ID'];
  if (!isNonBlank(token) || !isNonBlank(orgId) || !isNonBlank(projectId)) return null;
  return { token: token.trim(), orgId: orgId.trim(), projectId: projectId.trim() };
}
