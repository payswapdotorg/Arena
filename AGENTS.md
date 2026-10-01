# Arena Agent Contract

## Non-negotiable

The repository is the only durable source of truth. Never rely on conversation memory or undocumented assumptions.

## Recovery

Read, in order:
- README.md
- AI_CONTINUATION.md
- docs/LLM-ARCHITECT-HANDOFF.md
- spec/PROJECT-STATE.md
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

## V1 completion

A001-A036 are complete. They are not reopened for convenience.

Any change to a locked A-series contract requires an Architecture Change Request.

## B-series productization

The active objective is B001-B019:
- local install/use;
- deterministic Demo mode;
- polished multi-role UX;
- hosted preview;
- free-tier provider adapters;
- product E2E/UX validation;
- launch readiness.

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
