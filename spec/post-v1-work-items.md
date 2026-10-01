# Arena Post-V1 Productization Work Orders BWO1.0

## Purpose

A001-A036 delivered Arena V1 core. The B-series makes that core a product that satisfies all three user-facing requirements:

1. installable and usable locally;
2. hosted on free-tier-compatible infrastructure;
3. friendly, role-aware, visually rich UI.

## Dispatch contract

One Work Order = one branch = one PR.

Maximum 3 concurrent workers.

Concurrent Work Orders must have pairwise-disjoint write surfaces.

Root manifests/lockfiles remain Tech-Lead-owned for serialized reconciliation.

No B-series item may modify A-series semantic contracts without an explicit Architecture Change Request.

## Work orders

| ID | Scope | Depends | Owned surfaces |
|---|---|---|---|
| B001 | Web runtime foundation, Next.js App Router host, Arena design system primitives, route shell, responsive layout, loading/error primitives | A036 | apps/web/*, packages/ui-platform/* |
| B002 | Hosted persistence/infrastructure adapter layer: PostgreSQL repository ports, Neon adapter, R2 adapter, Upstash adapter, local fakes, health/capacity contracts | A036 | packages/persistence/*, adapters/hosted/*, services/persistence/* |
| B003 | Role/context model and role-aware projection contracts | A003,A034,A036 | packages/role-context/*, contracts/role-context/* |
| B004 | Identity/session/tenant integration and secure browser session boundary | B001,B002,B003 | packages/auth/*, services/auth/*, apps/web/src/auth/* |
| B005 | Persisted control-plane read model/API integration over canonical Arena objects | B002,B004,A025 | services/read-model/*, services/api-read/*, packages/read-model/* |
| B006 | Deterministic Demo/Preview mode and first-run guided narrative | B001,B003,B005,A028,A029 | apps/web/src/demo/*, packages/demo/*, docs/demo/* |
| B007 | Role-aware Home/Capability Cockpit and global navigation | B001,B003,B004,B005,B006 | apps/web/src/cockpit/* |
| B008 | Capability Case, Task and guided capability-development workflows | B005,B006,B007,A005,A008,A010,A011 | apps/web/src/capability/*, packages/product-flows/* |
| B009 | Expert Workbench and expert assignment/review workflow UX | B005,B006,B007,A006,A007,A017 | apps/web/src/expert/* |
| B010 | Agent Body Studio, Possession matrix, Skill/Knowledge/Tool composition and model-substrate comparison UX | B005,B006,B007,A021,A022,A023 | apps/web/src/bodies/*, packages/body-ui/* |
| B011 | Environment/trajectory replay viewer and interactive run inspection | B005,B007,A010,A011,A012,A013 | apps/web/src/replay/*, packages/replay-ui/* |
| B012 | Evaluation, verification, certification and research UX | B005,B007,A012,A013,A023,A030 | apps/web/src/evaluation/*, apps/web/src/research/* |
| B013 | Marketplace UX for experts and artifacts, including provenance/rights/verification/entitlements | B005,B007,A031,A032,A033 | apps/web/src/marketplace/*, packages/marketplace-ui/* |
| B014 | Operations, jobs, SLOs, audit and free-tier capacity UX | B005,B007,A015,A034,A035 | apps/web/src/operations/* |
| B015 | Production provider wiring and deployment automation: Vercel, Neon, R2, Upstash, optional Apify | B002,B004,B005,B014 | deploy/*, ops/deployment/*, .github/workflows/deploy* |
| B016 | Local install/seed/reset workflow and developer-friendly quickstart | B001,B002,B006 | scripts/product/*, docs/getting-started/*, release/local/* |
| B017 | Full product E2E, role-switch simulation, UX/operational conformance and regression suite | B008,B009,B010,B011,B012,B013,B014,B015,B016 | tests/product-e2e/*, tests/ux/*, docs/product-validation/* |
| B018 | Accessibility, mobile, performance, resilience and launch polish | B007-B017 | apps/web/src/**/a11y/*, apps/web/src/**/responsive/*, tests/performance/*, docs/release/product/* |
| B019 | Hosted preview acceptance, public demo, runbooks, cost/quota monitoring and launch gate | B015,B017,B018 | deploy/preview/*, ops/preview/*, docs/launch/*, release/preview/* |

## Parallelism

### First product wave

B001
B002
B003

All three have disjoint ownership and can be developed concurrently.

### Second product wave

After the first wave:

B004
B005

B006 may start as soon as B001+B003 exist, but must consume B005 only through its declared read-model contract. Prefer B004/B005 first if the worker limit is tight.

### Experience wave

Then fan out:

B007
B008
B009

followed by:

B010
B011
B012

and then:

B013
B014
B015

where dependency readiness permits.

### Finalization

B016 can progress once the web/persistence/demo path is stable.

B017 is the system-level acceptance gate.

B018 is the UX quality gate.

B019 is the public preview/launch gate.

## Ownership rules

Do not split a single UX flow across workers unless the boundary is an explicit package/contract boundary.

All role-specific screens use the same canonical data and product-flow contracts.

No worker may introduce provider-specific types into domain packages.

No worker may change lifecycle semantics for A-series objects merely to fit a UI.

## UX latitude

Workers may be creative in:

- visual composition;
- animation;
- storytelling;
- 2D/3D visualization;
- information grouping;
- interaction metaphors;
- empty/loading transitions.

Workers may not alter:

- authority;
- tenancy;
- role/permission semantics;
- Body/Substrate/Possession meaning;
- evidence/verification meaning;
- certification scope;
- lifecycle state machines.

## B-series completion

The program is complete only when all of the following are demonstrated on a clean machine and a fresh browser profile:

- local install and deterministic demo;
- hosted preview;
- role-aware shell;
- user can hold multiple roles and switch between them;
- at least two reference Bodies can be explored;
- a full Capability Case can be followed through Task/Environment/Trajectory/Evaluation/Verification/Certification/Release;
- the same underlying objects are correctly projected for at least Owner, Expert, Builder and Researcher roles;
- hosted persistence survives reload;
- free-tier capacity is visible and fail-closed;
- no billable fallback occurs;
- mobile and keyboard workflows are usable;
- UX regression suite passes;
- the final launch checklist is green.

## Product truth requirement

Every user-visible state must indicate whether it is:

- verified fact;
- evidence;
- expert judgment;
- model output;
- simulation;
- evaluation result;
- certification;
- suggestion/hypothesis;
- demo state.

The UI cannot collapse these into one generic “AI result”.
