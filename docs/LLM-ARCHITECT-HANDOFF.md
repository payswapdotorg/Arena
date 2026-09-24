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
