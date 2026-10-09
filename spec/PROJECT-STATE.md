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

- P000 MERGED
- P001 MERGED (PR #161, main d2f364f; issue #153 closed)
- P002 AUTHORIZED (wave 1, issue #154)
- P004 AUTHORIZED (wave 1, issue #156)
- P005 AUTHORIZED (wave 1, issue #157)

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

- C001 MERGED — Expert Escalation API, MCP, webhooks and durable lifecycle
  PR #129 (merged 8c49635; +64 files, +8593 lines; issue #75). Harvest record (TL, 2026-10-07
  15:57 UTC): packages/escalation — ES1.0 request model, durable lifecycle state machine with
  explicit timeout/cancelled/expert-replaced states, typed verdicts, append-only history,
  11-kind result taxonomy, idempotency-key + correlation semantics, domain tenant isolation,
  13-event webhook taxonomy; services/escalation-api — REST create/status, at-least-once
  webhook outbox, A015 idempotent submission wiring, timeout sweep, permitted-action guard,
  C002 RoutingPort seam with labelled round-robin stub, MCP tool layer; adapters/escalation —
  HMAC-SHA256 signed delivery (host-injected material, deterministic backoff, auditable
  dead-letter, timing-safe verification), MCP stdio binding, zero workspace deps;
  contracts/escalation — 10 G9-registered schemas. Worker battery all-green (164 owned tests);
  TL station battery green at fe15a47 + TL lockfile intake 27744a9. Disclosed in PR: routing
  stub awaits C002; HTTP listener is a host/C017 concern; persistence is in-memory reference
  fabric. Worker channel: platform-native Task subagents (z-ai gateway outage continues —
  disclosed in AI_CONTINUATION).

C-series wave 2 AUTHORIZED on live main @ 8c49635+: C002 (#76, work/C002-escalation-routing),
C006 (#113, work/C006-expert-session), C010 (#77, work/C010-payments) — disjoint surfaces;
dependencies verified on live main (C001 merged; A004/A006/A007/B002/A009/A010/A033/A034
merged in prior programs). Wave 3 staged (C003+C007+C017, briefs pre-written).

- C002 MERGED — capability-demand compiler and expert routing
  PR #130 (merged c2e1ae0; +33 files, +4704; issue #76). Harvest record (TL, 2026-10-07 17:15 UTC):
  packages/escalation-routing — demand compiler with typed closed outcomes over the A004 graph,
  deterministic 9-filter routing engine covering all 10 ES1.0 routing inputs, RoutingCandidate
  view, digest-chained append-only decision history; services/escalation-routing — C001
  RoutingPort structural replacement (vocabulary parity test), injected ports, fail-closed
  routing-unavailable degradation, A015 durable routing jobs. 90 new tests incl. adversarial
  (qualification-as-authorization, cross-tenant leakage, COI bypass). Worker battery green.
  Open (recorded): escalation-api default port remains the labelled stub — TL integration
  decision; RoutingPort hoist to a package proposed in the PR.

- C006 MERGED — expert environment capsule and privacy-safe session replication
  PR #132 (merged 6a3469e; +48 files, +7189; issue #113). Harvest record (TL, 2026-10-07):
  packages/expert-session — capsule derivation (bounded, escalation-scoped, time-bounded,
  privacy-controlled, non-authoritative), six EES1.0 modes as typed capability policy, privacy
  barrier control set with fail-closed escape detection, approved observable event stream (never
  private chain-of-thought), ToolGapSignal, knowledge tiers with no-silent-promotion, session
  completion contract, replay traces; services/expert-session — lifecycle bound to C001 states
  via injected ports, fail-closed on every event; adapters/expert-environment — A009-aware
  deterministic materializer (secret-tool exclusion; live-world mounts never replicate). 97
  owned tests; all four adversarial minimums green (escape fail-closed, secret leakage
  screened, mode escalation rejected, replay≠live). Open (recorded): A015 durability is the
  in-memory reference fabric; A010 runner execution deferred (adapter derives the view only).

- C010 MERGED — payments, escrow/hold, platform fees and payouts
  PR #131 (merged fadbb06; +50 files, +7719; issue #77). Harvest record (TL, 2026-10-07):
  packages/payments — money primitives (string-scaled minor units), versioned deterministic
  fee splits, digest-chained append-only ledger, lifecycle binding, idempotency, commercial
  audit events, provider port + truth-label law; services/payments — HOLD/offer/acceptance/
  CAPTURE/RELEASE/REFUND with fee-split payout, explicit-state dispute surface,
  escalation.payment.updated outbox events, typed cross-tenant denials; adapters/payments —
  deterministic DemoPaymentProvider (byte-stable ids, idempotent replay, typed failures).
  106 new tests incl. all five FINAL-HANDOFF §18 adversarial minimums at domain+service+provider
  seams. Open (recorded): MoR/settlement/tax/jurisdiction are explicit open production questions;
  disputes in-memory; outbox drain host-wired.

Integrated-main TL station battery GREEN at fadbb06 (boundary B1-B4 clean, contracts
byte-identical, typecheck 85/85, lint 85/85, test 85/85 tasks, build 85/85) — wave 2 complete:
C001+C002+C006+C010 landed entirely via platform Task subagents during the z-ai gateway outage.

C-series wave 3 AUTHORIZED on live main @ fadbb06+: C003 (#110, work/C003-expert-intake),
C007 (#114, work/C007-intervention-modes), C017 (#123, work/C017-developer-portal). Briefs
pre-written (scripts/worker-prompts/). All 22 C-series briefs exist.

- C007 MERGED — live human intervention modes
  PR #133 (merged 3836443; issue #114). Harvest record (TL, 2026-10-07 18:15 UTC): packages/
  intervention — 8-mode table mirroring C006 EES1.0 session modes, fail-closed authorization
  guards, escalation-modes law, per-mode result contracts onto C001's single taxonomy, A011
  trajectory binding (TEACH captureMandatory), C009 validation seam as labelled stub;
  services/intervention — lifecycle SESSION_READY→IN_PROGRESS→SUBMITTED, idempotent,
  escalation.progressed events. 100 new tests (68 domain + 32 service) incl. all adversarial
  minimums. Worker battery green. Open (recorded): validation stub awaits C009; in-memory
  reference fabric; captureMandatory scope + resubmitted-state questions in PR.

- C003 MERGED — AI expert intake and adaptive capability interview
  PR #134 (merged 03f8186; issue #110). Harvest record (TL, 2026-10-07): packages/expert-intake —
  typed items over C002/A004 vocabulary, expected-information-value selection with inspectable
  rationale, full lifecycle + ABANDONED/TIMED_OUT, digest-chained append-only transcript, typed
  outcomes, IntakeProfile → A006 proposal + A007 claims-with-evidence (qualification never
  authorization), InterviewerModelPort scripted reference, PII/authority screens, consent;
  services/expert-intake — in-memory reference fabric, injected A006/A007 public ports only,
  fail-closed TENANT_MISMATCH/TAMPERED/PORT_FAILURE, REQUIRED idempotency, deterministic demo.
  72 new tests (52 domain + 20 service) incl. all four adversarial minimums. Worker battery
  green. Open (recorded): in-memory fabric + scripted model are house reference patterns
  (disclosed); IntakeProfile seam versioning proposed for C004.

- C017 MERGED — developer portal, API keys, sandbox and SDK quickstarts
  PR #135 (merged 4104f7c; issue #123). Harvest record (TL, 2026-10-07): packages/developer-
  platform + services/developer-platform (API-key domain with scopes/rotation/revocation — keys
  never role authority; sandbox truth-labels; webhook registration; observability projections)
  + apps/web/src/developers portal module (host wiring over real C001 + dev-platform services,
  fail-closed route resolvers, 5 /developers/** routes with loading gate, deterministic demo
  corpus, live+sandbox dashboards with per-row truth labels). 57 owned tests (34 pkg + 23 svc)
  + 603 web-suite tests green. Worker battery green. Open (recorded): wire contracts not yet
  generated; routes read-only in session posture (interactive key writes + sandbox runs are a
  proposed follow-up with CSRF/idempotency posture); route-mount pattern question in PR.

Integrated-main TL station battery GREEN at 4104f7c (check/boundary clean, contracts
byte-identical, typecheck 91/91, lint 91/91, test 91/91 tasks, build 91/91) — wave 3 complete:
C001-C003, C006-C007, C010, C017 merged; 31 WOs total landed.

C-series wave 4 AUTHORIZED on live main @ 4104f7c+ (frontier RECOMPUTED from the dependency
table — AI_CONTINUATION's C009-in-wave-4 was wrong, C009 is blocked on C005): C004 (#111,
work/C004-expert-calibration), C008 (#115, work/C008-tool-gap-capture), C019 (#125,
work/C019-reference-integrations). C005 (needs C004) and C018 (ready) queue next.

- C019 MERGED — reference integrations: Epoch + generic AI application
  PR #136 (merged 86bd684; issue #125). Harvest record (TL, 2026-10-07 19:27 UTC):
  adapters/epoch-escalation — EPI1.0+ES1.0 trigger/posture mapping, read-only delivery
  projection, signed webhook consumption, fail-closed Epoch authority boundary (45 tests);
  examples/generic-ai-client — provider-neutral generic client proving the FINAL-HANDOFF
  §15/§16 loop (escalate → webhook/status poll → result) over public contracts only + Epoch
  loop over the same fabric + adversarial minimum (11 tests; self-contained per A027
  precedent — examples/* outside workspace globs, disclosed). Worker battery green. Open
  (recorded): reference fabric is in-process; MCP escalation surface not exercised by the
  example; examples battery placement question in PR.

- C004 MERGED — expert calibration, pre-training and continuous requalification
  PR #137 (merged bfc0ed7; issue #111). Harvest record (TL, 2026-10-07): packages/
  expert-calibration — probe-pinned CalibrationPrograms, append-only LE1.0 records with
  applicability context, typed 5-member drift verdicts, pre-training tracks, requalification
  policy + typed transition proposals, frozen DemonstratedPerformance read, tenant isolation,
  masquerade fails closed; services/expert-calibration — C003/A017/A007 injected ports with
  A007 type parity, program lifecycle, pre-training→A007 proposal-not-write, requalification
  as durable idempotent A015 jobs, C002 routing read with inForce. 55 tests incl. 4
  adversarial classes. Worker battery green (transient @arena/web build OOM under 3-concurrent
  re-ran green — disclosed). Open (recorded): domain-pack-change/dispute-raised triggers
  declared but not evaluated (no producer ports); in-process reference only.

- C008 MERGED — tool-gap and domain-knowledge capture pipeline
  PR #138 (merged 5814492; issue #115). Harvest record (TL, 2026-10-07): packages/tool-gap —
  EES1.0 ToolGapSignal staged append-only records (full field set, content-key dedup, sha256
  integrity walk) + closed guarded stage machine (nothing auto-promotes); packages/
  knowledge-capture — four-tier typed lattice + structurally-enforced no-silent-promotion
  wall + typed candidate-only KnowledgePatch; services/capability-improvement —
  capture-to-disposition over injected C007/A019/A020/A021 ports, granted-consent gate,
  sha256-chained append-only audit. 89 owned-surface tests (13 adversarial: overgeneralization,
  ungranted consent, provenance tampering, duplicate-injection dedup). Worker battery green.
  Open (recorded): in-process reference fabric; validation authority is C009's.

Integrated-main TL station battery GREEN at 5814492 (check/boundary clean, contracts
byte-identical, typecheck 97/97, lint 97/97, test 97/97 tasks, build 97/97, no OOM) —
wave 4 complete: 10 of 22 C-WOs landed (C001-C004, C006-C008, C010, C017, C019).

C-series wave 5 AUTHORIZED on live main @ 5814492+ (frontier recomputed): C005 (#112,
work/C005-expert-performance — deps C004 ✓, A007 ✓, A019 ✓, A020 ✓) and C018 (#124,
work/C018-session-policy — deps C006 ✓, C007 ✓, A034 ✓). Only two dispatchable —
every other C item is blocked on C005 (C009/C011/C016/C020/C021) or deeper. Wave 6 next:
C009 + C011 (after C005 merges).

- C018 MERGED — enterprise privacy, retention and session policy packs
  PR #139 (merged b3465ac; issue #124). Harvest record (TL, 2026-10-07 20:23 UTC):
  packages/expert-session-policy — versioned tenant-scoped PolicyPacks over the full EES1.0
  control set; typed closed conflict/infeasibility verdicts (never silently weakened);
  RETAIN/ANONYMIZE/DELETE_PENDING/DELETED disposition machine with post-deletion audit;
  withdrawal/erasure state machines with deletion double-spend typed-duplicate; cross-tenant
  grants with expiry+revocation; services/expert-session-policy — resolution over injected
  C006/C007/C001 seams with pack pinning, digest-chained audit. 74 tests (58 domain + 16
  service) incl. adversarial minimum. Worker battery green. Open (recorded): in-memory
  reference fabric; jurisdiction/residency declarative metadata only; retention-sweep
  scheduler ownership question in PR.

- C005 MERGED — expert performance / longitudinal evidence profile
  PR #140 (merged 2062e4e; issue #112). Harvest record (TL, 2026-10-07): packages/
  expert-performance — 8 quality-model record families, structural no-single-global-score
  law, LE1.0 attribution discipline (evaluator-version change ≠ expert change), versioned
  freshness policy with reasons, pure ingestion mapping from C004/A007/A019/A020, two
  same-object lenses; services/expert-performance — injected dep ports, content-digest
  re-verification, replay defense, cross-tenant fail-closed. 69 tests (49 domain + 20
  service) incl. adversarial (replay inflation, tampering, cross-tenant, score smuggling).
  Worker battery green (7m33s build, no OOM). Open (recorded): in-memory reference fabric;
  freshness defaults illustrative; C002/C013 consumers not yet present.

Integrated-main TL station battery GREEN at 2062e4e (check/boundary clean, contracts
byte-identical, typecheck 101/101, lint 101/101, test 101/101 tasks, build 101/101) —
wave 5 complete: 12 of 22 C-WOs landed (C001-C005, C006-C008, C010, C017-C019).

C-series wave 6 AUTHORIZED on live main @ 2062e4e+ (frontier recomputed after C005 merge):
C009 (#116, work/C009-escalation-validation — deps C007 ✓, C005 ✓, A012 ✓, A013 ✓) and
C011 (#117, work/C011-expert-engagement — deps C005 ✓, C010 ✓, A031 ✓). Wave 7 next:
C012 + C013 + C014 (after C009). Deadline note (honest, 20:35 UTC): waves 8-9
(C015+C020, C016+C021+C022) are unlikely to complete before 00:00 UTC — continuation
state will be left pristine per the stateless doctrine.

- C011 MERGED — expert engagement, availability, scheduling and SLA management
  PR #141 (merged 4d12303; issue #117). Harvest record (TL, 2026-10-07 21:25 UTC): packages/
  expert-engagement — engagement lifecycle bound to C001/C002, availability/capacity model +
  ES1.0 routing-input projection, versioned SLA policies/clocks + append-only breach records;
  services/expert-engagement — durable idempotent SLA jobs on the A015 seam. 68 tests incl.
  adversarial (expiry fail-closed, duplicate-accept idempotency, overcommit, cross-tenant,
  tampering). Worker battery green. Open (recorded): in-memory reference fabric; no HTTP
  binding (sibling-consistent); SLA rollup index ownership question (C011 vs C021).

- C009 MERGED — escalation validation, adjudication and expert replacement
  PR #142 (merged d0aab70; issue #116). Harvest record (TL, 2026-10-07): packages/
  escalation-validation — typed validation-plan derivation, two-stage A012/A013 adjudication
  (ACCEPTED/REVISION_REQUIRED/REJECTED/NEEDS_MORE_EVIDENCE), bounded append-only revision
  loop, typed replacement triggers → C002 seam, COI-failing validator selection over C005
  evidence; services/escalation-validation — C001 lifecycle binding +
  escalation.validation.updated events. 91 tests (58 pkg + 33 svc incl. 13 adversarial,
  2 integration); C007 tests stay green (plug-compat with its former stub). Worker battery
  green. Open (recorded): no JSON contracts registered (manifest script outside owned
  surfaces); in-process reference fabric.

Integrated-main TL station battery GREEN at d0aab70 (check/boundary clean, contracts
byte-identical, typecheck 105/105, lint 105/105, test 105/105 tasks, build 105/105) —
wave 6 complete: 14 of 22 C-WOs landed (C001-C009, C010, C011, C017, C018, C019).

C-series wave 7 AUTHORIZED on live main @ d0aab70+ (frontier recomputed after C009/C011
merges — three-way wave): C012 (#118, human-data production studio — deps C001/C006/C007/
C009/A014/A017 all ✓), C013 (#119, adversarial expert evaluation — deps C009/A012/A013/
A030 all ✓), C014 (#120, agent body pretraining + capability-body marketplace — deps
C008/C009/A021/A023/A024 all ✓). Wave 8 next: C015 + C020 (after C013/C014). The TL will
continue the cadence past 00:00 UTC per operator directive ("stay up until the entire
roadmap is done") — deadline misses will be disclosed honestly in these records.

- C013 MERGED — adversarial expert evaluation / Expert Arena competition
  PR #143 (merged 6cf70c8; issue #119). Harvest record (TL, 2026-10-07 22:41 UTC):
  packages/adversarial-evaluation — AE1.0 competition lifecycle, six judgment types,
  structurally enforced guardrails, evidence-weighted Bradley-Terry adjudication,
  discovery-signal-only ratio law, certification boundary, A030 byproducts; services/
  adversarial-evaluation — reference service on the A015 fabric with C009/A012/A013 seams;
  apps/web/src/competitions — web UX chain. 92 owned tests (64 domain + 16 service + 12
  web). Worker battery green (build OOM solo re-run disclosed). Open (recorded): /competitions
  app mounts not included (outside owned surface — resolvers exported for TL); single demo
  competition; calibrationWeight default question in PR.

- C014 MERGED — on-demand Agent Body pretraining and capability-body marketplace
  PR #144 (merged 6d52864; issue #120). Harvest record (TL, 2026-10-07): services/
  body-marketplace — pretraining pipeline (typed closed compilation, rights/evidence
  blocks), A021 forge proposals with NEW IMMUTABLE BodyVersions only, A023 record-backed
  certification posture, A024 listings (DRAFT→PUBLISHED→SUSPENDED/RETIRED append-only
  history), offer/grant seams; apps/web/src/body-marketplace — browse/detail/
  request-pretraining (consequence exposure)/my-listings with role lens. 38 service tests
  + 606 web-suite tests incl. 11 route tests. Worker battery green (build OOM solo re-run
  disclosed). Open (recorded): no app/ route mounts (outside owned surface); settlement
  seam ownership question in PR.

- C012 MERGED — human-data production studio for customer AI pipelines
  PR #145 (merged bf5d763; issue #118). Harvest record (TL, 2026-10-07): packages/human-
  data — commission model over the C001 compile seam, rights-gated deliverables (C009 gate +
  EES1.0 replay law + consent wall), A014 bundle assembly (46 tests); services/human-data —
  commission lifecycle with durable idempotent jobs, C001 escalation port, C006/C009
  deliverable-source port, A014 bundle delivery, events (16 tests); apps/web/src/human-data —
  studio routes: commission builder (consequence exposure), production dashboard (C001
  projections), dataset delivery (manifest/rights/lineage/download gate) + thin app-router
  mounts per C017 precedent (6 route tests). 68 owned tests total. Worker battery green
  (session-3 finisher: prior sessions' work intact). Open (recorded): escalation-port
  event-on-failure question in PR.

Integrated-main TL station battery GREEN at bf5d763 (check/boundary clean, contracts
byte-identical, typecheck 110/110, lint 110/110, test 110/110 tasks, build 110/110) —
wave 7 complete: 17 of 22 C-WOs landed (C001-C014, C017-C019).

C-series wave 8 AUTHORIZED on live main @ bf5d763+ (frontier recomputed after C013/C014
merges): C015 (#121, capability-demand matching across experts/Bodies/tools/knowledge/
artifacts — deps C002 ✓, C005 ✓, C008 ✓, C014 ✓ all merged) and C020 (#126, network
quality: reputation/disputes/anti-gaming/fraud — deps C005 ✓, C009 ✓, C010 ✓, C013 ✓
all merged). Wave 9 (final) next: C016 + C021 + C022 (after C015). Cadence continues
past 00:00 UTC per operator directive; the deadline miss is disclosed honestly.

- C015 MERGED — capability-demand matching across experts, Bodies, tools, knowledge and artifacts
  PR #146 (merged 934da7c; issue #121). Harvest record (TL, 2026-10-07 23:47 UTC):
  packages/capability-routing — cross-resource DemandProfile compiler (expert facet delegates
  to C002), resolution policy across all 8 escalation modes, catalog views for all 5 resource
  classes via injected C002/C005/C008/C014/A032 ports, deterministic ResourceMatch composition
  engine (fail-closed budget cap, closed outcome vocabulary), digest-chained decision history;
  services/capability-routing — service seam + A015 durable idempotent jobs. 73 owned tests
  (52 pkg + 21 svc) incl. adversarial (cross-tenant leakage, qualification-as-authorization,
  budget-infeasible composition, stale/delisted artifacts). Worker battery green. Open
  (recorded): host wiring of real catalogs + C001/C002/C021 adoption are other work orders;
  mirror-shape confirmations in PR.

- C020 MERGED — network quality: reputation, disputes, anti-gaming, fraud controls
  PR #147 (merged b22d64f; issue #126). Harvest record (TL, 2026-10-07): packages/
  network-quality — dimensional reputation (5 record families), dispute state machine, COI
  registry, anti-gaming (sybil/brigading/vote-abuse/payout-anomaly) + fraud controls with
  ingestion (92 tests); services/network-quality — dispute/COI/jobs with idempotency,
  runCapacityGamingDetection wired to the C011 engagement seam (conduct-flag evidence,
  requalification proposals, cross-tenant leak fails closed) (19 tests). Findings PROPOSE,
  never silently adjust. Worker battery green (8m58s build, no OOM). Open (recorded):
  in-memory reference fabric; policies injectable defaults not tenant-configurable; dep seams
  are structural mirrors pending real event feeds; no dedicated canonical spec (derived from
  work-items row + AE1.0 + FINAL-HANDOFF §7/§18 + security.md, disclosed).

Integrated-main TL station battery GREEN at b22d64f (check/boundary clean, contracts
byte-identical, typecheck 114/114, lint 114/114, test 114/114 tasks, build 114/114) —
wave 8 complete: 19 of 22 C-WOs landed (C001-C015, C017-C020). The 00:00 UTC deadline
passed during this harvest (23:47-00:0x) — cadence continues per operator directive
("stay up until the entire roadmap is done"), disclosed honestly.

C-series wave 9 (FINAL) AUTHORIZED on live main @ b22d64f+ (frontier recomputed after
C015/C020 merges — ALL remaining deps verified): C016 (#122, capability economics — deps
C005/C009/C010/C015 ✓), C021 (#127, escalation observability and SLA operations — deps
C001/C005/C010/C011/C015 ✓), C022 (#128, capability learning compiler — deps
C008/C009/C013/C014/A020-A023 ✓). These are the LAST three work orders of the roadmap.

- C016 MERGED — capability economics / intervention unit economics
  PR #148 (merged 336c4b4; issue #122). Harvest record (TL, 2026-10-08 01:14 UTC):
  packages/capability-economics — unit-economics projections over the C010 commercial truth,
  Q1.0 "verified capability gain per unit of expert effort" value side, no-money-truth and
  no-collapsed-score invariants (48 tests); services/capability-economics — durable idempotent
  recompute jobs, EXPLICIT demo/customer truth lens (20 tests). Worker battery green. Open
  (recorded): shared job-runner migration question + read-model lens pattern question in PR.

- C022 MERGED — capability learning compiler (the FINAL work order)
  PR #149 (merged 36b5fc6; issue #128). Harvest record (TL, 2026-10-08): packages/
  capability-learning — LE1.0 class-explicit ImprovementPrograms with closed
  compilable/blocked outcomes, A020 experiment assembly, Q1.0 five-condition typed-verdict
  gate, structurally-impossible ungated proposals into A021/A022/A023, tested boundary wall,
  CC1.0 feedback/IEV ranking (67 tests); services/capability-learning — ingest→compile→
  experiment→dispatch pipeline, idempotent, audited (22 tests). All 5 adversarial minimums
  verified. Worker battery green. Open (recorded): proposal-envelope lineage question; Q1.0
  thresholds are injectable defaults.

- C021 MERGED — human escalation observability and SLA operations
  PR #150 (merged fcc9215; issue #127). Harvest record (TL, 2026-10-08): packages/
  escalation-observability — C001 timeline projections, C011 SLA measurement with evidence
  law + supersession, A035 SLO rollups with disclosed formulas, health signals, alert-rule
  projections (55 tests); services/escalation-observability — durable idempotent projection
  jobs over C001/C011/C010/C015 ports, fail-closed (12 tests); apps/web/src/escalation-ops —
  operator board with fail-closed session boundary + labelled demo corpus (5 route tests).
  Worker battery green. Open (recorded): C005 declared-but-unconsumed dependency question in
  PR; projection feeding model question.

Integrated-main TL station battery GREEN at fcc9215 (check/boundary clean, contracts
byte-identical, typecheck 120/120, lint 120/120, test 120/120 tasks, build 120/120) —
THE FINAL STATE OF THE COMPLETE ROADMAP.

=== ROADMAP COMPLETE ===

A001-A036 (36) + B001-B019 (19) + G001-G003 (3) + C001-C022 (22) = 80 work orders —
ALL MERGED. The Arena product thesis is fully implemented on main: the Stripe of human
expert escalation for AI automation — escalation API/MCP/webhooks with a durable lifecycle,
capability-demand routing, expert intake/calibration/performance, privacy-safe expert
sessions with policy packs, live intervention modes, validation/adjudication, payments and
escrow, developer portal with API keys and sandbox, human-data studio, adversarial expert
evaluation, capability-body marketplace, cross-resource matching, economics, network
quality, observability/SLA operations, reference integrations (Epoch + generic AI app),
tool-gap/knowledge capture, and the capability learning compiler closing the loop.

Honest disclosures at completion: (1) the 00:00 UTC Oct 8 deadline was missed by ~1.25h —
the final wave (C016/C021/C022) merged 01:14 UTC per the operator directive to continue
until the roadmap was done; (2) reference fabrics are in-memory by house design — production
host wiring (persistence, HTTP listeners, real providers, route mounts for the three
unmounted web features) is the post-roadmap program; (3) workers' recorded architecture
questions (one per PR, all preserved in PR bodies and this file) define the next
architecture-review backlog.


## AUTHORITATIVE FRONTIER — POST-ROADMAP PRODUCTIONIZATION (2026-10-09)

**The full original roadmap is complete: A001–A036 (36) + B001–B019 (19) + G001–G003 (3) + C001–C022 (22) = 80/80 merged.** Latest reviewed main is 07a6b72d0fd82e087e159176a999b19adf8ced05. The recorded integrated-main battery passed 120/120 tasks at fcc9215; CI and Deploy preview on 07a6b72 succeeded.

The next frontier is P001–P008 in spec/post-roadmap-production-work-items.md, with sequence/concurrency in spec/post-roadmap-production-dependency-graph.md. Start P001 architecture-question closure; after its blocking decisions, P002/P004/P005 can run concurrently on disjoint surfaces (maximum three workers). Do not re-dispatch or relabel completed A/B/G/C work orders.

Known productionization limits (must not be hidden): multiple C-series services still use in-memory reference fabrics/injected ports; C019 generic client uses an in-process reference fabric and does not exercise MCP; G002 could not directly prove Neon migration/connectivity; the R2 bucket was empty at probe time and full object lifecycle is unproven; Upstash PING is not end-to-end coordination evidence; three web surfaces/mounts require a source-tree inventory; /tasks was observed to render the generic landing shell; launch checklist remains 7/69 checked and unreconciled; this review could not re-probe the current hosted endpoint and could not verify main branch protection through the connected GitHub integration. See docs/LLM-ARCHITECT-FINAL-HANDOFF.md and docs/evidence/* for evidence dates and full qualifications.

Commercial/payment readiness is distinct from deterministic payment abstractions. Confirm real-provider, merchant-of-record, tax, payout, refund/dispute and jurisdiction responsibilities before any live-money claim.
