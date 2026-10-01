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
- docs/launch-checklist.md

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


---

# FINAL TL EXECUTION DIRECTIVE — ARENA PRODUCTIZATION

## 1. Mandate

You are the Tech Lead / Orchestrator for the entire remaining Arena roadmap.

Do not treat this document, or the chat that produced it, as the implementation itself. The repository is the sole source of truth.

Your responsibility is to drive B001-B019 from READY to MERGED to ACCEPTED and finally close the public-preview launch gate.

Do not stop at “the code exists” or “CI is green”. The end state must be demonstrated from a fresh machine and a fresh browser profile.

## 2. What is already complete

A001-A036 are the completed Arena V1 core.

Do not reopen them merely to make the product easier to build.

Core invariants from A1.0 remain locked:

- Agent Body is a first-class persistent object.
- Body Version is immutable/content-addressed.
- Cognitive Substrate is distinct from Agent Body.
- Possession is the versioned binding between Body and Substrate plus runtime/environment/policy configuration.
- Certification is a claim about the tested composition, not about the raw model.
- Evaluation and Verification are different authorities.
- Historical evidence is append-only.
- Environment execution is isolated/bounded.
- Expert qualification is not authorization.
- Providers/models are behind adapters.
- Arena must not become the semantic authority of Epoch.
- Epoch World Model, Action Gateway, Constraint Engine, Verification/Evidence and Delivery State remain Epoch authorities.
- No direct Arena writes to Epoch authoritative stores.
- Long-running jobs are idempotent/correlation-addressable.
- Tenant/customer data remains isolated.

Any proposed violation requires an Architecture Change Request before implementation.

## 3. Product end state

At completion, a person who knows nothing about Arena must be able to:

1. open Arena;
2. understand the product in the first session;
3. enter a deterministic demo without provider credentials;
4. hold multiple granted roles;
5. switch roles without changing authorization;
6. understand a capability gap;
7. follow a capability case through the complete lifecycle;
8. inspect an Agent Body;
9. understand Body versus Cognitive Substrate versus Possession;
10. watch/replay an environment run;
11. distinguish expert action, model output, evaluation and verified evidence;
12. compare different substrates possessing the same Body;
13. inspect certification and release provenance;
14. discover/purchase/publish marketplace artifacts where entitled;
15. monitor jobs and hosted capacity;
16. perform the principal workflows on desktop and mobile;
17. do all of the above locally and on the hosted preview.

The product should feel like a guided professional workspace, not an API explorer or engineering diagnostics page.

## 4. Product architecture

Canonical Arena domains remain the source of truth.

The frontend is a projection layer.

Never create a second domain model in React state, route-local storage or ad hoc APIs.

Preferred flow:

Browser
-> role/session context
-> product/read-model API
-> canonical Arena services/protocols
-> persistence/artifact/workflow adapters
-> external providers

For long-running work:

UI command
-> authenticated API command
-> durable Job
-> worker/runner
-> checkpoint/events
-> canonical result
-> read-model projection
-> UI

Do not make one Vercel request the durable worker for long-running jobs.

## 5. Role architecture

The authoritative conceptual chain is:

Identity
-> Tenant
-> Policy/Permission
-> Granted Roles
-> Active Role Context
-> UI Projection

Active role is a lens, not an authorization mechanism.

Required reference roles:

- Owner/Customer
- Agent Builder
- Expert
- Evaluator
- Researcher
- Operator
- Marketplace Participant
- Administrator

A person can hold several or all of them.

Changing the active role may change:

- landing page;
- navigation emphasis;
- primary CTA;
- object projection;
- inspector content;
- recommended next actions.

Changing the active role must never change:

- tenant;
- permission grants;
- authorization;
- data visibility;
- audit identity.

## 6. UX north star

Use ShareNet as inspiration for interaction quality only:

- calm onboarding;
- clear state;
- progressive disclosure;
- generous whitespace;
- one meaningful primary action;
- restrained motion;
- accessibility.

Do not copy ShareNet's information architecture or visual identity.

Arena's experience should emphasize:

- capability discovery;
- guided work;
- role switching;
- interactive inspection;
- replay;
- evidence;
- causality;
- Body/Substrate/Certification clarity.

Workers are explicitly encouraged to be creative inside these boundaries.

They may innovate in:

- layout;
- visual language;
- animation;
- capability maps;
- 2D/3D representations;
- timeline/replay mechanics;
- inspector patterns;
- empty/loading/success transitions.

They may not innovate on canonical semantics or authority.

## 7. Product truth vocabulary

Every important user-visible state must be classified.

Use explicit labels/visual language for:

- Verified fact
- Evidence
- Expert judgment
- Model output
- Simulation / Replay
- Evaluation result
- Certification
- Suggestion / Hypothesis
- Demo state
- Pending
- Unknown

Do not collapse these into generic “AI result”, “verified”, “score” or “success” badges.

A purchased artifact is not automatically certified.

A model is not automatically a professional.

A replay is not a live-world mutation.

A role is not permission.

## 8. Work Order execution protocol

Every B-series Work Order must follow:

1. TL recomputes readiness from the live main branch.
2. TL confirms dependency SHAs are merged.
3. TL freezes owned write surfaces.
4. TL records dispatch base SHA.
5. TL gives worker only one Work Order.
6. Worker creates one branch and one PR.
7. Worker stays inside owned surfaces.
8. Worker does not modify governance state or lockfiles unless explicitly authorized.
9. Worker includes positive and negative tests.
10. Worker provides reproducible verification evidence.
11. TL reviews changed paths against ownership.
12. TL runs/reviews CI and product battery.
13. Any remediation is performed on the same PR.
14. Only TL accepts and merges.
15. TL records exact merge SHA and verification baseline.
16. TL updates project state and handoff.
17. TL recomputes the frontier.
18. TL dispatches the next safe wave.

Never dispatch from stale text.

## 9. Three-worker concurrency law

Maximum concurrent workers: 3.

Concurrent Work Orders must have pairwise-disjoint write surfaces.

Do not split a logical feature between workers unless the split is expressed as a stable package/contract boundary.

Do not allow two workers to edit:

- the same page;
- the same package manifest;
- the same generated contract;
- the root lockfile;
- the same governance file.

Root manifest/lockfile changes are serialized.

When a dependency is needed, worker reports it; TL reconciles it centrally.

## 10. Roadmap execution sequence

### Wave 1 — Foundation — LANDED (2026-10-01)

Dispatch exactly:

B001
B002
B003

B001 establishes the web host/design system. — MERGED via PR #67 (2b01b7b)

B002 establishes provider-neutral persistence/infrastructure contracts and hosted adapters. — MERGED via PR #68 (3ab66f9)

B003 establishes role/context/projection contracts. — MERGED via PR #66 (7605fe6)

These three are intentionally pairwise-disjoint. Each merge passed a full
TL-station battery plus an integration battery (final wave-1 tree: 61/61).

### Wave 2 — Secure product substrate

Dispatch:

B004
B005

B004 establishes secure identity/session/tenant browser boundaries. — MERGED via PR #70 (865c851)

B005 exposes persisted canonical read models through the product/API boundary. — MERGED via PR #72 (8a6e6e9)

B006 may begin only when its declared dependencies are satisfied; prefer stabilizing B004/B005 first if the worker budget is constrained.

### Wave 3 — First-use product

Dispatch:

B007
B008
B009

B007 = role-aware Capability Cockpit and shell.

B008 = Capability Case + Task guided workflow.

B009 = Expert workflow/workbench.

These must share read-model semantics rather than creating duplicate data models.

### Wave 4 — Deep capability experience

Dispatch:

B010
B011
B012

B010 = Body Studio + possession/substrate comparison.

B011 = Environment/Trajectory replay.

B012 = Evaluation/Verification/Certification + Research.

The three should converge on a coherent visual language while preserving independent ownership.

### Wave 5 — Commercial/operations/hosting

Dispatch:

B013
B014
B015

B013 = marketplace.

B014 = operations/jobs/SLO/capacity.

B015 = deployment/provider wiring.

B015 must consume B002/B004/B005/B014 contracts and cannot bypass them.

### Wave 6 — Installability and acceptance

Dispatch where dependencies are genuinely ready:

B016 = local install/seed/reset.

B017 = end-to-end product/UX/operational conformance.

B018 = accessibility/mobile/performance/resilience/product polish.

Do not let B018 become a generic redesign. It is a quality/launch gate over the already-defined product architecture.

### Final launch gate

B019 is serialized.

It owns:

- public preview acceptance;
- launch runbooks;
- hosted demo;
- quota/cost monitoring;
- release evidence;
- final product gate.

No “ready” claim before B019 is accepted.

## 11. B-series acceptance logic

### B001
Accepted when:
- real product host exists;
- Vercel-compatible build passes;
- design tokens/components are coherent;
- mobile shell works;
- accessibility primitives exist;
- diagnostics is no longer the default product experience.

### B002
Accepted when:
- Neon/R2/Upstash adapters satisfy provider-neutral contracts;
- local fakes have contract parity;
- quotas/capacity states exist;
- paid fallback is impossible;
- secrets remain server-side;
- migrations/bootstrap are reproducible.

### B003
Accepted when:
- all reference roles exist;
- active role is distinct from permission;
- role projection is canonical-object-based;
- switching is deterministic and testable.

### B004
Accepted when:
- browser session boundary is secure;
- tenant identity is preserved;
- authorization remains server/policy controlled;
- authentication failures fail closed.

### B005
Accepted when:
- UI can read persisted canonical state;
- versions/provenance/tenant boundaries survive reload;
- read model does not become a second authority.

### B006
Accepted when:
- a fresh browser can enter Demo with no provider credentials;
- demo is deterministic;
- demo is resettable;
- demo state is visibly labelled;
- the full reference narrative exists.

### B007
Accepted when:
- shell, workspace and role switcher work;
- home answers “what am I doing and what can I do next?”;
- active role changes the lens, not authorization.

### B008
Accepted when:
- user can start/continue a Capability Case;
- Task and case state are truthful;
- progression follows canonical lifecycle;
- guided workflow is understandable to a new user.

### B009
Accepted when:
- expert can discover assigned work;
- enter the workbench;
- perform/review work;
- submit evidence;
- see correct task/run/trajectory states.

### B010
Accepted when:
- Body Studio exists;
- Body versioning is explicit;
- skills/knowledge/tools are inspectable;
- Body/Substrate/Possession distinction is unmistakable;
- substrate comparisons are composition-scoped.

### B011
Accepted when:
- user can replay runs;
- timeline distinguishes observation/action/tool/result;
- replay never implies live mutation;
- engineering evidence remains accessible.

### B012
Accepted when:
- evaluation, verification and certification are separate concepts;
- research comparisons are composition-scoped;
- evidence and unknown causes are surfaced.

### B013
Accepted when:
- expert and artifact marketplaces are usable;
- provenance/rights/verification are visible;
- offer/grant/entitlement semantics are explicit;
- purchase never implies certification.

### B014
Accepted when:
- jobs, incidents, SLOs, audit and capacity can be understood;
- correlation IDs connect operational state to work;
- free-tier capacity is visible.

### B015
Accepted when:
- Vercel deployment works;
- Neon, R2 and Upstash integration works;
- optional Apify dry run works;
- no required demo path depends on a paid-only provider feature;
- secrets and environment configuration are documented.

### B016
Accepted when:
- clean machine setup is reproducible;
- demo seed/reset is simple;
- local and hosted product contracts are aligned.

### B017
Accepted when:
- complete capability lifecycle E2E passes;
- role-switch regression passes;
- UX-to-operational simulation passes;
- hosted/local parity passes.

### B018
Accepted when:
- accessibility checks pass;
- mobile workflows pass;
- performance budgets pass;
- resilience/error recovery pass;
- visual regression does not violate architecture.

### B019
Accepted only when every launch-checklist gate is green and reproducible evidence is attached.

## 12. Mandatory end-to-end scenario

The TL must ensure one automated + one human-readable walkthrough for:

Owner
-> capability gap
-> Capability Case
-> Task
-> Environment
-> run/replay
-> Trajectory
-> Evaluation
-> Verification
-> Learning
-> Agent Body Version
-> Possession
-> Substrate comparison
-> Certification
-> Release
-> Marketplace visibility/entitlement
-> Epoch consumption
-> Operations visibility

Then repeat the relevant portions through at least four role lenses:

Owner
Agent Builder
Expert
Researcher

And verify that an Operator can trace failures without changing the business meaning of the object.

## 13. Deployment architecture

Preview target:

Vercel Hobby
+
Neon Free
+
Cloudflare R2 Standard
+
Upstash Redis Free

Apify is optional and bounded.

Rules:

- domain code stays provider-neutral;
- providers are adapters;
- PostgreSQL is authoritative for control-plane state;
- R2 stores immutable large artifacts;
- Redis stores bounded/rebuildable state;
- Apify is acquisition only;
- no hidden paid fallback;
- capacity state is visible;
- quota exhaustion fails closed.

Do not assert that the entire system is “free” without qualification. The correct claim is that the declared preview profile is designed and tested to operate within the providers' published free allowances.

## 14. Local architecture

The product must support:

- Node 22 as pinned by the repository;
- reproducible package install;
- local infrastructure fakes/defaults where feasible;
- deterministic demo;
- resettable seed;
- explicit environment configuration for connected mode.

The first successful local run must not require a user to understand PostgreSQL, R2, Redis or Apify.

## 15. Testing strategy

Do not rely on a single test type.

The B-series must contain:

### Contract tests
Adapters and product projections match canonical protocols.

### Unit tests
Role logic, projection logic, state classification, quota logic, route helpers.

### Integration tests
Persistence, auth/session boundaries, artifact lifecycle, job/read-model flow.

### Negative/adversarial tests
Cross-tenant denial, role escalation attempts, replay mutation confusion, paid-fallback attempts, exhausted providers, malformed claims, stale versions, revoked rights.

### Product E2E
Real browser journeys over local and hosted-compatible stacks.

### UX checks
Desktop, tablet, mobile, keyboard and reduced motion.

### Performance
Page load, route navigation, read-model latency, replay rendering, artifact access, job polling/streaming.

### Fresh-machine acceptance
At least one clean environment path must be exercised before B019.

## 16. Browser UX verification

Use the repository's available browser-verification tooling where appropriate.

Every major user route must be inspected visually, not only asserted by DOM/unit tests.

Check:

- first-run onboarding;
- home;
- role switcher;
- case;
- expert workbench;
- Body Studio;
- replay;
- evaluation/certification;
- marketplace;
- operations;
- settings.

Look specifically for:

- dead ends;
- ambiguous CTAs;
- accidental admin language;
- state misrepresentation;
- role leakage;
- excessive dashboard density;
- mobile overflow;
- loading flashes;
- inaccessible focus;
- misleading certification/verification badges.

## 17. Creative-worker contract

Workers should not be micromanaged on visual implementation.

Each UX Work Order should receive:

- intent;
- canonical data dependencies;
- authority constraints;
- allowed states;
- acceptance scenarios;
- owned surfaces.

Then let the worker solve the visual composition.

TL review must judge the result against:

1. canonical truth;
2. role safety;
3. workflow completion;
4. usability;
5. accessibility;
6. consistency;
7. performance.

Do not reject creative variation merely because it differs from a proposed wireframe.

Do reject any variation that changes product semantics.

## 18. Change-control

Architecture changes are not to be smuggled into UI work.

A worker discovering an architectural gap must:

- document the finding;
- stop broadening scope;
- propose the smallest contract-level correction;
- let the TL determine whether an Architecture Change Request is required.

A UI workaround is not acceptable if it causes:

- duplicate authority;
- hidden state;
- role-derived authorization;
- fake completion;
- provider leakage;
- impossible lifecycle states.

## 19. Evidence discipline

Every accepted Work Order must leave evidence in the repository/PR:

- implementation summary;
- changed-surface declaration;
- tests;
- commands;
- outputs/results;
- limitations;
- screenshots or browser evidence for user-facing work where relevant;
- exact commit/merge SHA.

Do not report “tested” without commands/results.

Do not report “deployed” without a deployment identifier/URL and health evidence.

Do not report “free-tier” without the provider configuration and quota evidence.

## 20. State-management discipline

Prefer server/canonical state for authoritative facts.

Client state may contain:

- navigation;
- transient interaction;
- drafts;
- filters;
- animation;
- local view preferences.

Client state must not become the hidden authority for:

- role grants;
- permissions;
- certification;
- release state;
- entitlement;
- job completion;
- verification;
- tenant identity.

## 21. Demo discipline

Demo must be:

- deterministic;
- isolated;
- resettable;
- visibly labelled;
- representative of actual contracts.

The demo should use the same canonical object shapes/read models that live workflows use.

Avoid building a “fake demo API” that bypasses the product architecture.

## 22. Launch decision tree

The TL must not use subjective confidence as the launch criterion.

Use:

Local gates
AND
Hosted gates
AND
UX gates
AND
Security gates
AND
E2E gates
AND
Accessibility/mobile/performance gates
AND
Fresh-user evidence
AND
Free-tier guardrails
=
Launchable preview

Any red gate means the statement “Arena is ready” is not yet authorized.

## 23. Final completion artifact

At B019 acceptance, create/update:

- spec/PROJECT-STATE.md
- AI_CONTINUATION.md
- docs/LLM-ARCHITECT-HANDOFF.md
- docs/launch-checklist.md
- docs/getting-started/*
- docs/launch/*
- release/preview/*
- deployment URL record
- exact release commit SHA
- final test/verification baseline

The final state must be self-describing enough that a new architect can take over immediately.

## 24. First action for the new TL

Before dispatching any worker:

1. read the repository documents named above;
2. inspect live GitHub main/branches/PRs/issues;
3. verify A001-A036 remain merged;
4. verify B001/B002/B003 are still the only authorized first-wave items;
5. record the exact current main SHA;
6. dispatch B001, B002 and B003 to three workers with frozen surfaces;
7. reject any worker plan that requires shared-file parallel editing;
8. begin continuous reconciliation after each merge.

Do not ask the user to restate the architecture.

Do not wait for chat instructions between normal roadmap steps.

The repository now contains the roadmap, contracts, UX architecture, operational simulation, deployment target, launch gate and worker boundaries required to execute the entire remaining program.


# APPROVED PRODUCT DIRECTION — HUMAN ESCALATION INFRASTRUCTURE

The approved long-term product thesis is:

> Arena is the Stripe of human expert escalation for AI automation.

This changes the commercial center of gravity of Arena while preserving the A-series core.

## What Arena provides

Any AI application can call Arena when the agent reaches a capability boundary.

Arena handles:

Application
→ escalation
→ capability analysis
→ expert discovery/qualification
→ expert matching
→ secure environment session
→ human intervention
→ validation
→ machine-readable result
→ payment
→ optional learning/tool/knowledge/body improvement.

Epoch is one customer/integrator of this API, not Arena's defining application.

## Escalation modes

Supported modes:

- SOLVE
- CORRECT
- UNBLOCK
- REVIEW
- TEACH
- TOOL_GAP
- KNOWLEDGE
- EVALUATE

The immediate operational result is separated from any reusable learning artifact.

## Same-environment expert session

For escalations that support it, Arena creates an isolated ExpertSessionCapsule from the agent's execution state.

The human gets a secure link from Arena.

The session reproduces the relevant agent environment while enforcing:

- privacy barriers;
- data minimization;
- secret exclusion;
- tool/action allowlists;
- tenant isolation;
- time limits;
- live-world separation.

The expert's observable actions, tool invocations, outputs, corrections and annotations may be streamed to the originating agent/application when policy allows.

Do not expose or require hidden chain-of-thought. Capture observable work and explicit evidence.

## The intervention is a learning opportunity

A single intervention may generate:

- immediate correction;
- knowledge patch;
- tool-gap signal;
- tool specification;
- skill candidate;
- evaluator/verifier evidence;
- trajectory;
- benchmark case;
- improved Agent Body;
- reusable marketplace artifact.

Nothing is made globally reusable without validation, provenance, rights and scope.

## Tool-gap loop

When an expert needed a capability unavailable to the agent, capture a ToolGapSignal.

That can lead to:

ToolGapSignal
→ Tool specification
→ provider/adapter integration
→ Body update
→ benchmark
→ marketplace artifact.

This means Arena improves not only the model, but also the agent's surrounding tools and domain knowledge.

## Payment model

Expert work is a commercial transaction.

The originating AI application may specify a budget and authorize payment.

Arena handles:
- offer/acceptance;
- payment hold/authorization;
- validation condition;
- expert payout;
- platform fee;
- refund/revision paths;
- accounting/audit.

Payments are provider-neutral. A Connect-style marketplace provider is an appropriate adapter pattern for an initial implementation because platform application fees and multi-party transfers are supported by current Stripe Connect patterns. Exact merchant-of-record, payout and jurisdiction responsibilities must be decided before production rollout. citeturn787126search0turn787126search1

## Human Intelligence Fabric

The C-series introduces the Human Intelligence Fabric around the existing Expert Registry:

Capability Demand
→ Expert Discovery
→ Adaptive Qualification
→ Calibration
→ Matching
→ Engagement
→ Session
→ Intervention
→ Validation
→ Performance Evidence
→ Requalification.

This incorporates the strongest Micro1-inspired ideas without turning Arena into a staffing company.

## Expert performance

Create a longitudinal evidence-backed Expert Performance Profile covering:
- quality;
- reliability;
- task fit;
- verification acceptance;
- response/turnaround;
- revision history;
- domain breadth/depth;
- historical difficulty;
- cost efficiency.

Do not reduce the profile to one simplistic score.

## Adversarial Expert Evaluation

Arena gains an alternative evaluator-scarcity route:

Problem
→ independent expert solutions
→ adversarial challenges
→ proof/evidence
→ responses
→ qualified voting
→ adjudication
→ verification.

Upvote/downvote ratio is allowed as a community/discovery signal but cannot by itself establish correctness or certification.

Minimum safeguards:
- evidence required for substantive votes;
- no self-voting;
- conflict-of-interest handling;
- minimum sample size;
- anti-brigading/rate limiting;
- qualification-aware aggregation;
- explicit unknown/tie states.

Pairwise comparison methods and debate-style competing-prover research provide useful foundations for this evaluation approach, but Arena's own Verification authority remains final. citeturn128285academia14turn956631search6

## Why same-environment intervention is normative

The purpose is not only to let an expert answer a question.

It minimizes context translation and makes the intervention directly comparable to the agent's own workflow state.

Interactive imitation-learning research supports the value of corrective human intervention in the task state and shows ways to reduce expert monitoring burden while collecting higher-quality intervention data. citeturn956631academia0turn956631academia1

Recent HITL products likewise expose API-first task escalation and return structured machine-readable results, reinforcing the viability of the API boundary as a product primitive. citeturn128285search0turn128285search3

## C-series roadmap

The complete post-B roadmap is in:
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md

C001-C022 are the execution program.

The first safe C-wave is:

C001 — Escalation API/MCP/webhooks
C002 — capability-demand/routing compiler
C010 — payments/platform fees

Then progressively:
- adaptive expert intake;
- calibration;
- expert sessions;
- intervention modes;
- tool/knowledge capture;
- validation;
- expert performance;
- engagement;
- human-data production;
- adversarial competition;
- Agent Body pretraining marketplace;
- capability-demand routing;
- developer portal;
- enterprise privacy packs;
- Epoch/generic integrations;
- network quality/fraud/disputes;
- escalation operations;
- final capability-learning compiler.

The C-series must obey the same three-worker concurrency and repository-governance laws as B-series.

## Strategic product boundary

Arena is not:
- a generic recruiting company;
- a payroll system;
- a generic crowdsourcing site;
- a social voting site;
- an LLM hosting platform.

Arena is:
- human escalation infrastructure;
- capability acquisition infrastructure;
- human-data production infrastructure;
- capability improvement infrastructure;
- capability commerce.

The API is the primary commercial boundary.

## Canonical external flow

A generic AI application should ultimately be able to do:

POST escalation
→ receive request_id
→ Arena routes a qualified human
→ secure session starts
→ agent/app observes approved intervention
→ result is validated
→ structured result delivered
→ expert is paid
→ Arena collects fee
→ optional learning artifact is produced.

Epoch must work through exactly this generic boundary rather than receiving special treatment in the core architecture.

## Agent learning boundary

The originating application controls whether and how returned artifacts update its live agent.

Arena may produce candidate:
- skill;
- knowledge;
- tool;
- evaluator;
- benchmark;
- Body update.

Arena must not silently mutate the host application's live Agent or World Model.

## C-series acceptance bar

C-series is complete only when an unrelated third-party AI application, without Arena-specific internal access, can exercise the complete escalation flow and receive a validated machine-readable result.

Epoch and at least one generic reference client must prove this.

At least one real product flow must demonstrate:
1. agent reaches a capability boundary;
2. Arena recruits/matches a human;
3. expert receives a safe replica of the agent environment;
4. expert solves/corrects/unblocks;
5. agent receives the approved result;
6. payment settles;
7. Arena fee is recorded;
8. tool/knowledge/learning signals are captured where permitted;
9. the intervention can be replayed;
10. the same evidence can support future capability improvement.

