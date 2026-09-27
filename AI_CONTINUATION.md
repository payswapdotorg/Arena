# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

Current repository: payswapdotorg/Arena
Default branch: main
Work-order schema: AWO1.0
Maximum concurrent workers: 3
Architecture lock: A1.0
Current authorized wave: A009/A015/A016 (re-dispatched fresh after the platform generation-window outage; A004 merged)
Current live Work Order issues: #7 (+ A016 to be opened)
A001 MERGED: PR #2, merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a. A002 MERGED: PR #6, merge SHA 21dfdbda27d68bb706b31f642e92c8817c63aa5b (worker head ea8081c6 + reconciliation d21b4fe; CI 36280569487 green). A003 MERGED: PR #8, merge SHA e14b9fff9df0f37bc3982f5724401c55d1410813 (worker head 26fdd9ef + reconciliation b2a0f0dd; PR CI 36311438667 green). A004 MERGED: PR #10, merge SHA cff162b96a7dcc0758b509f666993ca557c4fddb (worker head 422613fe + intake d9e7689 + merge-of-main 6ad2415; PR CI green; branch-oracle acceptance — the worker chat died in a platform generation-window outage after the delivery branch was pushed).

A001 delivered the executable foundation: governance/boundary checkers with self-tests, CI battery on GitHub runners, package layering, the new-package scaffolder, deterministic contract generation with drift checks, and the @arena/protocol-core primitives (ProtocolError, CorrelationId/IdempotencyKey, SchemaRef, canonical JSON + sha256, Envelope<T>). A003 delivered the Agent Body protocol: @arena/agent-body (AgentBody, immutable content-addressed BodyVersion with all AB1.0 fields, provider-neutral CognitiveSubstrate with credential/provider-name rejection, digest-bearing Possession with versioned model-specific artifacts, append-only AgentInstance lifecycle, CompatibilityProfile with the substrate-alias-forbidden gate) + contracts/agent-body/*.v1.json via a package-level generator auto-wired into G9. A004 delivered the Capability Graph: @arena/capability-graph (11 digest-addressed versioned node kinds, typed provenance-bearing edges with a closed kind enum + endpoint matrix, skill-taxonomy DAG with cycle rejection reporting the offending path, pure graph queries, deep-freeze append-only guard, supersession-by-append, DomainPack extension point) + 19 contracts under contracts/capability/*.v1.json.

At every merge boundary:
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
