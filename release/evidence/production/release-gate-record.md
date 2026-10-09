# P008 — Release-gate decision record (R1.0): **NO-GO**

- **Work order:** P008 — release evidence, checklist reconciliation and governance gate (issue #160).
- **Governing rule:** `spec/post-roadmap-release-gate.md` (§4 hard gates, §5 minimum evidence
  bundle, §6 GO criteria, §7 NO-GO protocol). The repo is the source of truth for this decision.
- **Decision authority:** the **release owner** (repository administrator / operator) issues
  GO or NO-GO; this record assembles the evidence and applies §6 mechanically. P008 does not
  waive, accept or settle anything in anyone's name.
- **Gate-time window:** 2026-10-09T14:05–14:23Z (all finisher reads/runs below carry these
  fresh timestamps; the worker M1–M3 evidence files carry their own 13:2x–13:4xZ windows and
  were NOT rewritten).
- **Lineage (honest):** the dispatched P008 worker delivered M1–M3 (commit `33a26a2`:
  live-provider re-proof, hosted-availability + deploy-linkage record, branch-protection
  record) and died before the checklist reconciliation, the gate record, the battery and the
  PR. This finisher (task `34-b-finisher`) merged `origin/main` (`4d50ab5`, the TL's deploy
  wiring-fix — the P003-precedent merge commit `40a10be`) and completed M1 (checklist
  reconciliation), M4 (this record) and M5 (battery + PR). No historical evidence file was
  rewritten; this record references the post-fix state.

## 1. Release-candidate SHA

- **Gate-time RC (this branch's head, post-merge of main):**
  `40a10be80aa86ffacaa42f2c7beb2c391facd235` — branch `work/P008-release-evidence`
  (= dispatch base `efca69b` + the worker's evidence commit `33a26a2` + merge of main
  `4d50ab5`, which carries the deploy wiring-fix).
- **Final RC (by construction):** the post-merge main SHA of the P008 PR — it does not exist
  until the TL merges. Battery/CI/deploy-preview green AT THE FINAL RC is therefore a
  post-merge confirmation (§8 re-run criteria); everything this record can prove pre-merge is
  proven at `40a10be` (and its main ancestor `4d50ab5` for CI/deploy-preview runs).
- The branch's only delta vs main `4d50ab5`: the three worker evidence files under
  `release/evidence/production/*` (+465 lines) plus this record and the checklist
  reconciliation — no code, no lockfile.

## 2. Checklist classification census (M1 — `docs/launch-checklist.md`)

69 rows, each classified with exactly one §3 term and linked to committed evidence
(hard gate 5: no unchecked row without class+link; OPEN/BLOCKED rows carry owner+next step):

| Class | Count | Meaning at this gate |
|---|---|---|
| DEMONSTRATED-LIVE | **10** | proven against the real host/provider with committed evidence (live Neon migrations, R2 lifecycle, Upstash coordination, hosted availability, capacity visibility, health surface, zero-credential boots) |
| AUTOMATED-TEST-ONLY | **54** | covered by committed batteries, never claimed live (all Gate C/D/E rows, the automated Gate B/F rows) |
| OPEN | **5** | owner + next step attached (fresh-machine install evidence; onboarding-understandability walkthrough; fresh-browser walkthrough; known-limitations currency/acceptance; the macOS/Windows install leg) |
| BLOCKED | **0** | no checklist row is BLOCKED — the commercial blocker lives in the findings register (F-07) and hard gate 1 |
| WAIVED | **0** | no release-owner written waiver exists in the repo; nothing was waived by P008 or the TL |

## 3. Hard-gate disposition table (§4)

| # | Hard gate | Disposition at gate time | Evidence |
|---|---|---|---|
| 1 | **Commercial boundary** | **NOT SATISFIED — BLOCKED-COMMERCIAL (F-07). NO-GO driver.** The real payment provider, merchant-of-record, payouts, tax, refunds/disputes and jurisdiction responsibilities are unsettled; `DEMO_PROVIDER_POSTURE.executesCustomerMoney = false` is the recorded commercial truth; deterministic payment abstractions and sandbox flows do not satisfy this gate. | `docs/security/post-roadmap/findings-register.md` row F-07 (critical, **BLOCKED**, owner: release owner); `docs/security/post-roadmap/threat-model.md` AC-09; sandbox posture pinned by `tests/security/production/ac09-partial-payment-state.test.ts` (green, fresh) |
| 2 | **Tenant isolation and fail-closed behavior** | **SATISFIED** — verified at service boundaries in the integrated acceptance, not only UI/unit tests: cross-tenant read/write/advance/listing fail closed typed (no existence oracle) in the P007 adversarial battery; the P006 integrated flow proves cross-tenant fail-closed through the public transport; the live-Neon re-proof proves it through the real adapter. | `docs/evidence/production/security/integrated-pass-summary.md` (AC-01/AC-06 rows); `docs/evidence/production/integration/resilience-matrix-transcript.md` (cross-tenant-isolation row); `release/evidence/production/live-provider-reproof-2026-10-09.md` §1(e) (cross-tenant fail-closed on live Neon — DEMONSTRATED-LIVE); fresh re-runs 66/66 + 7/7 at the RC |
| 3 | **Deployed artifact ↔ source linkage** | **MECHANISM PROVEN · PIPELINE REPAIRED · NOT SATISFIED FOR THE FINAL RC (by construction).** The linkage mechanism works (Vercel API record → gitSha). The stale deployment diagnosed by the worker (`3b129c9e`, 14 commits behind, deploy-preview red since `377e4fe`) is FIXED: the TL's `4d50ab5` repaired the wiring self-test (the pin now derives from `SQL_MIGRATION_SOURCES`), deploy-preview run **37941158560 SUCCESS** on `4d50ab5` (2026-10-09T14:01:56Z), and production now serves `4d50ab5` (post-fix state below). The final RC is the post-merge main SHA of this PR — its linkage can only be recorded AFTER the TL merges; the re-verification commands are §6. | `release/evidence/production/hosted-availability-and-deploy-linkage.md` (worker diagnosis, as-found) + §3.1 below (finisher post-fix reads) |
| 4 | **Branch protection** | **NOT SATISFIED — NO-GO contributing fact.** main is NOT protected (fresh admin-scoped reads at gate time, 2026-10-09T14:22:53Z: `GET /branches/main/protection` → HTTP 404 "Branch not protected"; `branches/main` → `protected: false`, no required checks). The exact protection-enable payload is recorded for the operator; the TL executes it post-merge (it cannot be waived by the TL). | `release/evidence/production/branch-protection-record.md` (worker record §1–§4 + finisher re-read above) |
| 5 | **Checklist completeness** | **SATISFIED** — every row of `docs/launch-checklist.md` carries exactly one §3 class + a committed evidence link (census §2); OPEN rows carry owner+next step; no historical evidence was rewritten (the worker's diagnosis files stand as-found; this record carries the post-fix state). | `docs/launch-checklist.md` (the M1 reconciliation) |

### 3.1 Post-fix linkage state (finisher reads, 2026-10-09T14:2xZ)

```bash
source /home/z/my-project/scripts/env.sh
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_PxNulA41ti7n3uulomMVhiskUPCa&limit=4"
```

| Field | Post-fix value (finisher read) |
|---|---|
| Newest production deployment | `dpl_FVijfWSVGadW9EjDCfvVyzSLBqVf` — state **READY**, target **production**, created **2026-10-09T14:03:22Z** |
| Deployed source SHA | **`4d50ab506380b5a8be3faf99732e04544e1d5a12`** (= main; the deploy wiring-fix commit) |
| Previous production deployment | `dpl_6vAfT5DLajVF…` READY `3b129c9e85ae…` created 2026-10-09T06:18:09Z (the stale SHA the worker diagnosed) |
| deploy-preview workflow | run **37941158560** on `4d50ab5` — **completed / success** (2026-10-09T14:01:56Z); the 10 consecutive failures on main (`377e4fe`…`efca69b`) are history |
| Hosted URL fresh probe | `https://arena-preview-five.vercel.app` — `GET /` 200 (20879B), `/demo` 200 (97570B), `/operations` 200 (19413B, auth-required session gate rendered), `/cases` 200 (19261B), `/tasks` 200 (18813B), `/demo/operations` 200 (116396B — the capacity board renders: 16 capacity rows, AVAILABLE/DEGRADED/DISABLED postures, fail-closed note) |

**Stated exactly:** production serves `4d50ab5` — the newest main SHA at gate time, i.e. the
deploy pipeline is unblocked and current — but the FINAL RC (post-merge main SHA of this PR)
is not yet deployed because it does not yet exist. Hard gate 3 is therefore NOT SATISFIED at
gate time and closes only through §6's post-merge re-verification.

## 4. Minimum evidence bundle (§5) — item-by-item check

| §5 item | Exists | Artifact(s) |
|---|---|---|
| 1. Durable runtime (P002) | ✅ | `release/evidence/production/live-provider-reproof-2026-10-09.md` §1 (live: migrations 1..6 from zero, escalation persisted+read back, hard-restart resume, deterministic replay) + `deploy/runtime/EVIDENCE.md` + `docs/evidence/production/integration/composition-embedded-postgres-transcript.md` |
| 2. Neon direct migration/connectivity (P002/P004) | ✅ | re-proof §1 (dedicated project `arena-p008-evidence` / `spring-waterfall-59948079`, fresh branch, real HTTP driver through the production composition — not project listing) |
| 3. R2 object lifecycle (P004) | ✅ | re-proof §2.1 + `docs/evidence/production/providers/r2/object-lifecycle.md` (write/head/read+download/digest/immutable-replay/delete; retention honestly NOT CLAIMED — no port op; register F-04b) |
| 4. Upstash coordination (P004) | ✅ | re-proof §2.2 + `docs/evidence/production/providers/upstash/coordination-semantics.md` (lease/idempotency/rate-limit/cache with server-side TTL; queue honestly absent from the port — F-04c) |
| 5. Public transport (P003) | ✅ | `tests/api-host` battery (fresh 2 files / 20 tests: HTTP+MCP+signed-webhook lifecycle, auth/tenant mismatch, idempotent replay/conflict, forgery, timeout, retry/dedupe, /healthz) + the P006 public-flow transcripts — class AUTOMATED-TEST-ONLY (real local host, not the hosted deployment) |
| 6. Web routes (P005) | ✅ | `docs/evidence/production/ux/route-inventory.md` (S-01/S-02 mounted; S-03 real API routes; R-084 intentionally non-UI; `/tasks` fixed — L-007) |
| 7. Integrated acceptance (P006) | ✅ | `docs/evidence/production/integration/*.md` (5 transcripts at `c207d01`: generic client + Epoch adapter pass the IDENTICAL public flow; restart, duplicate, concurrency, timeout, outage+recovery; no real money in CI) + fresh re-run 5 files / 7 tests green at the RC |
| 8. Security/privacy/resilience (P007) | ✅ | `docs/security/post-roadmap/threat-model.md` + `findings-register.md` (12 rows with severity+disposition; F-08/F-09 FIXED with flipped regression pins) + `tests/security/production` (fresh 13 files / 66 tests) + `tests/resilience/production` (fresh 1 file / 6 tests) |
| 9. Checklist reconciliation (P008) | ✅ | `docs/launch-checklist.md` (M1 — census §2 above) |
| 10. Recovery and limitations record | ✅ (with an OPEN currency note) | findings-register (current at `5d9e8a5`), every evidence file's honest-limitations section, `docs/LLM-ARCHITECT-FINAL-HANDOFF.md`, `docs/release/product/*` statements (B018/B019-dated — currency/acceptance at the final RC is the release owner's pending decision, checklist Gate F row 10) |
| 11. Hosted availability re-probed at release time | ✅ | `release/evidence/production/hosted-availability-and-deploy-linkage.md` §1 (worker, 13:31–13:40Z) + §3.1 finisher probes (14:2xZ) — DEMONSTRATED-LIVE |
| 12. Branch protection record | ✅ (record exists; gate NOT SATISFIED) | `release/evidence/production/branch-protection-record.md` (admin-scoped reads: protection ABSENT; §4 operator payload) + the finisher re-read in §3 above |

## 5. Honesty notes (§9 compliance)

- The worker's three diagnosis files stand as-found (the stale-deployment and red-pipeline
  diagnoses were true at their capture time); this record carries the post-fix state —
  nothing was rewritten after the fact.
- No fabricated protection or deploy confirmation: hard gate 4 is recorded NOT SATISFIED from
  a fresh admin-scoped 404; hard gate 3's post-fix state is recorded from the Vercel API read,
  and the final-RC linkage is explicitly pending.
- AUTOMATED-TEST-ONLY rows support no live claim anywhere in this record; the checklist's
  checked-AUTOMATED-TEST-ONLY boxes are not live-behavior claims.
- Nothing is WAIVED; F-07 is not settled, accepted or downgraded by P008 or the TL.

## 6. Battery evidence (M5 — exact numbers, run at the gate-time RC `40a10be`)

**Workspace six-gate battery (repo root, Node 22 v22.22.0):**

| Gate | Result | Freshness |
|---|---|---|
| `pnpm run check:governance` | PASS — `[governance] check: clean` (diff base `4d50ab5`, 3 changed paths, 0 active work orders) | fresh |
| `pnpm run check:boundary` | PASS — `[boundary] check: clean` (B1–B4 hold) | fresh |
| `pnpm run typecheck` | PASS — **123/123** tasks | FULL TURBO cache replay — inputs content-identical to main `4d50ab5` (the branch delta vs main is markdown evidence only, outside all workspace inputs); disclosed |
| `pnpm run lint` | PASS — **123/123** tasks | FULL TURBO cache replay — same disclosure |
| `pnpm run test` | PASS — **123/123** tasks | FULL TURBO cache replay — same disclosure |
| `pnpm run build` | PASS — **123/123** tasks | FULL TURBO cache replay — same disclosure (no @arena/web OOM; `apps/web/.next/BUILD_ID` present) |

**Deploy package battery (the branch carries the `4d50ab5` wiring-fix):**
`cd deploy && pnpm run test` → **11 files / 103 tests PASS** (fresh, 2026-10-09T14:10Z —
including the repaired `src/hosted/wiring.test.ts` whose B015-era stale pin was the
deploy-preview red root cause).

**Specialist batteries (fresh at the RC, 2026-10-09T14:11–14:20Z):**
- P006 integrated acceptance — `node tests/integration/production/run.mjs` → **5 files / 7 tests green** (integration-production 4/5 + epoch-host-integration 1/2).
- P007 adversarial — `node tests/security/production/run.mjs` → **13 files / 66 tests green** (AC-01…AC-14, F-08/F-09 pins flipped).
- P007 resilience — `node tests/resilience/production/run.mjs` → **1 file / 6 tests green**.
- Product E2E — `node tests/product-e2e/run.mjs` → typecheck clean, **4 files / 28 tests green** (served layer over `next start`).
- UX conformance — `node tests/ux/run.mjs` → typecheck clean, **6 files / 46 tests green** (real headless Chromium viewport/keyboard layer included; UX-VIEWPORT-01 root-fixed at `a34a1e0`).
- Performance — `tests/performance` → **2 files / 18 tests green**.
- Epoch E2E — `examples/epoch-e2e` battery → **2 files / 17 tests green**.
- Public transport — `node tests/api-host/run.mjs` → **2 files / 20 tests green**.
- Runtime host (zero-credential path) — `node tests/runtime-host/run.mjs` → **2 files / 6 tests green + 1 live-Neon self-skip** (the live path's current proof is the worker's fresh run at `efca69b`: 3 files / 7 tests, live-Neon 24.6s — re-proof §1; runtime-host inputs unchanged since).

**Live-provider legs (worker M1, 2026-10-09T13:36–13:37Z, base `efca69b`):** hosted-provider
battery 6 files / **41 passed + 2 skipped** (app-boot skipped at probe time; covered by the
committed P004 evidence) + live-Neon runtime battery 3 files / 7 tests — full transcripts in
`release/evidence/production/live-provider-reproof-2026-10-09.md`.

**CI/deploy-preview on main:** CI run **37941158549** success at `4d50ab5`;
deploy-preview run **37941158560** success at `4d50ab5`. (The final-RC runs happen post-merge.)

## 7. THE VERDICT — **NO-GO** (§6 applied mechanically)

GO requires ALL of: zero BLOCKED rows · every row classified+linked · every hard gate
satisfied-or-waived-in-writing · battery/CI/deploy-preview green at the RC · claims matching
evidence classes. Unmet at gate time:

1. **Zero BLOCKED rows — UNMET:** findings-register **F-07** is BLOCKED (BLOCKED-COMMERCIAL).
   (The checklist itself has 0 BLOCKED rows; the register row is the blocker of record.)
2. **Every hard gate satisfied or waived — UNMET:** hard gate 1 (commercial boundary)
   NOT SATISFIED; hard gate 4 (branch protection) NOT SATISFIED; hard gate 3 (final-RC
   linkage) NOT SATISFIED at gate time by construction.
3. **Battery/CI/deploy-preview green at the (final) RC:** green at the gate-time RC `40a10be`
   and at main `4d50ab5`; the final RC exists only post-merge — its confirmation is a §8 item.

Every other §6 criterion is met (checklist completeness — hard gate 5; claims match evidence
classes — §5 above). Per §7, each blocking item is a tracked item with an owner and next step:

| # | Blocking item | Owner | Next step (what closes it) |
|---|---|---|---|
| B-1 | **F-07 commercial boundary** (hard gate 1) | **Release owner** | Settle the real payment provider, merchant-of-record, payouts, tax, refunds/disputes and jurisdiction responsibilities IN WRITING and record the settlement in the repo (register row F-07 next step); until then keep all payment surfaces sandbox/test-only and `executesCustomerMoney = false`. Nobody else may settle or waive this. |
| B-2 | **Branch protection absent** (hard gate 4) | **Operator (repository administrator); TL executes post-merge** | Apply the recorded payload (`release/evidence/production/branch-protection-record.md` §4: required check "Battery (install / governance / boundary / typecheck / lint / test / build)", `strict: true`, `enforce_admins: true`, 1 approving review, no force-pushes/deletions), then re-run the §1 reads — they must answer 200 with the protection payload and `protected: true` — and commit the confirmation (re-run of the record's §1). Consider adding the Deploy preview contexts as required checks once green at the merged RC. |
| B-3 | **Final-RC deployed↔source linkage** (hard gate 3) | **TL (post-merge)** | Let deploy-preview run green on the merged main SHA (the final RC); then re-verify: `curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?projectId=prj_PxNulA41ti7n3uulomMVhiskUPCa&limit=4"` — the newest production deployment's `gitSha` MUST equal the final-RC SHA (state READY), and the fresh probe of `https://arena-preview-five.vercel.app` must stay HTTP 200 (§3.1's exact commands). |

**Re-run criteria (§7 "the gate may be re-run after the blockers close"):** when B-1's written
settlement is committed, B-2's protection read answers 200/`protected: true`, and B-3's
linkage shows the final-RC SHA deployed+READY with the hosted probe green and CI +
deploy-preview green at that SHA, the gate is re-run: refresh the checklist census (the 5 OPEN
rows close through their recorded next steps or release-owner dispositions), re-derive this
record's hard-gate table, and re-issue the verdict. The OPEN checklist rows (fresh-machine
install evidence, onboarding/browser walkthroughs, limitations currency) are not §6 NO-GO
drivers by themselves, but the release owner should disposition them at the re-run (they are
the human-evidence legs of the bundle).

**Release artifacts (§8) — NOT produced (there is no GO):** no git tag, no GitHub Release,
no release-notes claims. The final battery output is this record (§6) referenced from the PR;
the deployed URL ↔ SHA linkage state is recorded in §3.1 (post-fix, pre-final-RC). Frontier
updates (PROJECT-STATE / AI_CONTINUATION status lines) are TL-serialized, not P008's to write.

## 8. TL post-merge actions (recorded for the harvest)

1. Merge the P008 PR after CI (no self-merge was performed by P008).
2. Confirm deploy-preview green on the merged RC and re-verify the linkage (§6 B-3 commands);
   record the final-RC linkage (re-run or amend this record's §3.1 per §9 — dated probes
   carry their own dates).
3. Execute the branch-protection payload (§6 B-2; the operator action recorded by the worker
   in `branch-protection-record.md` §4) and commit the fresh 200 read.
4. Final frontier/governance update (PROJECT-STATE, AI_CONTINUATION, work-order registry) —
   TL-serialized.
5. Route F-07 to the release owner (B-1). **No tag, no GitHub Release — there is no GO.**

## 9. Post-merge TL verification (dated addendum — 2026-10-09T14:5xZ; §9: dated probes carry their own dates; nothing above is rewritten)

The P008 PR was merged by the TL after CI green: **main `44b8577` (merge of PR #171)** — this
is the final release-candidate SHA by construction. The §8 TL post-merge actions, executed
and recorded:

1. **Merge** — done: PR #171 merged at `44b8577` (CI Battery check completed/success on the
   PR head `a22ad8d`; no self-merge by P008).
2. **B-3 (final-RC deployed↔source linkage) — CLOSED, verified live:**
   - CI run on `44b8577`: completed / success (2026-10-09T14:41Z).
   - Deploy-preview run on `44b8577`: completed / success (the wiring self-test + deploy
     battery + Vercel deploy all green — the pipeline repaired by `4d50ab5` held at the RC).
   - Vercel API (the §3.1 exact command): newest production deployment **READY, serving
     `44b85772c2`** (created 1791556958674) — the deployed artifact IS the final-RC SHA.
   - Fresh hosted probe: `GET https://arena-preview-five.vercel.app/` → **HTTP 200**.
   - Hard gate 3 is now fully satisfied at the final RC (mechanism + current deployment +
     green CI/deploy at that exact SHA).
3. **B-2 (branch protection) — executed immediately after this commit:** the TL applies the
   recorded payload (branch-protection-record.md §4: required check
   "Battery (install / governance / boundary / typecheck / lint / test / build)", strict,
   `enforce_admins: true`, 1 approving review, no force-pushes/deletions). The Deploy-preview
   contexts are deliberately NOT required (that workflow triggers on main pushes only —
   requiring it would deadlock PR merges). This commit is the last direct push to main;
   live verification after enablement: `GET /repos/payswapdotorg/Arena/branches/main/protection`
   must answer 200 with the payload and `branches/main` shows `protected: true`. The
   post-enablement 200 read can be committed via PR (the re-run path) — the pre-enablement
   404 read stands dated above.
4. **Final frontier/governance update** — this commit (PROJECT-STATE + AI_CONTINUATION):
   P008 MERGED; the post-roadmap productionization program P000–P008 is COMPLETE as
   delivered; the release gate stands at **NO-GO** with B-1 as the sole remaining
   §6-blocking item.
5. **B-1 (F-07 commercial boundary) — REMAINS OPEN, routed to the release owner.** The
   verdict is unchanged: NO-GO while F-07 is unsettled (§6: zero BLOCKED rows). The gate
   re-run criteria in §7 stand as written.

**Post-merge verdict: NO-GO (B-1 only).** The delivered state: every work order merged;
checklist 69/69 classified; hard gates 2/3/5 satisfied, 4 satisfied-by-live-API-state
(enablement recorded here, verifiable live), 1 open at the release owner. No tag, no GitHub
Release — there is no GO. The gate may be re-run when the F-07 settlement is committed.
