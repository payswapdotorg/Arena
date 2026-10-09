/**
 * tests/resilience/production/support/pglite-transport.ts — the embedded
 * REAL Postgres transport for the P007 resilience battery (Work Order
 * P007 integrated pass; issue #159).
 *
 * A faithful copy of the tests/runtime-host/support/pglite-transport.ts
 * pattern (P002's embedded-engine precedent; the same statement-dispatch
 * discipline). Kept battery-local so this battery stays self-contained.
 *
 * EVIDENCE CLASS: AUTOMATED-TEST-ONLY (embedded-PG engine class).
 */

import { PGlite } from '@electric-sql/pglite';
import type { SqlRow, SqlStatement, SqlTransport } from '@arena/hosted-neon-postgres';

/** The only statement allowed to carry multiple SQL statements. */
const MULTI_STATEMENT_NAMES = new Set(['apply_migration']);

export interface PgliteTransportHandle {
  readonly transport: SqlTransport;
  /** A second transport over the same embedded instance (restart proofs). */
  readonly twin: SqlTransport;
  close(): Promise<void>;
}

/** A fresh in-memory embedded real Postgres instance behind the seam. */
export async function createPgliteSqlTransport(): Promise<PgliteTransportHandle> {
  const db = new PGlite();
  const toTransport = (): SqlTransport => ({
    async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
      if (MULTI_STATEMENT_NAMES.has(statement.name)) {
        await db.exec(statement.sql);
        return [];
      }
      const result = await db.query(statement.sql, [...statement.params] as unknown[]);
      return result.rows as readonly SqlRow[];
    },
  });
  return {
    transport: toTransport(),
    twin: toTransport(),
    async close() {
      await db.close();
    },
  };
}
