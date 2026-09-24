# Agent Body and Possession Specification AB1.0

## AgentBody

Stable identity for a professional/capability composition.

An AgentBody has immutable BodyVersions.

## BodyVersion

Immutable snapshot of:

- body identity/version;
- mission and role;
- domain scope;
- capabilities and SkillRefs;
- KnowledgeRefs;
- ToolRefs;
- procedures/workflows;
- memory policy;
- planning/decision policy;
- escalation/delegation;
- authority boundaries;
- safety policy;
- evaluation suite refs;
- verification suite refs;
- environment requirements;
- substrate compatibility profile;
- provenance and lineage;
- parent/supersession refs.

## CognitiveSubstrate

Provider-neutral reference to a model/runtime capability.

Must identify:

- provider adapter;
- model family/id;
- model revision;
- modality profile;
- tool-calling profile;
- context/profile limits;
- adapter version;
- integrity metadata.

Credentials never enter canonical objects.

## Possession

Immutable binding:

```
BodyVersion
+
CognitiveSubstrate
+
RuntimeProfile
+
EnvironmentProfile
+
PolicyBundle
+
optional ModelSpecificArtifacts
```

A Possession has a content digest.

## AgentInstance

Ephemeral execution of a Possession with:

- instance id;
- possession digest;
- environment instance;
- runtime state;
- event stream;
- termination status.

## Compatibility Profile

A BodyVersion declares required modalities, tool semantics, context characteristics, cost/latency constraints where relevant, required evaluation suites, prohibited substrate conditions and optional substrate-specific adaptations.

It may not declare any model as semantically identical to the Body.

## Certification interpretation

Certification proves a claim about:

```
BodyVersion × Substrate × Environment × Runtime × CertificationSuite
```

It does not prove:

```
Substrate = Profession
```

## Evolution

A professional capability change creates a new BodyVersion.

A substrate upgrade creates a new Possession and normally requires compatibility/certification testing.

A model-specific training artifact that materially changes professional behavior must be versioned so it cannot silently mutate a certified Body.
