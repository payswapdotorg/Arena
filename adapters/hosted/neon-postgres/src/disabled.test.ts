/**
 * DISABLED fail-closed posture for the Neon PostgreSQL adapter (Work
 * Order B002; FT2.0 "Capacity state" + "Adapters never silently switch
 * to a paid path"; BRIEF: adapters constructed without env → DISABLED
 * fail-closed behavior is asserted; values never committed, never
 * logged).
 *
 * The canary technique: a deliberately recognizable FAKE value is placed
 * in the env source; every observable surface (thrown errors, capacity
 * snapshots, stringified errors) must NOT contain it. No live
 * credentials are used anywhere.
 */

import { describe, expect, it } from 'vitest';
import { isPersistenceCapacityError, isPersistenceError } from '@arena/persistence';
import { NeonControlPlaneRepository } from './adapter.js';
import { NeonMigrationRunner, bindSqlMigrations } from './migrations.js';
import { readNeonConfigFromEnv } from './env.js';

const CANARY = 'postgres://canary-user:canary-pass@canary-host.example/dbname';

describe('neon-postgres DISABLED fail-closed posture (no credentials)', () => {
  it('constructs DISABLED without env configuration and fails closed on every operation', async () => {
    const repo = new NeonControlPlaneRepository({ env: {} });
    expect(repo.enabled).toBe(false);

    const operations: (() => Promise<unknown>)[] = [
      () => repo.insert({ recordId: 'r-1', tenantId: 'tenant-alpha', kind: 'capability-case', version: 1, data: {} }),
      () => repo.get('r-1'),
      () => repo.update('r-1', { expectedRevision: 1, data: {} }),
      () => repo.delete('r-1'),
      () => repo.list({}),
      () => repo.count({}),
    ];
    for (const operation of operations) {
      let caught: unknown;
      try {
        await operation();
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceCapacityError(caught), `${String(operation)} must fail closed`).toBe(true);
      const capacityError = caught as { code?: string; capacityStatus?: string };
      expect(capacityError.code).toBe('PERSISTENCE_CAPACITY_DISABLED');
      expect(capacityError.capacityStatus).toBe('DISABLED');
    }
  });

  it('probes DISABLED (never throws, never crashes)', async () => {
    const repo = new NeonControlPlaneRepository({ env: {} });
    const snapshot = await repo.capacityProbe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);
    expect(snapshot.dimensions).toEqual([]);
  });

  it('the migration runner is DISABLED without configuration and fails closed', async () => {
    const runner = new NeonMigrationRunner({ env: {} });
    expect(runner.enabled).toBe(false);
    let caught: unknown;
    try {
      await runner.run([]);
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceCapacityError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe('PERSISTENCE_CAPACITY_DISABLED');
  });

  it('env resolution: DATABASE_URL wins over NEON_CONNECTION_STRING; unusable values are absent', () => {
    expect(
      readNeonConfigFromEnv({
        DATABASE_URL: 'postgresql://user:pass@host.example/db',
        NEON_CONNECTION_STRING: 'postgres://user:pass@other.example/db',
      }),
    ).toEqual({ connectionString: 'postgresql://user:pass@host.example/db' });
    expect(readNeonConfigFromEnv({ NEON_CONNECTION_STRING: 'postgres://u:p@h.example/db' })).toEqual(
      { connectionString: 'postgres://u:p@h.example/db' },
    );
    expect(readNeonConfigFromEnv({ DATABASE_URL: '   ' })).toBeNull();
    expect(readNeonConfigFromEnv({})).toBeNull();
    // Non-postgres schemes are unusable for this adapter -> DISABLED, not crash.
    expect(readNeonConfigFromEnv({ DATABASE_URL: 'file:/unrelated/local.db' })).toBeNull();
    expect(readNeonConfigFromEnv({ DATABASE_URL: 'mysql://u:p@h/db' })).toBeNull();
  });
});

describe('neon-postgres secret hygiene (canary never surfaces)', () => {
  it('DISABLED errors carry env-var NAMES, never values', async () => {
    const repo = new NeonControlPlaneRepository({ env: { DATABASE_URL: CANARY } });
    // Configured -> enabled; transport exists but no call happens here.
    expect(repo.enabled).toBe(true);

    const unconfigured = new NeonControlPlaneRepository({ env: { DATABASE_URL: '' } });
    let caught: unknown;
    try {
      await unconfigured.get('r-1');
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(serialized).not.toContain('canary');
    expect(String(caught)).not.toContain(CANARY);
    const details = (caught as { details?: { missingEnvVarNames?: string[] } }).details;
    expect(details?.missingEnvVarNames).toEqual(['DATABASE_URL', 'NEON_CONNECTION_STRING']);
  });

  it('transport failures keep driver detail out of the typed message (cause only)', async () => {
    const repo = new NeonControlPlaneRepository({
      env: { DATABASE_URL: CANARY },
      transport: {
        async execute() {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
      },
    });
    let caught: unknown;
    try {
      await repo.get('r-1');
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { message: string; code: string };
    expect(typed.code).toBe('PERSISTENCE_TRANSPORT_FAILED');
    expect(typed.message).not.toContain('canary');
    expect(String(caught)).not.toContain('canary');
  });

  it('bindSqlMigrations applies through the transport only (no fs access)', async () => {
    const executed: string[] = [];
    const transport = {
      async execute(statement: { name: string }) {
        executed.push(statement.name);
        return [];
      },
    };
    const migrations = bindSqlMigrations(transport);
    expect(migrations).toHaveLength(2);
    for (const migration of migrations) {
      await migration.apply();
    }
    expect(executed).toEqual(['apply_migration', 'apply_migration']);
  });
});
