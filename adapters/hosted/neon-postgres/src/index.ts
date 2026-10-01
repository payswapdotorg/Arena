/**
 * @arena/hosted-neon-postgres — the Neon PostgreSQL adapter for
 * @arena/persistence (Work Order B002; issue #64; FT2.0 "Database").
 *
 * Public surface:
 *   env         — env-var contract (DATABASE_URL / NEON_CONNECTION_STRING)
 *   sql-transport — the SqlTransport seam + the default Neon HTTP driver
 *                 transport (the ONLY infrastructure touchpoint)
 *   statements  — the closed, named, parameterized SQL statement set
 *   adapter     — NeonControlPlaneRepository (ControlPlaneRepository +
 *                 CapacityProbe; DISABLED fail-closed without config)
 *   migrations  — SQL_MIGRATION_SOURCES (inlined mirror of migrations/*.sql),
 *                 bindSqlMigrations, NeonMigrationRunner (versioned,
 *                 ordered, applied-record ledger, idempotent)
 *
 * Configuration is read ONLY from server-side env vars; values are never
 * committed and never logged. Without configuration the adapter is
 * DISABLED and every operation fails closed with the typed capacity
 * error. The SqlTransport seam lets the FULL persistence contract suite
 * run against this adapter without live credentials.
 */

export * from './env.js';
export * from './sql-transport.js';
export * from './statements.js';
export * from './adapter.js';
export * from './migrations.js';

import { SQL_MIGRATION_SOURCES } from './migrations.js';

/** The highest shipped migration version (the schema head). */
export const NEON_MIGRATION_HEAD_VERSION: number =
  SQL_MIGRATION_SOURCES.length > 0
    ? SQL_MIGRATION_SOURCES[SQL_MIGRATION_SOURCES.length - 1]?.version ?? 0
    : 0;

/** The shipped migration source count. */
export const NEON_MIGRATION_COUNT = SQL_MIGRATION_SOURCES.length;
