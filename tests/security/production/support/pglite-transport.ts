/**
 * tests/security/production/support/pglite-transport.ts — the embedded
 * REAL Postgres transport for the P007 adversarial battery (Work Order
 * P007 integrated pass; issue #159).
 *
 * A faithful copy of the tests/runtime-host/support/pglite-transport.ts
 * pattern (P002's embedded-engine precedent — the same statement-dispatch
 * discipline: only `apply_migration` is multi-statement and goes through
 * PGlite's exec(); every other named statement is a single parameterized
 * query). Kept battery-local so this battery stays self-contained (the
 * house norm: each tests/* battery owns its support files).
 *
 * @electric-sql/pglite is a real PostgreSQL 17 engine compiled to WASM:
 * the adversarial suites below run the REAL migration DDL, the REAL
 * named durable-runtime statement set and REAL transactional race
 * semantics (ON CONFLICT DO NOTHING + RETURNING, append-only guards,
 * jsonb) with zero credentials.
 *
 * EVIDENCE CLASS: AUTOMATED-TEST-ONLY (embedded-PG engine class per the
 * mission's release-gate §3 mapping; a live-Neon re-run is the optional
 * DEMONSTRATED-LIVE addition).
 */

import { PGlite } from '@electric-sql/pglite';
import type { SqlRow, SqlStatement, SqlTransport } from '@arena/hosted-neon-postgres';

/** The only statement allowed to carry multiple SQL statements. */
const MULTI_STATEMENT_NAMES = new Set(['apply_migration']);

export interface PgliteTransportHandle {
  readonly transport: SqlTransport;
  /**
   * A SECOND transport handle over the SAME embedded instance — the
   * adversarial battery's restart/second-composition pattern (a new
   * composition over the same durable store = the P002 "hard restart"
   * semantics: process-death without graceful stop).
   */
  readonly twin: SqlTransport;
  /** Close the underlying embedded Postgres instance. */
  close(): Promise<void>;
}

/**
 * A fresh in-memory embedded real Postgres instance behind the
 * SqlTransport seam (private database — nothing persists across
 * instances). The handle ALSO exposes a `twin` transport over the same
 * instance so a second composition can boot over the identical durable
 * state without tearing the engine down.
 */
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

/**
 * A FAILING transport: every statement throws. This is the degraded /
 * outage window the fail-closed posture must survive (health NEVER
 * reports AVAILABLE while statements fail; typed errors surface, no
 * silent fallback).
 */
export function createFailingSqlTransport(cause = 'adversarial injected outage'): SqlTransport {
  const failure = Object.freeze({ code: 'PERSISTENCE_TRANSPORT_FAILED', cause });
  return {
    async execute(): Promise<readonly SqlRow[]> {
      throw new Error(
        `injected transport failure (adversarial battery): ${JSON.stringify(failure)}`,
      );
    },
  };
}
