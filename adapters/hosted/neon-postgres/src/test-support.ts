/**
 * Test support for the Neon PostgreSQL adapter (Work Order B002):
 * `FakeSqlTransport` — an in-memory implementation of the SqlTransport
 * seam that mirrors the semantics of every named statement this adapter
 * issues (PostgreSQL-ish: JSONB rows, int8-as-number tolerance, guarded
 * UPDATE/DELETE via RETURNING row counts).
 *
 * This is how the FULL persistence contract suite runs against the hosted
 * adapter in CI without live credentials (FT2.0 "Local parity" / "Tests
 * never require live provider credentials"). What remains untested
 * without credentials is the literal SQL text executing on a live
 * database — that path is covered by the live run of the same suite when
 * env vars exist.
 *
 * NOT exported from the adapter index (test-support stays private; the
 * A033 hygiene precedent).
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '@arena/persistence';
import type { SqlRow, SqlStatement, SqlTransport } from './sql-transport.js';

interface FakeControlRow {
  record_id: string;
  tenant_id: string;
  kind: string;
  version: number;
  revision: number;
  data: unknown;
  created_at: number;
  updated_at: number;
}

interface FakeLedgerRow {
  version: number;
  name: string;
  applied_at: number;
}

export interface FakeSqlTransportOptions {
  /**
   * When true, data statements require the table to exist first (created
   * by a migration / the ledger bootstrap) — used to prove bootstrap
   * ordering. Default false (contract fixtures run post-bootstrap).
   */
  readonly enforceTables?: boolean;
}

export class FakeSqlTransport implements SqlTransport {
  private readonly controlRecords = new Map<string, FakeControlRow>();
  private readonly ledger = new Map<number, FakeLedgerRow>();
  private readonly tables = new Set<string>();
  private readonly enforceTables: boolean;
  /** Statement names executed, in order (for ordering assertions). */
  readonly executedStatements: string[] = [];

  constructor(options: FakeSqlTransportOptions = {}) {
    this.enforceTables = options.enforceTables ?? false;
  }

  async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.executedStatements.push(statement.name);
    switch (statement.name) {
      case 'select_1':
        return [{ ok: 1 }];
      case 'ensure_migration_ledger':
        this.trackCreateTable(statement.sql);
        return [];
      case 'list_applied_migrations':
        this.requireTable('arena_migration_ledger');
        return [...this.ledger.values()]
          .sort((a, b) => a.version - b.version)
          .map((row) => ({ ...row }));
      case 'record_applied_migration': {
        this.requireTable('arena_migration_ledger');
        const version = this.param(statement, 0);
        const name = this.param(statement, 1);
        const appliedAt = this.param(statement, 2);
        if (
          !Number.isInteger(version) ||
          typeof name !== 'string' ||
          !Number.isFinite(Number(appliedAt))
        ) {
          throw new Error('record_applied_migration: bad params');
        }
        this.ledger.set(version as number, {
          version: version as number,
          name,
          applied_at: Number(appliedAt),
        });
        return [];
      }
      case 'insert_control_record': {
        this.requireTable('arena_control_record');
        const row = this.controlRowFromParams(statement);
        this.controlRecords.set(row.record_id, row);
        return [];
      }
      case 'select_control_record': {
        this.requireTable('arena_control_record');
        const recordId = this.param(statement, 0);
        const row = this.controlRecords.get(String(recordId));
        return row !== undefined ? [{ ...row }] : [];
      }
      case 'select_control_records': {
        this.requireTable('arena_control_record');
        const kind = this.param(statement, 0);
        const tenantId = this.param(statement, 1);
        const limit = this.param(statement, 2);
        const offset = this.param(statement, 3);
        return this.filterRows(kind, tenantId).slice(
          Number(offset ?? 0),
          limit === null || limit === undefined
            ? undefined
            : Number(offset ?? 0) + Number(limit),
        );
      }
      case 'select_all_control_records': {
        this.requireTable('arena_control_record');
        const kind = this.param(statement, 0);
        const tenantId = this.param(statement, 1);
        const offset = Number(this.param(statement, 2) ?? 0);
        return this.filterRows(kind, tenantId).slice(offset);
      }
      case 'count_control_records': {
        this.requireTable('arena_control_record');
        const kind = this.param(statement, 0);
        const tenantId = this.param(statement, 1);
        return [{ total: this.filterRows(kind, tenantId).length }];
      }
      case 'update_control_record': {
        this.requireTable('arena_control_record');
        const recordId = String(this.param(statement, 0));
        const nextRevision = Number(this.param(statement, 1));
        const data = this.param(statement, 2);
        const updatedAt = Number(this.param(statement, 3));
        const expectedRevision = Number(this.param(statement, 4));
        const row = this.controlRecords.get(recordId);
        if (row === undefined || row.revision !== expectedRevision) return [];
        const updated: FakeControlRow = { ...row, revision: nextRevision, data, updated_at: updatedAt };
        this.controlRecords.set(recordId, updated);
        return [{ ...updated }];
      }
      case 'delete_control_record': {
        this.requireTable('arena_control_record');
        const recordId = String(this.param(statement, 0));
        const deleted = this.controlRecords.delete(recordId);
        return deleted ? [{ record_id: recordId }] : [];
      }
      case 'apply_migration':
        this.trackCreateTable(statement.sql);
        return [];
      default:
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
          message: `FakeSqlTransport does not implement statement: ${statement.name}`,
        });
    }
  }

  /** Tables created by executed DDL (bootstrap-ordering assertions). */
  createdTables(): readonly string[] {
    return [...this.tables];
  }

  private filterRows(kind: unknown, tenantId: unknown): SqlRow[] {
    return [...this.controlRecords.values()]
      .filter(
        (row) =>
          (kind === null || kind === undefined || row.kind === kind) &&
          (tenantId === null || tenantId === undefined || row.tenant_id === tenantId),
      )
      .sort((a, b) => (a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0))
      .map((row): SqlRow => ({ ...row }));
  }

  private controlRowFromParams(statement: SqlStatement): FakeControlRow {
    const recordId = this.param(statement, 0);
    const tenantId = this.param(statement, 1);
    const kind = this.param(statement, 2);
    const version = this.param(statement, 3);
    const revision = this.param(statement, 4);
    const data = this.param(statement, 5);
    const createdAt = this.param(statement, 6);
    const updatedAt = this.param(statement, 7);
    if (
      typeof recordId !== 'string' ||
      typeof tenantId !== 'string' ||
      typeof kind !== 'string' ||
      !Number.isInteger(version) ||
      !Number.isInteger(revision)
    ) {
      throw new Error('insert_control_record: bad params');
    }
    return {
      record_id: recordId,
      tenant_id: tenantId,
      kind,
      version: version as number,
      revision: revision as number,
      data: typeof data === 'string' ? safeParse(data) : data,
      created_at: Number(createdAt),
      updated_at: Number(updatedAt),
    };
  }

  private param(statement: SqlStatement, index: number): unknown {
    return statement.params[index];
  }

  private trackCreateTable(sql: string): void {
    const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    let match = pattern.exec(sql);
    while (match !== null) {
      this.tables.add(match[1] as string);
      match = pattern.exec(sql);
    }
  }

  private requireTable(name: string): void {
    if (this.enforceTables && !this.tables.has(name)) {
      throw new Error(`relation "${name}" does not exist (bootstrap required)`);
    }
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
