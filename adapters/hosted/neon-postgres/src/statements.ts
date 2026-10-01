/**
 * Named parameterized statements for the Neon PostgreSQL adapter
 * (Work Order B002). Pure data: every statement is a
 * (name, sql, params) triple, so the SQL surface is reviewable and
 * unit-testable without a live database.
 */

import type { JsonSafeValue } from '@arena/persistence';
import type { SqlStatement } from './sql-transport.js';

const CONTROL_RECORD_COLUMNS =
  'record_id, tenant_id, kind, version, revision, data, created_at, updated_at';

/** Table DDL identical to migrations/0002 (the runner bootstraps the ledger with it). */
export const MIGRATION_LEDGER_DDL = `CREATE TABLE IF NOT EXISTS arena_migration_ledger (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at BIGINT NOT NULL
)`;

export function insertControlRecordStatement(record: {
  readonly recordId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly version: number;
  readonly revision: number;
  readonly data: JsonSafeValue;
  readonly createdAt: number;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'insert_control_record',
    sql: `INSERT INTO arena_control_record (${CONTROL_RECORD_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    params: [
      record.recordId,
      record.tenantId,
      record.kind,
      record.version,
      record.revision,
      JSON.stringify(record.data),
      record.createdAt,
      record.updatedAt,
    ],
  };
}

export function selectControlRecordStatement(recordId: string): SqlStatement {
  return {
    name: 'select_control_record',
    sql: `SELECT ${CONTROL_RECORD_COLUMNS} FROM arena_control_record WHERE record_id = $1`,
    params: [recordId],
  };
}

export function selectControlRecordsStatement(query: {
  readonly kind?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}): SqlStatement {
  return {
    name: 'select_control_records',
    sql: `SELECT ${CONTROL_RECORD_COLUMNS} FROM arena_control_record${filterClause()} ORDER BY record_id ASC LIMIT $3::int OFFSET $4::int`,
    params: [query.kind ?? null, query.tenantId ?? null, query.limit ?? null, query.offset ?? 0],
  };
}

export function selectAllControlRecordsStatement(query: {
  readonly kind?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly offset?: number | undefined;
}): SqlStatement {
  return {
    name: 'select_all_control_records',
    sql: `SELECT ${CONTROL_RECORD_COLUMNS} FROM arena_control_record${filterClause()} ORDER BY record_id ASC OFFSET $3::int`,
    params: [query.kind ?? null, query.tenantId ?? null, query.offset ?? 0],
  };
}

export function countControlRecordsStatement(query: {
  readonly kind?: string | undefined;
  readonly tenantId?: string | undefined;
}): SqlStatement {
  return {
    name: 'count_control_records',
    sql: `SELECT count(*)::int AS total FROM arena_control_record${filterClause()}`,
    params: [query.kind ?? null, query.tenantId ?? null],
  };
}

export function updateControlRecordStatement(input: {
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly nextRevision: number;
  readonly data: JsonSafeValue;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'update_control_record',
    sql: `UPDATE arena_control_record SET revision = $2, data = $3, updated_at = $4
WHERE record_id = $1 AND revision = $5
RETURNING ${CONTROL_RECORD_COLUMNS}`,
    params: [
      input.recordId,
      input.nextRevision,
      JSON.stringify(input.data),
      input.updatedAt,
      input.expectedRevision,
    ],
  };
}

export function deleteControlRecordStatement(recordId: string): SqlStatement {
  return {
    name: 'delete_control_record',
    sql: 'DELETE FROM arena_control_record WHERE record_id = $1 RETURNING record_id',
    params: [recordId],
  };
}

export function ensureMigrationLedgerStatement(): SqlStatement {
  return {
    name: 'ensure_migration_ledger',
    sql: MIGRATION_LEDGER_DDL,
    params: [],
  };
}

export function listAppliedMigrationsStatement(): SqlStatement {
  return {
    name: 'list_applied_migrations',
    sql: 'SELECT version, name, applied_at FROM arena_migration_ledger ORDER BY version ASC',
    params: [],
  };
}

export function recordAppliedMigrationStatement(input: {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: number;
}): SqlStatement {
  return {
    name: 'record_applied_migration',
    sql: 'INSERT INTO arena_migration_ledger (version, name, applied_at) VALUES ($1, $2, $3)',
    params: [input.version, input.name, input.appliedAt],
  };
}

export function selectOneStatement(): SqlStatement {
  return {
    name: 'select_1',
    sql: 'SELECT 1 AS ok',
    params: [],
  };
}

function filterClause(): string {
  return ' WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR tenant_id = $2)';
}
