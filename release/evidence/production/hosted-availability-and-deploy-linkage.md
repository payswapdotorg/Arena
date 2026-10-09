# P008 — Hosted availability re-probe and deployed-artifact ↔ source linkage (hard gate 3)

- **Work order:** P008 (issue #160) · **Governing rule:** `spec/post-roadmap-release-gate.md`
  §4.3 (deployed artifact ↔ source linkage), §5.11 (hosted availability re-probed at release
  time — historical probes are not current availability).
- **Probe window:** 2026-10-09T13:31:18Z–13:40:50Z (fresh timestamps; commands recorded below).
- **Probing environment:** the P008 worktree sandbox (`/home/z/worktrees/P008`, base `efca69b`)
  with the operator credential set (`source /home/z/my-project/scripts/env.sh` — GITHUB_TOKEN,
  VERCEL_TOKEN; token VALUES never recorded, only their presence and the API answers).

## 1. Hosted availability — fresh re-probe (release-gate §5.11)

```bash
# 2026-10-09T13:31:18Z
curl -sS -o /tmp/hosted-home.html -w "HTTP %{http_code} | %{time_total}s | bytes=%{size_download}\n" \
  https://arena-preview-five.vercel.app/
# -> HTTP 200 | 1.550584s | bytes=20879
# served <title>: "Arena — professional AI capability, kept inspectable"

# 2026-10-09T13:40:50Z — route-level availability (GET, no credentials):
# GET /            -> HTTP 200 (1.325224s, 20879B)
# GET /demo        -> HTTP 200 (0.391363s, 97570B)
# GET /operations  -> HTTP 200 (0.292183s, 19413B)
# GET /cases       -> HTTP 200 (0.290974s, 19261B)
# GET /tasks       -> HTTP 200 (0.540594s, 18813B)
# GET /api/health  -> HTTP 404 (0.037468s, 17716B)  — documented architecture note:
#   the product exposes NO dedicated /api/health route (checklist Gate B row; PR #103 note);
#   the launch-gate health surface is the deployment-root 2xx/3xx smoke check, which is green.
```

**Verdict:** the hosted preview URL is LIVE and serving the Arena web app at probe time
(HTTP 200 on the landing, demo, operations, cases and tasks routes). `/api/health` 404s by
design (documented divergence, not an outage).

## 2. Deployed artifact ↔ source linkage (hard gate 3) — the honest record

### 2.1 GitHub deployments API

```bash
# 2026-10-09T13:28:36Z
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/payswapdotorg/Arena/deployments?per_page=5"
# -> [] (empty — the deploy automation does not create GitHub deployment records;
#        the workflow deploys through the Vercel CLI, so the linkage evidence lives in the
#        Vercel API record below, not in GitHub's deployments list)
```

### 2.2 Vercel deployment record (the authoritative linkage)

```bash
# 2026-10-09T13:29Z — project lookup
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects?limit=20"
# -> arena-preview | id=prj_PxNulA41ti7n3uulomMVhiskUPCa | framework=nextjs

# 2026-10-09T13:30Z — latest deployments (any target, newest first)
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_PxNulA41ti7n3uulomMVhiskUPCa&limit=4"
# arena-preview-goob29wms-… | state=READY | created=2026-10-09T06:18:09.706Z | target=production | gitSha=3b129c9e85ae | ref=main
# arena-preview-owjaj60y8-…  | state=READY | created=2026-10-09T06:16:14.313Z | target=production | gitSha=9d2c9bc22817 | ref=main
# arena-preview-c2p85asxp-… | state=READY | created=2026-10-09T04:58:06.183Z | target=production | gitSha=75bb2b4afdbd | ref=main
# arena-preview-dzfqhznum-… | state=READY | created=2026-10-09T04:56:24.980Z | target=production | gitSha=d2f364f5e04a | ref=main

# project record: latestDeployments = READY:3b129c9e85 (newest), READY:9d9c2bc228
# project production domain: arena-preview-five.vercel.app (non-redirect production alias)
```

**The deployed artifact ↔ source linkage, stated exactly:**

| Field | Value |
|---|---|
| Hosted URL | `https://arena-preview-five.vercel.app` (LIVE, HTTP 200 — §1 above) |
| Vercel project | `arena-preview` (id `prj_PxNulA41ti7n3uulomMVhiskUPCa`) |
| Current production deployment | created 2026-10-09T06:18:09.706Z, state READY |
| **Deployed source SHA** | **`3b129c9e85ae614159f02bee9e8ae565b40aab50`** (main; commit "governance: P004 accepted+merged (PR #162, main 9d2c9bc) + P005 accepted+merged (PR #163, main 81dbb0e) — wave-1 2/3 harvested; P002 in flight") |
| Release-candidate base at dispatch | `efca69b` (main head; +1 merge commit after PR #170's `5d9e8a5`) |
| **Linkage gap** | **the hosted deployment does NOT serve `efca69b`** — it serves `3b129c9e`, which is ~14 main commits behind (everything merged after 2026-10-09T06:16Z: P002, P003, the P007 threat-model register, P006, the P007 integrated pass, P002-F1, the TL intake) |

### 2.3 WHY the deployment is stale — the Deploy preview workflow is RED on main

Fresh API record (2026-10-09T13:28Z):

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/payswapdotorg/Arena/actions/workflows/deploy-preview.yml/runs?per_page=40"
# run 37936519700 | efca69b5 | push | failure | 2026-10-09T13:23:42Z | main   <- current head
# run 37936329454 | 5d9e8a51 | push | failure | 2026-10-09T13:22:05Z | main
# ... 10 consecutive failures on main pushes ...
# run 37701503393 | 377e4feb | push | failure | 2026-10-09T07:52:13Z | main   <- first failure
# run 37892662983 | 3b129c9e | push | success | 2026-10-09T06:16:13Z | main   <- LAST GREEN (the deployed SHA)
```

**Failure localization (from the run-37936519700 job log, fetched via the API):** the
`Wiring self-test` job fails at its **"Deploy battery (typecheck / lint / full test / build)"**
step; the `Deploy hosted preview (Vercel Hobby)` job is therefore **skipped** — no deployment
is produced. The failing test:

```
FAIL src/hosted/wiring.test.ts > B015 deterministic hosted bootstrap (migrations -> seed)
     > applies the versioned SQL migrations and the seed exactly once; re-runs are no-ops
AssertionError: expected [ 1, 2, 3, 4, 5, 6 ] to deeply equal [ 1, 2 ]
     Tests  1 failed | 102 passed  (103)      # 2026-10-09T13:25:42Z (GitHub runner)
```

**Local reproduction (this worktree, 2026-10-09T13:31:06Z, Node 22):**

```bash
pnpm --dir deploy install --frozen-lockfile --ignore-workspace
pnpm --dir deploy exec vitest run src/hosted/wiring.test.ts
# -> Test Files  1 failed (1) / Tests  1 failed | 12 passed (13) — same assertion
```

**Diagnosis (recorded for the TL; the fix is outside P008's frozen surfaces — `deploy/*`):**
`deploy/src/hosted/wiring.test.ts` pins the B015-era migration ledger (`[1, 2]`); the
P002-series work added migration versions 3–6 (runtime records + the P002-F1 durable payment
ledger 0006), so the pinned expectation is stale and the wiring self-test — and with it the
whole Deploy preview workflow and the actual Vercel deploy job — has been red on every main
push since `377e4fe` (the P002 merge, 2026-10-09T07:52Z). CI (`ci.yml`, the "Battery" check)
is NOT affected by this — it runs the workspace battery, not the deploy package's wiring test.

### 2.4 Gate disposition (hard gate 3)

**NOT SATISFIED at the gate.** The deployed artifact is provably linked to source SHA
`3b129c9e` (a real, recorded, verifiable linkage — the mechanism works), but the release
candidate (`efca69b` at dispatch; the post-merge main SHA after this PR) is **not** what the
hosted URL serves, and the deploy pipeline that would move it there is currently red. Per
release-gate §6 ("Battery, CI and Deploy preview are green at the release candidate SHA")
and §2 (entry criteria: "CI plus Deploy preview are green on that same SHA"), this is a
NO-GO contributing fact.

**Re-run path (TL, post-merge):**
1. Fix `deploy/src/hosted/wiring.test.ts` to pin the CURRENT migration ledger (`[1..6]`, or
   better: the same versioned expectation the adapter's migration ledger exports) — a
   TL-serialized change on `deploy/*` (outside P008 surfaces).
2. Let Deploy preview run green on the merged main SHA (the final RC).
3. Re-verify the linkage with the exact commands in §2.2 — the newest production deployment's
   `gitSha` must equal the merged RC SHA, and the fresh probe of
   `https://arena-preview-five.vercel.app` must stay HTTP 200.
4. Re-run the P008 gate record (§7 of the release gate: "The gate may be re-run after the
   blockers close").

**Sequencing note (why P008 cannot fix this itself):** deploy-preview triggers on push to
main only; the final RC is the post-merge main SHA of THIS PR, which by definition does not
exist until the TL merges. Even with a green deploy pipeline, the linkage at the true RC can
only be recorded AFTER the merge — this file records the mechanism, the current gap, and the
re-verification commands so the TL (or a re-run P008) can close it in minutes.
