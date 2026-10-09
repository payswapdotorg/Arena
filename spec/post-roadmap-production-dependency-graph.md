# Arena Post-Roadmap Productionization Dependency Graph P1.0

## Baseline
A001–A036, B001–B019, G001–G003 and C001–C022 (80 work orders) are complete/merged. This graph supersedes the old instruction to start or continue the C-series.

## Canonical graph

P001 — architecture-question register + decisions
├── P002 — durable runtime, Neon persistence and jobs
│   └── P003 — real HTTP/MCP/webhook transport
├── P004 — R2/Upstash lifecycle and provider evidence
└── P005 — route inventory, missing mounts and /tasks UX finding

P002 + P003 + P004 + P005
└── P006 — generic-AI-app + Epoch E2E against real host

P001 threat model + P002 + P003 + P004 + P005 + P006
└── P007 — integrated security/privacy/resilience acceptance

P006 + P007 blockers fixed or formally accepted
└── P008 — final evidence, checklist reconciliation and release gate

## Dispatch waves

### Wave 0
P001 only. It establishes the architecture-question register and resolves blocking semantics.

### Wave 1 — after P001's decision gate
Dispatch up to three workers:
- P002: durable runtime, persistence and Neon (runtime/Neon surfaces).
- P004: R2/Upstash provider operations and live evidence (no Neon code edits).
- P005: App Router inventory/mounts and /tasks UX (app-router/UX surface).
These scopes must be frozen and disjoint. If P001 exposes a blocker for one item, hold that item rather than bypass the gate.

### Wave 2
P003 after P002 freezes the host/runtime interface. A read-only P007 threat-model register may run in parallel on docs-only, disjoint scope.

### Wave 3
P006 after P002–P005. P007 may build isolated adversarial tests concurrently only against frozen interfaces; production-code fixes that overlap another WO must be split or serialized by the TL.

### Wave 4
P008 after P006 and disposition of all release-blocking P007 findings.

## Laws
- Recompute readiness from live main before every dispatch.
- Maximum three concurrent workers; one WO = one issue = one branch = one PR.
- Each worker receives exact base SHA, frozen owned paths, prohibited paths and verification commands.
- TL owns root manifests, lockfiles, workspace globs, contract generation and final release/frontier state.
- Reference-fabric tests are not real provider/host proof.
- Every merge needs pushed-SHA owned tests and an integrated-main battery.
- A build alone never proves public API availability, persistence, payment execution or hosted behavior.
- Semantic contract changes need a decision/ADR and ACR if Architecture Lock A2.0 changes.
