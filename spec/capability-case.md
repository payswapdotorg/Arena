# Capability Case Specification CC1.0

A Capability Case captures a concrete need to create, improve, test or verify an agent capability.

## Required fields

- case id/version;
- tenant/scope;
- source;
- domain;
- target capability;
- affected Body/Agent/Substrate when known;
- problem statement;
- observed failure/opportunity;
- evidence refs;
- known context;
- unknowns;
- desired outcome;
- expert requirement;
- environment requirement;
- task requirement;
- evaluator requirement;
- verifier requirement;
- priority;
- risk;
- provenance;
- status.

## Lifecycle

```
OPEN → TRIAGED → TASK_DESIGNED → EXPERT_WORK → EVALUATION → LEARNING → VALIDATED → CLOSED
```

Branches may create follow-up cases.

## Failure clusters

Multiple observations may map to a FailureCluster.

The cluster retains constituent evidence, scope, confidence, common capability hypothesis and rejected hypotheses.

Changing a hypothesis never deletes the original observations.

## Active learning

Arena may select the next case/task based on expected information value, but the selection rationale remains inspectable.
