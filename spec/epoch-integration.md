# Epoch Integration Contract EPI1.0

## Status

Reference provider integration. Arena is fully usable without Epoch.

## Incoming requests from Epoch

- CapabilityDevelopmentRequest;
- CapabilityCase seed;
- failed trajectory refs;
- evaluation gaps;
- capability/domain requirements.

## Arena outputs

- CapabilityCaseRef;
- TaskSpecRef;
- EnvironmentRef;
- ExpertWorkRef;
- TrajectorySetRef;
- EvaluatorRef;
- VerifierRef;
- SkillArtifactRef;
- AgentBodyVersionRef;
- CompatibilityReportRef;
- CertificationRef.

## Asynchronous contract

Every job uses:

- job id;
- correlation id;
- causation id;
- idempotency key;
- artifact digest(s);
- authorization metadata;
- explicit lifecycle/status.

## Authority

Arena does not:

- mutate Epoch World Model;
- execute Epoch actions;
- alter Epoch constraints;
- change approved baselines;
- alter Epoch delivery state;
- become Epoch semantic authority.

## Closed loop

```
Epoch detects capability failure
→ capability-development request
→ Arena Capability Case
→ task/environment/expert work
→ evaluation/verification/learning
→ Body/substrate certification
→ capability artifact
→ Epoch consumes artifact via its adapter
→ original capability is retested
```

## Aurum

Aurum may be used by Epoch to acquire a specific real-world observation from an authorized person.

Arena acquires reusable capability from expert work.

A future system may route expert recruitment/contact through external channels, but Aurum-specific schemas remain outside Arena core contracts.
