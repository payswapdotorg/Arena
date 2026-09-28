# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

Current repository: payswapdotorg/Arena
Default branch: main
Work-order schema: AWO1.0
Maximum concurrent workers: 3
Architecture lock: A1.0
Current authorized wave: A011 (trajectory; IN FLIGHT since 2026-09-28 07:30 UTC, dispatched from 6b8352c — prompt landed, pod provisioned, chat 0c1a3f11). A010 MERGED via PR #23 at 6b8352c on 2026-09-28 07:22 UTC (worker head b1997c1 + intake 95989c7 + lockfile regen 38868ff; PR CI green). A006 MERGED via PR #22 at 603050f on 2026-09-28 06:34 UTC.
Current live Work Order issues: #18 (A011 in flight) — the only open issue; all merged-WO trackers (#4/#5/#7/#9/#11/#12/#13/#17/#19) closed with acceptance comments on 2026-09-28 ~07:45 UTC
A001 MERGED: PR #2, merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a. A002 MERGED: PR #6, merge SHA 21dfdbda27d68bb706b31f642e92c8817c63aa5b (worker head ea8081c6 + reconciliation d21b4fe; CI 36280569487 green). A003 MERGED: PR #8, merge SHA e14b9fff9df0f37bc3982f5724401c55d1410813 (worker head 26fdd9ef + reconciliation b2a0f0dd; PR CI 36311438667 green). A004 MERGED: PR #10, merge SHA cff162b96a7dcc0758b509f666993ca557c4fddb (worker head 422613fe + intake d9e7689 + merge-of-main 6ad2415; PR CI green; branch-oracle acceptance — the worker chat died in a platform generation-window outage after the delivery branch was pushed). A009 MERGED: PR #14, merge SHA 480dd06563269b29c68b365d13a716009a5d4f87 (worker head b887803 + intake baf07db; PR CI green). A015 MERGED: PR #15, merge SHA 40defadbb56f8727e9540d929b6194e903daff55 (worker head 01684ca + intake 14a029c + merge-of-main 959c0c5; PR CI green). A016 MERGED: PR #16, merge SHA 8a834ad1ba59886bc58e897b8b6abb949ed677c5 (worker head 01feb38 + intake 7da9488 + merge-of-main c38544e; PR CI green). A005 MERGED: PR #20, merge SHA d0052965d79ae48a4dab5d4b38b699d5c1ed14d0 (worker head f900d2e + intake 9752c62; PR CI green). A018 MERGED: PR #21, merge SHA 13af7c27e27a61d1704e3d4a5f261ca8433b957b (worker head 2cc08aa + intake b8c3c71; PR CI green; 68-minute dispatch-to-merge cycle). A006 MERGED via PR #22 (merge SHA 603050fe549e8f4c10e1f08692abeb2b2d8cb7e8, worker head a878a77 + intake b65e6f3; PR CI green; 276 tests in @arena/expert-registry). A010 MERGED via PR #23 (merge SHA 6b8352c5256c19b4f997aba0dac3dc9435178ac9, worker head b1997c1 + intake 95989c7 + merge-of-main lockfile regen 38868ff; PR CI green on 38868ff).

A001 delivered the executable foundation: governance/boundary checkers with self-tests, CI battery on GitHub runners, package layering, the new-package scaffolder, deterministic contract generation with drift checks, and the @arena/protocol-core primitives (ProtocolError, CorrelationId/IdempotencyKey, SchemaRef, canonical JSON + sha256, Envelope<T>). A003 delivered the Agent Body protocol: @arena/agent-body (AgentBody, immutable content-addressed BodyVersion with all AB1.0 fields, provider-neutral CognitiveSubstrate with credential/provider-name rejection, digest-bearing Possession with versioned model-specific artifacts, append-only AgentInstance lifecycle, CompatibilityProfile with the substrate-alias-forbidden gate) + contracts/agent-body/*.v1.json via a package-level generator auto-wired into G9. A004 delivered the Capability Graph: @arena/capability-graph (11 digest-addressed versioned node kinds, typed provenance-bearing edges with a closed kind enum + endpoint matrix, skill-taxonomy DAG with cycle rejection reporting the offending path, pure graph queries, deep-freeze append-only guard, supersession-by-append, DomainPack extension point) + 19 contracts under contracts/capability/*.v1.json. A009 delivered the Environment protocol: @arena/environment-protocol (ENV1.0 declarations, checkpoint semantics, workload admission) + contracts/environment/*.v1.json. A015 delivered durable jobs/events/orchestration: @arena/job-protocol + services/job-orchestrator (G9 services/* generator wiring) + contracts/events/*.v1.json. A016 delivered the model adapter protocol: @arena/model-substrate (SubstrateAdapter protocol, content-addressed AdapterDescriptor, append-only SubstrateRegistry, compatibility test descriptors, upgrade path types) + adapters/models reference adapters + contracts/model-substrate/*.v1.json. A005 delivered the Capability Case protocol: @arena/capability-case (CapabilityCase — the versioned root-of-record composing the Problem tuple; case compilation, digest envelopes, drift checks) + contracts/capability-case/*.v1.json. A018 delivered the control console: @arena/control-ui + apps/web/src/console (vanilla-TS HTML renderers, node:http read-only routes, XSS-escape negatives, zero new runtime deps under the frozen catalog). A006 delivered the expert registry: @arena/expert-registry (Expert/expert-profile protocol; 276 tests, full battery green). A010 delivered the isolated environment runner and lifecycle: services/environment-runner + packages/environment-runtime (runner protocol against ENV1.0 declarations, lifecycle management, checkpoint integration).

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
