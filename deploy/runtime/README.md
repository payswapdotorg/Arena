# deploy/runtime — the durable host runtime composition site (P002)

Work Order P002 (issue #154; ADR-P001-01/02/07). This directory is the
**M1-designated composition site** for the durable host runtime:
`packages/runtime-host/src/surfaces.ts` (the frozen interface package,
session 2) named this exact wiring point — *"the REAL classes satisfy
these interfaces structurally at the composition site (deploy/runtime
wiring); the parity is pinned by tests/runtime-host against the real
classes."*

## Why the composition lives here

Boundary law **B2** (`scripts/boundary-check.mjs`, backed by
`spec/service-boundaries.md`): a service may never import another
service — services communicate only through versioned contracts. The
durable host runtime composes THREE services
(`services/escalation-api`, `services/escalation-routing`,
`services/job-orchestrator`) over the neon-postgres durable ports from
`services/runtime-host`. Cross-service wiring is therefore ILLEGAL
inside `services/*` — and `deploy/` is the standalone composition layer
(the `@arena/deploy` package, its own lockfile, not a boundary-checked
workspace layer; the `deploy/src/hosted` precedent for source-alias
composition).

## What is composed (`src/composition.ts`)

`composeRuntimeHost(options)`:

- **persistence** — `createDurableRuntimeComponents` over ONE shared
  `SqlTransport` (injected, or the Neon HTTP driver from
  `DATABASE_URL` / `NEON_CONNECTION_STRING`): versioned migrations
  0001–0005 + the named durable-runtime statement set;
- **escalation lifecycle** — the REAL `EscalationApiService`
  (services/escalation-api) over the durable escalation store + webhook
  outbox, with the REAL `EscalationRoutingService` by default (R-007)
  and the labelled round-robin stub as the explicit fallback;
- **jobs** — the ONE shared durable job runner (ADR-P001-01): the REAL
  `JobOrchestrator` (services/job-orchestrator) over the durable job
  store + event sink, with the `DurableEventSink` SHARED with the host
  core (one audit-chain cache);
- **host core** — `services/runtime-host`'s `createRuntimeHost` with
  the engines injected through the frozen package's structural
  surfaces (`EscalationLifecycleSurface` / `JobRunnerSurface`).

The returned host is `constructed`; `start()` applies migrations from
zero (no-op when current), hydrates the audit tail, runs the
restart-recovery sweep and flips to `started`.

## Where it is proven

- **tests/runtime-host** (the P002 acceptance battery) typechecks AND
  exercises this composition against real engines and real databases
  (embedded real Postgres via PGlite + live Neon) — including the
  structural-parity pinning the frozen package's comment names. The
  battery's `run.mjs` reaches this source through an explicit alias
  (the P004 `@arena/deploy/env-contract` battery-alias precedent).
- **EVIDENCE.md** (this directory) is the release-gate-facing summary of
  the five P002 acceptance proofs — environment, migration output,
  restart/resume proof, idempotent replay proof, cross-tenant
  fail-closed proof — with the machine-generated transcripts in
  `tests/runtime-host/evidence/`.
- `deploy/`'s own battery does not cover this subtree (deploy's
  `tsconfig.json`/`vitest.config.ts` include `src/` only; those root
  files are outside P002's owned surfaces) — disclosed in the PR body.

## P003 binding

Wave-2 P003 binds real HTTP/MCP/webhook transport onto the frozen
`RuntimeHostApi` the composed host returns (`RuntimeHostService` is a
structural superset — the frozen interface is exactly what P003 sees).
