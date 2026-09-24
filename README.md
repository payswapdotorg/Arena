# Arena

Arena is the capability-development platform for creating, improving, testing, and certifying expert agents.

## Core thesis

A model is a cognitive substrate. An **Agent Body** is the persistent, versioned professional capability composition that the substrate possesses.

```
Agent Instance = Agent Body Version + Cognitive Substrate + Possession Config + Environment + Runtime State
```

Therefore:

```
Agent Capability != Model Capability
```

Arena develops and certifies the composition. Host operating systems such as Epoch operate the resulting agent in real work.

## Source of truth

The repository is authoritative; chat is not.

A fresh Architect / Tech Lead must start with `AGENTS.md`, `AI_CONTINUATION.md`, `docs/LLM-ARCHITECT-HANDOFF.md`, `spec/PROJECT-STATE.md`, `spec/architecture.md`, `spec/architecture-lock.md`, `spec/requirements.md`, `spec/work-items.md`, `spec/dependency-graph.md`, and `spec/worker-runbook.md`.

## Product boundary

Arena owns expert capability discovery and qualification, capability cases, task construction, executable environments, expert work capture, trajectories, evaluation and verification assets, learning experiments, Agent Body versions, cognitive-substrate compatibility, certification, release artifacts, and product/SDK surfaces.

Arena does not become the semantic authority for an external operating system. For Epoch, World Model, Action Gateway, Constraint Engine, Verification/Evidence and Delivery State remain Epoch authorities. Arena integrates through provider-neutral contracts and adapters.

## Initial implementation

A001 is currently authorized. It establishes the monorepo, governance/runtime foundations, frozen dependency policy, package boundaries, CI/test harness, and protocol primitives.

After A001 merges, the Tech Lead derives the live frontier from `spec/dependency-graph.md` and may activate at most three pairwise-disjoint Work Orders.

## First flagship

The first reference Agent Body is a software engineering body. The platform architecture is domain-general; structural engineering and other professional bodies follow after the core capability/certification loop is proven.

## Design law

Arena certifies statements of the form:

> Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X.

Arena does not certify that M alone is a structural engineer, software engineer, or other profession.
