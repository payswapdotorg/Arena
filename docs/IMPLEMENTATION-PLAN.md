# Arena Implementation Plan A1.0

## Objective

Deliver a production-capable Arena that can take a capability gap through expert work, executable evaluation and learning into a versioned Agent Body that can be possessed by multiple model substrates and independently certified.

## Phase 0 — Foundation

A001.

Exit:
- repository self-checking;
- CI green;
- package boundaries enforced;
- worker governance operational.

## Phase 1 — Canonical capability objects

A002, A003, A004.

Deliver:
- immutable artifact/provenance primitives;
- Agent Body/Possession model;
- Capability Graph and Skill model.

Exit:
- all three protocols versioned;
- canonical serialization/digest tests;
- negative tests for provider leakage and mutable identity.

## Phase 2 — Case, expert, task and environment foundations

A005–A010.

Deliver:
- Capability Cases;
- expert registry/qualification;
- TaskSpec compiler;
- environment protocol/runtime.

Exit:
- a case can compile into a reproducible task;
- a qualified expert can be matched;
- an environment can execute/reset safely.

## Phase 3 — Work capture and judgment

A011–A016.

Deliver:
- trajectory storage;
- evaluation;
- verification;
- artifact/dataset packaging;
- durable jobs/events;
- cognitive substrate adapters.

Exit:
- an agent and an expert can perform a task;
- actions/observations are captured;
- deterministic and expert evaluation can run;
- evidence is reproducible;
- long-running work is resumable and idempotent.

## Phase 4 — User experience

A017–A018.

Deliver:
- expert workbench;
- customer/control-plane console.

Exit:
- a human can discover a task, perform it in the correct environment, review evidence and inspect results without developer intervention.

## Phase 5 — Learning and body construction

A019–A024.

Deliver:
- skill extraction;
- learning experiments;
- Agent Body Forge;
- compatibility;
- certification;
- body registry/release.

Exit:
- validated trajectories can produce a Body Version;
- the same Body Version can be tested with multiple substrates;
- certification clearly scopes to the tested composition;
- releases are immutable and reproducible.

## Phase 6 — API and Epoch integration

A025–A027.

Deliver:
- public/private API;
- SDK;
- Epoch adapter;
- end-to-end capability-gap feedback loop.

Exit:
- Epoch can submit a capability gap;
- Arena produces a capability artifact;
- Epoch can consume and re-test it without direct shared state.

## Phase 7 — Reference professional bodies and research

A028–A030.

Deliver:
- Software Engineer Body;
- Structural Engineer Body demonstration;
- public benchmark/evaluation suite.

Exit:
- end-to-end bodies are benchmarked;
- professional limitations are explicit;
- model-only and body-composition results are separately reported.

## Phase 8 — Commercial platform

A031–A033.

Deliver:
- expert marketplace;
- artifact marketplace;
- billing/entitlements.

Exit:
- experts can be qualified and compensated;
- artifacts can be published privately/publicly;
- usage is accounted for and entitlement-gated.

## Phase 9 — Production hardening

A034–A036.

Deliver:
- security/tenancy/audit;
- observability/SLOs;
- production deployment/performance/release.

Exit:
- security review complete;
- production SLO evidence exists;
- recovery/runbook tested;
- release artifacts reproducible.

## Final E2E acceptance

The implementation is complete only when the system can demonstrate:

```
Epoch capability gap
→ Arena Capability Case
→ TaskSpec
→ Environment
→ qualified expert
→ expert trajectory
→ agent trajectory
→ evaluation
→ verification
→ learning experiment
→ extracted skill
→ Agent Body v1
→ Body + Model A certification
→ Body + Model B compatibility/certification
→ published release
→ Epoch consumes release
→ original capability gap is re-evaluated
```

The E2E must preserve provenance and prove that improvement was not merely caused by changing the evaluator or benchmark.
