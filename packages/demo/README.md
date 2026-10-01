# @arena/demo — Deterministic Demo/Preview Mode (B006)

Deterministic demo corpus + guided first-run narrative for Arena
(Work Order B006; issue #73). Governing product truth: **demo state is
NOT customer state** — always visibly labelled, deterministic,
resettable, zero-credential.

## Surface

| Module | What it owns |
| --- | --- |
| `shared.ts` | The reserved `DEMO_TENANT_ID` + `isDemoTenant()` guard, the fixed narrative time constants, **THE labelling contract** (`DEMO_LABELLING`: banner/badge/reset texts) and the closed `PRODUCT_TRUTH_LABELS` vocabulary |
| `errors.ts` | `DemoError` with the closed code list (`DEMO_SCOPE_VIOLATION`, `DEMO_INVALID_INPUT`, `DEMO_UNKNOWN_RECORD`) |
| `corpus.ts` | The versioned, frozen seed corpus (canonical `ControlPlaneRecord`s derived from the A028 software-engineer and A029 structural-engineer reference bodies) + `computeDemoCorpusHash()` (testable determinism) |
| `narrative.ts` | The versioned, ordered narrative script + role-scoped variants (owner / agent-builder / expert) |
| `store.ts` | The `DemoStore` lifecycle port (`seed` idempotent, `reset` deterministic, `isSeeded`), the in-memory fake, and `createDemoReadSession` (demo reads THROUGH a B005 `CanonicalReadModel`, guarded by `assertDemoTenantScope`) |
| `views.ts` | Pure projections of demo canonical reads into display summaries that each carry their product-truth label |

## Contracts

- **Determinism**: no randomness, no wall-clock. The only "time" is the
  fixed `DEMO_NARRATIVE_TIME_ISO` constant; record provenance is stamped
  at the fixed `DEMO_NARRATIVE_EPOCH_MS`. Two corpus constructions
  produce the identical `computeDemoCorpusHash()`.
- **Scope**: every demo record carries the reserved demo tenant
  (`arena-demo`). Demo state requested outside the demo tenant surface
  fails with the typed `DEMO_SCOPE_VIOLATION` error.
- **Canonical reads**: demo reads go through the B005
  `CanonicalReadModel` port (the read-model service implements it) —
  there is no parallel demo-only API.
- **Labelling**: every demo surface must render the exported labelling
  contract (banner + badge + reset affordance) so labelling cannot drift.
- **Lifecycle**: `seed()` is idempotent (re-running produces the
  identical corpus); `reset()` drops and reseeds to the identical hash.
  The port is defined over the B002 `ControlPlaneRepository`, so the same
  implementation runs over the in-memory fake now and a hosted adapter
  later (B015 wiring).

## Purity

Zero Next.js imports, zero provider names, zero environment access, zero
wall-clock, zero randomness, zero new external dependencies (workspace
links only: `@arena/persistence`, `@arena/protocol-core`,
`@arena/read-model`). Enforced by `src/hygiene.test.ts`.
