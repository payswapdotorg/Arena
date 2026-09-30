# Arena — LLM Architect / Tech Lead Handoff

## Mission

Build Arena into the capability-development platform that creates, improves, evaluates and certifies expert Agent Bodies.

Arena turns difficult professional work into reusable capability assets:

```
Operational failure / capability gap
→ Capability Case
→ Task
→ Environment
→ Expert intervention
→ Trajectory
→ Evaluation / Verification
→ Learning artifact
→ Agent Body Version
→ Model Compatibility Test
→ Certification
→ Release
```

## Architectural thesis

The central abstraction is the Agent Body.

A Cognitive Substrate (LLM/model) can possess many bodies. The same body can be possessed by many compatible substrates.

```
Body v1.4 + GPT-6 Astra
Body v1.4 + Model X
Body v1.4 + Model Y
```

are distinct possessions of the same professional body.

Only the composition is certified.

## Product scope

Arena includes:

- Capability Graph
- Capability Cases
- Expert Registry and Qualification
- Task Compiler
- Environment Protocol and isolated runners
- Expert Workbench
- Trajectory Store
- Evaluator / Verifier Fabric
- Artifact and lineage system
- Learning Experiment Engine
- Skill Extraction
- Agent Body Forge
- Cognitive Substrate adapters
- Compatibility Engine
- Certification
- Body Registry and releases
- customer/developer API and SDK
- Epoch integration adapter
- reference bodies and evaluation surfaces
- commercial marketplace and usage accounting
- security, tenancy and operations

## Authority

Arena has one semantic authority for Arena-native objects: the Arena Control Plane.

Host systems remain authoritative for their own worlds.

For Epoch:

- World Model is semantic authority.
- Action Gateway is execution authority.
- Constraint Engine is constraint authority.
- Verification/Evidence is proof authority.
- Delivery State is operational delivery authority.

Arena supplies capability-development artifacts through adapters.

## Agent Body

A Body Version is immutable and content-addressed.

It contains, directly or by reference:

- mission/role;
- domain scope;
- capabilities and skills;
- knowledge;
- tools;
- procedures;
- memory policy;
- planning/decision policy;
- escalation/delegation;
- authority boundaries;
- safety policy;
- evaluation and verification suites;
- environment requirements;
- substrate compatibility profile;
- provenance.

## Possession

A Possession binds:

- BodyVersion;
- CognitiveSubstrate;
- runtime profile;
- model adapter version;
- environment profile;
- policy bundle;
- optional substrate-specific artifacts.

Possessions are immutable and reproducible.

## Certification

Certification records a claim about:

```
BodyVersion × Substrate × Environment × Runtime × CertificationSuite
```

It never claims that the underlying model, by itself, is a professional engineer, lawyer, accountant, researcher, etc.

A new model creates a new possession and requires compatibility/certification testing.

A professional-capability change creates a new Body Version.

## Domain strategy

The first reference body is software engineering because executable environments and deterministic verification allow fast iteration.

Future domains include structural engineering, construction, mechanical/electrical engineering, scientific research, finance, cybersecurity and enterprise operations.

Domain additions belong in body/skill/environment/evaluator/verifier packages, not in competing core lifecycles.

## Epoch integration

Arena is an optional capability-development provider for Epoch.

```
Epoch failure/capability gap
→ Capability Development Request
→ Arena Capability Case
→ expert/task/environment work
→ learning/certification
→ artifact
→ Epoch consumes artifact via adapter
```

Arena never directly mutates Epoch authoritative stores.

## Implementation approach

Foundation status: A001 merged (PR #2, d07a9bee); A002 merged (PR #6, 21dfdbda — artifact-protocol + provenance, G9 governs package-level contract generators); A003 merged (PR #8, e14b9fff — agent-body protocol, worker head 26fdd9ef + reconciliation b2a0f0dd, PR CI 36311438667 green, battery + pristine frozen-lockfile clone green on 5 packages); A004 merged (PR #10, cff162b — capability-graph protocol, worker head 422613f + intake d9e7689 + merge-of-main 6ad2415, PR CI green, battery + pristine clone green on 7 workspace projects, branch-oracle acceptance after a platform generation-window outage); A009 merged (PR #14, 480dd06 — environment-protocol ENV1.0, worker head b887803 + intake baf07db, PR CI green); A015 merged (PR #15, 40defad — job-protocol + services/job-orchestrator, worker head 01684ca + intake 14a029c + merge-of-main 959c0c5, PR CI green); A016 merged (PR #16, 8a834ad — model-substrate + adapters/models reference adapters, worker head 01feb38 + intake 7da9488 + merge-of-main c38544e, PR CI green). A005 merged (PR #20, d005296); A018 merged (PR #21, 13af7c2); A006 merged (PR #22, 603050f — expert-registry, 276 tests); A010 merged (PR #23, 6b8352c — environment-runner + environment-runtime, worker head b1997c1 + intake 95989c7 + lockfile regen 38868ff, PR CI green). A011 merged (PR #24, ee57532 — @arena/trajectory + services/trajectory-store + contracts/trajectory, worker head 15620f8 + intake b5f7f46, PR CI green). A012 merged (PR #26, 0cb1b906 — @arena/evaluation + services/evaluation + contracts/evaluation, worker head 6b05363 + intake ed05333, PR CI green, battery 20/20 + pristine frozen-lockfile clone green). A013 merged (PR #28, 02c7155 — @arena/verification + services/verification + contracts/verification, worker head 4388033 + intake 9238836, PR CI green, station battery all-green with 165+51 new tests; VerifierDescriptor with the closed EV1.0 method enum, EvidenceReference on real A002 ArtifactRefs, evidence support summaries, derived pass/fail/unknown outcomes with structured unknown causes, score-impossibility by construction — lock rule 7 proven bidirectionally with @arena/evaluation deliberately unimported). A019 merged (PR #32, 95f8e3c — @arena/skill-extraction + services/skill-extraction, worker head b56cef7 + intake 7d3f2c9, station battery all-green with 89+34 new tests; ValidatedTrajectoryRef enforcing the R17 validated gate with REAL A011/A012/A013 guards, deterministic ExtractionPolicy, content-addressed SkillCandidates, idempotent ExtractionRunRecords; no contracts surface — schemas in-package as SchemaRef data, disclosed). A014 merged (PR #34, d3cf60a — services/artifacts + packages/datasets + contracts/dataset, worker head d7e2d1e + remediation 084377e, station battery all-green with 89+75 new tests; the first REQUIRE-CHANGES remediation round of the program — a typecheck error fixed on the same branch per the runbook). A007 merged (PR #36, eaebedd — @arena/expert-qualification + @arena/expert-matching-fabric + contracts/expert-qualification, 127+46 tests, station battery all-green; QualificationEvidence/CompetencyClaim/QualificationRecord with append-only supersession and renewal/decay, QualificationPolicy, deterministic MatchingPolicy with digest tie-breaks; qualification DATA never authorization — lock rule 9). A020 merged (PR #35, 871c29c — @arena/learning + @arena/learning-fabric + contracts/learning, 145+46 tests, station battery all-green; ExperimentDescriptor with every LE1.0 minimum field + explicit changed-surface interventions, evaluator/verifier-version-confound attribution flags, the five-condition CapabilityLiftVerdict (never a score), read-only learning boundary, CalibrationRecord). A008 merged (PR #40, 04faea8 — @arena/task-spec + @arena/task-compiler-fabric + contracts/task, 159+55 tests, station battery all-green; full TS1.0 TaskSpec structure with the 11-class vocabulary, leakage/quality declarations, the deterministic R6 compiler over A005 TaskCompilationTargets with idempotency-keyed CompilationRecords). A021 merged (PR #39, b9402dc — @arena/body-forge + @arena/body-forge-fabric, 95+36 tests; BodyManifest composition with cited provenance for learning-derived inputs, deterministic forge recipes, append-only supersession lineage, the compose-from-learning demo path). A017 merged (PR #43, 84e1013 — @arena/workbench + apps/web/src/workbench route layer, 94+23 tests, R41 graceful degradation). A022 merged (PR #44, 3109811 — @arena/compatibility + @arena/compatibility-fabric, 45+8 tests, station battery ALL-GREEN after six remediation rounds + terminal TL intake; deterministic Body×Substrate verdicts with closed vocabulary, content-digest-validated append-only records, fail-closed registry + reference service). A023 merged (PR #45, 6c65c06 — @arena/certification + services/certification + contracts/certification, 50 files +10281 lines, station battery ALL-GREEN; CertificationSuite composition over evaluation+verification+compatibility references, deterministic scoped-statement CertificationRecords, closed verdict discipline; delivered by a replay GLM-5.3 Full-Stack agents-tab session). A024 merged (PR #47, 446c3ab — packages/body-registry + services/body-registry; release admission gated on real certification + compatibility references, append-only ReleaseRecord lineage, idempotent content-addressed publication; delivered by the replay GLM-5.3 Full-Stack session at 23:58 UTC, station battery ALL-GREEN). Current wave: A025/A031/A032 fan-out. Verification baseline: node 22 (engine-strict >=22 <23), pnpm 10.34.5; battery install/governance/boundary/typecheck/lint/test/build all exit 0.

Use a TypeScript-first monorepo with:

- PostgreSQL for control-plane state;
- object storage for immutable large artifacts;
- durable workflows for long-running work;
- isolated execution for environments;
- provider-neutral protocols;
- content-addressed artifacts;
- explicit idempotency/correlation;
- strict tenant isolation.

## Completion target

A fresh team must be able to execute:

```
Capability Case
→ Task
→ Environment
→ Expert
→ Trajectory
→ Evaluation
→ Verification
→ Learning
→ Agent Body
→ Substrate Compatibility
→ Certification
→ Release
→ Epoch consumption
```

without this conversation.
A025 MERGED via PR #48 at 79e8f25 (2026-09-30): @arena/arena-sdk + @arena/api-fabric + contracts/api — the public/private Arena API and SDK surface. 25/36 merged; A026/A028/A029/A034 join A031/A032/A033 as dispatchable.
A034 MERGED via PR #54 at e66e201 (2026-09-30): services/security + packages/security + tests/security — tenancy isolation, authorization policy, data rights, expert rights, audit discipline. A026 MERGED via PR #53 at 4f3b473 (2026-09-30): adapters/epoch — EPI1.0 provider-neutral adapter with async job envelope and structural authority boundary. A028 MERGED via PR #52 at af7feb4 (2026-09-30): bodies/environments/examples/software-engineer — the first complete reference vertical slice proving the full protocol chain. 28/36 merged; A027/A030/A035 dispatched (wave-3); A036 unlocks on their landing.
A027 MERGED via PR #55 at a6e26fe (2026-09-30): examples/tests/docs epoch-e2e — the deterministic full-loop learning slice. 29/36 merged.
A035 MERGED via PR #56 at 52dca43 (2026-09-30): observability + SLOs + operations docs. 30/36 merged; A036 waits on A030 only.
A029 MERGED via PR #57 at 30c8b1d (2026-09-30): reference structural-engineer body vertical slice. 31/36 merged.
A030 MERGED via PR #58 at 9af0de6 (2026-09-30): research benchmark + public evaluation suite. 32/36 merged; A036 sprint dispatched.
