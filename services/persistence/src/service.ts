/**
 * @arena/persistence-service — health/capacity/bootstrap fabric (Work
 * Order B002; issue #64; FT2.0 "Capacity state" + "Cost safety").
 *
 * Composes adapters behind the @arena/persistence ports (provider-neutral
 * by construction — adapters are injected at composition time; the ONLY
 * workspace import is @arena/persistence).
 *
 * Surfaces:
 *   - ProviderHealthService — aggregated ProviderHealthSnapshot per
 *                             provider + overall (worst-of severity),
 *                             versioned as a HealthReport record;
 *   - CapacityService       — quota visibility (remaining/limit/window
 *                             per provider dimension) for UI surfacing
 *                             later, versioned as a CapacityReport
 *                             record, plus the FAIL-CLOSED capacity
 *                             guard: `guard()` throws the typed
 *                             exhaustion/disabled error when ANY
 *                             registered provider is EXHAUSTED or
 *                             DISABLED — there is no alternate path to
 *                             take instead (FT2.0: a silent billable
 *                             switch is not representable);
 *   - BootstrapService      — deterministic bootstrap order
 *                             (migrations -> seed-check), reproducible
 *                             and safe to re-run, versioned as a
 *                             BootstrapReport record.
 */

import {
  aggregateProviderHealth,
  CAPACITY_STATUS_SEVERITY,
  PERSISTENCE_ERROR_CODES,
  PersistenceCapacityError,
  PersistenceError,
  toProviderHealth,
} from '@arena/persistence';
import type {
  CapacityDimensionReading,
  CapacityReason,
  CapacitySnapshot,
  ControlPlaneRepository,
  Migration,
  MigrationRunner,
  ProviderHealth,
} from '@arena/persistence';
import type { Clock, RegisteredPersistenceProvider, SeedStep } from './ports.js';
import type { BootstrapReport, CapacityProviderEntry, CapacityReport, HealthReport } from './shared.js';
import { makeHealthReport, PERSISTENCE_SERVICE_RECORD_VERSION } from './shared.js';

// ---------------------------------------------------------------------------
// Registry validation (composition time, fail closed)
// ---------------------------------------------------------------------------

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Validate the provider registry once at composition time (fail closed). */
function validateProviders(
  providers: readonly RegisteredPersistenceProvider[],
): readonly RegisteredPersistenceProvider[] {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (
      typeof provider.providerId !== 'string' ||
      !PROVIDER_ID_PATTERN.test(provider.providerId)
    ) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `invalid provider id: ${JSON.stringify(provider.providerId)}`,
      });
    }
    if (seen.has(provider.providerId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `duplicate provider id: ${provider.providerId}`,
      });
    }
    seen.add(provider.providerId);
    if (typeof provider.probe?.capacityProbe !== 'function') {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `provider ${provider.providerId} must carry a capacity probe`,
        details: { providerId: provider.providerId },
      });
    }
    if (provider.meter !== undefined && typeof provider.meter.probe !== 'function') {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `provider ${provider.providerId} carries a malformed quota meter`,
        details: { providerId: provider.providerId },
      });
    }
  }
  return providers;
}

/**
 * Probe every provider (deterministic registration order). A probe that
 * THROWS violates the CapacityProbe contract — the service still
 * produces a snapshot: DEGRADED with the structured 'probe-failed'
 * reason (fail closed, never a crash, never transport detail).
 */
async function probeAll(
  providers: readonly RegisteredPersistenceProvider[],
  clock: Clock,
): Promise<readonly ProviderHealth[]> {
  const entries = await Promise.all(
    providers.map(async (provider): Promise<ProviderHealth> => {
      let snapshot: CapacitySnapshot;
      try {
        snapshot = await provider.probe.capacityProbe();
      } catch {
        snapshot = {
          status: 'DEGRADED',
          checkedAt: clock.now(),
          dimensions: [],
          reasons: [{ code: 'probe-failed' }],
        };
      }
      return toProviderHealth(provider.providerId, snapshot);
    }),
  );
  return entries;
}

// ---------------------------------------------------------------------------
// ProviderHealthService
// ---------------------------------------------------------------------------

export interface ProviderHealthServiceDeps {
  readonly clock: Clock;
  readonly providers: readonly RegisteredPersistenceProvider[];
}

/** Aggregated provider health (worst-of severity wins; FT2.0 visibility). */
export class ProviderHealthService {
  private readonly clock: Clock;
  private readonly providers: readonly RegisteredPersistenceProvider[];

  constructor(deps: ProviderHealthServiceDeps) {
    this.clock = deps.clock;
    this.providers = validateProviders(deps.providers);
  }

  /** The aggregated versioned health report (per provider + overall). */
  async health(): Promise<HealthReport> {
    const checkedAt = this.clock.now();
    const entries = await probeAll(this.providers, this.clock);
    return makeHealthReport(aggregateProviderHealth(entries, checkedAt));
  }

  /** One provider's health entry (null when the id is not registered). */
  async providerHealth(providerId: string): Promise<ProviderHealth | null> {
    const checkedAt = this.clock.now();
    const provider = this.providers.find((entry) => entry.providerId === providerId);
    if (provider === undefined) return null;
    let snapshot: CapacitySnapshot;
    try {
      snapshot = await provider.probe.capacityProbe();
    } catch {
      snapshot = {
        status: 'DEGRADED',
        checkedAt,
        dimensions: [],
        reasons: [{ code: 'probe-failed' }],
      };
    }
    return toProviderHealth(provider.providerId, snapshot);
  }

  /** The registered provider ids (neutral logical roles). */
  get providerIds(): readonly string[] {
    return this.providers.map((provider) => provider.providerId);
  }
}

// ---------------------------------------------------------------------------
// CapacityService
// ---------------------------------------------------------------------------

/**
 * The structured reason used when a blocking provider reports none: the
 * closed code for the status plus (when exactly one dimension is
 * reported) that dimension's name. exactOptionalPropertyTypes-safe.
 */
function blockingReasonFor(
  status: 'EXHAUSTED' | 'DISABLED',
  dimensions: readonly CapacityDimensionReading[],
): CapacityReason {
  const code: CapacityReason['code'] =
    status === 'EXHAUSTED' ? 'quota-exhausted' : 'configuration-missing';
  const single = dimensions.length === 1 ? dimensions[0] : undefined;
  return single !== undefined ? { code, dimension: single.dimension } : { code };
}

export interface CapacityServiceDeps {
  readonly clock: Clock;
  readonly providers: readonly RegisteredPersistenceProvider[];
}

/**
 * Quota visibility + the fail-closed capacity guard.
 *
 * `guard()` implements the FT2.0 exhaustion policy at composition level:
 * when ANY registered provider probes EXHAUSTED or DISABLED it throws
 * the typed PersistenceCapacityError. There is no parameter, return
 * path or alternate destination that could silently switch to a
 * billable provider — callers get the typed error or a usable report.
 */
export class CapacityService {
  private readonly clock: Clock;
  private readonly providers: readonly RegisteredPersistenceProvider[];

  constructor(deps: CapacityServiceDeps) {
    this.clock = deps.clock;
    this.providers = validateProviders(deps.providers);
  }

  /** The versioned quota-visibility report (dimensions per provider). */
  async capacity(): Promise<CapacityReport> {
    const checkedAt = this.clock.now();
    const entries = await probeAll(this.providers, this.clock);
    let overall: CapacityReport['overall'] = 'AVAILABLE';
    for (const entry of entries) {
      if (CAPACITY_STATUS_SEVERITY[entry.status] > CAPACITY_STATUS_SEVERITY[overall]) {
        overall = entry.status;
      }
    }
    const providers: CapacityProviderEntry[] = entries.map((entry) => ({
      providerId: entry.providerId,
      status: entry.status,
      checkedAt: entry.checkedAt,
      dimensions: entry.dimensions,
      reasons: entry.reasons,
    }));
    return Object.freeze({
      recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
      overall,
      checkedAt,
      providers: Object.freeze(providers),
    } satisfies CapacityReport);
  }

  /**
   * The fail-closed capacity gate: returns the capacity report when every
   * registered provider is usable (AVAILABLE/DEGRADED); throws the typed
   * PersistenceCapacityError for the FIRST blocking provider
   * (EXHAUSTED/DISABLED) in deterministic registration order. No
   * alternate route exists (FT2.0).
   */
  async guard(): Promise<CapacityReport> {
    const report = await this.capacity();
    for (const provider of report.providers) {
      if (provider.status === 'EXHAUSTED' || provider.status === 'DISABLED') {
        const status = provider.status;
        const reasons: readonly CapacityReason[] =
          provider.reasons.length > 0
            ? provider.reasons
            : [blockingReasonFor(status, provider.dimensions)];
        throw new PersistenceCapacityError(
          status === 'EXHAUSTED'
            ? PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED
            : PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
          status,
          reasons,
          {
            message:
              status === 'EXHAUSTED'
                ? `provider ${provider.providerId} is exhausted; failing closed (no alternate path is representable)`
                : `provider ${provider.providerId} is disabled; failing closed`,
            details: {
              providerId: provider.providerId,
              status,
              policy: 'fail-closed',
              reasons,
            },
          },
        );
      }
    }
    return report;
  }

  /** The registered provider ids (neutral logical roles). */
  get providerIds(): readonly string[] {
    return this.providers.map((provider) => provider.providerId);
  }
}

// ---------------------------------------------------------------------------
// BootstrapService
// ---------------------------------------------------------------------------

export interface BootstrapServiceDeps {
  readonly clock: Clock;
  readonly migrationRunner: MigrationRunner;
  /** Required when a seed step is configured (the seed lives in the control plane). */
  readonly controlPlane?: ControlPlaneRepository;
  /** Optional seed step: migrations ALWAYS run first, then seed-check. */
  readonly seed?: SeedStep;
}

/**
 * Deterministic bootstrap: migrations -> seed-check. Reproducible and
 * safe to re-run: re-running skips applied migrations and skips an
 * already-present seed (idempotent by contract).
 */
export class BootstrapService {
  private readonly clock: Clock;
  private readonly migrationRunner: MigrationRunner;
  private readonly controlPlane: ControlPlaneRepository | null;
  private readonly seed: SeedStep | null;

  constructor(deps: BootstrapServiceDeps) {
    this.clock = deps.clock;
    this.migrationRunner = deps.migrationRunner;
    if (deps.seed !== undefined && deps.controlPlane === undefined) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
        message: 'a configured seed step requires the control-plane repository (fail closed)',
      });
    }
    this.controlPlane = deps.controlPlane ?? null;
    this.seed = deps.seed ?? null;
  }

  /**
   * Run the deterministic bootstrap order: migrations first (typed
   * failures propagate and ABORT the bootstrap — the seed never runs on
   * a failed schema), then the seed check (apply only when absent).
   */
  async bootstrap(migrations: readonly Migration[]): Promise<BootstrapReport> {
    const ranAt = this.clock.now();
    // Step 1: migrations (fail-closed: a typed failure aborts here).
    const run = await this.migrationRunner.run(migrations);
    // Step 2: seed check (only after a successful schema step).
    let outcome: 'seeded' | 'already-seeded' | 'not-configured';
    if (this.seed !== null && this.controlPlane !== null) {
      const seeded = await this.seed.isSeeded(this.controlPlane);
      if (!seeded) {
        await this.seed.apply(this.controlPlane);
        outcome = 'seeded';
      } else {
        outcome = 'already-seeded';
      }
    } else {
      outcome = 'not-configured';
    }
    return Object.freeze({
      recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
      ranAt,
      steps: Object.freeze([
        Object.freeze({
          step: 'migrations',
          status: run.applied.length > 0 ? 'applied' : 'skipped',
        }),
        Object.freeze({ step: 'seed-check', status: outcome }),
      ]),
      migrations: Object.freeze({
        fromVersion: run.fromVersion,
        toVersion: run.toVersion,
        applied: Object.freeze(
          run.applied.map((entry) => Object.freeze({ version: entry.version, name: entry.name })),
        ),
        skipped: Object.freeze(
          run.skipped.map((entry) => Object.freeze({ version: entry.version, name: entry.name })),
        ),
      }),
      seedCheck: Object.freeze({ outcome }),
    } satisfies BootstrapReport);
  }
}
