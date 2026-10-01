/**
 * Versioned SQL migrations + MigrationRunner for the Neon PostgreSQL
 * adapter (Work Order B002; issue #64; FT2.0 "Database": migrations are
 * versioned and reproducible).
 *
 *   - `SQL_MIGRATION_SOURCES` is the inlined, ordered, versioned migration
 *     list. It mirrors migrations/*.sql ONE-TO-ONE (asserted by the
 *     migration test: file text === inlined text) so the repository files
 *     remain the reviewable source of truth while runtime stays bundler
 *     friendly (no fs reads in deployed code).
 *   - `bindSqlMigrations(transport)` turns the sources into `Migration`s
 *     whose apply() executes the statement on the transport.
 *   - `NeonMigrationRunner` bootstraps the applied-record ledger
 *     (CREATE TABLE IF NOT EXISTS), applies missing migrations in
 *     ascending version order and records each AFTER success — re-runs
 *     are no-ops (idempotent, reproducible bootstrap).
 */

import {
  normalizeMigrationList,
  PERSISTENCE_ERROR_CODES,
  PersistenceCapacityError,
  PersistenceError,
  SystemClock,
} from '@arena/persistence';
import type {
  AppliedMigration,
  Clock,
  Migration,
  MigrationRunResult,
  MigrationRunner,
} from '@arena/persistence';
import { missingNeonEnvVarNames, readNeonConfigFromEnv } from './env.js';
import { createNeonHttpSqlTransport, executeStatement } from './sql-transport.js';
import type { SqlTransport } from './sql-transport.js';
import {
  ensureMigrationLedgerStatement,
  listAppliedMigrationsStatement,
  MIGRATION_LEDGER_DDL,
  recordAppliedMigrationStatement,
} from './statements.js';

/** One versioned SQL migration source (inlined mirror of migrations/*.sql). */
export interface SqlMigrationSource {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const SQL_MIGRATION_SOURCES: readonly SqlMigrationSource[] = Object.freeze([
  {
    version: 1,
    name: 'create-control-plane-records',
    sql: `-- B002 migration 0001 (neon-postgres): authoritative control-plane record store.
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_control_record (
  record_id   TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  revision    INTEGER NOT NULL,
  data        JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS arena_control_record_tenant_kind_idx
  ON arena_control_record (tenant_id, kind);
`,
  },
  {
    version: 2,
    name: 'create-migration-ledger',
    sql: `-- B002 migration 0002 (neon-postgres): versioned-migration applied-record
-- ledger. The migration runner's bootstrap statement uses the same
-- idempotent DDL so a fresh store always has a ledger before migrations
-- record into it.
CREATE TABLE IF NOT EXISTS arena_migration_ledger (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at BIGINT NOT NULL
);
`,
  },
]);

/** Bind the SQL migration sources to a transport as executable Migration objects. */
export function bindSqlMigrations(transport: SqlTransport): readonly Migration[] {
  return SQL_MIGRATION_SOURCES.map((source) => ({
    version: source.version,
    name: source.name,
    apply: async () => {
      await executeStatement(transport, {
        name: 'apply_migration',
        sql: source.sql,
        params: [],
      });
    },
  }));
}

export interface NeonMigrationRunnerOptions {
  readonly transport?: SqlTransport;
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock;
}

export class NeonMigrationRunner implements MigrationRunner {
  private readonly transport: SqlTransport | null;
  private readonly clock: Clock;
  private readonly missingEnvNames: readonly string[];

  constructor(options: NeonMigrationRunnerOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    if (options.transport !== undefined) {
      this.transport = options.transport;
      this.missingEnvNames = [];
    } else {
      const config = readNeonConfigFromEnv(options.env ?? process.env);
      // No configuration -> DISABLED (fail closed; no client is constructed).
      this.transport =
        config !== null ? createNeonHttpSqlTransport(config.connectionString) : null;
      this.missingEnvNames = missingNeonEnvVarNames(options.env ?? process.env);
    }
  }

  async run(migrations: readonly Migration[]): Promise<MigrationRunResult> {
    const transport = this.gate();
    const sorted = normalizeMigrationList(migrations);
    const ranAt = this.clock.now();
    // Bootstrap the ledger FIRST (idempotent DDL identical to migration 0002).
    await executeStatement(transport, ensureMigrationLedgerStatement());
    const ledgerEntries = await this.readLedger(transport);
    const ledgerByVersion = new Map(ledgerEntries.map((entry) => [entry.version, entry]));
    const fromVersion =
      ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1]?.version ?? null : null;
    // The ledger head AFTER the run — matching the shared contract suite
    // (a no-op re-run keeps the head; it does not null it out).
    let toVersion: number | null = fromVersion;
    const applied: AppliedMigration[] = [];
    const skipped: AppliedMigration[] = [];
    for (const migration of sorted) {
      const existing = ledgerByVersion.get(migration.version);
      if (existing !== undefined) {
        skipped.push(existing);
        continue;
      }
      try {
        await migration.apply();
      } catch (cause) {
        if (cause instanceof PersistenceError) throw cause;
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
      await executeStatement(
        transport,
        recordAppliedMigrationStatement({
          version: entry.version,
          name: entry.name,
          appliedAt: entry.appliedAt,
        }),
      );
      applied.push(entry);
      toVersion = toVersion === null ? migration.version : Math.max(toVersion, migration.version);
    }
    return {
      ranAt,
      applied: Object.freeze(applied),
      skipped: Object.freeze(skipped),
      fromVersion,
      toVersion,
    };
  }

  async appliedMigrations(): Promise<readonly AppliedMigration[]> {
    const transport = this.gate();
    await executeStatement(transport, ensureMigrationLedgerStatement());
    return this.readLedger(transport);
  }

  /** True when the runner has configuration / a transport (not DISABLED). */
  get enabled(): boolean {
    return this.transport !== null;
  }

  private async readLedger(transport: SqlTransport): Promise<readonly AppliedMigration[]> {
    const rows = await executeStatement(transport, listAppliedMigrationsStatement());
    return rows.map((row) => {
      const version = row['version'];
      const name = row['name'];
      const appliedAt = row['applied_at'];
      if (
        !Number.isInteger(version) ||
        (version as number) < 1 ||
        typeof name !== 'string' ||
        !Number.isFinite(Number(appliedAt))
      ) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_MIGRATION, {
          message: 'migration ledger row does not map onto the applied-migration shape',
        });
      }
      return Object.freeze({
        version: version as number,
        name,
        appliedAt: Number(appliedAt),
      } satisfies AppliedMigration);
    });
  }

  private gate(): SqlTransport {
    if (this.transport === null) {
      throw new PersistenceCapacityError(
        PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
        'DISABLED',
        [{ code: 'configuration-missing' }],
        {
          message:
            'the hosted migration runner is disabled: no connection configuration was provided (fail closed)',
          details: { missingEnvVarNames: this.missingEnvNames },
        },
      );
    }
    return this.transport;
  }
}

export { MIGRATION_LEDGER_DDL };
