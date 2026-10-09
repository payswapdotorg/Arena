/**
 * The shared persistence contract suite runs against the Neon PostgreSQL
 * adapter through its injected SqlTransport seam (FT2.0 "Local parity"):
 * the SAME tests that pass against the in-memory fakes pass against the
 * hosted adapter's repository logic here, with zero live credentials.
 * When DATABASE_URL / NEON_CONNECTION_STRING exist in the environment,
 * the same suite additionally runs against the live driver (skipped
 * otherwise — tests never REQUIRE live credentials).
 */

import { describe, expect, it } from 'vitest';
import {
  definePersistenceContractSuite,
  isPersistenceError,
  ManualClock,
} from '@arena/persistence';
import { NeonControlPlaneRepository } from './adapter.js';
import { NeonMigrationRunner, bindSqlMigrations, SQL_MIGRATION_SOURCES } from './migrations.js';
import { readNeonConfigFromEnv } from './env.js';
import { FakeSqlTransport } from './test-support.js';

const T0 = 1_700_000_000_000;

definePersistenceContractSuite('neon-postgres (transport seam)', () => {
  const clock = new ManualClock(T0);
  const transport = new FakeSqlTransport();
  return {
    controlPlane: new NeonControlPlaneRepository({ transport, clock }),
    migrationRunner: new NeonMigrationRunner({ transport, clock }),
    clock,
  };
});

// Live runs require a USABLE connection string (postgres:// or
// postgresql://). A DATABASE_URL with another scheme (e.g. an unrelated
// local sqlite file) must NOT trigger live runs — the same env resolution
// the adapter itself uses decides this (tests never REQUIRE credentials).
const hasLiveCredentials = readNeonConfigFromEnv() !== null;

describe.skipIf(!hasLiveCredentials)('neon-postgres live contract suite (credentials present)', () => {
  definePersistenceContractSuite('neon-postgres (live)', async () => ({
    controlPlane: new NeonControlPlaneRepository(),
    migrationRunner: new NeonMigrationRunner(),
  }));
});

describe('neon-postgres adapter discipline', () => {
  it('binds the shipped SQL migrations and runs them idempotently', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeSqlTransport({ enforceTables: true });
    const runner = new NeonMigrationRunner({ transport, clock });
    const migrations = bindSqlMigrations(transport);
    // 0001-0002 control plane (B002) + 0003-0005 durable host runtime
    // (P002) + 0006 durable payment ledger/outbox (P002-F1, F-09).
    expect(migrations.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6]);

    // Before bootstrap, repository operations fail closed on the missing
    // relation (the transport enforces table existence).
    const repo = new NeonControlPlaneRepository({ transport, clock });
    let transportFailure: unknown;
    try {
      await repo.insert({
        recordId: 'record-1',
        tenantId: 'tenant-alpha',
        kind: 'capability-case',
        version: 1,
        data: { value: 1 },
      });
    } catch (error) {
      transportFailure = error;
    }
    expect(isPersistenceError(transportFailure)).toBe(true);

    const first = await runner.run(migrations);
    expect(first.applied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(first.fromVersion).toBeNull();
    expect(first.toVersion).toBe(6);
    expect(transport.createdTables()).toContain('arena_control_record');
    expect(transport.createdTables()).toContain('arena_migration_ledger');
    // P002 durable host-runtime tables (migrations 0003-0005).
    expect(transport.createdTables()).toContain('arena_escalation_record');
    expect(transport.createdTables()).toContain('arena_escalation_event');
    expect(transport.createdTables()).toContain('arena_webhook_outbox');
    expect(transport.createdTables()).toContain('arena_job_record');
    expect(transport.createdTables()).toContain('arena_job_event');
    expect(transport.createdTables()).toContain('arena_audit_record');
    expect(transport.createdTables()).toContain('arena_job_dead_letter');
    expect(transport.createdTables()).toContain('arena_runtime_idempotency');
    expect(transport.createdTables()).toContain('arena_projection_state');
    // P002-F1 durable payment tables (migration 0006 — F-09).
    expect(transport.createdTables()).toContain('arena_payment_ledger');
    expect(transport.createdTables()).toContain('arena_payment_ledger_entry');
    expect(transport.createdTables()).toContain('arena_payment_outbox');

    // Re-run is a no-op.
    const second = await runner.run(migrations);
    expect(second.applied).toEqual([]);
    expect(second.skipped.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6]);

    // After bootstrap the repository works.
    const inserted = await repo.insert({
      recordId: 'record-1',
      tenantId: 'tenant-alpha',
      kind: 'capability-case',
      version: 1,
      data: { value: 1 },
    });
    expect(inserted.created).toBe(true);
  });

  it('mirrors migrations/*.sql one-to-one in the inlined sources', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    for (const source of SQL_MIGRATION_SOURCES) {
      const file = `migrations/${String(source.version).padStart(4, '0')}-${source.name}.sql`;
      const path = fileURLToPath(new URL(`../${file}`, import.meta.url));
      const text = await readFile(path, 'utf8');
      expect(text, `inlined SQL must equal ${file}`).toBe(source.sql);
    }
  });

  it('exposes the ledger bootstrap DDL identical to migration 0002', () => {
    const ledgerSource = SQL_MIGRATION_SOURCES.find((source) => source.version === 2);
    expect(ledgerSource).toBeDefined();
    expect(ledgerSource?.sql).toContain('CREATE TABLE IF NOT EXISTS arena_migration_ledger');
  });

  it('probes AVAILABLE with a healthy transport and DEGRADED with a failing one', async () => {
    const clock = new ManualClock(T0);
    const healthy = new NeonControlPlaneRepository({ transport: new FakeSqlTransport(), clock });
    const snapshot = await healthy.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.checkedAt).toBe(T0);

    const failing = new NeonControlPlaneRepository({
      transport: {
        async execute() {
          throw new Error('connection refused');
        },
      },
      clock,
    });
    const degraded = await failing.capacityProbe();
    expect(degraded.status).toBe('DEGRADED');
    expect(degraded.reasons).toEqual([{ code: 'probe-failed' }]);
    // Probe failures never carry transport detail in reasons.
    expect(JSON.stringify(degraded)).not.toContain('connection refused');
  });

  it('surfaces declared allowances as unknown-usage dimension readings', async () => {
    const repo = new NeonControlPlaneRepository({
      transport: new FakeSqlTransport(),
      clock: new ManualClock(T0),
      declaredAllowances: [{ dimension: 'storage', limit: 512 * 1024 * 1024 }],
    });
    const snapshot = await repo.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.dimensions).toEqual([
      { dimension: 'storage', used: null, limit: 536870912, remaining: null, windowMs: null },
    ]);
    expect(snapshot.reasons).toEqual([]);
  });
});
