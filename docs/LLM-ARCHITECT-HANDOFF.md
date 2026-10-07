# Arena — LLM Architect / Tech Lead Handoff

## Current authoritative handoff

The complete current implementation directive is:

**docs/LLM-ARCHITECT-FINAL-HANDOFF.md**

Read that document first. It supersedes the historical material that follows in this file where the two differ.

It is the authoritative handoff for:
- post-B019 launch-integrity closure G001-G003;
- C001-C022 Human Expert Escalation / Capability Commerce;
- three-worker concurrency;
- dependency sequencing;
- API boundary;
- same-environment expert session;
- payment;
- learning/tool/knowledge capture;
- adversarial evaluation;
- Epoch and generic third-party integration;
- final completion criteria.

## Repository truth

- A001-A036: MERGED
- B001-B019: MERGED
- C001-C022: NOT YET IMPLEMENTED
- G001-G003: current launch-integrity closure stage

Current recorded main acceptance:
d94c0a4af210dbcfe8937d71270cd1a06cd4c905

Current product thesis:

> Arena is the Stripe of human expert escalation for AI automation.

The repository remains the sole source of truth.

## Source-of-truth documents

- docs/LLM-ARCHITECT-FINAL-HANDOFF.md
- spec/post-b019-launch-integrity-closure.md
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md
- docs/decisions/ADR-HUMAN-ESCALATION-001.md
- spec/architecture-lock.md
- AGENTS.md
- AI_CONTINUATION.md
- spec/PROJECT-STATE.md

Do not use the conversation as a source of implementation truth.

## Immediate next move

Dispatch G001 + G002 + G003 concurrently.

After launch-integrity closure, begin C001.

Then recompute live readiness and continue through C022 using the corrected dependency graph.

