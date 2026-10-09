# P008 follow-up — Fresh-browser UX walkthrough battery output (launch-day evidence, output leg)

- **Work order:** post-P008 release-gate follow-up (launch-checklist Gate F row 10's recorded
  next step: "run `node tests/ux/run.mjs` on a browser-capable host" and attach the output;
  Gate F row 10's output was `pending launch-day evidence`).
- **Governing rule:** `spec/post-roadmap-release-gate.md` §3/§9 — fresh dated probe, no
  historical evidence rewritten, claims match the evidence class exactly.
- **Run window:** 2026-10-09T15:14:44Z–15:14:57Z (UTC). Command: `node tests/ux/run.mjs`.

## Environment (stated exactly)

| Item | Value |
|---|---|
| Host | the same sandboxed Linux x64 container, same **fresh clone** of main `04e6b61` as the installation transcript (`docs/evidence/production/launch/install-fresh-machine-2026-10-09.md`) — the walkthrough ran against the SAME freshly-built tree (apps/web/.next produced by the cold 123/123 build minutes earlier) |
| Browser | **real headless Chromium** (Playwright `chromium.launch({ headless: true })`), resolved through `ARENA_PLAYWRIGHT_MODULE=/home/z/.npm-global/lib/node_modules/playwright/index.mjs` (the global npm prefix install; the repo itself carries no Playwright dependency — B017 posture) |
| Served layer | the runner served the BUILT app via `next start` on an ephemeral port and pointed the served-layer suites at it (`ARENA_UX_BASE_URL`); cleanup re-seeded demo state via `POST /demo/reset` and stopped the server |
| Runner stages | (1) typecheck through apps/web's typescript; (2) serve the built app; (3) vitest over the six suites; (4) cleanup |

## Invocation disclosure (both attempts, honestly)

- **First invocation 15:14:10Z — EXIT_STATUS=1:** `ARENA_PLAYWRIGHT_MODULE` was pointed at
  the package **directory**; the dynamic ESM import of a directory file URL cannot resolve
  the package entry, so the three real-browser suites failed at import time (`Cannot find
  module 'file:///…/node_modules/playwright'`). This was an environment-variable mistake by
  the operator, **not a product failure** — no product code changed between attempts.
- **Second invocation 15:14:44Z — EXIT_STATUS=0** with the module pointed at the package
  entry file `index.mjs`. Result below.

## Result (2026-10-09T15:14:44Z, verbatim tail)

```
 ✓ states.test.ts (10 tests) 87ms
 Test Files  6 passed (6)
      Tests  46 passed (46)
 Duration  13.57s
[ux-battery] cleanup: POST /demo/reset (demo state reseeded to the frozen corpus)
[ux-battery] cleanup: next start stopped
EXIT_STATUS=0
```

All six suites green on a fresh tree: no-raw-json, operational, route-reachability, states,
truth-labels, and the **viewport + keyboard suite over real headless Chromium** (mobile and
desktop viewports against the served app; keyboard reachability with visible focus
treatment; the static overflow analysis).

## What this proves (and does not prove)

- **DEMONSTRATED-LIVE (this transcript):** the B017 UX/operational conformance battery runs
  green end-to-end on a fresh clone + fresh cold build of main `04e6b61`, with the
  real-browser layer ACTIVE (not skipped) against the locally served production build, and
  the runner's own cleanup discipline verified (state reseed, server stop).
- **NOT claimed (explicit):** the **human onboarding-clarity judgment** — "understandable
  without Arena terminology" (launch-checklist Gate C row 1) — is a recorded human judgment,
  and no human reviewer was involved in this run. That row remains **OPEN with the release
  owner**; this transcript closes only the Gate F row 10 **output** leg. A human operator
  can perform the walkthrough against the hosted preview (`https://arena-preview-five.vercel.app`,
  serving `04e6b61` per the linkage record) or against a local `pnpm --filter @arena/web dev`.

**Reproducibility:** fresh clone at `04e6b61`, Node 22 + the cold build (see the install
transcript), then `ARENA_PLAYWRIGHT_MODULE=<playwright package entry file> node tests/ux/run.mjs`.
