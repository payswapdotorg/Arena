/**
 * Hosted-wiring dry run (Work Order B015): verifies the FULL wiring path
 * WITHOUT live credentials.
 *
 * What the dry run proves, end to end, deterministically (no network, no
 * secrets):
 *
 *   1. env presence/shape — the required names of the hosted env contract
 *      are reported (missing names are expected pre-provisioning; a
 *      PRESENT-but-unusable value is a defect);
 *   2. per-provider resolution — the REAL B002 adapter env readers accept
 *      placeholder-shaped configuration (the same code path strict mode
 *      uses);
 *   3. the optional Apify posture (disabled is a passing state);
 *   4. the Vercel profile validates against the Hobby constraints;
 *   5. the free-tier quota ceilings are all declared and positive;
 *   6. adapter instantiation — the composed stack (real B002 adapters,
 *      injected local fakes at the transport seams) probes AVAILABLE,
 *      declares the quota dimensions, and passes the capacity guard;
 *   7. bootstrap — versioned migrations apply against the fake transport,
 *      the hosted seed lands once, and a re-run is a no-op (reproducible);
 *   8. fail-closed refusal — an exhausted or disabled provider makes the
 *      guard THROW the typed capacity error (no fallback path exists).
 *
 * Every check reports NAMES and posture facts only — never env VALUES.
 * This module is exercised by `dry-run.integration.test.ts` and is the
 * wiring self-test the deploy workflow runs.
 */

import { isPersistenceCapacityError, ManualClock, toCapacitySnapshot } from '@arena/persistence';
import type { Clock, ProviderCapacityStatus } from '@arena/persistence';
import { guardHostedPreviewCapacity, NO_BILLABLE_FALLBACK, HOSTED_PREVIEW_EXHAUSTION_POLICY } from './fail-closed.js';
import { FakeObjectStorageTransport, FakeRestTransport, FakeSqlTransport } from './fakes.js';
import {
  composeHostedBootstrap,
  composeHostedPersistenceStack,
  HOSTED_PREVIEW_PROVIDER_IDS,
  resolveHostedWiring,
} from './wiring.js';
import type { HostedStackTransports } from './wiring.js';
import {
  APIFY_FREE_TIER_QUOTAS,
  NEON_FREE_TIER_QUOTAS,
  R2_FREE_TIER_QUOTAS,
  UPSTASH_FREE_TIER_QUOTAS,
  VERCEL_HOBBY_CONSTRAINTS,
} from './quotas.js';
import {
  HOSTED_PREVIEW_VERCEL_PROFILE,
  missingVercelDeployEnvVarNames,
  validateVercelProjectProfile,
} from './vercel.js';

/** One dry-run check result (names and posture facts only). */
export interface DryRunCheck {
  readonly id: string;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly detail: string;
}

/** The aggregated dry-run report (`ok` is false iff any check failed). */
export interface DryRunReport {
  readonly mode: 'dry-run';
  readonly checks: readonly DryRunCheck[];
  readonly ok: boolean;
}

/**
 * Placeholder-shaped env accepted by the REAL B002 adapter env readers.
 * These are structurally valid (scheme/host/token shapes) but carry no
 * credentials and point nowhere — the local fakes take over at the
 * transport seams.
 */
export const DRY_RUN_PLACEHOLDER_ENV: Readonly<Record<string, string>> = Object.freeze({
  DATABASE_URL: 'postgres://dry-run:no-credentials@dry-run.invalid/arena',
  R2_ACCOUNT_ID: 'dry-run-account',
  R2_ACCESS_KEY_ID: 'dry-run-access-key-id',
  R2_SECRET_ACCESS_KEY: 'dry-run-secret-access-key',
  R2_BUCKET: 'dry-run-bucket',
  UPSTASH_REDIS_REST_URL: 'https://dry-run.upstash.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'dry-run-rest-token',
  APIFY_TOKEN: 'dry-run-apify-token',
  ARENA_SESSION_SECRET: 'dry-run-session-secret-0123456789abcdef',
});

/** Deterministic clock for the fake-backed checks. */
const DRY_RUN_CLOCK: Clock = new ManualClock(0);

function localFakeTransports(): HostedStackTransports {
  return {
    sql: new FakeSqlTransport({ enforceTables: true }),
    objectStorage: new FakeObjectStorageTransport(),
    rest: new FakeRestTransport({ clock: DRY_RUN_CLOCK }),
  };
}

function envPresenceChecks(env: Record<string, string | undefined>): DryRunCheck[] {
  const resolution = resolveHostedWiring(env, 'dry-run');
  const checks: DryRunCheck[] = [];
  const required = [
    resolution.controlPlane,
    resolution.objectStore,
    resolution.coordination,
  ];
  for (const provider of required) {
    const present = provider.envVarNames.filter(
      (name) => env[name] !== undefined && env[name]?.trim() !== '',
    );
    if (provider.configured) {
      checks.push({
        id: `env-presence:${provider.providerId}`,
        status: 'pass',
        detail: `configured (${present.length}/${provider.envVarNames.length} names present)`,
      });
    } else if (present.length > 0) {
      checks.push({
        id: `env-presence:${provider.providerId}`,
        status: 'fail',
        detail: `values are present but UNUSABLE by the adapter reader (strict wiring would fail closed); missing names: ${provider.missingEnvVarNames.join(', ') || '(none)'}`,
      });
    } else {
      checks.push({
        id: `env-presence:${provider.providerId}`,
        status: 'warn',
        detail: `no credentials provided (expected pre-provisioning); missing names: ${provider.missingEnvVarNames.join(', ')}`,
      });
    }
  }
  checks.push({
    id: `env-presence:${resolution.apify.enabled ? 'apify-enabled' : 'apify-optional'}`,
    status: 'pass',
    detail: resolution.apify.enabled
      ? 'APIFY_TOKEN present (optional adapter enabled)'
      : 'APIFY_TOKEN absent (optional adapter disabled — a passing posture; Apify is never required for the primary lifecycle)',
  });
  if (resolution.sessionSecret.lengthOk) {
    checks.push({
      id: 'env-presence:session-boundary',
      status: 'pass',
      detail: 'ARENA_SESSION_SECRET present and meets the >=32-character bound',
    });
  } else if (resolution.sessionSecret.present) {
    checks.push({
      id: 'env-presence:session-boundary',
      status: 'fail',
      detail: 'ARENA_SESSION_SECRET is present but shorter than 32 characters (B004 fails closed with AUTH_DISABLED)',
    });
  } else {
    checks.push({
      id: 'env-presence:session-boundary',
      status: 'warn',
      detail: 'ARENA_SESSION_SECRET not provided (TL injects at the launch gate; see ops/deployment/provider-setup.md)',
    });
  }
  return checks;
}

function placeholderResolutionChecks(): DryRunCheck[] {
  // The REAL readers must accept the placeholder shapes (the strict code
  // path, exercised without credentials).
  const resolution = resolveHostedWiring(DRY_RUN_PLACEHOLDER_ENV, 'dry-run');
  const ids = [
    [resolution.controlPlane.configured, 'wiring-resolve:control-plane-store'],
    [resolution.objectStore.configured, 'wiring-resolve:object-store'],
    [resolution.coordination.configured, 'wiring-resolve:coordination-store'],
  ] as const;
  return ids.map(([configured, id]) => ({
    id,
    status: configured ? ('pass' as const) : ('fail' as const),
    detail: configured
      ? 'the B002 adapter env reader accepts the placeholder-shaped configuration (real resolution path)'
      : 'the adapter env reader rejected the placeholder configuration — the wiring path is broken',
  }));
}

function vercelProfileChecks(env: Record<string, string | undefined>): DryRunCheck[] {
  const validation = validateVercelProjectProfile(HOSTED_PREVIEW_VERCEL_PROFILE);
  const missing = missingVercelDeployEnvVarNames(env);
  return [
    {
      id: 'vercel-profile',
      status: validation.ok ? 'pass' : 'fail',
      detail: validation.ok
        ? `profile validates (root ${HOSTED_PREVIEW_VERCEL_PROFILE.rootDirectory}, target ${HOSTED_PREVIEW_VERCEL_PROFILE.target}, functions <= ${HOSTED_PREVIEW_VERCEL_PROFILE.functionMaxDurationSeconds}s — Vercel Hobby ceiling)`
        : `profile problems: ${validation.problems.join('; ')}`,
    },
    {
      id: 'vercel-deploy-credentials',
      status: 'warn',
      detail:
        missing.length === 0
          ? 'CI deploy credentials present'
          : `CI deploy credentials not injected (GitHub repository secrets, owned by the TL at the B019 gate); missing names: ${missing.join(', ')}`,
    },
  ];
}

function quotaCeilingChecks(): DryRunCheck[] {
  const profiles = [NEON_FREE_TIER_QUOTAS, R2_FREE_TIER_QUOTAS, UPSTASH_FREE_TIER_QUOTAS, APIFY_FREE_TIER_QUOTAS];
  const bad: string[] = [];
  for (const profile of profiles) {
    for (const dimension of profile.dimensions) {
      if (!(dimension.limit > 0)) bad.push(`${profile.providerId}/${dimension.dimension}`);
    }
  }
  return [
    {
      id: 'quota-ceilings',
      status: bad.length === 0 ? 'pass' : 'fail',
      detail:
        bad.length === 0
          ? `all free-tier ceilings declared and positive (neon: ${NEON_FREE_TIER_QUOTAS.dimensions.length} dimensions, r2: ${R2_FREE_TIER_QUOTAS.dimensions.length}, upstash: ${UPSTASH_FREE_TIER_QUOTAS.dimensions.length}, apify: ${APIFY_FREE_TIER_QUOTAS.dimensions.length}); source: docs/deployment/free-tier-architecture.md`
          : `non-positive ceilings are not declarable: ${bad.join(', ')}`,
    },
    {
      id: 'fail-closed-policy',
      status: HOSTED_PREVIEW_EXHAUSTION_POLICY === 'fail-closed' && NO_BILLABLE_FALLBACK ? 'pass' : 'fail',
      detail: 'exhaustion policy is fail-closed and no billable fallback is representable',
    },
    {
      id: 'vercel-hobby-constraints',
      status: VERCEL_HOBBY_CONSTRAINTS.functionsMaxDurationSeconds === 300 ? 'pass' : 'fail',
      detail: `Vercel Hobby constraints encoded (functions max duration ${VERCEL_HOBBY_CONSTRAINTS.functionsMaxDurationSeconds}s, $${VERCEL_HOBBY_CONSTRAINTS.priceUsdPerMonth}/month)`,
    },
  ];
}

async function compositionChecks(): Promise<DryRunCheck[]> {
  const transports = localFakeTransports();
  const stack = composeHostedPersistenceStack({
    env: DRY_RUN_PLACEHOLDER_ENV,
    clock: DRY_RUN_CLOCK,
    transports,
  });
  const checks: DryRunCheck[] = [];

  const probes = new Map<string, string[]>();
  for (const provider of stack.providers) {
    const snapshot = await provider.probe.capacityProbe();
    probes.set(
      provider.providerId,
      snapshot.dimensions.map((dimension) => dimension.dimension),
    );
    checks.push({
      id: `composition:${provider.providerId}`,
      status: snapshot.status === 'AVAILABLE' ? 'pass' : 'fail',
      detail: `probe ${snapshot.status}${snapshot.reasons.length > 0 ? ` (${snapshot.reasons.map((reason) => reason.code).join(', ')})` : ''} against the local fake; declared dimensions: ${probes.get(provider.providerId)?.join(', ') || '(none)'}`,
    });
  }

  try {
    const report = await guardHostedPreviewCapacity(stack.providers, DRY_RUN_CLOCK);
    checks.push({
      id: 'composition:capacity-guard',
      status: report.overall === 'AVAILABLE' ? 'pass' : 'warn',
      detail: `guard passed with overall ${report.overall} (all registered providers usable)`,
    });
  } catch (error) {
    checks.push({
      id: 'composition:capacity-guard',
      status: 'fail',
      detail: `guard refused the composed stack: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return checks;
}

async function bootstrapChecks(): Promise<DryRunCheck[]> {
  const transports = localFakeTransports();
  const bootstrapStack = composeHostedBootstrap({
    env: DRY_RUN_PLACEHOLDER_ENV,
    clock: DRY_RUN_CLOCK,
    transports,
  });
  const first = await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
  const second = await bootstrapStack.bootstrap.bootstrap(bootstrapStack.migrations);
  const appliedNames = first.migrations.applied.map((entry) => `${entry.version}:${entry.name}`);
  const checks: DryRunCheck[] = [
    {
      id: 'bootstrap:migrations',
      status:
        first.migrations.applied.length === first.migrations.toVersion &&
        first.migrations.applied.length > 0
          ? 'pass'
          : 'fail',
      detail: `versioned migrations applied against the local fake (${appliedNames.join(', ')}); fromVersion ${first.migrations.fromVersion} -> toVersion ${first.migrations.toVersion}`,
    },
    {
      id: 'bootstrap:seed',
      status: first.seedCheck.outcome === 'seeded' && second.seedCheck.outcome === 'already-seeded' ? 'pass' : 'fail',
      detail: `seed check: first run '${first.seedCheck.outcome}', re-run '${second.seedCheck.outcome}' (idempotent bootstrap)`,
    },
    {
      id: 'bootstrap:reproducible',
      status: second.migrations.applied.length === 0 ? 'pass' : 'fail',
      detail: `re-run applied ${second.migrations.applied.length} migrations (expected 0 — reproducible)`,
    },
  ];
  return checks;
}

async function failClosedChecks(): Promise<DryRunCheck[]> {
  const checks: DryRunCheck[] = [];
  // (a) Exhausted provider -> the guard THROWS the typed error.
  const exhaustedProbe = {
    capacityProbe: async () =>
      toCapacitySnapshot({
        status: 'EXHAUSTED' as ProviderCapacityStatus,
        checkedAt: DRY_RUN_CLOCK.now(),
        dimensions: [],
        reasons: [{ code: 'quota-exhausted' }],
      }),
  };
  let refused = false;
  try {
    await guardHostedPreviewCapacity(
      [
        Object.freeze({
          providerId: 'dry-run-exhausted',
          probe: exhaustedProbe,
        }),
      ],
      DRY_RUN_CLOCK,
    );
  } catch (error) {
    refused = isPersistenceCapacityError(error) && error.capacityStatus === 'EXHAUSTED';
  }
  checks.push({
    id: 'fail-closed:exhausted',
    status: refused ? 'pass' : 'fail',
    detail: refused
      ? 'an EXHAUSTED provider makes the guard throw the typed capacity error — the operation is refused (no fallback)'
      : 'the guard did NOT refuse an exhausted provider — fail-closed contract broken',
  });

  // (b) Unconfigured (DISABLED) wiring -> strict resolution fails fast AND
  // the guard refuses the disabled adapters (NO transports injected: the
  // adapters must construct in their DISABLED posture).
  const emptyResolution = resolveHostedWiring({}, 'strict');
  const unconfigured = new Map(
    emptyResolution.failures.map((failure) => [failure.providerId, failure.missingEnvVarNames.join(', ')]),
  );
  const disabledStack = composeHostedPersistenceStack({ env: {}, clock: DRY_RUN_CLOCK });
  let disabledRefused = false;
  try {
    await guardHostedPreviewCapacity(disabledStack.providers, DRY_RUN_CLOCK);
  } catch (error) {
    disabledRefused = isPersistenceCapacityError(error) && error.capacityStatus === 'DISABLED';
  }
  const strictFailedFast =
    emptyResolution.failures.length >= 3 &&
    unconfigured.get(HOSTED_PREVIEW_PROVIDER_IDS.controlPlane) !== undefined;
  checks.push({
    id: 'fail-closed:disabled',
    status: strictFailedFast && disabledRefused ? 'pass' : 'fail',
    detail: `empty env: strict resolution failed fast on ${emptyResolution.failures.length} surfaces (names only) and the guard refused the DISABLED stack with the typed error`,
  });
  return checks;
}

/**
 * Run the hosted-wiring dry run against an env source (defaults to
 * process.env — presence reporting only; the composition/bootstrap and
 * fail-closed checks are fully deterministic and never touch the
 * network). Returns the structured report; `ok === false` means the
 * wiring self-test FAILS (the deploy workflow surfaces the report).
 */
export async function runHostedWiringDryRun(
  env: Record<string, string | undefined> = process.env,
): Promise<DryRunReport> {
  const checks: DryRunCheck[] = [
    ...envPresenceChecks(env),
    ...placeholderResolutionChecks(),
    ...vercelProfileChecks(env),
    ...quotaCeilingChecks(),
    ...(await compositionChecks()),
    ...(await bootstrapChecks()),
    ...(await failClosedChecks()),
  ];
  return {
    mode: 'dry-run',
    checks: Object.freeze(checks),
    ok: checks.every((check) => check.status !== 'fail'),
  };
}

/** Render a dry-run report as human-readable lines (names only). */
export function formatDryRunReport(report: DryRunReport): string {
  const lines = [
    `hosted wiring dry-run: ${report.ok ? 'OK' : 'FAILED'} (${report.checks.filter((c) => c.status === 'pass').length} pass, ${report.checks.filter((c) => c.status === 'warn').length} warn, ${report.checks.filter((c) => c.status === 'fail').length} fail)`,
  ];
  for (const check of report.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.id} — ${check.detail}`);
  }
  return lines.join('\n');
}
