# Arena Work Items AWO1.0

## Dispatch contract

One Work Order = one branch = one PR.

Maximum concurrent workers = 3.

Concurrent Work Orders must have pairwise-disjoint owned write surfaces.

The Tech Lead derives the live frontier from the dependency graph; static wave examples never override dependency readiness.

## Work orders

| ID | Scope | Depends | Owned surfaces |
|---|---|---|---|
| A001 | Repository foundation, governance, CI, test harness, package boundaries, base protocol primitives | — | root manifests, apps/*, packages/protocol-core/*, scripts/*, .github/* |
| A002 | Artifact identity, versioning, provenance and lineage protocol | A001 | packages/artifact-protocol/*, packages/provenance/*, contracts/artifacts/* |
| A003 | Agent Body, BodyVersion, Cognitive Substrate, Possession, Agent Instance protocol | A001 | packages/agent-body/*, contracts/agent-body/* |
| A004 | Capability Graph and skill taxonomy | A001 | packages/capability-graph/*, contracts/capability/* |
| A005 | Capability Case protocol and lifecycle | A003,A004 | packages/capability-case/*, contracts/capability-case/* |
| A006 | Expert registry and expert profile | A002,A004 | packages/expert-registry/*, contracts/expert/* |
| A007 | Expert qualification, evidence and matching | A005,A006,A013 | packages/expert-qualification/*, services/expert-matching/*, contracts/expert-qualification/* |
| A008 | TaskSpec and Task Compiler | A005,A006,A007 | packages/task-spec/*, services/task-compiler/*, contracts/task/* |
| A009 | Environment protocol | A002 | packages/environment-protocol/*, contracts/environment/* |
| A010 | Isolated environment runner and lifecycle | A009,A015 | services/environment-runner/*, packages/environment-runtime/* |
| A011 | Trajectory protocol and storage | A002,A009,A010 | packages/trajectory/*, services/trajectory-store/*, contracts/trajectory/* |
| A012 | Evaluation protocol and evaluator fabric | A005,A011 | packages/evaluation/*, services/evaluation/*, contracts/evaluation/* |
| A013 | Verification protocol and verifier fabric | A002,A012 | packages/verification/*, services/verification/*, contracts/verification/* |
| A014 | Artifact storage/lineage service and dataset packaging | A002,A011,A012,A013 | services/artifacts/*, packages/datasets/*, contracts/dataset/* |
| A015 | Durable jobs/events/orchestration | A001 | packages/job-protocol/*, services/job-orchestrator/*, contracts/events/* |
| A016 | Cognitive Substrate/model adapter protocol and adapters | A002,A003 | packages/model-substrate/*, adapters/models/*, contracts/model-substrate/* |
| A017 | Expert Workbench | A006,A008,A009,A011,A015 | apps/web/src/workbench/*, packages/workbench/* |
| A018 | Customer/control-plane web console | A003,A005,A015 | apps/web/src/console/*, packages/control-ui/* |
| A019 | Skill extraction from validated trajectories | A011,A012,A013,A004 | packages/skill-extraction/*, services/skill-extraction/* |
| A020 | Learning experiment engine and attribution | A011,A012,A013,A019 | packages/learning/*, services/learning/*, contracts/learning/* |
| A021 | Agent Body Forge | A003,A004,A019,A020 | packages/body-forge/*, services/body-forge/* |
| A022 | Body/substrate compatibility engine | A003,A016,A020,A021 | packages/compatibility/*, services/compatibility/* |
| A023 | Certification suite and certification engine | A013,A022,A014 | packages/certification/*, services/certification/*, contracts/certification/* |
| A024 | Body registry, release and publishing | A003,A021,A022,A023 | packages/body-registry/*, services/body-registry/* |
| A025 | Public/private Arena API and SDK | A002,A003,A005,A024 | packages/arena-sdk/*, services/api/*, contracts/api/* |
| A026 | Epoch provider-neutral capability-development adapter | A025,A024 | adapters/epoch/* |
| A027 | Epoch end-to-end capability-gap learning slice | A026,A019,A020,A023 | examples/epoch-e2e/*, tests/epoch-e2e/*, docs/integrations/* |
| A028 | Reference Software Engineer Agent Body | A008,A010,A012,A013,A021,A023,A024,A025 | bodies/software-engineer/*, environments/software-engineer/*, examples/software-engineer/* |
| A029 | Reference Structural Engineer Agent Body | A008,A010,A012,A013,A021,A023,A024,A025 | bodies/structural-engineer/*, environments/structural-engineer/*, examples/structural-engineer/* |
| A030 | Research benchmark and public evaluation suite | A012,A013,A014,A023,A028 | research/*, benchmarks/* |
| A031 | Expert marketplace and commercial qualification | A006,A007,A023,A024 | services/marketplace-experts/*, apps/web/src/marketplace/experts/* |
| A032 | Dataset/evaluation/environment marketplace | A012,A013,A014,A024 | services/marketplace-artifacts/*, apps/web/src/marketplace/artifacts/* |
| A033 | Billing, usage accounting and entitlements | A015,A018,A024 | services/billing/*, packages/entitlements/* |
| A034 | Security, tenancy, authorization and audit hardening | A001,A015,A018,A021,A023,A025 | services/security/*, packages/security/*, tests/security/* |
| A035 | Observability, operations and SLOs | A015,A010,A018,A034 | packages/observability/*, services/observability/*, docs/operations/* |
| A036 | Production deployment, performance, release engineering and launch readiness | A010,A015,A018,A024,A030,A034,A035 | deploy/*, ops/*, docs/release/*, tests/performance/*, release/* |

## Universal acceptance

Every Work Order must:

- remain inside owned surfaces;
- include positive and negative tests;
- include contract/parity tests where contracts exist;
- include reproducible evidence;
- preserve architecture lock rules;
- avoid root lockfile edits during parallel work;
- record exact dispatch base and final head SHA;
- identify limitations;
- leave no unresolved critical review finding.

## Completion target

A complete Arena v1 proves:

```
Capability Case
→ Task
→ Environment
→ Expert
→ Trajectory
→ Evaluation
→ Verification
→ Learning
→ Body
→ Substrate Compatibility
→ Certification
→ Release
→ Epoch consumption
```
