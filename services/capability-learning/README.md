# @arena/capability-learning-service

The Arena **capability-learning reference compiler service** (Work Order C022; issue #128) — the closing service of the C-series learning loop: candidate ingestion → program compilation → experiment orchestration → gated proposal dispatch as durable idempotent jobs over injected ports (the A015 fabric pattern).

## Flow

1. **`ingestCandidate`** — the host projects an intervention-derived improvement candidate (from the C008 tool-gap / knowledge-capture surfaces, C009 escalation-validation evidence, C013 adversarial-evaluation research candidates or C014 body-marketplace pretraining candidates) into `@arena/capability-learning`'s typed candidate view. The REAL domain constructor validates it; digest dedup makes duplicate ingestions deduplicate (audited) instead of inflating counts.
2. **`compileTenantPrograms`** — the deterministic compiler: one `ImprovementProgram` per LE1.0 intervention class. Blocked outcomes (`rights-insufficient` / `evidence-insufficient` / `scope-conflict`) are AUDITED — never silently dropped.
3. **`runProgramExperiment`** — assembles the program's A020 `ExperimentDescriptor`, executes it through THE INJECTED A020 engine port (`ExperimentEnginePort` — never by importing the A020 service), evaluates the Q1.0 five-condition capability-lift gate (`evaluateAdoptionGate`), stores the typed verdict and appends the feedback record (interventions → improvements → measured lift).
4. **`dispatchGatedProposals`** — routes the ADOPTED program's proposals into the destination seams: A021 Body Forge body-version proposals (every adopted program), A022 compatibility re-test obligations (substrate-affecting classes), A023 recertification triggers (superseding programs). An ungated program fails closed with `CAPABILITY_LEARNING_SVC_NOT_ADOPTED` — adoption of an ungated improvement is structurally impossible.

Every decision lands in the append-only, tamper-evident audit stream (`CompilerAuditSink`) with machine-readable decision codes. `rankNextSelections` exposes the expected-information-value ranking over the tenant's feedback history (CC1.0 active-learning law).

## Ports (injected seams)

`Clock`, `CandidateLedger`, `ProgramLedger`, `GateVerdictLedger`, `FeedbackLedger`, `ExperimentEnginePort` (the A020 seam), `ForgeBodyVersionProposalPort` / `CompatibilityRetestProposalPort` / `RecertificationTriggerProposalPort` (the A021/A022/A023 seams), `CompilerAuditSink`.

The in-memory reference fabric (`fabric.ts`) implements every port: digest-deduped tenant-scoped ledgers, the `ReferenceExperimentEngine` (executes A020 experiment descriptors through `@arena/learning`'s own pure computations with REAL A011/A012/A013 record guards and the LE1.0 read-only evidence tier), collecting proposal ports over protocol `Envelope<T>` command envelopes, and the tamper-evident audit sink. Hosts swap the fabric for real persistence (`adapters/*`, never here).

## Dependencies

`@arena/capability-learning` (the compiler domain), `@arena/learning` + `@arena/trajectory` + `@arena/evaluation` + `@arena/verification` (the A020 seam), `@arena/protocol-core`. Pure TypeScript; zero external runtime dependencies.
