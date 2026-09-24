# Environment Specification ENV1.0

An Environment is a versioned executable world in which agents and experts perform tasks.

## Contract

Declare:

- environment id/version;
- image/build digest;
- initial state snapshot;
- seed policy;
- action/tool surface;
- observation surface;
- resource limits;
- network policy;
- filesystem policy;
- secret policy;
- time limits;
- reset semantics;
- checkpoint semantics;
- evidence outputs;
- evaluator/verifier hooks.

## Isolation

Untrusted workloads must have least privilege, explicit mounts, bounded CPU/memory/time, controlled network egress, secret isolation, process isolation and cleanup/reset.

## Reproducibility

Prefer deterministic environments.

For nondeterminism, capture seed, versions, external inputs and relevant timing/context metadata.

## Evidence

Every run should be addressable using task version, environment version, run id, initial snapshot digest, trajectory digest and evidence digests.
