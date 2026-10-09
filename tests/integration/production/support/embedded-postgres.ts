/**
 * tests/integration/production/support/embedded-postgres.ts — the
 * embedded REAL Postgres transport for the P006 integrated acceptance
 * battery (Work Order P006; issue #158).
 *
 * @electric-sql/pglite is a real PostgreSQL 17 engine compiled to WASM:
 * it executes the REAL durable-runtime migration DDL and the REAL named
 * parameterized statement set (the same SqlTransport seam the Neon HTTP
 * driver serves in production) — no credential, no network, fully
 * self-contained CI path. This mirrors the P002 battery's
 * tests/runtime-host/support/pglite-transport.ts discipline (that file
 * is P002's frozen surface — this one is P006's own, byte-equivalent in
 * dispatch discipline):
 *
 *   - the ONE genuinely multi-statement statement (apply_migration)
 *     goes through PGlite's exec();
 *   - every other statement is a single parameterized statement and
 *     goes through query().
 *
 * EVIDENCE CLASS: runs over this engine are AUTOMATED-TEST-ONLY per
 * spec/post-roadmap-release-gate.md §3 (real database ENGINE embedded in
 * the test process — not a live hosted deployment). The live-Neon
 * optional path is NOT wired here: P002/P004 own the live-provider
 * evidence classes; P006's evidence records the engine per proof.
 */

import { PGlite } from '@electric-sql/pglite';
import type { SqlRow, SqlStatement, SqlTransport } from '@arena/hosted-neon-postgres';

/** The only statement allowed to carry multiple SQL statements. */
const MULTI_STATEMENT_NAMES = new Set(['apply_migration']);

export interface EmbeddedPostgresHandle {
  /** The SqlTransport the composition consumes (ONE shared transport). */
  readonly transport: SqlTransport;
  /** Close the underlying embedded Postgres instance. */
  close(): Promise<void>;
}

/**
 * A fresh private embedded real Postgres instance behind the
 * SqlTransport seam (nothing persists across instances — exactly what
 * the migrate-from-zero integrated boot needs).
 */
export async function createEmbeddedPostgresTransport(): Promise<EmbeddedPostgresHandle> {
  const db = new PGlite();
  const transport: SqlTransport = {
    async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
      if (MULTI_STATEMENT_NAMES.has(statement.name)) {
        await db.exec(statement.sql);
        return [];
      }
      const result = await db.query(statement.sql, [...statement.params] as unknown[]);
      return result.rows as readonly SqlRow[];
    },
  };
  return {
    transport,
    async close() {
      await db.close();
    },
  };
}
