/**
 * Hosted-preview provider wiring (Work Order B015) — the composition glue
 * that INSTANTIATES the B002 hosted adapters from environment config.
 *
 * Architecture law honored here:
 *   - NO new adapter code: every provider behavior comes from the B002
 *     adapters (`@arena/hosted-neon-postgres`, `@arena/hosted-r2-object-store`,
 *     `@arena/hosted-upstash-redis`) and the composition fabric
 *     (`@arena/persistence-service`). This module only resolves env,
 *     declares free-tier allowances and composes.
 *   - names, never values: every failure carries missing env-var NAMES
 *     (the B002 discipline); secrets are never logged or embedded.
 *   - fail closed, twice: (1) strict mode fails FAST at resolution time on
 *     any missing required variable; (2) the runtime capacity guard
 *     (./fail-closed.ts) refuses operations when any provider probes
 *     EXHAUSTED or DISABLED — there is no alternate path, no paid fallback
 *     and no second destination anywhere in this surface.
 *   - dry-run mode verifies the FULL wiring path without live credentials
 *     by injecting the B002 local fakes through the adapters' transport
 *     seams (see ./dry-run.ts and ./fakes.ts).
 */

import {
  bindSqlMigrations,
  createNeonHttpSqlTransport,
  missingNeonEnvVarNames,
  NeonControlPlaneRepository,
  NeonMigrationRunner,
  readNeonConfigFromEnv,
  SQL_MIGRATION_SOURCES,
} from '@arena/hosted-neon-postgres';
import type { NeonAdapterConfig, SqlTransport } from '@arena/hosted-neon-postgres';
import {
  missingR2EnvVarNames,
  R2BlobStore,
  readR2ConfigFromEnv,
} from '@arena/hosted-r2-object-store';
import type { ObjectStorageTransport, R2AdapterConfig } from '@arena/hosted-r2-object-store';
import {
  missingUpstashEnvVarNames,
  readUpstashConfigFromEnv,
  UpstashCoordinationStore,
} from '@arena/hosted-upstash-redis';
import type { RestCommandTransport, UpstashAdapterConfig } from '@arena/hosted-upstash-redis';
import { SystemClock } from '@arena/persistence';
import type { Clock, ControlPlaneRepository, Migration } from '@arena/persistence';
import { BootstrapService } from '@arena/persistence-service';
import type { RegisteredPersistenceProvider, SeedStep } from '@arena/persistence-service';
import { resolveApifyWiring } from './apify.js';
import type { ApifyWiring } from './apify.js';
import {
  neonDeclaredAllowances,
  r2DeclaredAllowances,
  upstashDeclaredAllowances,
} from './quotas.js';

/**
 * Neutral logical provider ids — IDENTICAL to the B014 operations registry
 * (apps/web/src/operations fixtures) so the hosted probes light up the
 * /operations/capacity panel through the same CapacityProbe port without
 * touching apps/web.
 */
export const HOSTED_PREVIEW_PROVIDER_IDS = Object.freeze({
  controlPlane: 'control-plane-store',
  objectStore: 'object-store',
  coordination: 'coordination-store',
} as const);

/** Wiring mode: `strict` fails fast on missing config; `dry-run` verifies shape only. */
export type HostedWiringMode = 'strict' | 'dry-run';

/** One provider's env resolution (names only — never values). */
export interface HostedProviderWiring<TConfig> {
  /** Neutral logical provider id (B014 vocabulary). */
  readonly providerId: string;
  /** The env-var names this provider's adapter reads. */
  readonly envVarNames: readonly string[];
  /** Missing/blank names (per the adapter's own reader). */
  readonly missingEnvVarNames: readonly string[];
  /** The adapter config, or null when unconfigured (DISABLED posture). */
  readonly config: TConfig | null;
  /** True iff the adapter reader resolved a usable config. */
  readonly configured: boolean;
}

function neonWiring(env: Record<string, string | undefined>): HostedProviderWiring<NeonAdapterConfig> {
  const config = readNeonConfigFromEnv(env);
  return {
    providerId: HOSTED_PREVIEW_PROVIDER_IDS.controlPlane,
    envVarNames: ['DATABASE_URL', 'NEON_CONNECTION_STRING'],
    missingEnvVarNames: missingNeonEnvVarNames(env),
    config,
    configured: config !== null,
  };
}

function r2Wiring(env: Record<string, string | undefined>): HostedProviderWiring<R2AdapterConfig> {
  const config = readR2ConfigFromEnv(env);
  return {
    providerId: HOSTED_PREVIEW_PROVIDER_IDS.objectStore,
    envVarNames: [
      'R2_ACCOUNT_ID',
      'R2_S3_ENDPOINT',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
    ],
    missingEnvVarNames: missingR2EnvVarNames(env),
    config,
    configured: config !== null,
  };
}

function upstashWiring(
  env: Record<string, string | undefined>,
): HostedProviderWiring<UpstashAdapterConfig> {
  const config = readUpstashConfigFromEnv(env);
  return {
    providerId: HOSTED_PREVIEW_PROVIDER_IDS.coordination,
    envVarNames: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    missingEnvVarNames: missingUpstashEnvVarNames(env),
    config,
    configured: config !== null,
  };
}

/** One collected strict-mode failure (fail fast, names only). */
export interface HostedWiringFailure {
  readonly providerId: string;
  readonly missingEnvVarNames: readonly string[];
  readonly note: string;
}

/** The session-boundary wiring summary (B004 env needs, names/length only). */
export interface SessionSecretWiring {
  readonly envVarName: 'ARENA_SESSION_SECRET';
  readonly present: boolean;
  /** True when the secret meets the >=32-char bound (production requirement). */
  readonly lengthOk: boolean;
}

/** The full hosted-preview wiring resolution. */
export interface HostedWiringResolution {
  readonly mode: HostedWiringMode;
  readonly controlPlane: HostedProviderWiring<NeonAdapterConfig>;
  readonly objectStore: HostedProviderWiring<R2AdapterConfig>;
  readonly coordination: HostedProviderWiring<UpstashAdapterConfig>;
  readonly apify: ApifyWiring;
  readonly sessionSecret: SessionSecretWiring;
  /**
   * Strict mode: one entry per unconfigured REQUIRED surface (fail fast).
   * Dry-run: always empty — missing config is reported, not fatal.
   */
  readonly failures: readonly HostedWiringFailure[];
}

const SESSION_SECRET_MIN_LENGTH = 32;

/**
 * Resolve the hosted wiring from an env source. The B002 adapter env
 * readers are the single source of truth for per-provider usability (e.g.
 * a DATABASE_URL with an unusable scheme resolves to unconfigured — the
 * adapter would construct DISABLED; strict mode fails fast on that).
 */
export function resolveHostedWiring(
  env: Record<string, string | undefined>,
  mode: HostedWiringMode,
): HostedWiringResolution {
  const controlPlane = neonWiring(env);
  const objectStore = r2Wiring(env);
  const coordination = upstashWiring(env);
  const apify = resolveApifyWiring(env);
  const secret = env['ARENA_SESSION_SECRET'];
  const sessionSecret: SessionSecretWiring = {
    envVarName: 'ARENA_SESSION_SECRET',
    present: secret !== undefined && secret.trim() !== '',
    lengthOk: secret !== undefined && secret.trim().length >= SESSION_SECRET_MIN_LENGTH,
  };

  const failures: HostedWiringFailure[] = [];
  if (mode === 'strict') {
    if (!controlPlane.configured) {
      failures.push({
        providerId: controlPlane.providerId,
        missingEnvVarNames: controlPlane.missingEnvVarNames,
        note: 'Neon control-plane wiring is unconfigured (DATABASE_URL or NEON_CONNECTION_STRING with a postgres:// / postgresql:// scheme is required)',
      });
    }
    if (!objectStore.configured) {
      failures.push({
        providerId: objectStore.providerId,
        missingEnvVarNames: objectStore.missingEnvVarNames,
        note: 'R2 object-store wiring is unconfigured (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and either R2_S3_ENDPOINT or R2_ACCOUNT_ID are required)',
      });
    }
    if (!coordination.configured) {
      failures.push({
        providerId: coordination.providerId,
        missingEnvVarNames: coordination.missingEnvVarNames,
        note: 'Upstash coordination wiring is unconfigured (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required)',
      });
    }
    if (!sessionSecret.lengthOk) {
      failures.push({
        providerId: 'session-boundary',
        missingEnvVarNames: [sessionSecret.envVarName],
        note: `the session secret must be at least ${SESSION_SECRET_MIN_LENGTH} characters (B004 fails closed with AUTH_DISABLED otherwise)`,
      });
    }
    // Apify is optional: an unconfigured Apify surface is NEVER a failure.
  }

  return {
    mode,
    controlPlane,
    objectStore,
    coordination,
    apify,
    sessionSecret,
    failures: Object.freeze(failures),
  };
}

// ---------------------------------------------------------------------------
// Adapter instantiation glue (composes the B002 hosted adapters)
// ---------------------------------------------------------------------------

/** Transport seams injectable for credential-free runs (dry-run / tests). */
export interface HostedStackTransports {
  readonly sql?: SqlTransport;
  readonly objectStorage?: ObjectStorageTransport;
  readonly rest?: RestCommandTransport;
}

export interface ComposeHostedStackOptions {
  /**
   * Env source; UNDEFINED means "the adapters read process.env themselves"
   * (their default). An explicit record pins the source (tests/dry-run).
   */
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock;
  /**
   * Injected transports: when present the adapters NEVER construct live
   * clients for that seam (the B002 transport seam) — this is how the
   * dry-run executes the full wiring path against local fakes without
   * credentials. When absent, the Neon SQL transport is derived ONCE from
   * the resolved env config and shared by the repository, the migration
   * runner and the bound migrations (one logical database by construction).
   */
  readonly transports?: HostedStackTransports;
  /** Production leaves '' (default); hermetic runs may namespace keys. */
  readonly keyNamespacePrefix?: string;
}

/**
 * The transport an UNCONFIGURED Neon stack would never reach: every
 * statement fails closed. Exists so `migrations` is always bindable; the
 * disabled runner refuses before any statement executes.
 */
const refuseAllSqlTransport: SqlTransport = {
  async execute(): Promise<never> {
    throw new Error(
      'hosted Neon wiring is unconfigured: no SQL transport exists (DISABLED posture — fail closed)',
    );
  },
};

/** The composed hosted persistence stack (B002 adapters + registry). */
export interface HostedPersistenceStack {
  readonly controlPlane: NeonControlPlaneRepository;
  readonly objectStore: R2BlobStore;
  readonly coordination: UpstashCoordinationStore;
  readonly migrationRunner: NeonMigrationRunner;
  /** The versioned SQL migrations bound to the shared SQL transport. */
  readonly migrations: readonly Migration[];
  /** Registered providers (B014 logical ids) for health/capacity services. */
  readonly providers: readonly RegisteredPersistenceProvider[];
}

/**
 * Instantiate the hosted persistence stack from env config: the three B002
 * adapters with their free-tier allowances declared (quota visibility),
 * composed as `RegisteredPersistenceProvider` entries behind the neutral
 * logical ids the B014 operations capacity panel already renders.
 *
 * Unconfigured adapters construct in their DISABLED posture (fail closed —
 * the capacity guard refuses operations); strict callers validate with
 * `resolveHostedWiring(env, 'strict')` FIRST.
 */
export function composeHostedPersistenceStack(
  options: ComposeHostedStackOptions = {},
): HostedPersistenceStack {
  const clock: Clock = options.clock ?? new SystemClock();
  const env = options.env;
  const envSource: Record<string, string | undefined> = env ?? process.env;

  // One shared SQL transport: injected fake OR derived from the resolved
  // Neon config (live). UNDEFINED when unconfigured — the adapters then
  // construct in their DISABLED posture (fail closed: probes report
  // DISABLED/configuration-missing, never a fake DEGRADED).
  const neonConfig = readNeonConfigFromEnv(envSource);
  const liveSqlTransport: SqlTransport | undefined =
    neonConfig !== null ? createNeonHttpSqlTransport(neonConfig.connectionString) : undefined;
  const sqlTransport: SqlTransport | undefined = options.transports?.sql ?? liveSqlTransport;

  const controlPlane = new NeonControlPlaneRepository({
    ...(env !== undefined ? { env } : {}),
    ...(sqlTransport !== undefined ? { transport: sqlTransport } : {}),
    clock,
    declaredAllowances: neonDeclaredAllowances(),
  });
  const objectStore = new R2BlobStore({
    ...(env !== undefined ? { env } : {}),
    ...(options.transports?.objectStorage !== undefined
      ? { transport: options.transports.objectStorage }
      : {}),
    clock,
    declaredAllowances: r2DeclaredAllowances(),
  });
  const coordination = new UpstashCoordinationStore({
    ...(env !== undefined ? { env } : {}),
    ...(options.transports?.rest !== undefined ? { transport: options.transports.rest } : {}),
    clock,
    declaredAllowances: upstashDeclaredAllowances(),
    ...(options.keyNamespacePrefix !== undefined
      ? { keyNamespacePrefix: options.keyNamespacePrefix }
      : {}),
  });
  const migrationRunner = new NeonMigrationRunner({
    ...(env !== undefined ? { env } : {}),
    ...(sqlTransport !== undefined ? { transport: sqlTransport } : {}),
    clock,
  });
  const migrations = bindSqlMigrations(sqlTransport ?? refuseAllSqlTransport);

  const providers: readonly RegisteredPersistenceProvider[] = Object.freeze([
    Object.freeze({
      providerId: HOSTED_PREVIEW_PROVIDER_IDS.controlPlane,
      probe: controlPlane,
    } satisfies RegisteredPersistenceProvider),
    Object.freeze({
      providerId: HOSTED_PREVIEW_PROVIDER_IDS.objectStore,
      probe: objectStore,
    } satisfies RegisteredPersistenceProvider),
    Object.freeze({
      providerId: HOSTED_PREVIEW_PROVIDER_IDS.coordination,
      probe: coordination,
    } satisfies RegisteredPersistenceProvider),
  ]);

  return {
    controlPlane,
    objectStore,
    coordination,
    migrationRunner,
    migrations,
    providers,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap composition (deterministic migrations -> optional hosted seed)
// ---------------------------------------------------------------------------

/** The hosted-preview bootstrap marker record (deterministic seed content). */
const HOSTED_PREVIEW_SEED_RECORD_ID = 'preview-bootstrap-marker';
const HOSTED_PREVIEW_SEED_TENANT_ID = 'preview';
const HOSTED_PREVIEW_SEED_KIND = 'preview-bootstrap';
const HOSTED_PREVIEW_SEED_DATA = Object.freeze({
  note: 'Arena hosted preview bootstrap marker (B015)',
  surface: 'hosted-preview',
} as const);

/**
 * The hosted seed step (the concrete predicate the persistence fabric
 * documents for B015): one deterministic control-plane marker record.
 * Idempotent by construction — re-runs skip via `isSeeded`, and an
 * identical replay of `insert` is a no-op (`created: false`).
 */
export function createHostedPreviewSeedStep(): SeedStep {
  return {
    async isSeeded(controlPlane: ControlPlaneRepository): Promise<boolean> {
      return (await controlPlane.get(HOSTED_PREVIEW_SEED_RECORD_ID)) !== null;
    },
    async apply(controlPlane: ControlPlaneRepository): Promise<void> {
      await controlPlane.insert({
        recordId: HOSTED_PREVIEW_SEED_RECORD_ID,
        tenantId: HOSTED_PREVIEW_SEED_TENANT_ID,
        kind: HOSTED_PREVIEW_SEED_KIND,
        version: 1,
        data: HOSTED_PREVIEW_SEED_DATA,
      });
    },
  };
}

export interface ComposeHostedBootstrapOptions extends ComposeHostedStackOptions {
  /** Seed step; defaults to the hosted-preview marker seed. */
  readonly seed?: SeedStep;
}

/** The composed bootstrap stack (BootstrapService + migrations + control plane). */
export interface HostedBootstrapStack {
  readonly bootstrap: BootstrapService;
  readonly migrations: readonly Migration[];
  readonly controlPlane: ControlPlaneRepository;
}

/**
 * Compose the deterministic hosted bootstrap: NeonMigrationRunner +
 * SQL_MIGRATION_SOURCES bound to the shared SQL transport, then the
 * optional hosted seed step (migrations ALWAYS run first — the seed never
 * lands on a failed schema; re-runs are no-ops).
 */
export function composeHostedBootstrap(
  options: ComposeHostedBootstrapOptions = {},
): HostedBootstrapStack {
  const stack = composeHostedPersistenceStack(options);
  return {
    bootstrap: new BootstrapService({
      clock: options.clock ?? new SystemClock(),
      migrationRunner: stack.migrationRunner,
      controlPlane: stack.controlPlane,
      seed: options.seed ?? createHostedPreviewSeedStep(),
    }),
    migrations: stack.migrations,
    controlPlane: stack.controlPlane,
  };
}

export { SQL_MIGRATION_SOURCES };
