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

### Fourth wave (B008/B009/B010 — three concurrent workers)

B008 AUTHORIZED — Capability Case, Task and guided capability-development
workflows
Deps B005+B006+B007+A005+A008+A010+A011 all MERGED; issue to be opened at
dispatch
Owned: apps/web/src/capability/*, packages/product-flows/*

B009 AUTHORIZED — Expert Workbench and expert assignment/review workflow UX
Deps B005+B006+B007+A006+A007+A017 all MERGED; issue to be opened at dispatch
Owned: apps/web/src/expert/*

B010 AUTHORIZED — Agent Body Studio, Possession matrix, Skill/Knowledge/Tool
composition and model-substrate comparison UX
Deps B005+B006+B007+A021+A022+A023 all MERGED; issue to be opened at dispatch
Owned: apps/web/src/bodies/*, packages/body-ui/*

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
- B008 AUTHORIZED
- B009 AUTHORIZED
- B010 AUTHORIZED
- B011 WAITING_ON_DEPENDENCIES
- B012 WAITING_ON_DEPENDENCIES
- B013 WAITING_ON_DEPENDENCIES
- B014 WAITING_ON_DEPENDENCIES
- B015 WAITING_ON_DEPENDENCIES
- B016 WAITING_ON_DEPENDENCIES
- B017 WAITING_ON_DEPENDENCIES
- B018 WAITING_ON_DEPENDENCIES
- B019 WAITING_ON_DEPENDENCIES

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
