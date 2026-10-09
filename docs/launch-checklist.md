> **P008 reconciliation record (2026-10-09, M1 — supersedes the B019-era warning):** every row
> below is now classified with exactly one `spec/post-roadmap-release-gate.md` §3 vocabulary term
> (**DEMONSTRATED-LIVE / AUTOMATED-TEST-ONLY / OPEN / BLOCKED / WAIVED**) and linked to committed
> evidence. Checkbox semantics after this reconciliation: **checked = the row's reconciled class
> is DEMONSTRATED-LIVE or AUTOMATED-TEST-ONLY** (committed evidence covers the row at the stated
> class); **unchecked = OPEN or BLOCKED** (owner + next step attached). A checked
> AUTOMATED-TEST-ONLY row is never a live-behavior claim (release-gate §3/§6). The historical
> B019 count (7/69) is superseded by the P008 census below. No row was deleted; no historical
> evidence was rewritten.
>
> **Census (69 rows):** DEMONSTRATED-LIVE **10** · AUTOMATED-TEST-ONLY **54** · OPEN **5** ·
> BLOCKED **0** · WAIVED **0** (no release-owner waiver exists in the repo; N/A-style rows are
> recorded as the release owner's pending decision per the OPEN discipline). The register-level
> commercial blocker (findings-register F-07, BLOCKED-COMMERCIAL) is a hard-gate fact, not a
> checklist row — see `release/evidence/production/release-gate-record.md`.
>
> **Battery freshness at the reconciliation head** (`40a10be`, branch `work/P008-release-evidence`
> = `efca69b` + worker M1–M3 evidence + merge of main `4d50ab5`): workspace gates
> governance/boundary clean (fresh) and typecheck/lint/test/build 123/123 (turbo cache replay —
> inputs content-identical to main `4d50ab5`; the branch's only delta vs main is the three
> `release/evidence/production/*` markdown files); deploy battery 11 files / 103 tests (fresh);
> integration 5 files / 7 tests, security 13 files / 66 tests, resilience 1 file / 6 tests,
> product-e2e 4 files / 28 tests, ux 6 files / 46 tests (real headless Chromium), performance
> 2 files / 18 tests, epoch-e2e 2 files / 17 tests, api-host 2 files / 20 tests (all fresh,
> 2026-10-09T14:0x–14:2xZ). Live-provider legs were re-proven 2026-10-09T13:36–13:37Z at base
> `efca69b` (worker M1) — `release/evidence/production/live-provider-reproof-2026-10-09.md`.

# Arena Public Preview Launch Checklist L1.0

## TL finalization record (2026-10-04, B019 launch gate) — historical

The launch gate (B019) is MERGED and the TL-owned boundary is executed:

- **Live hosted preview:** https://arena-preview-five.vercel.app (production
  alias, HTTP 200; deployed by .github/workflows/deploy-preview.yml on push to
  main — wiring self-test + prebuilt build/deploy + smoke-check all green).
- **Providers:** Neon `arena-preview` · R2 `arena-preview-objects` · Upstash
  (existing) · Vercel project `arena-preview` (Next 15.5.27 security intake).
- **Secrets:** runtime env contract on the Vercel project; deploy credentials
  as GitHub repository secrets (fail-closed posture enforced by the workflow).
- **Acceptance machinery:** `deploy/preview` runs the Gate-B battery (hermetic
  dry-run default; live mode via `ARENA_PREVIEW_URL`) — `pnpm --dir deploy/preview run run`.
- **Evidence program:** `docs/launch/evidence-index.md` maps every row below to
  a real artifact or an explicit `TL-owned at the launch gate` /
  `pending launch-day evidence` mark; `release/preview` records the Gate-F set.

The B019-era checkbox snapshot (7/69) is historical; the P008 reconciliation
above is the current state. Unchecked rows carry an owner and a next step.


## Gate A — Local install/use

[ ] Fresh Linux/macOS/Windows-compatible Node 22 environment can install without hidden dependencies.
  - **OPEN** (Linux leg: DEMONSTRATED-LIVE; macOS/Windows legs: OPEN, never exercised) · evidence: the Linux fresh-machine leg now has a committed run log — `docs/evidence/production/launch/install-fresh-machine-2026-10-09.md` (fresh clone of main `04e6b61`, prereq-check → install → 123/123 cold build → deterministic demo corpus hash `4dfd1acd`, EXIT_STATUS=0; first attempt failed the disk prereq honestly, recorded) — and the cold-registry Linux leg is covered green by CI on every push (Battery on fresh GitHub runners, green at `44b8577` and `04e6b61`). macOS and Windows have never been exercised. **owner:** release owner (TL executed the Linux leg 2026-10-09; macOS/Windows legs remain) · **next step:** run `node scripts/product/install.mjs` on fresh macOS/Windows hosts and attach the logs (Gate F row 8 carries the bundle record — `install-001` now exitStatus=0 with the Linux transcript as artifactRef).

[x] Documented single-command developer/demo start path works. — **AUTOMATED-TEST-ONLY** · evidence: `docs/getting-started/README.md` + `docs/getting-started/local-mode.md` (the documented paths, committed); the equivalent built-artifact boot is machine-proven this gate — `tests/product-e2e` and `tests/ux` served layers boot `next start` over the real build (fresh 28/28 and 46/46) and the P004 zero-credential live boot (`docs/evidence/production/providers/capacity/zero-credential-boot.md`) boots the same artifact with zero credentials. No human-follows-the-docs walkthrough is recorded (that judgment is Gate F row 9, OPEN).

[x] Fresh browser opens Arena home. — **DEMONSTRATED-LIVE** · evidence: `docs/evidence/production/providers/capacity/zero-credential-boot.md` (live boot of the production artifact, sanitized env: `GET / → 200` with body) + fresh hosted probe of `https://arena-preview-five.vercel.app/` (HTTP 200, 20879B — `release/evidence/production/hosted-availability-and-deploy-linkage.md` §1 and the finisher re-probe in `release/evidence/production/release-gate-record.md`). Scope: served-content proof (live HTTP); browser-fidelity rendering is covered by the automated real-Chromium layer (`tests/ux/viewport.test.ts`, fresh green) — no human browser session is recorded.

[x] Demo workspace can be entered without provider credentials. — **DEMONSTRATED-LIVE** · evidence: `docs/evidence/production/providers/capacity/zero-credential-boot.md` (built app boots with 19 provider env names removed; `GET /demo → 200`) + `release/evidence/production/live-provider-reproof-2026-10-09.md` §2.5 (fresh re-proof of the zero-credential DISABLED posture at both adapters).

[x] Demo can reset. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/served-walk.test.ts` (`/demo/reset` semantics over the real served app — reset restores the identical frozen-corpus hash) + the product-e2e runner's cleanup contract; fresh run 4 files / 28 tests green at the reconciliation head. No live hosted reset probe is recorded.

[x] Demo covers the full reference chain. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (the read-path story walk Task → Trajectory → Evaluation → Verification → Certification → Release with truth labels; Task/Environment hops in the guided flow) + `determinism.test.ts` (B016 seed parity — the real `scripts/product/seed.mjs` seeds the identical corpus); fresh 28/28. The demo is a local deterministic artifact — no provider operation is involved.

[x] No diagnostics-only route is the default experience. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/route-reachability.test.ts` (UX-ROUTE-02: the first-run landing renders exactly ONE primary action into `/cases`; every nav affordance leads to a real rendering route) + `docs/evidence/production/ux/route-inventory.md` (the reconciled 83-row route tree; the default route `/` is the cockpit mount); fresh 46/46.

## Gate B — Hosted preview

[x] Vercel production deployment is live. — **DEMONSTRATED-LIVE** · evidence: fresh probes 2026-10-09T13:31–13:40Z (worker) and 2026-10-09T14:2xZ (finisher): HTTP 200 on `/`, `/demo`, `/operations`, `/cases`, `/tasks` — `release/evidence/production/hosted-availability-and-deploy-linkage.md` §1 + `release/evidence/production/release-gate-record.md` §3 (post-fix production deployment `dpl_FVijfWSVGadW…` READY serving `4d50ab5`).

[x] Stable public URL recorded in release docs. — **DEMONSTRATED-LIVE** · evidence: the URL `arena-preview-five.vercel.app` is recorded in this file, `spec/PROJECT-STATE.md`, `docs/launch/launch-day-runbook.md` and the Vercel project record (`hosted-availability-and-deploy-linkage.md` §2.2: non-redirect production alias), and the URL itself answers HTTP 200 on fresh probes (§1 + gate record §3).

[x] Neon database bootstraps from versioned migrations. — **DEMONSTRATED-LIVE** · evidence: `release/evidence/production/live-provider-reproof-2026-10-09.md` §1 (fresh 2026-10-09T13:36Z: migrations **1..6 applied from zero** on a fresh branch of the dedicated project `arena-p008-evidence` through the REAL Neon HTTP driver over the production composition; accepted escalation persisted and read back; hard-restart resume; deterministic replay; cross-tenant fail-closed; battery 3 files / 7 tests).

[x] R2 artifact lifecycle works. — **DEMONSTRATED-LIVE** · evidence: `release/evidence/production/live-provider-reproof-2026-10-09.md` §2.1 (fresh 2026-10-09T13:37Z: authorized write → head → read+download (byte-equal) → digest leg → immutable replay → delete → bucket empty again) + the P004 committed transcript `docs/evidence/production/providers/r2/object-lifecycle.md`.

[x] Upstash Redis coordination works. — **DEMONSTRATED-LIVE** · evidence: `release/evidence/production/live-provider-reproof-2026-10-09.md` §2.2 (fresh: lease lifecycle + expiry, idempotency window open/duplicate/conflict/expiry, rate-limit fixed window, cache TTL, namespace isolation — server-side TTL observed live; PING counted as context only) + `docs/evidence/production/providers/upstash/coordination-semantics.md`.

[x] Optional Apify path has a dry run and is never required by the core demo. — **AUTOMATED-TEST-ONLY** · evidence: `deploy/src/hosted/apify.test.ts` + `deploy/src/hosted/dry-run.integration.test.ts` (absent token ⇒ disabled posture; dry-run wiring) — fresh deploy battery 11 files / 103 tests green at the reconciliation head. The never-required leg is additionally DEMONSTRATED-LIVE: the zero-credential live boot (`docs/evidence/production/providers/capacity/zero-credential-boot.md`) runs the whole demo with NO provider credentials at all.

[x] Provider secrets are server-side only. — **AUTOMATED-TEST-ONLY** · evidence: repository secret-scan green (2,366 files — the B019 record in this row) + `deploy/src/hosted/env-contract.test.ts` (fresh, in the 103-test deploy battery) + the hosted env contract on the Vercel project (`hosted-availability-and-deploy-linkage.md` §2.2). Live transcripts corroborate operationally (values never recorded; only env-var NAMES and resource IDs — every transcript in `docs/evidence/production/*` and `release/evidence/production/*`).

[x] Health/readiness checks are live. — **DEMONSTRATED-LIVE** · evidence: the launch-gate health surface is the deployment-root smoke (documented architecture note: the product exposes NO dedicated `/api/health` — PR #103; the worker's probe records `GET /api/health → 404` as the documented divergence), and the deployment root is live-green: fresh HTTP 200 probes (§1 above) + deploy-preview run 37941158560 (success on `4d50ab5`) whose smoke-check gates the deploy. The runtime host's `/healthz` readiness surface (state/ready/capacity/components) is AUTOMATED-TEST-ONLY: `docs/evidence/production/integration/composition-embedded-postgres-transcript.md`.

[x] Provider capacity state is visible. — **DEMONSTRATED-LIVE** · evidence: fresh hosted probe of `GET /demo/operations` (HTTP 200, 116396B) renders the capacity board — 16 `operations-capacity-row` elements with `AVAILABLE`/`DEGRADED`/`DISABLED` statuses, visible ceilings and the fail-closed note (finisher probe, `release/evidence/production/release-gate-record.md` §3); `GET /operations` renders the auth-required/denied session gate (fail-closed — capacity of a real workspace is visible only to its session). Adapter-level capacity probes are DEMONSTRATED-LIVE (`live-provider-reproof-2026-10-09.md` §2.1/§2.2 capacity-probe rows; wrong-credential probes report DEGRADED, never healthy). Honesty note: the `/demo/operations` board is the visibly-labelled deterministic demo posture (all four FT2.0 postures); the session board reads the real B002 capacity contracts through the validated session.

[x] Free-tier exhaustion is fail-closed. — **AUTOMATED-TEST-ONLY** · evidence: `deploy/src/hosted/fail-closed.test.ts` + `deploy/src/hosted/quotas.test.ts` (fresh deploy battery 103/103) + `tests/ux/operational.test.ts` (EXHAUSTED/DISABLED render as fail-closed REFUSAL, no billable fallback — fresh 46/46) + the port-level `PERSISTENCE_CAPACITY_EXHAUSTED` gate (`docs/evidence/production/providers/r2/failure-capacity-matrix.md`). Live quota exhaustion is NOT demonstrated and NOT claimed — findings-register **F-04a** (OPEN): owner deploy/B019 follow-up + release owner; next step: build usage metering or accept the blind spot in writing; either way verify fail-closed under an operator-declared EXHAUSTED state.

[x] No hidden paid fallback exists. — **AUTOMATED-TEST-ONLY** · evidence: `deploy/preview` fail-closed validator + workflow fail-closed posture (the B019 record in this row) + `tests/ux/operational.test.ts` (no-billable-fallback rendered contract) + the persistence taxonomy admits no paid-fallback path (port-level, P004 matrices). Live corroboration (not the primary class): every live provider-failure row fails closed with a typed error and no second destination — `live-provider-reproof-2026-10-09.md` §2.3/§2.4 (wrong credentials, foreign bucket, anonymous access → typed `PERSISTENCE_TRANSPORT_FAILED`).

## Gate C — UX

[ ] First-run onboarding is understandable without Arena terminology.
  - **OPEN** · evidence: the structural affordances are machine-proven (`tests/ux/route-reachability.test.ts` UX-ROUTE-02 — one primary action into `/cases`; truth-label vocabulary closed) and the fresh-browser battery OUTPUT is now attached (`docs/evidence/production/launch/ux-walkthrough-2026-10-09.md` — 6 files / 46 tests green on real headless Chromium over a fresh cold-built tree, served layer active), but "understandable without Arena terminology" remains a human judgment requiring a recorded walkthrough by a human reviewer; no human record exists. **owner:** release owner · **next step:** a human operator records the fresh-browser walkthrough (against the hosted preview serving the RC, or a local dev boot) with an onboarding-clarity pass — the attached transcript is the machine leg and explicitly does not claim the human judgment.

[x] Home is a role-aware capability cockpit. — **AUTOMATED-TEST-ONLY** · evidence: cockpit view tests (`apps/web/src/cockpit/cockpit-home-view.test.tsx`, workspace battery) + `tests/ux/truth-labels.test.ts` (UX-TRUTH-02) + `docs/evidence/production/ux/route-inventory.md` (home = the cockpit mount over the B003/B004 seams).

[x] Persistent workspace + role switcher exists. — **AUTOMATED-TEST-ONLY** · evidence: cockpit view tests (workspace selector + `data-arena-role-switcher`, workspace battery).

[x] Multi-role users can switch context without losing safe navigation state. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/role-switch.test.ts` (identity/tenancy preserved, only the projection changes, safe navigation retained — fresh 9/9 within 28/28).

[x] Role switching cannot change authorization. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/role-switch.test.ts` (authorization unchanged across every lens) + `packages/auth/src/session.test.ts` (the session record is carried, never interpreted) + the P007 adversarial rows `tests/security/production/ac01-tenant-isolation.test.ts` / `ac05-api-key-misuse.test.ts` (fresh 66/66).

[x] Same canonical case/body/run has role-specific projections. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/role-switch.test.ts` (same facts/record/corpus hash, different lens, at three layers) + `packages/role-context/src/projections/projection.test.ts` (workspace battery).

[x] Owner flow works. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (guided flow draft → submitted → triaged → active → resolved with legality + append-only history — fresh green).

[x] Agent Builder flow works. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/role-switch.test.ts` (Builder lens) + `apps/web/src/capability/case-view.test.ts` (workspace battery).

[x] Expert flow works. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/expert/workbench.test.ts` + `expert-view.test.tsx` (workspace battery) + the P006 bounded-expert-session rows (intervention actions recorded — `docs/evidence/production/integration/generic-client-full-flow-transcript.md`, fresh battery re-run 7/7).

[x] Researcher flow works. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/research/research-view-model.test.ts` (workspace battery) + `tests/ux/truth-labels.test.ts` (UX-TRUTH-07 composition-scope banner — fresh).

[x] Operator flow works. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/operations/operations-route.test.tsx` (workspace battery) + `tests/ux/operational.test.ts` (fresh).

[x] Marketplace flow works. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/marketplace/marketplace-route.test.tsx` (workspace battery) + `docs/evidence/production/ux/route-inventory.md` §S-02 (`/body-marketplace{,/listings/[listingId],/request-pretraining,/my-listings}` mounted with session/tenant protection).

[x] Body/Substrate/Possession distinction is visually explicit. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/bodies/bodies-route.test.tsx` (workspace battery) + `tests/ux/truth-labels.test.ts` (closed truth-label vocabulary — fresh).

[x] Replay is visibly non-authoritative. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/replay/state-mark.test.ts` + `replay-route.test.tsx` (workspace battery) + `tests/ux/truth-labels.test.ts` + the adversarial live-writeback denial (`tests/security/production/ac13-live-world-writeback.test.ts` — `asLiveMutation` typed REPLAY_AS_LIVE for every kind; fresh 66/66).

[x] Evidence, evaluation, certification and suggestion are visually distinct. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/truth-labels.test.ts` (UX-TRUTH-03 three-way distinction + truth-class legend — fresh).

[x] Loading, empty, error, denied and demo states exist. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/states.test.ts` (UX-STATE-01/02 — honest empties, fail-closed gates, actionable next steps — fresh) + the app-level `loading.tsx`/`error.tsx`/`not-found.tsx` routes.

[x] Mobile layouts work. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/viewport.test.ts` — REAL headless Chromium at 390x844 and 1280x800 (no horizontal overflow on any demo page, responsive zone switching), fresh green at the reconciliation head; the B017-known mobile-overflow defect UX-VIEWPORT-01 was root-fixed at the B017 intake (commit `a34a1e0` — scroll-region rule family; the tripwire list is empty and the strict expectation applies). Scope: automated real-browser measurement — no human mobile-device walkthrough is recorded.

[x] Keyboard navigation works. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/viewport.test.ts` (keyboard reaches real interactive elements with visible focus treatment — real Chromium, fresh) + A11Y-COMP-01 (`apps/web/src/a11y/testing` focus-management battery, workspace test gate).

[x] Reduced motion works. — **AUTOMATED-TEST-ONLY** · evidence: A11Y-COMP-05 (`apps/web/src/a11y` reduced-motion detection, workspace test gate) + `tests/ux/viewport.test.ts` reduced-motion posture (fresh).

## Gate D — Operational conformance

[x] Every critical UI claim maps to a canonical object or explicitly labelled derived state. — **AUTOMATED-TEST-ONLY** · evidence: `tests/ux/truth-labels.test.ts` + `tests/ux/no-raw-json.test.ts` (no raw payload rendering; the corpus-hash digest display is the single documented exception — fresh) + contract generation byte-identity (`pnpm run contracts:generate`, workspace battery).

[x] Role context is never used as an authorization decision. — **AUTOMATED-TEST-ONLY** · evidence: `packages/auth/src/session.test.ts` + `tests/product-e2e/role-switch.test.ts` + the P007 adversarial suites (ac01/ac05 — authorization decided at service boundaries; fresh 66/66).

[x] No client-only mutation can bypass server policy. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/served-walk.test.ts` (foreign Origin → 403; origin-checked POSTs with the 303 redirect contract — fresh) + the S-03 real API routes with CSRF + typed auth (`docs/evidence/production/ux/route-inventory.md` §S-03) + `tests/api-host` auth negatives (typed 401/403 at the public boundary — fresh 20/20).

[x] Correlation/idempotency metadata is preserved across long-running workflows. — **AUTOMATED-TEST-ONLY** · evidence: the P006 integrated transcripts (request id + idempotent replay across a hard restart — `docs/evidence/production/integration/*.md`, committed at `c207d01`, re-run fresh 7/7 at the reconciliation head) + the C001 law battery. Live coordination legs noted: Upstash idempotency windows with server-side TTL are DEMONSTRATED-LIVE (`live-provider-reproof-2026-10-09.md` §2.2).

[x] Job/trajectory/evaluation/verification state is not faked. — **AUTOMATED-TEST-ONLY** · evidence: `services/job-orchestrator` pure state machine tests (workspace battery) + `tests/ux/truth-labels.test.ts` (closed truth-badge vocabulary) + the P006 typed-states rows + the AC-13 replay/writeback denials (fresh 66/66).

[x] Marketplace entitlement does not imply certification. — **AUTOMATED-TEST-ONLY** · evidence: `packages/marketplace-ui/src/certification.test.ts` + `entitlement.test.ts` (workspace battery).

[x] Certification never implies professional licensure. — **AUTOMATED-TEST-ONLY** · evidence: `packages/certification/src/hygiene.test.ts` (`licensure` in the forbidden vocabulary — workspace battery).

## Gate E — Product E2E

[x] Capability Case creation. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (guided-flow creation through the A005 state machine — fresh 28/28) + the P006 public-flow creation rows (`POST /v1/escalations → 201`, committed transcripts; fresh re-run 7/7).

[x] Task compilation. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (Task hop: `compose-task` stores traced TaskSpec proposals — fresh).

[x] Environment run. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (Environment hop: pinned initial environment + case requirements — fresh) + `tests/epoch-e2e/full-loop.test.ts` (typed run artifacts — fresh 17/17).

[x] Expert intervention. — **AUTOMATED-TEST-ONLY** · evidence: `apps/web/src/expert/workbench.test.ts` (workspace battery) + the P006 bounded-expert-session intervention rows (read-context, run-approved-tools, propose-patch, annotate-evidence, signal-tool-gap — committed transcripts, fresh re-run green).

[x] Trajectory capture. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (read-path story walk) + `tests/epoch-e2e/full-loop.test.ts` (trajectories in the typed artifact chain — fresh).

[x] Evaluation. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (read-path Evaluation with truth labels — fresh) + the P006 validation/adjudication rows (recorded verdict, the C009 seam).

[x] Verification. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (read-path Verification — fresh) + the P006 `validationStatus=passed` rows.

[x] Learning experiment. — **AUTOMATED-TEST-ONLY** · evidence: `tests/epoch-e2e/full-loop.test.ts` (capability-gap learning loop: skill draft, learning verdict, gated proposal — fresh 17/17) + the P006 learning-gate rows (unconsented BLOCKED; consented → Q1.0 adopted-with-evidence).

[x] Body version creation. — **AUTOMATED-TEST-ONLY** · evidence: `packages/body-forge/src/forge.test.ts` + `property.test.ts` (deterministic, tamper-detected BodyVersion — workspace battery).

[x] Body/Substrate compatibility. — **AUTOMATED-TEST-ONLY** · evidence: `packages/compatibility/src/evaluator.test.ts` + `registry.test.ts` (workspace battery).

[x] Certification. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (read-path Certification — fresh) + `tests/epoch-e2e/adversarial.test.ts` (certification gates: candidate-channel grant requirement; gap evidence never certifies — fresh).

[x] Release/publication. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/lifecycle-walk.test.ts` (read-path Release — fresh) + the P006 release/payout rows (sandbox DEMO provider, `executesCustomerMoney=false` — demo money only; committed transcripts). Live-money release/publication is BLOCKED-COMMERCIAL by findings-register F-07 (hard gate 1) — no live claim is made or implied by this row.

[x] Epoch adapter consumption. — **AUTOMATED-TEST-ONLY** · evidence: `tests/epoch-e2e/full-loop.test.ts` + `adversarial.test.ts` (fresh 17/17) + the P006 epoch-adapter host-integration battery (the Epoch adapter drives the identical public flow; committed transcript at `c207d01`, fresh re-run 2/2 — `docs/evidence/production/integration/epoch-adapter-full-flow-transcript.md`).

[x] Role-switch regression suite. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/role-switch.test.ts` (fresh 9/9 within the 28/28 product-e2e run).

[x] Hosted/local parity suite. — **AUTOMATED-TEST-ONLY** · evidence: `tests/product-e2e/served-walk.test.ts` (the served app honours the composition-layer contract over real HTTP) + `determinism.test.ts` (B016 seed parity — the real seed command produces the identical corpus hash) — fresh 28/28. Note: the `deploy/preview` Gate-B battery's live hosted mode (`ARENA_PREVIEW_URL`) was not run at this gate; the hosted legs live-probed this gate are the deployment-root + capacity-board + demo routes (Gate B rows 1/8/9).

## Gate F — Release evidence

[x] CI green. — **AUTOMATED-TEST-ONLY** · evidence: CI Battery check green on main `4d50ab5` (run 37941158549, 2026-10-09T14:01:56Z) and on `efca69b` (run 37936520296); the reconciliation-head local six-gate battery is green (gate record §6). The FINAL release candidate is the post-merge main SHA of the P008 PR — CI green at that SHA is the TL's post-merge confirmation (gate record §8 re-run criteria).

[x] Product E2E green. — **AUTOMATED-TEST-ONLY** · evidence: fresh at the reconciliation head — `tests/product-e2e` 4 files / 28 tests, `tests/epoch-e2e` 2 files / 17 tests, P006 integrated battery 5 files / 7 tests (gate record §6).

[x] Accessibility audit green. — **AUTOMATED-TEST-ONLY** · evidence: the B018 a11y conformance battery (`apps/web/src/a11y/testing` — A11Y-COMP-01…06, workspace test gate, inputs-identical cache replay this gate) + `tests/performance/manifest.json` A11Y rows + `docs/release/product/accessibility-statement.md`. The audit RESULT RECORD for the release bundle (the `release/preview` Accessibility evidence record) is a release artifact filled on GO (release-gate §8) — not yet filled.

[x] Performance budget green. — **AUTOMATED-TEST-ONLY** · evidence: `tests/performance` 2 files / 18 tests green, fresh at the reconciliation head (A036 PERF1.0 deterministic load-shape battery over the real API fabric; wall-clock recorded, never asserted) + `docs/release/product/performance-budget.md`. The result record is filled on GO (§8).

[x] Security regression green. — **AUTOMATED-TEST-ONLY** · evidence: `tests/security/production` 13 files / 66 tests green, fresh at the reconciliation head (AC-01…AC-14, including the F-08/F-09 regression pins — both flipped FIXED by PR #170) + `tests/resilience/production` 1 file / 6 tests green.

[x] Free-tier quota tests green. — **AUTOMATED-TEST-ONLY** · evidence: `deploy/src/hosted/quotas.test.ts` (+ fail-closed + env-contract + wiring) — fresh deploy battery 11 files / 103 tests green at the reconciliation head (the branch carries the TL's `4d50ab5` wiring-fix, so the deploy pipeline's own battery is green on this branch) + `tests/ux/operational.test.ts` rendered-exhaustion posture.

[x] Deployment health green. — **DEMONSTRATED-LIVE** · evidence: deploy-preview run 37941158560 SUCCESS on main `4d50ab5` (2026-10-09T14:01:56Z — wiring self-test + build/deploy + smoke-check green; the pipeline REPAIRED, see the linkage record §2.3 diagnosis → `4d50ab5` fix) + fresh live probes of `https://arena-preview-five.vercel.app` (5 routes HTTP 200 — worker §1 + finisher gate record §3) + production deployment `dpl_FVijfWSVGadW…` READY.

[ ] Fresh-machine installation evidence attached.
  - **OPEN** (Linux leg attached; macOS/Windows legs pending) · evidence: `docs/evidence/production/launch/install-fresh-machine-2026-10-09.md` — the B016 installer run on a fresh clone of main `04e6b61` (Linux x64): honest prereq failure recorded, then EXIT_STATUS=0 with 124 workspace projects installed, 123/123 build tasks cold (0 cached), deterministic demo corpus verified (hash `4dfd1acd`); the Gate-F bundle record `install-001` is filled with `exitStatus: 0` and this artifactRef (`release/preview/evidence/evidence-bundle.json` — bundle honestly INCOMPLETE: 1 passed / 7 pending launch-day records). Disclosed: shared warm pnpm store in this run; the cold-registry Linux leg is CI-green on every push. **owner:** release owner (TL executed the Linux leg 2026-10-09) · **next step:** attach macOS/Windows fresh-host logs at the gate (or the release owner accepts the Linux-scope disposition in the GO/NO-GO record).

[ ] Fresh-browser UX walkthrough evidence attached.
  - **OPEN** (machine output leg attached; human walkthrough record pending) · evidence: the battery OUTPUT is now attached — `docs/evidence/production/launch/ux-walkthrough-2026-10-09.md` (`node tests/ux/run.mjs` on the same fresh clone + cold build: 6 files / 46 tests green with REAL headless Chromium, served layer over `next start`, cleanup verified; the first-invocation environment-variable mistake is disclosed in the transcript). The HUMAN walkthrough record (onboarding clarity — Gate C row 1 — plus core flows walked by a human operator) does not yet exist. **owner:** release owner · **next step:** a human operator records the walkthrough against the hosted preview (`https://arena-preview-five.vercel.app`, serving the RC per the linkage record) or a local dev boot, and attaches it; the machine leg is done.

[ ] Known limitations published.
  - **OPEN** · evidence: the limitations records are committed — `docs/security/post-roadmap/findings-register.md` (12 rows: 9 OPEN / 1 BLOCKED F-07 / 2 FIXED, dispositions current after the P002-F1 merge `5d9e8a5`), every production-evidence file's honest-limitations section, `docs/LLM-ARCHITECT-FINAL-HANDOFF.md`, `docs/release/product/accessibility-statement.md` + `mobile-support-statement.md` + `docs/launch/public-demo-guide.md` (B018/B019-dated product statements). **TL currency confirmation (2026-10-09):** verified at the final release-candidate SHA `04e6b6121e` — the register and handoff are untouched since their last disposition updates (`efca69b` and earlier; only P008 evidence/governance files changed after), so the register of record IS current at the RC; the product statements still predate the P002–P007 series (honest scope note, unchanged). **owner:** release owner · **next step:** record the acceptance of the limitations record as current in the GO/NO-GO decision at the gate re-run (the currency fact is now TL-verified and recorded here; the acceptance is the release owner's).

## Final statement

Only after Gates A-F are green may Arena state:

“Installable, usable and publicly previewable through the hosted free-tier deployment.”

The statement applies to the declared preview profile and does not imply unlimited capacity or production-grade SLAs.

**P008 gate status (2026-10-09):** the release gate verdict is **NO-GO** — see
`release/evidence/production/release-gate-record.md` (hard gate 1 commercial boundary
BLOCKED-COMMERCIAL per findings-register F-07; hard gate 4 branch protection not satisfied;
final-RC deployed↔source linkage pending the TL's post-merge re-verification). The final
statement above is therefore NOT yet claimable as a release statement; it remains the
checklist's completion criterion.
