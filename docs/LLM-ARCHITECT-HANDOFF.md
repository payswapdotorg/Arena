# Arena — LLM Architect / Tech Lead Handoff

## Mission

Arena V1 core A001-A036 is complete.

The next job is to turn that capability-development core into a product that ordinary users can install, discover, understand and use, without compromising the Agent Body / Cognitive Substrate architecture.

## Current truth

V1 is merged. The B-series is the active implementation program.

Read first:
- AGENTS.md
- AI_CONTINUATION.md
- spec/architecture-lock.md
- spec/product-requirements.md
- spec/roles-and-contexts.md
- spec/ux-architecture.md
- docs/ux-operational-simulation.md
- docs/deployment/free-tier-architecture.md
- spec/free-tier-contract.md
- spec/post-v1-work-items.md
- spec/post-v1-dependency-graph.md

## Product bar

Arena public preview is ready only when all of the following are true.

### Local use

A fresh machine can install and start Arena through a documented one-command path.

A fresh browser can enter deterministic Demo mode without infrastructure credentials.

The Demo narrates:
Capability Case -> Task -> Environment -> Trajectory -> Evaluation -> Verification -> Agent Body -> Possession -> Certification -> Release.

### Hosted use

The web app is on a stable Vercel URL.

Control-plane state uses Neon PostgreSQL.

Large immutable artifacts use Cloudflare R2.

Bounded coordination/cache/rate limiting uses Upstash Redis.

Apify remains optional for bounded external data acquisition.

Preview quota exhaustion is explicit and fail-closed.

### UX

The product has:
- lightweight onboarding;
- role-aware shell;
- persistent role switcher;
- workspace context;
- capability cockpit;
- guided capability workflows;
- expert workbench;
- Agent Body Studio;
- Body/Substrate/Possession visualization;
- environment/trajectory replay;
- evaluation/verification/certification views;
- marketplace;
- operations/capacity;
- responsive/mobile behavior;
- keyboard/accessibility support;
- loading/empty/error/denied/demo states.

## Design reference

ShareNet is a reference for interaction qualities: calm onboarding, sparse hierarchy, explicit status, progressive disclosure and a primary action.

Arena is not a ShareNet clone. Its UX must support complex engineering workflows and multiple role lenses.

## Role semantics

Identity -> Tenant -> Permission/Policy -> Granted Roles -> Active Role Context -> UI Workflow.

Changing active role does not grant authority.

The same canonical object has different projections.

A Capability Case can appear as:
Owner: why is my agent struggling?
Expert: what work am I being asked to perform?
Builder: what capability is missing?
Researcher: what evidence supports the hypothesis?
Operator: is the workflow healthy?

## Agent semantics

Agent Body and Cognitive Substrate remain separate objects.

Possession binds them.

Certification is scoped to:
Body Version × Substrate × Environment × Runtime × Certification Suite.

The UI must reinforce this distinction.

## Operational boundary

Frontend code never invents domain truth.

Replay is observational unless a separately authorized live action occurs.

Marketplace purchase, certification and professional authorization are distinct.

## UX validation

docs/ux-operational-simulation.md contains the pre-implementation scenario simulation and the resulting normative changes.

## B-series implementation

B001 — web runtime foundation and design system
B002 — hosted persistence and infrastructure adapters
B003 — roles and contexts
B004/B005 — secure identity/session and persisted read models
B006/B007 — demo and capability cockpit
B008-B014 — main role-specific workflows
B015 — deployment
B016 — local install
B017 — product E2E and UX/operational conformance
B018 — accessibility/mobile/performance/resilience
B019 — hosted preview and launch gate

## Concurrency

One Work Order = one branch = one PR.

Maximum three concurrent workers.

Exact write surfaces are frozen before dispatch.

Root dependency/lockfile reconciliation is serialized by the Tech Lead.

Workers may innovate within UX composition, animation and interaction patterns but cannot change canonical lifecycle, role/permission, authority, provenance or certification semantics.

## Definition of done

A fresh user can:
- open Arena;
- understand what it does;
- choose a role;
- switch roles;
- create or explore a capability case;
- inspect an Agent Body;
- watch/replay a run;
- understand evidence and certification;
- compare substrates for one Body;
- discover capability artifacts;
- use the same workflows locally or through the hosted preview.

A fresh engineer can implement the next Work Order using repository state alone.
