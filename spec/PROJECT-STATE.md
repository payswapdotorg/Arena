# Arena Project State

Architecture: A1.0
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

### First wave

B001 READY — Web runtime foundation / Next.js App Router / design system
Issue #63
Owned: apps/web/*, packages/ui-platform/*

B002 READY — Hosted persistence/infrastructure adapters
Issue #64
Owned: packages/persistence/*, adapters/hosted/*, services/persistence/*

B003 READY — Role/context model and projection contracts
Issue #65
Owned: packages/role-context/*, contracts/role-context/*

These are intentionally pairwise-disjoint and are the only current authorized productization wave.

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
- B001 AUTHORIZED
- B002 AUTHORIZED
- B003 AUTHORIZED
- B004 WAITING_ON_DEPENDENCIES
- B005 WAITING_ON_DEPENDENCIES
- B006 WAITING_ON_DEPENDENCIES
- B007 WAITING_ON_DEPENDENCIES
- B008 WAITING_ON_DEPENDENCIES
- B009 WAITING_ON_DEPENDENCIES
- B010 WAITING_ON_DEPENDENCIES
- B011 WAITING_ON_DEPENDENCIES
- B012 WAITING_ON_DEPENDENCIES
- B013 WAITING_ON_DEPENDENCIES
- B014 WAITING_ON_DEPENDENCIES
- B015 WAITING_ON_DEPENDENCIES
- B016 WAITING_ON_DEPENDENCIES
- B017 WAITING_ON_DEPENDENCIES
- B018 WAITING_ON_DEPENDENCIES
- B019 WAITING_ON_DEPENDENCIES
