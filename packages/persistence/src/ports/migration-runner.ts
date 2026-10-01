/**
 * MigrationRunner port (Work Order B002; issue #64; FT2.0 "Database":
 * migrations are versioned and reproducible).
 *
 * Versioned, ordered, reproducible schema migrations with an
 * applied-record ledger:
 *
 *   - migrations carry a positive unique integer `version`, a stable
 *     `name` (slug) and an `apply` thunk (self-contained: hosted adapters
 *     bind their statements at construction time);
 *   - `run` applies every migration NOT already in the ledger, in
 *     ascending version order, recording each into the ledger AFTER a
 *     successful apply — re-running is a no-op (idempotent bootstrap);
 *   - `appliedMigrations` reads the ledger (ascending);
 *   - duplicate versions, non-positive versions and malformed names are
 *     rejected with typed errors BEFORE anything runs.
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';

export interface Migration {
  /** Positive unique integer; ordering key. */
  readonly version: number;
  /** Stable slug (lowercase letters/digits/hyphens). */
  readonly name: string;
  readonly description?: string;
  /** Execute this migration; implementations record it after success. */
  apply(): Promise<void>;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  /** When the migration was applied (epoch ms). */
  readonly appliedAt: number;
}

export interface MigrationRunResult {
  readonly ranAt: number;
  /** Migrations applied by THIS run (ascending), empty on re-run. */
  readonly applied: readonly AppliedMigration[];
  /** Ledger entries that pre-existed (ascending). */
  readonly skipped: readonly AppliedMigration[];
  /** Highest applied version BEFORE this run, null when the ledger was empty. */
  readonly fromVersion: number | null;
  /** Highest applied version AFTER this run (the ledger head); null only when the ledger is empty. */
  readonly toVersion: number | null;
}

/** The provider-neutral migration port (fakes + hosted adapters). */
export interface MigrationRunner {
  /** Idempotently apply the given migrations in ascending version order. */
  run(migrations: readonly Migration[]): Promise<MigrationRunResult>;
  /** The applied-record ledger, ascending by version. */
  appliedMigrations(): Promise<readonly AppliedMigration[]>;
}

export const MIGRATION_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
const MIGRATION_NAME_PATTERN = new RegExp(MIGRATION_NAME_PATTERN_SOURCE);

export function isMigrationName(value: unknown): value is string {
  return typeof value === 'string' && MIGRATION_NAME_PATTERN.test(value);
}

/**
 * Validate a migration list (fail closed): positive integer versions,
 * unique, well-formed names, callable apply. Returns the list sorted
 * ascending by version.
 */
export function normalizeMigrationList(migrations: readonly Migration[]): readonly Migration[] {
  const seen = new Set<number>();
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of sorted) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
        message: `migration version must be a positive integer: ${String(migration.version)}`,
      });
    }
    if (seen.has(migration.version)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
        message: `duplicate migration version: ${String(migration.version)}`,
      });
    }
    seen.add(migration.version);
    if (!isMigrationName(migration.name)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
        message: `migration name must match ${MIGRATION_NAME_PATTERN_SOURCE}: ${JSON.stringify(migration.name)}`,
      });
    }
    if (typeof migration.apply !== 'function') {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
        message: `migration ${migration.name} must carry an apply function`,
      });
    }
  }
  return sorted;
}
