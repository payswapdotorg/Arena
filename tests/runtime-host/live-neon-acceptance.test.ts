/**
 * tests/runtime-host/live-neon-acceptance.test.ts — the five P002
 * acceptance criteria against LIVE Neon PostgreSQL through the REAL
 * Neon serverless HTTP driver, via the PRODUCTION composition
 * (deploy/runtime/src/composition.ts).
 *
 * Live activation (credentials are NEVER required — this suite
 * self-skips with an explicit reason when absent; CI has no provider
 * credentials by design):
 *   - ARENA_P002_NEON_EVIDENCE_URL — a postgres:// connection string to
 *     the DEDICATED arena-p002-evidence project/branch provisioned by
 *     the evidence script (tests/runtime-host/evidence/neon-evidence.sh),
 *     which creates a FRESH branch per run so the zero→latest migration
 *     proof is canonical. DELIBERATELY no DATABASE_URL /
 *     NEON_CONNECTION_STRING fallback: those may point at an existing
 *     shared project, and this suite WRITES — it must only ever run
 *     against the dedicated evidence project (never touch existing
 *     projects).
 *
 * Evidence transcripts (redacted at capture time — identifiers are
 * prefix+length, no connection strings, no credentials, no full record
 * bodies) are written to tests/runtime-host/evidence/.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { createNeonHttpSqlTransport } from '@arena/hosted-neon-postgres';
import { runAcceptanceProofs, writeTranscript } from './support/acceptance.js';

const EVIDENCE_DIR =
  process.env.ARENA_P002_EVIDENCE_OUT ?? new URL('./evidence/', import.meta.url).pathname;

const dedicatedUrl = process.env.ARENA_P002_NEON_EVIDENCE_URL?.trim();
const liveUrl: string | null =
  dedicatedUrl !== undefined && dedicatedUrl !== '' ? dedicatedUrl : null;

describe.skipIf(liveUrl === null)(
  'P002 acceptance — live Neon (dedicated evidence project) through the production composition',
  () => {
    it('proves (a) migrate zero→latest, (b) persist+read-back, (c) hard-restart resume, (d) deterministic replay, (e) cross-tenant fail-closed', async () => {
      expect(liveUrl).toBeTruthy();
      expect(liveUrl?.startsWith('postgres')).toBe(true);
      const transport = createNeonHttpSqlTransport(liveUrl as string);
      const transcript: string[] = [];
      const verdict = await runAcceptanceProofs({
        label: 'live-neon',
        transport,
        clock: new ManualClock(Date.parse('2026-10-07T10:00:00.000Z')),
        migrationMode: 'fresh',
        transcript,
      });

      // (a) the fresh branch migrated all five versions from zero.
      expect(verdict.migrationsApplied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5]);
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

      const file = await writeTranscript(EVIDENCE_DIR, 'live-neon', transcript);
      expect(file).toContain('live-neon-transcript.md');
    });
  },
);
