# @arena/capability-learning

The Arena **capability learning compiler** (Work Order C022; issue #128) — the closing surface of the C-series learning loop. Turns validated intervention-derived improvement candidates into typed `ImprovementProgram`s, one per LE1.0 intervention class, adopts them ONLY through the Q1.0 five-condition capability-lift gate, and proposes the adopted improvements into the Forge / compatibility / certification surfaces — **nothing becomes globally reusable automatically**.

## What it does

- **Compiler core** — `compilePrograms(candidates, {compiledBy})` compiles improvement candidates into typed programs, ONE PER (tenant, LE1.0 intervention class), the changed surface EXPLICIT on every program. Deterministic given identical candidates (canonical ordering; no clock reads). Typed closed outcomes: `compilable` / `blocked` with machine-readable reasons from the closed set `rights-insufficient | evidence-insufficient | scope-conflict`.
- **Candidates** — `createImprovementCandidate` builds the content-addressed, tenant-scoped input view projected from the dependency surfaces (C008 tool-gap / knowledge-patch candidates, C009 escalation-validation evidence, C013 adversarial research candidates, C014 marketplace pretraining candidates — bound **by digest** through the closed `CANDIDATE_SOURCE_KINDS` vocabulary). The changed surface must be one of the LE1.0 nine; ≥1 validated evidence digest is required; rights come from the closed `CANDIDATE_RIGHTS_STATUSES` vocabulary.
- **Experiment assembly** — `assembleProgramExperiment(program, {experimentId})` compiles each program to an A020 `ExperimentDescriptor` carrying EVERY LE1.0 minimum field, built through `@arena/learning`'s REAL constructor, executed through the A020 engine's public ports (see the reference service).
- **Q1.0 capability-lift adoption gate** — `evaluateAdoptionGate({program, runRecord, experimentRef, candidates})` adopts ONLY when the five Q1.0 conditions hold on the A020 run record: pinned evaluation population improvement, verification audit survival, evaluator/version attribution accounted, protected-capability regression measured, uncertainty reported. Typed verdicts — `adopted-with-evidence` / `rejected-with-reasons` / `unknown-insufficient-sample` — **never a bare boolean**.
- **Gated proposals** — `createGatedImprovementProposal(program, gateVerdict, …)` / `routeGatedProposals(…)`: adopted improvements become PROPOSALS into A021 (new immutable BodyVersions — every adopted program), A022 (compatibility/re-testing obligations for substrate-affecting classes) and A023 (recertification triggers for superseding programs). Adoption of an ungated improvement is **structurally impossible**: the only proposal constructor rejects every non-adopted gate verdict (`CAPABILITY_LEARNING_NOT_ADOPTED`) and every verdict not bound to the program.
- **Learning boundary** — `enforceCompilerBoundary` / `checkProgramBoundary` / `historicalDigestsOfCompilation`: compiler outputs are NEW versioned content-addressed artifacts with full lineage; historical trajectories, task/environment versions, certification evidence and original customer records are never rewritten (`CAPABILITY_LEARNING_BOUNDARY_VIOLATION`).
- **Feedback record** — `createFeedbackRecord` + `rankByExpectedInformationValue`: the append-only record of which interventions produced which improvements with what measured lift, feeding future selection by expected information value with an inspectable rationale (CC1.0 active-learning law).

## Dependencies

Runtime: `@arena/protocol-core` (canonical JSON + sha256 digests), `@arena/learning` (the REAL LE1.0 experiment protocol — ExperimentDescriptor, run records, verdicts, intervention-surface vocabulary, boundary precedent — consumed, never redefined). Pure TypeScript; zero external runtime dependencies.

The reference compiler service (candidate ingestion → compilation → experiment orchestration → gated proposal dispatch on the A015 fabric) lives in `services/capability-learning`.

## Specs

- `spec/learning.md` (LE1.0) — interventions, attribution, learning boundary, experiment minimum.
- `spec/quality-model.md` (Q1.0) — the five-condition capability-lift gate (the adoption law).
- `spec/human-escalation-work-items.md` — C022 row + the learning loop.
