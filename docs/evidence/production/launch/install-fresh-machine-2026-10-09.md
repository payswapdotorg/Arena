# P008 follow-up — Fresh-machine installation run log (launch-day evidence, Linux leg)

- **Work order:** post-P008 release-gate follow-up (the launch-checklist Gate A row 1 / Gate F
  row 8 recorded next step: "TL executes" the fresh-machine install and attaches the log).
- **Governing rule:** `spec/post-roadmap-release-gate.md` §3 (DEMONSTRATED-LIVE vocabulary:
  commands, logs, resource IDs, timestamps) and §9 (dated probes carry their own dates; no
  evidence rewritten after the fact).
- **Run window:** 2026-10-09T15:00:27Z (first attempt — honest prereq failure) and
  2026-10-09T15:04:20Z–15:13:24Z (completed run). All timestamps UTC.
- **Command:** `node scripts/product/install.mjs` (B016; plain Node, zero external deps).

## Environment (stated exactly — the honesty preamble)

| Item | Value |
|---|---|
| Host class | sandboxed Linux x64 container (Ubuntu-class), 4 GiB RAM class, rootfs 9.9 GiB |
| Node | v22.22.0 (`/home/z/node22/bin/node`) — satisfies engines `>=22 <23` |
| pnpm | 10.34.5 via the user global npm prefix — matches the `packageManager` pin exactly |
| Source tree | **fresh `git clone` from `origin` (GitHub)** at `04e6b6121ea0a8398fd7a0d4ab559b14b5ff3c25` (main tip at run time) — no local state transferred |
| pnpm store | **shared, warm** content-addressable store (`reused 193, downloaded 0` — packages were NOT re-fetched from the registry in this run) |
| Cold-registry coverage | the CI Battery workflow installs from the registry on a **fresh GitHub runner** on every push — green at `44b8577` and `04e6b61` (run 37944377971-class); that is the cold-Linux leg |
| Build cache | **none** — `turbo` reports `0 cached, 123 total` (every task a cache miss; a true cold build, 8m58s) |
| Not exercised | macOS and Windows (no such hosts in this environment — those legs remain OPEN, owned by the release owner) |

## First attempt — the honest prerequisite failure (2026-10-09T15:00:27Z)

```
[arena-install] step 1/4: checking prerequisites…
[arena-install]   PASS  node v22.22.0 satisfies engines >=22 <23
[arena-install]   PASS  pnpm 10.34.5 (packageManager pin)
[arena-install]   INFO  corepack 0.34.0 available
[arena-install]   FAIL  only 1.8 GiB free (< 2.0 GiB recommended)
[arena-install] FAILED: only 1.8 GiB free (< 2.0 GiB recommended)
  next: free up disk space and re-run
EXIT_STATUS=1
```

The installer failed EARLY with an actionable message — exactly its designed behavior. The
disk pressure was sandbox clutter (stale recovery copies under `/tmp`, `turbo` caches and
merged worktrees), not a product defect; ~2.5 GiB was reclaimed and the run repeated.

## Completed run (2026-10-09T15:04:20Z → 15:13:24Z) — verbatim console

```
[arena-install] step 1/4: checking prerequisites…
[arena-install]   PASS  node v22.22.0 satisfies engines >=22 <23
[arena-install]   PASS  pnpm 10.34.5 (packageManager pin)
[arena-install]   INFO  corepack 0.34.0 available
[arena-install]   PASS  4.3 GiB free (>= 2.0 GiB recommended)
[arena-install] step 2/4: pnpm install (workspace dependencies)…
Scope: all 124 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +193
Progress: resolved 193, reused 193, downloaded 0, added 193, done
Done in 3.1s using pnpm v10.34.5
[arena-install] step 3/4: pnpm build (workspace build outputs)…
   • Running build in 123 packages
   • Remote caching disabled
   ... 123 tasks, all cache misses (full cold-build log retained; condensed here —
       the verbatim full log is reproducible with the command above) ...
 Tasks:    123 successful, 123 total
Cached:    0 cached, 123 total
 Time:     8m58.083s
[arena-install] step 4/4: verifying the workspace…
[arena-install]   PASS  build outputs present (packages/demo, packages/persistence)
[arena-install]   PASS  deterministic demo corpus verified: 5 records · tenant arena-demo · hash summary 4dfd1acd
[arena-install] done — Arena is installed and verified (local mode: zero providers, zero credentials).
EXIT_STATUS=0
```

(One `sharp@0.34.5` build-script warning was raised by pnpm's script-allowance policy and
one package printed a `turbo.json` outputs-key warning — both are pre-existing, benign, and
visible in the CI Battery logs on main as well; neither affects the install result.)

## What this run proves (and does not prove)

- **DEMONSTRATED-LIVE (this transcript):** the B016 installer takes a fresh clone of main
  `04e6b61` from zero to a verified local-mode install on Linux x64 — prereq checks honest
  (including a real disk-space failure), 124 workspace projects installed, 123/123 build
  tasks executed cold, and the deterministic demo corpus seeds to its stable hash
  `4dfd1acd` with zero provider accounts and zero credentials.
- **Covered by CI (AUTOMATED-TEST-ONLY class for the cold-registry leg):** the truly
  cold install (registry fetch on an ephemeral runner) runs green in the Battery workflow
  on every push — including at the RC `44b8577` and at `04e6b61`.
- **NOT claimed:** macOS and Windows legs (never exercised anywhere — remain OPEN with the
  release owner as owner); no claim that the sandbox equals a customer machine (kernel,
  filesystem and package-registry locality differ — the transcripts record what ran, and
  the reproducibility note is the command itself).

**Reproducibility:** on any Linux host with Node 22 and pnpm 10.34.5:
`git clone https://github.com/payswapdotorg/Arena && cd Arena && node scripts/product/install.mjs`
