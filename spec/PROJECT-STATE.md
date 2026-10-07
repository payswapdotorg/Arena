# Arena Project State

Architecture: A2.0
Work Order schemas: AWO1.0 / BWO1.0
Maximum concurrent workers: 3

## V1

A001-A036: COMPLETE / MERGED.

The V1 core is implemented end-to-end:
Capability Case -> Task -> Environment -> Expert -> Trajectory -> Evaluation -> Verification -> Learning -> Agent Body -> Substrate Compatibility -> Certification -> Release -> Epoch consumption -> Production -> Marketplace -> Billing/Entitlements.

## Productization program

Goal: satisfy all three product requirements:

1. installable and usable locally;
2. hosted through a free-tier-compatible preview profile;
3. friendly responsive multi-role frontend with a persistent role switcher and role-specific workflows.

### First wave — LANDED

B001 MERGED — Web runtime foundation / Next.js App Router / design system
Issue #63 — PR #67 (merged 2b01b7b)
Owned: apps/web/*, packages/ui-platform/*

B002 MERGED — Hosted persistence/infrastructure adapters
Issue #64 — PR #68 (merged 3ab66f9)
Owned: packages/persistence/*, adapters/hosted/*, services/persistence/*

B003 MERGED — Role/context model and projection contracts
Issue #65 — PR #66 (merged 7605fe6)
Owned: packages/role-context/*, contracts/role-context/*

Wave-1 harvest record (TL, 2026-10-01): each PR merged after full TL-station
battery (governance/boundary/typecheck/lint/test/build) plus per-merge
lockfile intake and an integration battery at every merge step (final
integrated wave-1 tree: 61/61 tasks green). B002 additionally received TL
live-path hardening at intake (deterministic idempotency replay, hermetic
live contract runs, live rate-limit window) — disclosed in the PR body.

### Second wave

B004 MERGED — Identity/session/tenant integration and secure browser
session boundary
Issue #69 — PR #70 (merged 865c851)
Owned: packages/auth/*, services/auth/*, apps/web/src/auth/*
Harvest record: two-session worker delivery + TL completion; TL-station
battery 63/63 all gates; CI battery green on head a5ae1e8 before merge.

B005 MERGED — Persisted control-plane read model/API integration over
canonical Arena objects
Issue #71 — PR #72 (merged 8a6e6e9)
Owned: services/read-model/*, services/api-read/*, packages/read-model/*
Harvest record: worker delivery + TL completion; TL battery 66/66 all
gates; CI battery green on head e4d25ea before merge.

B006 MERGED — Deterministic Demo/Preview mode and first-run guided
narrative
Issue #73 — PR #74 (merged aa5d526)
Owned: apps/web/src/demo/*, apps/web/src/app/demo/*, packages/demo/*,
docs/demo/* (+ apps/web/package.json @arena/demo link + lockfile intake)
Harvest record: worker delivery + TL completion (worker died pre-commit at
the session wall-clock); deterministic tamper-proof seal tests fixed en
route (auth flake, 040dc5c); TL import normalization + manifest/lockfile
intake; TL battery 268/268 all gates; CI battery green on head 04a6e56
(integrated with repaired main) before merge.

### Third wave

B007 MERGED — Role-aware Home/Capability Cockpit and global navigation
Issue #78 — PR #79 (merged 4ff6188)
Owned: apps/web/src/cockpit/* (+ permitted route mounts: app/page.tsx,
app/app.test.tsx, app/demo/cockpit/*)
Harvest record: two-session worker delivery (first session built + committed,
died pre-push; continuation session verified + pushed + PR'd) + TL independent
review (fail-closed session → B005 read API; lens-not-authorization with
truthful not-granted denial; injective state classification with distinct
pending/unknown marks; demo cockpit visibly labelled); TL battery 268/268
under CI-equivalent clean-.next conditions; branch CI queued (runner queue);
merged on local-battery truth per house rule.

### Fourth wave (B008/B009/B010 — three concurrent workers) — LANDED

B008 MERGED — Capability Case, Task and guided capability-development
workflows
Issue #80 — PR #85 (merged 4a857b7)
Owned: apps/web/src/capability/*, packages/product-flows/*
Harvest record: three-session delivery (worker M1 product-flows 33 tests;
continuation M2 capability UI; TL-completed M3 route mounts) + TL lockfile
intake (packages/product-flows) + semantic merge with B009/B010 (app.test.tsx
stub lists recomputed). TL battery on integrated tree: governance clean,
boundary clean, build 69/69, typecheck/lint/test 207/207.

B009 MERGED — Expert Workbench and expert assignment/review workflow UX
Issue #81 — PR #84 (merged 6a68895)
Owned: apps/web/src/expert/*
Harvest record: dead-worker uncommitted tree completed by a continuation
session (24 files, 90/90 expert tests; evidence INSERT-only through the B002
port; qualification rendered as scoped judgment, never authorization); TL
independent battery build 67/67, typecheck/lint/test 201/201; branch CI green
(458cbed).

B010 MERGED — Agent Body Studio, Possession matrix, Skill/Knowledge/Tool
composition and model-substrate comparison UX
Issue #82 — PR #83 (merged 377dc01)
Owned: apps/web/src/bodies/*, packages/body-ui/*
Harvest record: worker M1 (body-ui 38 tests) + M2 (studio surfaces 26 tests)
committed; TL completed M3 (route mounts + one Parameters<> type fix) +
lockfile intake (packages/body-ui). TL battery build 68/68, typecheck/lint/
test 204/204; branch CI green (abc80d3). Post-merge main CI green (6a68895).

### Fifth wave (B011/B012/B013 — three concurrent workers)

B012 MERGED — Evaluation, verification, certification and research UX landed
PR #89 (merged 372232b)
Harvest record (TL, 2026-10-02 03:25 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); lockfile intake as needed; PR opened and merged by the TL; issue #87 closed at acceptance.

B011 AUTHORIZED — Environment/trajectory replay viewer and interactive run
inspection
Deps B005+B007+A010+A011+A012+A013 all MERGED; issue to be opened at dispatch
Owned: apps/web/src/replay/*, packages/replay-ui/*

B012 AUTHORIZED — Evaluation, verification, certification and research UX
Deps B005+B007+A012+A013+A023+A030 all MERGED; issue to be opened at dispatch
Owned: apps/web/src/evaluation/*, apps/web/src/research/*

B013 AUTHORIZED — Marketplace UX for experts and artifacts, including
provenance/rights/verification/entitlements
Deps B005+B007+A031+A032+A033 all MERGED; issue to be opened at dispatch
Owned: apps/web/src/marketplace/*, packages/marketplace-ui/*

Slot-blocked (deps MERGED, waiting for a concurrent-worker slot):
B018 waits on B011+B013 (both in flight); B019 waits on B015+B017+B018.

## Product specifications

- spec/product-requirements.md
- spec/roles-and-contexts.md
- spec/ux-architecture.md
- spec/ux-route-matrix.md
- spec/free-tier-contract.md
- spec/post-v1-work-items.md
- spec/post-v1-dependency-graph.md
- docs/deployment/free-tier-architecture.md
- docs/ux-operational-simulation.md
- docs/product-demo-script.md
- docs/decisions/ADR-HUMAN-ESCALATION-001.md
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md

## Product truth invariants

Role context is not permission.

Body is not Substrate.

Possession is the binding.

Certification is composition-scoped.

Replay is observational unless a separately authorized live action is issued.

Demo state is not customer state.

Provider quota is visible and fail-closed.

The frontend projects canonical objects; it does not create a parallel domain model.

## Current product gap assessment

### Local use
Existing V1 offers an engineering/reference console, but not yet the final product-first install/demo journey.

### Hosted use
No Arena Vercel project is currently configured in the connected Vercel account, and the repository has no current Neon/R2/Upstash/Apify provider wiring. The B-series must establish this.

### UX
A018/A017 provide engineering console/workbench foundations, but the final role-aware product shell, onboarding, cockpit and all role-specific workflows are still B-series work.

## UX validation

The pre-implementation role/replay/evidence/marketplace/free-tier simulation is recorded in docs/ux-operational-simulation.md.

The simulation required:
- persistent role switcher;
- role-specific projections over shared canonical objects;
- explicit state/evidence taxonomy;
- replay/live-world separation;
- marketplace/certification distinction;
- visible capacity state;
- deterministic Demo mode.

These are normative B-series requirements.

## Deployment target

Preview:
Vercel Hobby + Neon Free + Cloudflare R2 Standard + Upstash Redis Free, with Apify optional for bounded acquisition.

Provider-specific types remain adapter-only.

## Successor procedure

After every B merge:
1. reconcile live GitHub state;
2. record exact merge SHA and verification;
3. update this file, AI_CONTINUATION.md and docs/LLM-ARCHITECT-HANDOFF.md;
4. recompute readiness from spec/post-v1-dependency-graph.md;
5. dispatch no more than 3 disjoint items;
6. serialize root dependency/lockfile reconciliation;
7. run relevant product E2E/UX gates whenever user-facing behavior changes materially.

Never treat stale chat context as state.


## Current frontier

B017 MERGED — full product E2E battery + UX/operational conformance + validation runbook
PR #97 (merged 12a517b, intake a34a1e0)
Harvest record (TL, 2026-10-02 23:58 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); intake applies the architecture-question verdicts (UX-VIEWPORT-01 root fix, reset-hint narrowing, battery manifest wiring); PR opened and merged by the TL; issue #96 closed at acceptance.

B014 MERGED — Operations, jobs, SLOs, audit and free-tier capacity UX landed
PR #90 (merged c0fcbbc)
Harvest record (TL, 2026-10-02 04:45 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); lockfile intake as needed; PR opened and merged by the TL; issue #91 closed at acceptance.

- A001 MERGED
- A002 MERGED
- A003 MERGED
- A004 MERGED
- A005 MERGED
- A006 MERGED
- A007 MERGED
- A008 MERGED
- A009 MERGED
- A010 MERGED
- A011 MERGED
- A012 MERGED
- A013 MERGED
- A014 MERGED
- A015 MERGED
- A016 MERGED
- A017 MERGED
- A018 MERGED
- A019 MERGED
- A020 MERGED
- A021 MERGED
- A022 MERGED
- A023 MERGED
- A024 MERGED
- A025 MERGED
- A026 MERGED
- A027 MERGED
- A028 MERGED
- A029 MERGED
- A030 MERGED
- A031 MERGED
- A032 MERGED
- A033 MERGED
- A034 MERGED
- A035 MERGED
- A036 MERGED
- B001 MERGED
- B002 MERGED
- B003 MERGED
- B004 MERGED
- B005 MERGED
- B006 MERGED
- B007 MERGED
- B008 MERGED
- B009 MERGED
- B010 MERGED
- B011 MERGED
- B012 MERGED
- B013 MERGED
- B014 MERGED
- B015 MERGED
- B016 MERGED
- B017 MERGED
- B018 MERGED
- B019 MERGED — hosted preview acceptance, public demo, runbooks, cost/quota monitoring and launch gate
PR #103 (merged 8d24fd2, head 24ecc8e, TL intake 14efa47)
Harvest record (TL, 2026-10-04 21:29 UTC): multi-session worker delivery (local glm-4-plus agent sessions 1-2 + platform-subagent sessions 3-4 completing the final mile); TL station six-gate battery GREEN at the pushed head under Node 22; CI battery green (run 37235588903); ownership clean (four owned surfaces; root manifests TL-intaken at 14efa47 — exact workspace entries, parents standalone); live-path probes verified against the live production preview; +40 tests across the three workspace-registered preview packages. Issue #102 closed at acceptance.

Launch-gate final state (TL-owned boundary, executed):
- Providers provisioned: Neon arena-preview (steep-moon-56016170) · R2 arena-preview-objects · Vercel project arena-preview (nextjs, node 22.x, rootDirectory apps/web).
- Runtime env contract + GitHub deploy secrets injected (fail-closed posture unblocked).
- Deploy pipeline proven end-to-end on push to main (wiring-selftest → vercel pull/build/deploy repo-root posture → smoke-check).
- LIVE HOSTED PREVIEW: https://arena-preview-five.vercel.app (production alias).
- Security intake: Next 15.5.4 → 15.5.27 (Vercel advisory gate); frozen-pin test updated; workflow-structure test tracks the repo-root CLI posture.

**B-SERIES COMPLETE: 19/19 work orders merged (B001-B019).**

Launch-gate pre-provisioning record (TL, 2026-10-04 19:5x UTC — the TL-owned
boundary of issue #102, provisioned ahead of the B019 merge):
- Neon project `arena-preview` (steep-moon-56016170, aws-us-east-1, pg 17);
- Cloudflare R2 bucket `arena-preview-objects`;
- Vercel project `arena-preview` (prj_PxNulA41ti7n3uulomMVhiskUPCa,
  nextjs, node 22.x; no rootDirectory — the deploy workflow already runs
  from apps/web and a rootDirectory double-joins the CLI path);
- runtime env contract injected as Vercel production env vars (B015
  env-contract: DATABASE_URL / R2_* / UPSTASH_* / ARENA_SESSION_SECRET);
- GitHub repository secrets VERCEL_TOKEN / VERCEL_ORG_ID / VERCEL_PROJECT_ID
  injected — deploy-preview.yml is now unblocked on push to main.

## Long-term product direction

Approved north star:
Arena = Stripe of human expert escalation for AI automation.

C-series successor program:
C001-C022 in spec/human-escalation-work-items.md.

Core external flow:
Application/Agent -> Escalation Request -> Capability Demand -> Expert Match -> Expert Session -> Intervention -> Validation -> Result -> Payment -> optional Learning/Tool/Knowledge improvement.

The expert session may be a bounded replica of the agent environment. The originating application remains authoritative over its live world.

Competition-based evaluation is an alternative evaluator route. It does not bypass Arena Verification.

C-series first recommended wave:
C001, C002, C010.

See spec/human-escalation-dependency-graph.md.

B016 MERGED — local install/seed/reset workflow and developer quickstart
PR #95 (merged c9b6f25f)
Harvest record (TL, 2026-10-02 21:40 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); lockfile intake as needed; PR opened and merged by the TL; issue #94 closed at acceptance.

B017 MERGED — full product E2E, role-switch simulation, UX/operational conformance
PR #97 (merged 12a517b)
Harvest record (TL, 2026-10-02 23:58 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA f5cc908, gate-parity green; product-e2e 28/28 + ux 46/46 batteries re-run locally under Node 22.20 with the real-Chromium viewport layer); intake a34a1e0 applies the worker's architecture-question verdicts (UX-VIEWPORT-01 root fix — scroll-region rule family + code break-anywhere, strict viewport expectations restored; DEMO_RESET_HINT narrowed to actual semantics; test:e2e/test:ux manifest wiring); issue #96 closed at acceptance.

B011 MERGED — environment/trajectory replay viewer + interactive run inspection; frontier B018 waits on B013, B019 on B018
PR #98 (merged 550622cf)
Harvest record (TL, 2026-10-03 04:48 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); lockfile intake as needed; PR opened and merged by the TL; issue #86 closed at acceptance.

B013 MERGED — Marketplace UX for experts and artifacts: packages/marketplace-ui view-model layer (provenance/rights/verification/entitlement state machine/certification-badge-only-when-record-backed/fail-closed purchase), apps/web/src/marketplace runtime+corpus+screens absorbing console-era recipes (21 tests preserved), /marketplace/** + /demo/marketplace/** mounts; TL parity ALL GREEN at 304f87a (71/71 tasks on two full runs); 39 files +6352/-22
PR #99 (merged 531f8c7)
Harvest record (TL, 2026-10-03 13:48 UTC): worker delivery branch-verified at the TL station (six-gate battery re-run at the pushed SHA, gate-parity green); lockfile intake as needed; PR opened and merged by the TL; issue #88 closed at acceptance.

B018 MERGED — accessibility, mobile, performance, resilience and launch polish: apps/web/src/a11y (primitives + ambient DOM type surface + 12-test conformance battery), apps/web/src/responsive (primitives + 13-test battery), tests/performance PERF1.0 revival (full @arena/* source mapping — standalone NodeNext resolution fixed) + product-budget tests (suite 18/18), docs/release/product/* (a11y/mobile/perf-budget/resilience statements + launch-polish checklist), honest manifest at tests/performance/manifest.json
PR #101 (merged 29d01e43)
Harvest record (TL, 2026-10-04 07:50 UTC): worker delivery over three remediation rounds + disclosed TL intake-remediation (z-ai worker brain rate-limit-dead; mechanical fixes applied at the station — JSX-in-.ts renames, ambient DOM types instead of the DOM lib, local cn() replacing the nonexistent '@/lib/utils', perf-suite source mapping); six-gate battery re-run at the pushed SHA 08d9132 ALL GREEN (71/71 turbo tasks; apps/web 581 passed + 8 skipped; a11y 12/12; responsive 13/13; post-build app.test 36/36; PERF standalone 18/18); no lockfile intake needed; issue #100 closed at acceptance.


## FINAL CURRENT FRONTIER — 2026-10-07

Authoritative handoff: docs/LLM-ARCHITECT-FINAL-HANDOFF.md

A001-A036: COMPLETE / MERGED.
B001-B019: COMPLETE / MERGED.

Post-B019 launch-integrity closure is now explicitly tracked:
- G001 issue #104 — fresh-machine/local evidence;
- G002 issue #105 — current hosted/provider/quota evidence;
- G003 issue #106 — fresh-browser UX/product evidence.

G001-G003 have disjoint evidence surfaces and may run concurrently.

C001-C022: NOT YET IMPLEMENTED.

C-series north star: Arena is the Stripe of human expert escalation for AI automation.

Corrected C dependency/concurrency:
- C001;
- then C002 + C006 + C010;
- then C003 + C007 + C017;
- then C004 + C008 + C009;
- then C005 + C011 + C012;
- then C013 + C014 + C015;
- then C016 + C018 + C020;
- then C019 + C021 + C022.

Maximum concurrent workers: 3.

Do not declare the strongest public launch statement until G001-G003 are accepted.
Do not dispatch a C item before its dependencies are verified on live main.
- G001 MERGED — fresh-machine local product proof
  PR #108 (merged 61d1f4f). Harvest record (TL, 2026-10-07 14:04 UTC): genuinely fresh E2B machine
  (node 22.23.3 + pnpm 10.34.5 downloaded in-run, fresh clone); product:install 111s exit 0, corpus
  hash 4dfd1acd, zero providers/zero credentials; doctor 7/1/0; landing 200 byte-identical to hosted;
  demo+reset contracts; test:e2e 28/28; test:ux 46/46 (real headless Chromium); test:product 66/66;
  persistence semantics verified. TL station battery green on the branch and on integrated main (1ca2603).
- G002 MERGED — hosted live proof, provider/quota proof and current deployment reconciliation
  PR #107 (merged 3126596). Harvest record (TL, 2026-10-07 14:04 UTC): current 2026-10-07 probes —
  3× landing HTTP 200; Vercel production deploys READY at 05:02Z/10:36Z (stale-Oct-4 concern resolved);
  Neon project verified (direct-DB probe honestly NOT-DERIVABLE); R2 bucket valid (0 objects current);
  Upstash PONG; B019 acceptance harness 5/5 Gate B PASSED at 13:21Z; no paid fallback; 0 secret patterns
  in served bundles. TL station battery green.
- G003 MERGED — fresh-browser UX/product audit and launch evidence closure
  PR #109 (merged 1ca2603). Harvest record (TL, 2026-10-07 14:04 UTC): fresh-profile audit of 13
  surfaces + 404 on the hosted preview; truth labels verbatim; role-lens interaction (?role=expert);
  mobile 390x844 no-overflow; keyboard focus-visible throughout; one minor disclosed finding
  (/tasks renders the landing shell — backlog note). TL station battery green.

Post-B019 launch-integrity closure: G001+G002+G003 ACCEPTED AND MERGED (2026-10-07).

C-series issue tracker COMPLETE: #75 (C001), #76 (C002), #77 (C010) plus #110-#128
(C003-C009, C011-C022) — every C work order has its tracking issue with scope,
dependencies, owned surfaces and wave schedule (created 2026-10-07 by the TL).
C001 sandbox pre-staged (branch work/C001-escalation-api at f222599) with an armed
brain-recovery auto-launcher (worker-brain outage disclosed in AI_CONTINUATION).
Arena may now truthfully state: installable, usable and publicly previewable.
C-series (C001-C022) is the active implementation roadmap; first wave C001 (#75).
