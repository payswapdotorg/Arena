# Arena Agent Contract

## Non-negotiable

The repository is the only durable source of truth. Never rely on conversation memory or undocumented assumptions.

## Recovery

Read, in order:
- README.md
- AI_CONTINUATION.md
- docs/LLM-ARCHITECT-FINAL-HANDOFF.md
- spec/PROJECT-STATE.md
- spec/post-roadmap-production-work-items.md
- spec/post-roadmap-production-dependency-graph.md
- spec/architecture.md
- spec/architecture-lock.md
- spec/product-requirements.md
- spec/roles-and-contexts.md
- spec/ux-architecture.md
- docs/ux-operational-simulation.md
- docs/deployment/free-tier-architecture.md
- spec/free-tier-contract.md
- spec/post-v1-work-items.md
- spec/post-v1-dependency-graph.md
- the assigned Work Order
- live GitHub issue/PR state
- exact dispatch base SHA

## Architect / Tech Lead

Owns architecture, Work Orders, dispatch, acceptance, review, merge decisions and project state.

Maximum 3 concurrent workers.

Active Work Orders have frozen machine-auditable write surfaces. Concurrent Work Orders must be pairwise-disjoint.

The Tech Lead reconciles worker claims against live GitHub/API state, including SHAs, changed paths, CI, tests and merge ancestry.

## Worker

Implements exactly one Work Order, stays within declared ownership, never edits governance state in flight, never silently broadens scope, provides reproducible verification evidence, and never merges its own PR.

## Roadmap completion

A001-A036, B001-B019, G001-G003 and C001-C022 are complete/merged (80 work orders). They are not reopened for convenience. Consult the authoritative final handoff for current productionization tasks; do not follow historical C-series or launch-closure dispatch instructions.

Any change to a locked architecture contract requires an Architecture Change Request.

## Current objective: productionization

The active frontier is P001-P008 in `spec/post-roadmap-production-work-items.md`, sequenced by `spec/post-roadmap-production-dependency-graph.md`.

P001 closes architecture questions first. Then P002/P004/P005 may run concurrently on disjoint scopes, up to a maximum of three workers. Production host/persistence/transport/provider/integration proof is distinct from roadmap completion.

## Concurrency

No-rebase is default.

Concurrent Work Orders must not share source files, package manifests, generated contract surfaces, root manifests, lockfiles or governance state.

Shared contracts are implemented/stabilized before consumers.

Root dependency/lockfile reconciliation is serialized by the Tech Lead.

## UX authority

Role context is not permission.

Identity -> tenant -> policy/permission -> granted roles -> active role context -> UI workflow.

The UI is a projection of canonical Arena contracts.

Workers may creatively vary layout, visualizations, animation, metaphors and micro-interactions. They may not alter:
- canonical semantics;
- lifecycle state machines;
- authority boundaries;
- tenancy;
- role/permission semantics;
- provenance;
- evaluation/verification meaning;
- certification scope.

## Agent Body principle

A model is never synonymous with an Agent Body.

A Body Version is independently versioned and addressable.

Possession binds a Body Version to a Cognitive Substrate and runtime configuration.

Certification claims apply to the tested composition, not to the model in isolation.

## Replay / demo

Replay is observational unless a separately authorized live action is issued.

Demo state is never customer-authoritative state.

## Provider neutrality

Vercel, Neon, R2, Upstash and Apify are adapters only.

No provider-specific type or credential belongs in Arena domain contracts.

## Security

Untrusted task/environment workloads execute only inside approved isolation.

Secrets are never committed.

Customer data is never silently reused across tenants.

## Merge gate

Implementation complete + verification green + evidence complete + ownership compliant + Architect approval = merge.

## Remediation

Architect findings are fixed on the same PR with regression evidence.


## Approved long-term product direction

Arena's north star is: **the Stripe of human expert escalation for AI automation**.

The completed C-series turns the V1 capability infrastructure into an API-native human escalation network. The next work is P001-P008 productionization described in the authoritative final TL handoff. Any AI application may:
- escalate a capability boundary;
- request the required expert capability;
- receive a qualified human intervention;
- receive a validated machine-readable result;
- pay the expert through Arena;
- optionally receive approved tool, knowledge, skill, evaluation or Agent Body improvement artifacts.

Where supported, the expert works in a privacy-sanitized bounded replica of the agent's environment. The replica is never a live-world mutation path.

Approved escalation modes: SOLVE, CORRECT, UNBLOCK, REVIEW, TEACH, TOOL_GAP, KNOWLEDGE, EVALUATE.

The adversarial expert competition path is an alternate evaluation method, not a replacement for Verification.

See:
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md
