/**
 * tests/runtime-host/support/pglite-transport.ts — the embedded REAL
 * Postgres transport for the P002 acceptance battery.
 *
 * @electric-sql/pglite is a real PostgreSQL 17 engine compiled to WASM:
 * it executes the REAL migration DDL (CREATE TABLE / CREATE INDEX /
 * comments, multi-statement), the REAL named parameterized statement
 * set ($1..$n placeholders, ON CONFLICT, UPDATE ... RETURNING, jsonb)
 * and the REAL transaction semantics — no credential, no network, fully
 * self-contained CI path (the task's "real embedded Postgres"; no
 * postgres server binaries exist in this environment and no
 * tests/integration helper exists on this branch — disclosed in the PR
 * body).
 *
 * Statement dispatch mirrors the reference transport's discipline: the
 * ONE genuinely multi-statement statement (apply_migration — each
 * migration source carries table + index DDL and comments) goes through
 * PGlite's exec(); every other statement is a single parameterized
 * statement and goes through query().
 */

import { PGlite } from '@electric-sql/pglite';
import type { SqlRow, SqlStatement, SqlTransport } from '@arena/hosted-neon-postgres';

/** The only statement allowed to carry multiple SQL statements. */
const MULTI_STATEMENT_NAMES = new Set(['apply_migration']);

export interface PgliteTransportHandle {
  readonly transport: SqlTransport;
  /** Close the underlying embedded Postgres instance. */
  close(): Promise<void>;
}

/**
 * A fresh in-memory embedded real Postgres instance behind the
 * SqlTransport seam (private database — nothing persists across
 * instances, which is exactly what the migrate-from-zero proof needs).
 */
export async function createPgliteSqlTransport(): Promise<PgliteTransportHandle> {
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
