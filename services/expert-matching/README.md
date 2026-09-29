# @arena/expert-matching-fabric

The A007 **reference expert-matching fabric** (Work Order A007; requirement
R8 "Match expert requirements to qualified experts"): the in-process pool +
pure matcher + command/query orchestration over the REAL
`@arena/expert-qualification` protocol.

Pure TypeScript, zero external runtime dependencies (only
`@arena/expert-qualification` + `@arena/protocol-core` workspace packages).
No network, no database, no clock reads — matching evaluates at the
REQUEST's fixed `evaluatedAt` (determinism anchor), and the same pool +
request always produce the same ranked result.

## Public surface

- **`QualifiedExpertPool`** — the in-process reference registry of expert
  cards, evidence records, claims, qualification policies and
  qualification records. Registration discipline: idempotent by content
  digest; identity conflicts fail loudly (same identity + different digest
  is a conflict, never a silent redefinition); claims REQUIRE a
  registered card (scope metadata is always well-defined); records
  REQUIRE their claim and policy and valid supersession chains;
  everything is append-only (no update/delete APIs).
- **`ExpertMatchingEngine`** — the deterministic, pure matcher:
  tenant filter first (lock rule 11 — cross-tenant experts are invisible,
  never merely unmatched), then request-level scope checks
  (domain/jurisdiction/availability with fixed precedence), then
  per-requirement resolution (active claim → proficiency threshold →
  latest in-force qualification record), deterministic ranking
  (fully-satisfying first, satisfied-count descending, evidence depth
  descending, then tie-break by content digest — never registration
  order), policy cap, and the explicit negative space
  (`requirementsUnmet`).
- **`ExpertMatchingFabric`** — command/query orchestration:
  `qualifyClaim` (idempotent command, lock rule 17 — same key + same
  command replays the stored record; same key + different command is a
  conflict), `recordQualificationExpiry` (decay APPENDS, never rewrites),
  `matchExperts` (pure query with the envelope round trip), plus the
  append-only event log and an observability dump.
- **`main.mjs`** — a deterministic end-to-end demo (registration →
  qualification → matching → negative probes → decay → observability).

## What it deliberately is NOT

- **Not an access or rights system** (architecture-lock
  rule 9): matching ranks by per-requirement qualification evidence ONLY —
  no object here conveys rights, roles or system authority. Tenant
  filtering is a data boundary (lock rule 11), not a rights decision.
- **Not a standing system** (spec/quality-model.md): no global score, no
  standing input — per-requirement evidence only.
- **Not a REST/HTTP service** — the Work Order gate is the typed
  programmatic API + the demo entry; wire shapes travel inside
  `@arena/protocol-core` envelopes.

## Commands

```bash
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint .
pnpm test             # vitest run (pool/matcher/fabric + property + hygiene)
pnpm build            # tsc -p tsconfig.build.json
pnpm demo             # node main.mjs — deterministic end-to-end scenario
```

## Test map

| Suite | Focus |
| --- | --- |
| `pool.test.ts` | registration discipline, identity/supersession conflicts, append-only, queries |
| `matcher.test.ts` | golden path, every unmatched reason, tenant isolation, ranking, caps, supersession |
| `fabric.test.ts` | command orchestration, idempotency/conflicts, decay appends, envelope round trips |
| `property.test.ts` | registration-order invariance, match determinism, ranking totality (seeded LCG) |
| `hygiene.test.ts` | lock-rule-9 / no-standing separation negatives + public-surface hygiene |
