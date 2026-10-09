# P002 release-gate evidence — the durable host runtime (deploy/runtime)

Work Order P002 (issue #154). This is the release-gate-facing summary of
WHERE the five acceptance criteria of spec/post-roadmap-production-work-
items.md "## P002" are proven, and by what evidence. The full evidence
records live in `tests/runtime-host/evidence/` (machine-generated
transcripts, redacted at capture time); the proofs run through THIS
directory's production composition (`src/composition.ts`).

## Environment

| class | engine | composition | credentials |
| --- | --- | --- | --- |
| Embedded real Postgres (CI path) | @electric-sql/pglite — PostgreSQL 17 (WASM), pinned by services/runtime-host | `deploy/runtime/src/composition.ts` with the transport injected | none (self-contained) |
| Live Neon (evidence path) | Neon PostgreSQL 18.6, aws-us-east-2, via `@neondatabase/serverless` 0.10.4 HTTP driver | same composition, transport from `ARENA_P002_NEON_EVIDENCE_URL` | dedicated project `arena-p002-evidence` (id `square-glitter-02449657`), fresh branch per run, password `npg_***REDACTED***` |
| Composition parity (always) | REAL EscalationApiService + REAL EscalationRoutingService + REAL JobOrchestrator over the in-memory reference transport | same composition | none |

Runner: `node tests/runtime-host/run.mjs` (typechecks the battery + the
production composition, then runs vitest). Live activation:
`bash tests/runtime-host/evidence/neon-evidence.sh`. Battery result at
the M4 close: **3 files / 7 tests passed** (live suite included; without
credentials: 2 files / 6 passed + 1 self-skipped with reason).

## (a) Clean database migrates zero → latest

Both engines applied exactly `[1,2,3,4,5]`
(`create-control-plane-records`, `create-migration-ledger`,
`create-runtime-escalation-records`, `create-runtime-job-records`,
`create-runtime-idempotency-and-projections`) on a clean
database. Live ledger state (PostgreSQL 18.6):

```
arena_migration_ledger: versions 1..5, applied_at = 1791367200000
(the A015 ManualClock pinned at 2026-10-07T10:00:00.000Z)
```

A second start over the already-migrated store is a NO-OP
(`migrationsApplied: []` — pinned by the pglite suite's idempotent
re-run test).

## (b) Real adapter persists and reads back an accepted escalation

An accepted escalation round-tripped through the real durable stores:
`state=matching` (the REAL routing service's honest no-match posture),
`lens=customer` (ADR-P001-02 lens stamping derived from the tenant and
enforced at read time). Durable footprint on the live branch after the
run: 1 escalation record + 3 lifecycle event rows
(`arena_escalation_record` / `arena_escalation_event`).

## (c) Restart resumes without loss or duplicated transition

A claimed-then-orphaned durable job (process death — NO graceful stop)
was reclaimed by the next start's recovery sweep:
`{nonTerminalJobs: 1, reclaimedLeases: 1, terminalJobsUntouched: 0}`;
the job advanced (append-only event log grew), the pre-restart event
history was preserved verbatim (canonical comparison — PostgreSQL jsonb
legitimately reorders object keys), the escalation's history length and
state were UNCHANGED across the restart boundary (no duplicated
transition), and the tamper-evident audit chain continued
digest-linked (3 records, `verifyAuditChain` green across the boundary).

## (d) Retries return the deterministic recorded outcome

A re-submission of the same idempotent identity returned
`outcome="replay"` with the SAME `requestId`, and the recorded outcome
in `arena_runtime_idempotency` was byte-stable across the replay
(274 bytes) — the durable idempotency record is the authority, never a
recomputation.

## (e) Cross-tenant access fails closed

Every cross-tenant path failed closed with the typed errors:
create → `RUNTIME_CROSS_TENANT_ACCESS`; read →
`RUNTIME_ESCALATION_NOT_FOUND` (no existence leak); advance →
`ESCALATION_CROSS_TENANT_ACCESS`; correlation listing → 0 rows. Proven
on BOTH engines through the same production composition.

## Where the proofs live

- `tests/runtime-host/pglite-acceptance.test.ts` — the five proofs +
  the idempotent migration re-run, against embedded real Postgres.
- `tests/runtime-host/live-neon-acceptance.test.ts` — the same five
  proofs against live Neon (self-skipping without the dedicated URL).
- `tests/runtime-host/composition-parity.test.ts` — REAL engine parity
  through this composition root (structural surfaces of the frozen
  packages/runtime-host interface), the restart-recovery arc, the stub
  fallback, and the zero-credential fail-closed posture.
- `tests/runtime-host/evidence/README.md` — exact commands, timestamps,
  project/branch/host identifiers, redacted password posture, battery
  output, live ledger + durable row counts.

## Honest limitations

- The Neon HTTP SQL proxy executes ONE command per prepared statement:
  the multi-command `apply_migration` source is split and executed
  sequentially WITHOUT a wrapping transaction (the HTTP driver has no
  cross-request session). The DDL is idempotent by contract and the
  ledger records a version only after its source applied fully, so a
  mid-sequence failure re-runs cleanly — disclosed rather than papered
  over (`adapters/hosted/neon-postgres/src/sql-transport.ts`).
- Live evidence is a single-run class per branch (fresh branch per run);
  it is not a continuous soak. Concurrency races and provider-outage
  windows belong to P006/P007, per the roadmap.
- `deploy/`'s own battery does not cover this subtree (deploy's
  tsconfig/vitest include `src/` only) — the P002 battery covers it.
