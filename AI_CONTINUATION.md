# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

Current repository: payswapdotorg/Arena
Default branch: main
Work-order schema: AWO1.0
Maximum concurrent workers: 3
Architecture lock: A1.0
Current authorized item: A001
Current live Work Order issue: #1
Bootstrap governance is committed; use live GitHub state for the exact latest main SHA.

A001 establishes the executable foundation, governance checks, package boundaries, CI/test harness and protocol primitives.

After A001 merges:
1. reconcile GitHub ground truth;
2. update spec/PROJECT-STATE.md;
3. update this file and docs/LLM-ARCHITECT-HANDOFF.md with exact merge SHA and verification baseline;
4. derive READY items from spec/dependency-graph.md;
5. select at most three pairwise-disjoint Work Orders;
6. record dispatch base SHA and frozen ownership;
7. never reinterpret a Work Order from conversation context.

Core product invariant:

```
Agent Capability = f(Body, Model, Skills, Tools, Knowledge, Memory, Environment, Policies, Verification)
```

A model is a cognitive substrate, not the durable identity of a professional Agent Body.

Certification invariant:
Certification applies to the tested Body × Substrate × Environment × Runtime × Suite composition. A model is never inferred to be a professional agent solely because it can possess a certified Body.

Epoch integration is optional. Arena publishes provider-neutral capability-development artifacts and services; Epoch remains authoritative for its own world, action, constraints, delivery and operational records.

Do not ask the user to reconstruct prior decisions. Approved decisions are recorded in repository documentation.
