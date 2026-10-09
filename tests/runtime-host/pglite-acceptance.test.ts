/**
 * tests/runtime-host/pglite-acceptance.test.ts — the five P002
 * acceptance criteria against a REAL embedded PostgreSQL engine
 * (@electric-sql/pglite: PostgreSQL 17 compiled to WASM — real DDL, real
 * parameterized statements, real ON CONFLICT / RETURNING / jsonb
 * semantics), through the PRODUCTION composition
 * (deploy/runtime/src/composition.ts) with the REAL service engines.
 *
 * This is the self-contained, zero-credential CI path: every criterion
 * the spec's "## P002" acceptance block names is proven here against a
 * real database engine, not a fake.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { runAcceptanceProofs, writeTranscript } from './support/acceptance.js';
import { createPgliteSqlTransport } from './support/pglite-transport.js';

const EVIDENCE_DIR = process.env.ARENA_P002_EVIDENCE_OUT ?? new URL('./evidence/', import.meta.url).pathname;

describe('P002 acceptance — embedded real Postgres (PGlite) through the production composition', () => {
  it('proves (a) migrate zero→latest, (b) persist+read-back, (c) hard-restart resume, (d) deterministic replay, (e) cross-tenant fail-closed', async () => {
    const handle = await createPgliteSqlTransport();
    try {
      const transcript: string[] = [];
      const verdict = await runAcceptanceProofs({
        label: 'embedded-postgres',
        transport: handle.transport,
        clock: new ManualClock(Date.parse('2026-10-07T10:00:00.000Z')),
        migrationMode: 'fresh',
        transcript,
      });

      // (a) a clean database migrated all five versions from zero.
      expect(verdict.migrationsApplied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
      expect(verdict.migrationsApplied.map((entry) => entry.name)).toEqual([
        'create-control-plane-records',
        'create-migration-ledger',
        'create-runtime-escalation-records',
        'create-runtime-job-records',
        'create-runtime-idempotency-and-projections',
      ]);
      // (b) the real adapter persisted + read the accepted escalation back.
      expect(verdict.escalationReadBack).toBe(true);
      // (c) the hard restart resumed: one non-terminal job reclaimed, no
      //     terminal job re-executed.
      expect(verdict.restartRecovery).toEqual({
        nonTerminalJobs: 1,
        reclaimedLeases: 1,
        terminalJobsUntouched: 0,
      });
      // (d) the replay returned the deterministic recorded outcome.
      expect(verdict.replayDeterministic).toBe(true);
      // (e) cross-tenant access failed closed on every path.
      expect(verdict.crossTenantFailClosed).toBe(true);
      // The audit chain continued across the restart boundary: the two
      // pre-restart mutations (submit + claim) plus the recovery sweep's
      // own audited mutation — and the digest linkage verifies over the
      // WHOLE chain (pre-restart records + post-restart continuation).
      expect(verdict.auditChainLength).toBeGreaterThanOrEqual(3);
      expect(verdict.auditChainVerified).toBe(true);

      const file = await writeTranscript(EVIDENCE_DIR, 'embedded-postgres', transcript);
      expect(file).toContain('embedded-postgres-transcript.md');
    } finally {
      await handle.close();
    }
  });

  it('re-runs migrations idempotently against the migrated store (no-op restart)', async () => {
    const handle = await createPgliteSqlTransport();
    try {
      const clock = new ManualClock(Date.parse('2026-10-07T10:00:00.000Z'));
      const { composeRuntimeHost } = await import('@arena/runtime-host-composition');
      const hostA = await composeRuntimeHost({ transport: handle.transport, clock });
      const first = await hostA.start();
      expect(first.migrationsApplied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
      await hostA.stop();
      const hostB = await composeRuntimeHost({ transport: handle.transport, clock });
      const second = await hostB.start();
      expect(second.migrationsApplied).toEqual([]); // already at head — a no-op
      expect(second.recovery).toEqual({
        nonTerminalJobs: 0,
        reclaimedLeases: 0,
        terminalJobsUntouched: 0,
      });
      await hostB.stop();
    } finally {
      await handle.close();
    }
  });
});
