# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

Current repository: payswapdotorg/Arena
Default branch: main
Work-order schema: AWO1.0
Maximum concurrent workers: 3
Architecture lock: A1.0
Current main head: e876327d7b998fce0bcbc5efeb0e3f89d6cb6224
Current authorized item: A001
All successor items: waiting on dependencies.

A001 must establish the executable foundation, governance checks, package boundaries, CI/test harness and protocol primitives.

After A001 merges:

1. update spec/PROJECT-STATE.md;
2. update this file and docs/LLM-ARCHITECT-HANDOFF.md with exact merge SHA and verification baseline;
3. re-derive READY items from spec/dependency-graph.md;
4. select at most three pairwise-disjoint Work Orders;
5. record dispatch base SHA and frozen ownership;
6. never reinterpret a Work Order from conversation context.

Core product invariant:

```
Agent Capability = f(Body, Model, Skills, Tools, Knowledge, Memory, Environment, Policies, Verification)
```

A model is a cognitive substrate, not the durable identity of a professional Agent Body.

Epoch integration is optional. Arena publishes provider-neutral capability-development artifacts and services; Epoch remains authoritative for its own world, action, constraints, delivery and operational records.

Do not ask the user to reconstruct prior decisions. Approved decisions are recorded in repository documentation.
