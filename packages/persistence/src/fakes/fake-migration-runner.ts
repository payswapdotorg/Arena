/**
 * FakeMigrationRunner (Work Order B002) — the local in-memory
 * implementation of the migration port with FULL contract parity with the
 * hosted adapter: ordered, idempotent apply + applied-record ledger
 * (FT2.0 "Local parity"; migrations are versioned and reproducible).
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';
import { normalizeMigrationList } from '../ports/migration-runner.js';
import type {
  AppliedMigration,
  Migration,
  MigrationRunResult,
  MigrationRunner,
} from '../ports/migration-runner.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from './clock.js';

export interface FakeMigrationRunnerOptions {
  readonly clock?: Clock;
}

export class FakeMigrationRunner implements MigrationRunner {
  private readonly clock: Clock;
  private readonly ledger = new Map<number, AppliedMigration>();

  constructor(options: FakeMigrationRunnerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  async run(migrations: readonly Migration[]): Promise<MigrationRunResult> {
    const sorted = normalizeMigrationList(migrations);
    const ranAt = this.clock.now();
    const fromVersion = this.maxAppliedVersion();
    const applied: AppliedMigration[] = [];
    const skipped: AppliedMigration[] = [];
    for (const migration of sorted) {
      const existing = this.ledger.get(migration.version);
      if (existing !== undefined) {
        skipped.push(existing);
        continue;
      }
      try {
        await migration.apply();
      } catch (cause) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.MIGRATION_FAILED, {
          message: `migration ${migration.name} (v${String(migration.version)}) failed`,
          details: { version: migration.version, name: migration.name },
          cause,
        });
      }
      const entry: AppliedMigration = Object.freeze({
        version: migration.version,
        name: migration.name,
        appliedAt: ranAt,
      });
      this.ledger.set(migration.version, entry);
      applied.push(entry);
    }
    return {
      ranAt,
      applied: Object.freeze(applied),
      skipped: Object.freeze(skipped),
      fromVersion,
      toVersion: this.maxAppliedVersion(),
    };
  }

  async appliedMigrations(): Promise<readonly AppliedMigration[]> {
    return Object.freeze(
      [...this.ledger.values()].sort((a, b) => a.version - b.version),
    );
  }

  private maxAppliedVersion(): number | null {
    let max: number | null = null;
    for (const version of this.ledger.keys()) {
      if (max === null || version > max) max = version;
    }
    return max;
  }
}
