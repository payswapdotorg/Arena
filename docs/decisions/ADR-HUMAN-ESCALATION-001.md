# ADR — Human Expert Escalation as Arena's Product North Star

- Decision date: 2026-10-01
- Status: APPROVED
- Scope: Arena long-term product direction, API boundary, commercial model and learning loop

## Decision

Arena's approved north star is:

> **Arena is the Stripe of human expert escalation for AI automation.**

Arena becomes infrastructure that any AI-enabled software can use when automation reaches a capability boundary.

The application supplies the problem context and escalation policy.

Arena supplies the human capability.

## Canonical transaction

AI Application / Agent
→ Escalation Request
→ Capability Demand
→ Expert Qualification / Matching
→ Bounded Expert Environment Session
→ Human Intervention
→ Validation
→ Machine-readable Result
→ Payment / Platform Fee
→ Optional Learning / Tool / Knowledge / Body improvement

## Intervention semantics

Supported modes:

- SOLVE
- CORRECT
- UNBLOCK
- REVIEW
- TEACH
- TOOL_GAP
- KNOWLEDGE
- EVALUATE

The mode must be explicit in the request and lifecycle.

## Same-environment rule

When enabled, the expert works inside a privacy-sanitized bounded replica of the originating agent's environment.

This creates a direct correspondence between:

agent context
→ human action
→ observable consequence
→ validated result

The replica is never a path into the host application's live authoritative world.

## Learning rule

A human intervention can create:

- immediate correction;
- knowledge patch;
- tool-gap signal;
- tool specification;
- skill candidate;
- evaluator;
- benchmark;
- Agent Body improvement;
- marketplace artifact.

These are candidate/reusable artifacts only after appropriate validation, rights, provenance and scope checks.

## Commercial rule

The application can authorize a budget.

Arena manages:

- offer/acceptance;
- validation condition;
- expert payout;
- platform fee;
- refund/revision state;
- commercial evidence.

Payment providers remain adapters.

## Evaluation competition rule

Arena can use a competition-style evaluation path in domains with scarce evaluators.

Experts submit independent solutions and challenge each other with evidence.

Upvote/downvote ratio may be displayed as a community signal, but it does not establish correctness or certification by itself.

Arena Verification remains authoritative.

## Application-neutral rule

Epoch is a reference customer/integrator.

Arena must also support an unrelated generic AI application through the same public API contract.

No Epoch-specific semantics belong in the Arena core.

## Why this decision fits the existing architecture

The decision reuses rather than replaces:

- Expert Registry;
- Expert Qualification;
- Expert Matching;
- TaskSpec;
- Environment Protocol;
- Environment Runner;
- Trajectory;
- Evaluation;
- Verification;
- Learning;
- Agent Body Forge;
- Compatibility;
- Certification;
- Release;
- Marketplace;
- Billing/Entitlements;
- Security/Tenancy;
- Observability.

The new C-series composes these existing primitives into an API-native human escalation product.

## Consequence

The long-term Arena roadmap is:

A001-A036: capability infrastructure
→ B001-B019: usable hosted product
→ C001-C022: human escalation network + capability commerce

The repository documents named by those programs are authoritative.
