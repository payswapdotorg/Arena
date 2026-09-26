# Arena Repository Layout

> This file is required by the A001 dispatch (acceptance criteria item 10).
> A001's owned surfaces in spec/work-items.md do not include `docs/*`; the
> A001 dispatch explicitly mandates this file and docs/verification-baseline.md.
> The carve-out is recorded in `scripts/work-order-surfaces.json` and flagged
> to the Tech Lead.

## How to run everything (the verification battery)

```bash
pnpm install --frozen-lockfile   # reproducible install (engines: node >=22 <23, .nvmrc: 22)
pnpm governance                  # governance self-tests + repo governance checks
pnpm boundary                    # boundary self-tests + repo layer scan
pnpm typecheck                   # tsc --noEmit in every workspace (via turbo)
pnpm lint                        # eslint in every workspace + repo scripts (via turbo)
pnpm test                        # vitest in every workspace (positive + negative suites)
pnpm build                       # tsc emit to dist/ in every workspace (via turbo)
```

`pnpm governance` and `pnpm boundary` both (a) run deliberate violation
fixtures that MUST fail, then (b) check the real tree — a check whose
fixtures do not fail is itself a failure.

## Top-level directories

| Path | Purpose | Owner pattern |
|---|---|---|
| `apps/` | Deployable applications (top layer). `apps/web` is the canonical Arena control UI surface (architecture-lock rule 20). | `apps/*` (A001), `apps/web/src/<area>/*` (A017/A018/A031/A032) |
| `packages/` | Workspace libraries. `packages/protocol-*` = protocol layer; everything else = domain layer. | per work order (see spec/work-items.md) |
| `services/` | Deployable services. Each service owns its capability and persists only through explicit contracts (spec/service-boundaries.md). | per work order |
| `adapters/` | External-system adapters (model providers, Epoch, persistence/infrastructure). Provider-specific semantics never enter kernel contracts. | per work order |
| `bodies/`, `environments/` | Reference Agent Body definitions and executable environment definitions (content workspaces; not layered code). | A028/A029 |
| `contracts/` | Generated cross-service contracts (`contracts/<domain>/`), produced by generators registered in `scripts/generate-contracts.mjs`. Committed; drift-checked by governance (G9). | per work order |
| `scripts/` | Repository tooling: governance check, boundary check, package scaffolder, contract generator, work-order surface registry, self-test fixtures. | A001 |
| `spec/` | Immutable work products: requirements, work items, dependency graph, project state, object specifications. Edited only by the Tech Lead at governance boundaries. | Tech Lead |
| `docs/` | Architecture, governance, handoff, and operational documentation. | Tech Lead (+ per-WO carve-outs) |
| `.github/` | CI workflows (pinned action refs only). | A001 (`.github/*`) |

Root manifests: `package.json`, `pnpm-workspace.yaml` (workspace globs + exact
version catalog), `pnpm-lock.yaml` (committed; `--frozen-lockfile` installs),
`turbo.json` (task graph), `tsconfig.base.json` (strict TypeScript base),
`eslint.config.mjs` (flat config), `.npmrc` (`save-exact=true`,
`engine-strict=true`), `.nvmrc` (node 22), `.gitignore`, `LICENSE`.

## Layering rules (enforced by `pnpm boundary`)

From docs/architecture.md §18:

```
apps
  ↓
services
  ↓
domain packages (packages/*, except protocol-*)
  ↓
protocol packages (packages/protocol-*)
  ↓
persistence/infrastructure adapters (adapters/*)
```

Machine rules (scripts/boundary-check.mjs):

- **B1** — nothing outside `apps/` may import from `apps/*` (a package
  importing an app fails).
- **B2** — a service may not import another service's internals; services
  communicate only through versioned contracts
  (spec/service-boundaries.md "Cross-service rule").
- **B3** — an adapter may not import another adapter's internals (provider
  adapters are isolation boundaries).
- **B4** — cross-workspace imports may only point downward. Same-layer
  composition is allowed only between domain packages and between protocol
  packages. Documented exception: adapters may import protocol and domain
  packages, because provider adapters translate external semantics INTO Arena
  packages (architecture.md §17 — e.g. model adapters implement protocol
  interfaces, the Epoch adapter consumes the SDK). This exception is an
  interpretation; confirm with the Architect (see A001 report, architecture
  questions).

Deliberate violation fixtures live in `scripts/fixtures/boundary/cases/` and
run as part of `pnpm boundary`.

## Governance (enforced by `pnpm governance`)

`scripts/governance-check.py` implements the machine checks required by
docs/GOVERNANCE.md:

| Check | What it enforces |
|---|---|
| G1 | required source-of-truth files present and non-empty |
| G2 | architecture lock present, version A1.0, 24 contiguous rules, ACR section |
| G3 | PROJECT-STATE frontier items exist in work-items; ≤3 concurrent active |
| G4 | every changed path (base..HEAD) ⊆ owned surfaces of some work order |
| G5 | concurrently active work orders have pairwise-disjoint surfaces |
| G6 | frozen dependencies: exact pins only, `.npmrc` flags, bounded engines, exact catalog |
| G7 | protocol-core purity: zero runtime deps, no model/provider names |
| G8 | CI workflow exists with pinned action refs + full battery |
| G9 | generated contracts match the generator (no drift) |

The work-order surface registry (`scripts/work-order-surfaces.json`) is
derived from spec/work-items.md; carve-outs are explicit and reasoned.

## Frozen dependency policy

- Every dependency in every manifest is **exact** (`1.2.3`), a `catalog:`
  reference (catalog entries are exact), or `workspace:*` for internal links.
- `.npmrc` sets `save-exact=true` and `engine-strict=true`.
- `engines.node` is a bounded pin (`>=22 <23`); `.nvmrc` pins 22;
  `packageManager` pins the exact pnpm version.
- The root lockfile is committed; CI installs with `--frozen-lockfile`.
- Root lockfile edits are serialized by the Tech Lead except during the A001
  bootstrap (A001 is the only active work order).

## Contract generation convention

- Generators declare contracts in the manifest inside
  `scripts/generate-contracts.mjs` (`id`, repo-relative `output`, `build()`).
- Output is deterministic: JSON with sorted keys, 2-space indent, trailing
  newline. Generated files are committed.
- `pnpm contracts:generate` regenerates in place. Governance check G9
  regenerates to a temp dir and diffs against the committed copies — any
  missing/extra/changed file fails governance.
- A001 demonstrates the convention with
  `packages/protocol-core/contracts/*.json` (bound to the TS surface by
  `src/contracts.parity.test.ts`). Later work orders put cross-service
  contracts in `contracts/<domain>/` and register their generators in the
  same manifest.

## Creating a new workspace package

```bash
node scripts/new-package.mjs --name @arena/my-feature          # domain layer
node scripts/new-package.mjs --name @arena/protocol-jobs        # protocol layer
node scripts/new-package.mjs --self-test                        # structural self-test
```

The scaffold passes the full battery out of the box (proven for real by
`@arena/protocol-core`, which was scaffolded with this tool).
