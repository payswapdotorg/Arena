/**
 * Versioned contract surface for @arena/persistence-service (Work Order
 * B002; issue #64; spec/service-boundaries.md: services communicate
 * through versioned contracts).
 *
 * Every record the service emits carries `recordVersion ===
 * PERSISTENCE_SERVICE_RECORD_VERSION` and is validated by a strictly
 * fail-closed parser (the billing/observability service precedent):
 * malformed input, unknown statuses, mismatched aggregates and wrong
 * versions are REJECTED, never coerced.
 */

import {
  aggregateProviderHealth,
  CAPACITY_STATUS_SEVERITY,
  isCapacityReason,
  isProviderCapacityStatus,
  isProviderId,
  PERSISTENCE_ERROR_CODES,
  PersistenceError,
  toCapacityDimensionReading,
} from '@arena/persistence';
import type {
  CapacityDimensionReading,
  CapacityReason,
  ProviderCapacityStatus,
  ProviderHealth,
  ProviderHealthSnapshot,
} from '@arena/persistence';

/** Version of this service's record surface (bump = breaking change). */
export const PERSISTENCE_SERVICE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Health report (ProviderHealthService)
// ---------------------------------------------------------------------------

/** The versioned aggregate health record (FT2.0 capacity states). */
export interface HealthReport {
  readonly recordVersion: typeof PERSISTENCE_SERVICE_RECORD_VERSION;
  /** Worst-of severity across all providers. */
  readonly overall: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly providers: readonly ProviderHealth[];
}

/** Parse a HealthReport (fail closed on any malformed field). */
export function toHealthReport(value: unknown): HealthReport {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
      message: `invalid health report: ${reason}`,
    });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== PERSISTENCE_SERVICE_RECORD_VERSION) {
    return fail(`recordVersion must be ${String(PERSISTENCE_SERVICE_RECORD_VERSION)}`);
  }
  const providers = parseProviderEntries(record['providers']);
  if (!isProviderCapacityStatus(record['overall'])) {
    return fail('overall must be one of AVAILABLE, DEGRADED, EXHAUSTED, DISABLED');
  }
  const overall = record['overall'];
  if (typeof record['checkedAt'] !== 'number' || !Number.isFinite(record['checkedAt']) || record['checkedAt'] < 0) {
    return fail('checkedAt must be a non-negative finite number');
  }
  const checkedAt = record['checkedAt'];
  // The stated overall MUST be the worst-of aggregate of the entries.
  const aggregate = aggregateProviderHealth(providers, checkedAt);
  if (aggregate.overall !== overall) {
    return fail(`overall ${overall} does not match the worst-of aggregate ${aggregate.overall}`);
  }
  return Object.freeze({
    recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
    overall,
    checkedAt,
    providers: aggregate.providers,
  } satisfies HealthReport);
}

/** Wrap a validated domain snapshot into the versioned report record. */
export function makeHealthReport(snapshot: ProviderHealthSnapshot): HealthReport {
  return toHealthReport({
    recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
    overall: snapshot.overall,
    checkedAt: snapshot.checkedAt,
    providers: snapshot.providers,
  });
}

// ---------------------------------------------------------------------------
// Capacity report (CapacityService — quota visibility for UI surfacing)
// ---------------------------------------------------------------------------

/** One provider's quota visibility entry. */
export interface CapacityProviderEntry {
  readonly providerId: string;
  readonly status: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly dimensions: readonly CapacityDimensionReading[];
  readonly reasons: readonly CapacityReason[];
}

/** The versioned quota-visibility record. */
export interface CapacityReport {
  readonly recordVersion: typeof PERSISTENCE_SERVICE_RECORD_VERSION;
  readonly overall: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly providers: readonly CapacityProviderEntry[];
}

/** Parse a CapacityReport (fail closed on any malformed field). */
export function toCapacityReport(value: unknown): CapacityReport {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
      message: `invalid capacity report: ${reason}`,
    });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== PERSISTENCE_SERVICE_RECORD_VERSION) {
    return fail(`recordVersion must be ${String(PERSISTENCE_SERVICE_RECORD_VERSION)}`);
  }
  const providers = parseProviderEntries(record['providers']);
  if (!isProviderCapacityStatus(record['overall'])) {
    return fail('overall must be one of AVAILABLE, DEGRADED, EXHAUSTED, DISABLED');
  }
  const overall = record['overall'];
  if (typeof record['checkedAt'] !== 'number' || !Number.isFinite(record['checkedAt']) || record['checkedAt'] < 0) {
    return fail('checkedAt must be a non-negative finite number');
  }
  const checkedAt = record['checkedAt'];
  let worst: ProviderCapacityStatus = 'AVAILABLE';
  for (const entry of providers) {
    if (CAPACITY_STATUS_SEVERITY[entry.status] > CAPACITY_STATUS_SEVERITY[worst]) {
      worst = entry.status;
    }
  }
  if (worst !== overall) {
    return fail(`overall ${overall} does not match the worst-of aggregate ${worst}`);
  }
  return Object.freeze({
    recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
    overall,
    checkedAt,
    providers,
  } satisfies CapacityReport);
}

// ---------------------------------------------------------------------------
// Bootstrap report (BootstrapService — migrations → seed-check)
// ---------------------------------------------------------------------------

/** The deterministic bootstrap step order (migrations FIRST, then seed). */
export const BOOTSTRAP_STEP_NAMES = Object.freeze(['migrations', 'seed-check'] as const);

export type BootstrapStepName = (typeof BOOTSTRAP_STEP_NAMES)[number];

export const BOOTSTRAP_STEP_STATUSES = Object.freeze([
  'applied',
  'skipped',
  'seeded',
  'already-seeded',
  'not-configured',
] as const);

export type BootstrapStepStatus = (typeof BOOTSTRAP_STEP_STATUSES)[number];

/** One step of the deterministic bootstrap order. */
export interface BootstrapStepReport {
  readonly step: BootstrapStepName;
  readonly status: BootstrapStepStatus;
}

/** The migration summary embedded in a bootstrap report. */
export interface BootstrapMigrationSummary {
  readonly fromVersion: number | null;
  readonly toVersion: number | null;
  readonly applied: readonly { readonly version: number; readonly name: string }[];
  readonly skipped: readonly { readonly version: number; readonly name: string }[];
}

/** The seed-check outcome embedded in a bootstrap report. */
export interface BootstrapSeedCheckReport {
  readonly outcome: 'seeded' | 'already-seeded' | 'not-configured';
}

/** The versioned bootstrap record (reproducible; safe re-run). */
export interface BootstrapReport {
  readonly recordVersion: typeof PERSISTENCE_SERVICE_RECORD_VERSION;
  readonly ranAt: number;
  /** Steps in the deterministic order: migrations, then seed-check. */
  readonly steps: readonly BootstrapStepReport[];
  readonly migrations: BootstrapMigrationSummary;
  readonly seedCheck: BootstrapSeedCheckReport;
}

/** Parse a BootstrapReport (fail closed on any malformed field). */
export function toBootstrapReport(value: unknown): BootstrapReport {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
      message: `invalid bootstrap report: ${reason}`,
    });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== PERSISTENCE_SERVICE_RECORD_VERSION) {
    return fail(`recordVersion must be ${String(PERSISTENCE_SERVICE_RECORD_VERSION)}`);
  }
  if (typeof record['ranAt'] !== 'number' || !Number.isFinite(record['ranAt']) || record['ranAt'] < 0) {
    return fail('ranAt must be a non-negative finite number');
  }
  const ranAt = record['ranAt'];

  const stepsValue = record['steps'];
  if (!Array.isArray(stepsValue) || stepsValue.length !== BOOTSTRAP_STEP_NAMES.length) {
    return fail(`steps must list exactly ${String(BOOTSTRAP_STEP_NAMES.length)} entries`);
  }
  const steps: BootstrapStepReport[] = [];
  for (const [index, expectedStep] of BOOTSTRAP_STEP_NAMES.entries()) {
    const step = stepsValue[index];
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      return fail('each step must be a plain object');
    }
    const stepRecord = step as Record<string, unknown>;
    if (stepRecord['step'] !== expectedStep) {
      return fail(
        `steps must follow the deterministic order ${BOOTSTRAP_STEP_NAMES.join(' -> ')}`,
      );
    }
    if (!(BOOTSTRAP_STEP_STATUSES as readonly string[]).includes(String(stepRecord['status']))) {
      return fail(`unknown bootstrap step status: ${String(stepRecord['status'])}`);
    }
    steps.push(
      Object.freeze({
        step: expectedStep,
        status: stepRecord['status'] as BootstrapStepStatus,
      }),
    );
  }

  const migrations = parseMigrationSummary(record['migrations'], fail);
  const seedCheckRaw = record['seedCheck'];
  if (
    typeof seedCheckRaw !== 'object' ||
    seedCheckRaw === null ||
    Array.isArray(seedCheckRaw) ||
    !['seeded', 'already-seeded', 'not-configured'].includes(
      String((seedCheckRaw as Record<string, unknown>)['outcome']),
    )
  ) {
    return fail('seedCheck.outcome must be seeded | already-seeded | not-configured');
  }
  const outcome = (seedCheckRaw as Record<string, unknown>)['outcome'] as
    | 'seeded'
    | 'already-seeded'
    | 'not-configured';

  return Object.freeze({
    recordVersion: PERSISTENCE_SERVICE_RECORD_VERSION,
    ranAt,
    steps: Object.freeze(steps),
    migrations,
    seedCheck: Object.freeze({ outcome }),
  } satisfies BootstrapReport);
}

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

function parseProviderEntries(value: unknown): ProviderHealth[] {
  if (!Array.isArray(value)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
      message: 'providers must be an array',
    });
  }
  const entries: ProviderHealth[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
        message: 'each provider entry must be a plain object',
      });
    }
    const record = entry as Record<string, unknown>;
    if (!isProviderId(record['providerId'])) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `invalid provider id: ${JSON.stringify(record['providerId'])}`,
      });
    }
    if (seen.has(record['providerId'])) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `duplicate provider id: ${record['providerId']}`,
      });
    }
    seen.add(record['providerId']);
    if (!isProviderCapacityStatus(record['status'])) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
        message: 'provider status must be one of AVAILABLE, DEGRADED, EXHAUSTED, DISABLED',
      });
    }
    if (
      typeof record['checkedAt'] !== 'number' ||
      !Number.isFinite(record['checkedAt']) ||
      record['checkedAt'] < 0
    ) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
        message: 'provider checkedAt must be a non-negative finite number',
      });
    }
    if (!Array.isArray(record['dimensions'])) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
        message: 'provider dimensions must be an array',
      });
    }
    const dimensions = record['dimensions'].map((dimension) =>
      toCapacityDimensionReading(dimension),
    );
    if (!Array.isArray(record['reasons'])) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
        message: 'provider reasons must be an array',
      });
    }
    const reasons: CapacityReason[] = [];
    for (const reason of record['reasons']) {
      if (!isCapacityReason(reason)) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
          message: 'each reason must be a structured capacity reason',
        });
      }
      reasons.push({ ...reason });
    }
    entries.push({
      providerId: record['providerId'],
      status: record['status'],
      checkedAt: record['checkedAt'],
      dimensions: Object.freeze(dimensions),
      reasons: Object.freeze(reasons),
    });
  }
  return entries;
}

function parseMigrationSummary(
  value: unknown,
  fail: (reason: string) => never,
): BootstrapMigrationSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('migrations must be a plain object');
  }
  const record = value as Record<string, unknown>;
  const versionOrNull = (field: string): number | null => {
    const raw = record[field];
    if (raw === null) return null;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
      return fail(`migrations.${field} must be a positive integer or null`);
    }
    return raw;
  };
  const list = (field: string): { version: number; name: string }[] => {
    const raw = record[field];
    if (!Array.isArray(raw)) {
      return fail(`migrations.${field} must be an array`);
    }
    return raw.map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return fail(`migrations.${field} entries must be plain objects`);
      }
      const entryRecord = entry as Record<string, unknown>;
      if (
        !Number.isInteger(entryRecord['version']) ||
        (entryRecord['version'] as number) < 1 ||
        typeof entryRecord['name'] !== 'string'
      ) {
        return fail(`migrations.${field} entries must carry version + name`);
      }
      return Object.freeze({
        version: entryRecord['version'] as number,
        name: entryRecord['name'],
      });
    });
  };
  return Object.freeze({
    fromVersion: versionOrNull('fromVersion'),
    toVersion: versionOrNull('toVersion'),
    applied: Object.freeze(list('applied')),
    skipped: Object.freeze(list('skipped')),
  } satisfies BootstrapMigrationSummary);
}
