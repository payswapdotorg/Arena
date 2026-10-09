# P002 acceptance evidence — tests/runtime-host/evidence/

Work Order P002 (issue #154). This directory holds the machine-generated
transcripts of the five acceptance proofs
(spec/post-roadmap-production-work-items.md "## P002"), captured
**redacted-at-capture-time** (identifiers are prefix+length, digests are
12-hex prefixes, no connection strings, no credentials, no full record
bodies — the P004 transcript discipline):

- `embedded-postgres-transcript.md` — the CI-path proofs: a REAL embedded
  PostgreSQL engine (@electric-sql/pglite — PostgreSQL 17 compiled to
  WASM, pinned by services/runtime-host) through the PRODUCTION
  composition (deploy/runtime/src/composition.ts). Zero credentials.
- `live-neon-transcript.md` — the live-path proofs: LIVE Neon PostgreSQL
  (server version **18.6**, region aws-us-east-2) through the REAL Neon
  serverless HTTP driver (`@neondatabase/serverless` 0.10.4) via the same
  production composition. Self-skipping without
  `ARENA_P002_NEON_EVIDENCE_URL`.
- `neon-evidence.sh` — the evidence runner: provisions the DEDICATED Neon
  project and a FRESH branch per run, then drives the battery. The only
  project it may ever touch is the one named `arena-p002-evidence`.

## Canonical live run (2026-10-09)

| field | value |
| --- | --- |
| UTC timestamp | 2026-10-09T07:33:45Z (branch), battery green at ~07:34 UTC |
| Dedicated Neon project | `arena-p002-evidence` — id `square-glitter-02449657` (created by this lineage 2026-10-09T07:24:44Z; the ONLY project touched — all other org projects were listed read-only, never modified) |
| Evidence branch (fresh, clean DB) | `p002-evidence-20261009T073345Z` — id `br-falling-mountain-b52ce578` (parent: the project's default `main` branch) |
| Branch endpoint host | `ep-tiny-meadow-b5n1a9nw.c-7.us-east-2.aws.neon.tech` (read/write, autoscaling 0.25 CU) |
| Database / role | `neondb` / `neondb_owner` |
| Role password | `npg_***REDACTED***` (minted at project creation; never printed, never committed — on re-runs the operator passes `ARENA_P002_NEON_PASSWORD` from their secret store) |
| Connection scheme | `postgresql://…?sslmode=require` (exists only in the child process env for the run's duration) |
| Engine | PostgreSQL 18.6 (`SELECT current_setting('server_version')` → `18.6 (c021049)`) via the Neon HTTP SQL proxy |

### Commands (exact)

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
source /home/z/my-project/scripts/env.sh          # NEON_API_KEY_ALT etc.
export ARENA_P002_NEON_PASSWORD=<operator secret> # for an existing project
bash tests/runtime-host/evidence/neon-evidence.sh
# equivalent manual form (battery only):
#   ARENA_P002_NEON_EVIDENCE_URL='postgresql://neondb_owner:<secret>@<branch-host>/neondb?sslmode=require' \
#     node tests/runtime-host/run.mjs
```

### Battery output (live run)

```
[runtime-host-battery] typecheck: clean
 RUN  v5.0.1 /home/z/worktrees/P002/tests/runtime-host
 ✓ live-neon-acceptance.test.ts (1 test) 22096ms
   ✓ proves (a) migrate zero→latest, (b) persist+read-back, (c) hard-restart resume,
     (d) deterministic replay, (e) cross-tenant fail-closed 22095ms
 ✓ pglite-acceptance.test.ts (2 tests) 4024ms
 ✓ composition-parity.test.ts (4 tests) 30ms
 Test Files  3 passed (3)
      Tests  7 passed (7)
[p002-evidence] green — transcript: tests/runtime-host/evidence/live-neon-transcript.md
```

### Live migration ledger + durable row counts (queried after the run)

```sql
SELECT version, name FROM arena_migration_ledger ORDER BY version;
-- 1 create-control-plane-records
-- 2 create-migration-ledger
-- 3 create-runtime-escalation-records
-- 4 create-runtime-job-records
-- 5 create-runtime-idempotency-and-projections
-- (applied_at = 1791367200000 for all five — the A015 ManualClock pinned
--  at 2026-10-07T10:00:00.000Z, i.e. deterministic injected time)

SELECT
  (SELECT count(*) FROM arena_escalation_record)      AS escalations,        -- 1
  (SELECT count(*) FROM arena_escalation_event)       AS escalation_events,  -- 3
  (SELECT count(*) FROM arena_job_record)             AS jobs,               -- 1
  (SELECT count(*) FROM arena_job_event)              AS job_events,         -- 3
  (SELECT count(*) FROM arena_audit_record)           AS audit_records,      -- 3
  (SELECT count(*) FROM arena_runtime_idempotency)    AS idempotency_outcomes; -- 1
```

The counts are exactly the acceptance arc's honest footprint: one
accepted escalation (3 lifecycle events), one durable job (submit +
start + the recovery sweep's requeue/timeout event), three
digest-chained audit records (submit + claim + recovery mutation), one
recorded idempotency outcome (the deterministic replay anchor).

### The five proofs (both engines, same shape)

| # | criterion | embedded Postgres (PGlite 17) | live Neon (18.6) |
| --- | --- | --- | --- |
| (a) | clean DB migrates zero→latest | `[1,2,3,4,5]` applied | `[1,2,3,4,5]` applied (ledger above) |
| (b) | real adapter persists + reads back an accepted escalation | `state=matching lens=customer` | `state=matching lens=customer` |
| (c) | hard restart resumes without loss/duplicated transition | recovery `{nonTerminalJobs:1, reclaimedLeases:1, terminalJobsUntouched:0}`, pre-restart history preserved verbatim (canonical JSON — jsonb reorders keys), escalation history length unchanged | same |
| (d) | retries return the deterministic recorded outcome | `outcome="replay"`, recorded outcome stable (274 bytes) | same |
| (e) | cross-tenant access fails closed | create=`RUNTIME_CROSS_TENANT_ACCESS` read=`RUNTIME_ESCALATION_NOT_FOUND` act=`ESCALATION_CROSS_TENANT_ACCESS` list=0 | same |

Both runs also verify the tamper-evident audit chain END-TO-END across
the restart boundary (`verifyAuditChain`: contiguous sequences,
previousDigest linkage, recomputed sha256 digests) — heads recorded in
the transcripts (redacted to 12-hex prefixes).

### Honest notes

- The live path is WRITES-ON-DEDICATED-PROJECT-ONLY: the live suite
  deliberately ignores `DATABASE_URL` / `NEON_CONNECTION_STRING` (they
  may point at existing shared projects) and activates solely on
  `ARENA_P002_NEON_EVIDENCE_URL`.
- The live battery found and fixed a real transport limitation: the Neon
  HTTP SQL proxy executes ONE command per prepared statement, so the
  multi-command `apply_migration` source is split into its top-level
  commands (quote/comment/dollar-quote aware) and executed sequentially
  in source order (`adapters/hosted/neon-postgres/src/sql-transport.ts`,
  covered by `src/sql-transport.test.ts` — 12 credential-free tests with
  a stubbed fetch).
- Superseded evidence branches (e.g. `p002-evidence-20261009T072514Z`
  from the first probe run) were deleted from the dedicated project;
  only the canonical branch is retained. The project itself is retained
  for TL verification.
