# Arena Architecture A1.0

## 1. Core model

Arena is a capability-development system:

```
Problem = (Capability Case, Body, Substrate, Environment, Tasks, Actions, Evaluation, Verification, Evidence, Learning)
```

Its primary output is not a dataset alone. It is a versioned capability composition deployable as an Agent Body.

## 2. Identity model

### Agent Body
Persistent professional identity and capability composition.

### Cognitive Substrate
A model that supplies general cognitive computation.

### Possession
A binding of a body version to a substrate and runtime configuration.

### Agent Instance
An executing possession in an environment with transient state.

```
AgentBodyVersion + CognitiveSubstrateVersion + RuntimeProfile + EnvironmentVersion = Possession → AgentInstance
```

## 3. Capability model

Capabilities decompose into:

- declarative knowledge;
- procedural skills;
- tool skills;
- reasoning/decision patterns;
- verification skills;
- communication/escalation behavior;
- domain methods.

A Skill is a versioned artifact with inputs, outputs, prerequisites, evidence, tests and provenance.

## 4. Capability Graph

The graph relates:

- domain;
- capability;
- sub-capability;
- skill;
- tool;
- task family;
- evaluator;
- verifier;
- expert competency;
- observed failure;
- body version.

It is descriptive and queryable; it does not replace object authority.

## 5. Capability Case

The bridge from observed failure to capability development.

Records target capability, domain, context, observed failure, evidence, current body/substrate, uncertainty, desired outcome, expert requirements, environment requirements, task requirements and evaluation/verification requirements.

## 6. Task

TaskSpec is the reproducible unit of work. It contains task identity/version, initial state, statement, objectives, constraints, allowed tools, forbidden shortcuts, success conditions, evidence criteria, difficulty, domain/capability labels, environment requirements and evaluator/verifier bindings.

## 7. Environment

A versioned executable world supporting snapshot/restore, deterministic seeds where feasible, typed actions, observations, tools, isolation, quotas, evidence and result export.

## 8. Expert

Experts are capability providers. Profiles include identity, competencies, qualifications, evidence, task history, reliability, availability and domain/jurisdiction where appropriate.

Qualification, reputation and authorization are separate concerns.

## 9. Trajectory

A trajectory records observable work:

```
State → Action → Observation → State → ... → Outcome
```

Expert trajectories may include explicit corrections, annotations, decisions, tools, outputs and verification.

Arena does not require hidden chain-of-thought. The learning product is observable work and explicitly supplied rationale/critique when available.

## 10. Evaluation and verification

Evaluation judges performance against criteria.

Verification establishes evidence/proof.

Both are versioned and can be combined into Certification Suites.

## 11. Learning

Learning experiments compare baseline and intervention and attribute observed change.

Learning can update skills, body composition, retrieval/knowledge bindings, policies, evaluator/verifier assets or model-specific adaptations.

Learning never rewrites historical facts or evidence.

## 12. Agent Body Forge

The Forge composes:

```
Body Manifest
+ Skills
+ Knowledge
+ Tools
+ Procedures/Policies
+ Verification
+ Evaluation
+ Environment Requirements
```

into an immutable Body Version.

## 13. Compatibility

Compatibility is tested as:

```
Body × Substrate × Environment × Runtime Profile × Certification Suite
```

A Body can be compatible with multiple substrates without implying the substrates are equivalent models in the abstract.

## 14. Certification

Example claim:

```
StructuralEngineer.Body 1.4
+ Substrate X 6.0
+ StructuralEnv 3.2
+ CertificationSuite 2.1
= PASS
```

Raw model benchmarks remain separate.

## 15. Provenance

Material artifacts retain stable identity, version, digest, source/creator, timestamps, parent refs, rights metadata, transformation lineage and verification refs.

## 16. Multi-tenancy and security

Tenant boundaries cover customer data, expert records, tasks, environments, trajectories, datasets, bodies and certification evidence.

Untrusted environments execute only inside approved isolation boundaries.

## 17. Integration

External providers and models interact via adapters. Provider-specific semantics never enter Arena kernel contracts.

Epoch remains authoritative for its own operational world.

## 18. Layers

```
apps
  ↓
services
  ↓
domain packages
  ↓
protocol packages
  ↓
persistence/infrastructure adapters
```

Dependencies only flow through approved layer contracts.

## 19. Non-goals

v1 does not train a frontier base model, provide universal physics/CAD, issue professional licenses, become a universal host operating system, allow unrestricted public code execution, or equate an LLM with a professional Agent Body.
