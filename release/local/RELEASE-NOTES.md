# Local Profile Release Notes

## local-profile 1.0.0 — B016 (local install / seed / reset workflow & developer quickstart)

First release of the Arena local profile: the developer-facing
install → seed → doctor → reset workflow and the quickstart that takes a
fresh machine to deterministic Demo mode.

### Ships

- **`scripts/product/` — the product workflow commands** (zero external
  dependencies, runnable standalone, `--help` on every command):
  - `install.mjs` — prerequisite check (Node in the engines range, the
    exact pnpm pin via corepack, disk) → `pnpm install` → `pnpm build` →
    verification (workspace loads; the demo corpus seeds to its stable
    hash; expected build outputs exist). Early actionable failures —
    never a deep stack trace.
  - `seed.mjs` — the B006 deterministic demo corpus (5 records, reserved
    demo tenant `arena-demo`) into the local fake persistence store,
    driven through the B002 `ControlPlaneRepository` port (the file-backed
    local fake in `scripts/product/lib/local-store.mjs`) via the B006
    `DemoStore` port — the SAME ports the application uses. Idempotent;
    prints exactly what was seeded, the tenant identity, the corpus hash
    summary and the labelling truth.
  - `reset.mjs` — confirmation gate (`--yes` or typed `reset`;
    non-interactive sessions abort before deleting anything), total wipe
    of local state (store + regenerable caches; never source,
    `node_modules`, the lockfile or git history), optional `--reseed`.
  - `doctor.mjs` — pass/warn/fail diagnosis per item: node, pnpm,
    corepack, disk, install, build, store (including a byte-level
    comparison against the deterministic corpus), web port. Exit 1 only
    on FAIL.
  - `tests/` — a self-contained `node --test` runner (zero deps):
    66 deterministic tests — pure-logic suites (CLI parsing,
    prerequisites, confirmation gate, wipe plan, doctor diagnosis,
    store port semantics) plus thin integration wrappers that spawn the
    real commands.
- **`docs/getting-started/`** — the quickstart (fresh machine → running
  local Arena with Demo mode in the smallest honest number of steps),
  the local-mode contract (`local = fakes, no providers, no billing`)
  and the troubleshooting map (symptom → doctor line → fix).
- **`release/local/`** — this profile record: what ships, what is
  intentionally absent, the release checklist.

### Product truths enforced by this release

1. Install is honest: prerequisites stated exactly; failures are early,
   actionable, never deep stack traces.
2. Demo state is not customer state: seeded data is identified (tenant,
   labelling contract, corpus hash) and never enters a hosted/customer
   posture — the seed command targets the local fake store only.
3. Reset is total and explicit: confirmation gate + wipe of all local
   state; nothing partial is silently kept; source is never touched.
4. No billable anything by default: local mode runs entirely on local
   fakes with zero credentials; provider wiring is documented as an
   explicit opt-in (docs/deployment/free-tier-architecture.md).
5. The first-run experience hands the developer the deterministic Demo
   mode as the default path (`/demo`).

### Verified

- All four commands exercised end-to-end on a clean machine simulation:
  `install` (prereq checks + install + build + verify),
  `seed` (idempotent double-run), `doctor` (healthy verdict, 8 pass /
  0 warn / 0 fail), `reset` (total wipe with protection sentinels +
  reseed path).
- `node scripts/product/tests/run-tests.mjs`: 66/66 pass.
- Repository gates at the release SHA: governance, boundary, typecheck,
  lint, test, build — green (numbers in the B016 completion report).

### Known limitations

- The reset wipe scope keeps `node_modules` by design (dependencies are
  not state); a from-scratch dependency rebuild is
  `node scripts/product/install.mjs`.
- The doctor web-port probe reports "listening" for ANY process bound
  to `:3000` — it cannot distinguish Arena's dev server from another
  application (documented in troubleshooting.md).
- Windows is untested; the workflow targets the POSIX shells CI runs.
