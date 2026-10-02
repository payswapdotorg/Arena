# The Arena product-validation runbook (B017)

How to run the FULL product validation suite on a clean machine, what
output to expect, and how to interpret it. Everything below is
evidence-producing: every check maps to a named product behavior with a
machine-readable pass/fail (see `tests/ux/manifest.json`).

## 0. Prerequisites

| Requirement | Why |
| --- | --- |
| Node.js >= 22 < 23 (the repo's `engines` field, enforced `engine-strict`) | the workspace install + type-stripping product scripts |
| pnpm 10.34.5 (pinned via `packageManager`; `corepack enable` or a global install of the exact pin) | the workspace toolchain |
| ~2 GiB disk, no provider accounts, no credentials | the local posture is a fake store — zero providers |
| OPTIONAL: Playwright + Chromium on the host (`npm i -g playwright && playwright install chromium`, resolved via `ARENA_PLAYWRIGHT_MODULE` or the global npm prefix) | the REAL-browser viewport checks; without it they self-skip and the static overflow analysis still runs |

## 1. Clean-machine flow

```bash
git clone https://github.com/payswapdotorg/Arena.git arena && cd arena
corepack enable                                   # or: npm i -g pnpm@10.34.5
pnpm install                                      # workspace install
pnpm build                                        # produces apps/web/.next (needed by the served layers)

# local product sanity (B016): install -> seed -> doctor
node scripts/product/seed.mjs                     # deterministic demo corpus into the local fake store
node scripts/product/doctor.mjs                   # environment diagnosis (exit 0 = no FAILED items)

# the B017 product E2E battery (lifecycle walk + role-switch + determinism + served HTTP walk)
node tests/product-e2e/run.mjs                    # 28 tests

# the B017 UX/operational conformance battery (routes, truth labels, states, raw JSON, viewport, operations)
node tests/ux/run.mjs                             # 46 tests

# teardown (optional — both runners already clean up after themselves)
node scripts/product/reset.mjs --yes              # wipes .arena-local + regenerable caches
```

Both runners are **self-contained**: they typecheck their battery
through apps/web's typescript, boot the BUILT app on localhost
(`next start`, ports 31317 / 31318 — no network beyond localhost), run
their suites through apps/web's vitest with `--root`, and ALWAYS clean
up (`POST /demo/reset` + server stop) even on failure. They are not
pnpm workspace projects (the `tests/*` precedent — the workspace root
does not include `tests/*`, and a root-manifest edit is forbidden), so
`pnpm test` does not pick them up: run them through their `run.mjs`
entry points exactly as above.

`--no-serve` runs only the composition-layer suites (useful on a
machine without a build): the served/browser suites then self-skip and
the runner says so.

## 2. Expected output

`node tests/product-e2e/run.mjs` — expect:

```
[product-e2e] typecheck: clean
[product-e2e] serve: ready on http://localhost:31317
[product-e2e] run: vitest run --root tests/product-e2e
 Test Files  4 passed (4)
      Tests  28 passed (28)
[product-e2e] cleanup: POST /demo/reset (demo state reseeded to the frozen corpus)
[product-e2e] cleanup: next start stopped
```

`node tests/ux/run.mjs` — expect:

```
[ux-battery] typecheck: clean
[ux-battery] serve: ready on http://localhost:31318
[ux-battery] browser layer: Playwright module found — the real-browser viewport checks will run
[ux-battery] run: vitest run --root tests/ux
 Test Files  6 passed (6)
      Tests  46 passed (46)
[ux-battery] cleanup: POST /demo/reset (demo state reseeded to the frozen corpus)
[ux-battery] cleanup: next start stopped
```

(46/46 includes the UX-VIEWPORT-01 characterization tripwires — see the
interpretation guide below. Without Playwright the browser layer
self-skips and the total drops accordingly; the runner prints which
layer ran.)

Wall-clock on the delivery machine: the product-E2E battery runs in
~14s, the UX battery in ~15s (server boot + 30+ page loads + two
Chromium viewport sweeps dominate).

## 3. Interpretation guide

**Determinism**: the batteries are deterministic by construction —
frozen B006 corpus, injected fixed timestamps on the flow runtime, no
network beyond localhost. A re-run must produce identical results. A
determinism failure (`determinism.test.ts`) means the corpus or a
composition path drifted — look at the corpus-hash assertion first.

**Failure output names the step, the surface and the expected-vs-actual**
(e.g. `mobile-390x844 /demo/evaluation: document scrollWidth must not
exceed clientWidth: expected 840 to be less than or equal to 390`, with
the offending element named). The regression manifest
(`tests/ux/manifest.json`) maps every check to the surface that OWNS
the behavior — start triage there.

**The UX-VIEWPORT-01 tripwires** (in `viewport.test.ts`): the battery
KNOWS about a systemic mobile-only table overflow on the demo surfaces
(the `role="region"` scroll wrappers exist but their CSS never sets
`overflow-x: auto`). Those pages are asserted AS THE CURRENT DEFECTIVE
STATE. Two outcomes matter:

- a tripwire page FAILS with "still overflows at 390px … KNOWN DEFECT":
  nothing changed — the defect record is intact;
- a tripwire page fails with "expected false to be true" or the strict
  "scrollWidth must not exceed clientWidth" message: SOMEONE FIXED a
  surface — remove that page from `KNOWN_OVERFLOW_PAGES` so the strict
  expectation applies from then on. The tripwire exists precisely so
  the defect cannot be silently forgotten.

**Port conflicts**: both runners accept `--port N`. The servers bind
localhost only and are killed by the runners' cleanup; a stale server
from an interrupted run can be killed manually (`lsof -ti :31317`).

**The B016 parity check** (`determinism.test.ts`, last suite) spawns
the REAL `scripts/product/seed.mjs` against a scratch state dir and
asserts the seeded corpus hash equals the app demo runtime's corpus
hash — proving the app's demo mode and the B016 local store seed are
ONE corpus. The scratch dir is wiped by the test.

**Reset semantics** (product truth): `POST /demo/reset` drops and
reseeds the CORPUS records; guided-walk writes (cases you started
through the forms) persist until the server process restarts — the
process restart IS the total reset, and both runners perform it after
every run. This is asserted, not assumed (`served-walk.test.ts`, final
suite).

## 4. What the batteries do NOT cover (honest limits)

- **No live hosted-provider verification**: the hosted posture is
  B015's credential-free dry-run battery; B017 runs against the local
  serving path only (no credentials exist at this layer by design).
- **B011 replay / B013 marketplace surfaces do not exist at this base
  SHA** (AUTHORIZED, not merged): the lifecycle walk covers Trajectory
  through the B006 narrative steps and the canonical case history, not
  a dedicated replay viewer; `/marketplace` is still the B001 stub and
  is asserted as a reachable stub.
- **Keyboard-usable**: Tab reachability + interactive-element focus are
  asserted; a full keyboard-only walkthrough of every flow is future
  work (recorded in the completion matrix).
