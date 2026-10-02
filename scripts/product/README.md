# scripts/product — the local Arena product workflow (B016)

The developer-facing local workflow: **install → seed → doctor → reset**.
Every command is a standalone plain-Node script (zero external
dependencies, Node ≥ 22) runnable directly — no root `package.json`
wiring required:

```bash
node scripts/product/install.mjs   # prereq check → pnpm install → pnpm build → verify
node scripts/product/seed.mjs      # deterministic demo corpus into the local fake store
node scripts/product/doctor.mjs    # environment diagnosis (pass/warn/fail per item)
node scripts/product/reset.mjs     # [--yes] [--reseed] — total wipe of LOCAL state
```

All four support `--help`.

## Product truth (what these commands guarantee)

1. **Honest install** — `install` states exactly what the machine needs
   (Node in the repo's engines range, the exact pnpm pin via corepack,
   ~2 GiB disk, **no provider accounts**) and fails early with an
   actionable `next:` line — never a deep stack trace.
2. **Demo state is not customer state** — `seed` drives the B006
   `DemoStore` port over a file-backed implementation of the B002
   `ControlPlaneRepository` port (the SAME ports the app uses — no
   bespoke SQL path). The report prints every seeded record id, the
   reserved demo tenant (`arena-demo`), the corpus hash summary and the
   labelling contract text.
3. **Reset is total and explicit** — a confirmation gate (`--yes` or
   typing exactly `reset`), then a wipe of ALL local state: the store
   plus regenerable caches (`.turbo`, `coverage`, `packages/*/dist`,
   `apps/*/.next`). Source, `node_modules`, the lockfile and git history
   are NEVER touched.
4. **No billable anything by default** — the store is a local fake:
   zero providers, zero credentials. Hosted provider wiring is an
   explicit opt-in documented in `docs/deployment/free-tier-architecture.md`.

## Local state layout

| Path | What it is |
| --- | --- |
| `<repo>/.arena-local/store/control-plane.json` | the local fake persistence store (file-backed B002 repository) |
| `<repo>/.arena-local/` | disposable local tool state; never committed; wiped by `reset` |

Environment knobs:

| Variable | Effect |
| --- | --- |
| `ARENA_LOCAL_STATE_DIR` | override the local state directory (product knob) |
| `ARENA_PRODUCT_REPO_ROOT` | **test seam only** — redirect the repo root used for state/cache paths so the reset totality tests can run against scratch trees. Never set it manually. |

## How the commands reach the workspace

The scripts load `@arena/persistence` and `@arena/demo` **directly from
their TypeScript sources** through the same `.js → .ts` resolution shim
the A018 console uses (`lib/ts-source-shim.mjs`, Node type stripping).
After `pnpm build` the compiled `dist/` outputs exist too (checked by
`install`/`doctor`) — the runtime seam itself always runs the sources,
so the scripts and the app can never drift apart.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success (for `doctor`: no FAILED items — warnings allowed) |
| 1 | failure (actionable message on stderr) |
| 2 | usage error (unknown flag) |

## Tests

```bash
node scripts/product/tests/run-tests.mjs
```

Self-contained runner over Node's built-in `node --test` — pure-logic
suites (parsing, prerequisites, confirmation gate, wipe plan, doctor
diagnosis) plus thin integration wrappers that spawn the real commands.
Requires the workspace to be installed (`node scripts/product/install.mjs`)
because the suites drive the real persistence/demo modules.
