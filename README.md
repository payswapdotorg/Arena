# Arena

Arena is the capability-development platform for creating, improving, testing, and certifying expert agents.

## Current status

Arena V1 core (A001-A036) is complete.

The current objective is B-series productization: turn that core into a product that a new user can install, understand, explore and use, with a polished role-aware frontend and a hosted free-tier preview.

## Core thesis

A model is a cognitive substrate. An Agent Body is the persistent, versioned professional capability composition that the substrate possesses.

Agent Instance = Agent Body Version + Cognitive Substrate + Possession Config + Environment + Runtime State

Therefore:

Agent Capability != Model Capability

Arena develops and certifies the composition. Host operating systems such as Epoch operate the resulting agent in real work.

## Three product requirements

The B-series must reach all three:

1. Installable and usable locally, including deterministic Demo mode.
2. Hosted through a free-tier-compatible preview stack.
3. A solid, friendly, role-aware frontend with different workflows for different roles and a persistent role switcher.

## UX direction

The UX takes inspiration from ShareNet's implementation principles: lightweight onboarding, calm visual hierarchy, clear state communication, progressive disclosure, generous spacing, and a strong primary action.

Arena adds a workspace-oriented model with role-specific lenses, capability maps, interactive run replay, Body/Model separation, and explicit evidence semantics.

See:
- spec/ux-architecture.md
- spec/roles-and-contexts.md
- docs/ux-operational-simulation.md

## Hosted preview

Target preview stack:

- Vercel Hobby for the Next.js web/control plane;
- Neon Free for PostgreSQL;
- Cloudflare R2 Standard for immutable artifacts;
- Upstash Redis Free for bounded coordination/cache/rate limits;
- Apify Free only for optional bounded acquisition workflows.

See docs/deployment/free-tier-architecture.md and spec/free-tier-contract.md.

## Repository source of truth

A fresh Tech Lead must read:

- AGENTS.md
- AI_CONTINUATION.md
- docs/LLM-ARCHITECT-HANDOFF.md
- spec/PROJECT-STATE.md
- spec/architecture.md
- spec/architecture-lock.md
- spec/product-requirements.md
- spec/ux-architecture.md
- spec/roles-and-contexts.md
- spec/post-v1-work-items.md
- spec/post-v1-dependency-graph.md
- docs/ux-operational-simulation.md
- docs/deployment/free-tier-architecture.md
- docs/launch-checklist.md
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md

Chat is not an authority source.

## Product boundary

Arena owns expert capability discovery and qualification, capability cases, task construction, executable environments, expert work capture, trajectories, evaluation and verification assets, learning experiments, Agent Body versions, cognitive-substrate compatibility, certification, release artifacts, marketplace and product surfaces.

For Epoch, World Model, Action Gateway, Constraint Engine, Verification/Evidence and Delivery State remain Epoch authorities. Arena integrates through provider-neutral contracts.

## Long-term product direction

The approved north star is:

> Arena is the Stripe of human expert escalation for AI automation.

Any AI application can use Arena's API to procure the right human expertise when its automation reaches a capability boundary.

Arena handles:
- capability need interpretation;
- expert discovery and qualification;
- matching;
- secure expert sessions;
- solve/correct/unblock/review/teach interventions;
- validation;
- machine-readable results;
- expert payment and Arena platform fees;
- optional learning, tool-gap and domain-knowledge capture.

Epoch is one application using Arena's API, not Arena's semantic center.

See:
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md

The C-series adds a Human Intelligence Fabric around the completed V1 capability infrastructure and the B-series product layer.
