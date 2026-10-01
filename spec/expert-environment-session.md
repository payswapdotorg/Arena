# Arena Expert Environment Session EES1.0

## Purpose

Allow a human expert to solve or intervene in an AI task using a safe replica of the same operating environment available to the agent.

This is the mechanism by which a paid human intervention can become a directly reusable learning event.

## Environment Capsule

At escalation time Arena receives or requests a snapshot reference:

ExecutionCapsule = task + world state + files/data + tool availability + policy + relevant history

Arena creates a bounded ExpertSessionCapsule derived from that state.

It is:
- isolated;
- scoped to one escalation;
- time-bounded where appropriate;
- privacy-policy controlled;
- non-authoritative for the host application's live world.

## Session modes

### Observe

Expert can inspect the agent's current state.

### Correct

Expert edits or corrects a result.

### Unblock

Expert supplies exactly the missing information or decision.

### Takeover

Expert completes the subproblem.

### Teach

Expert performs the solution while observable actions and artifacts are captured.

### Review

Expert critiques or validates a candidate solution.

Allowed modes are declared in the EscalationRequest.

## Agent observation

The originating agent/application may receive an observable stream containing approved events:
- environment observations;
- human actions;
- tool invocations;
- tool results;
- artifact changes;
- annotations;
- checkpoints;
- final result;
- expert correction;
- explicit tool-gap signal.

Do not require or transmit private chain-of-thought.

Arena captures observable work, evidence and structured annotations rather than hidden reasoning.

## Privacy barrier

The host application declares what is visible.

Possible controls:
- field-level redaction;
- document-level redaction;
- secret/tool exclusion;
- tenant boundary;
- customer identity masking;
- time-limited credentials;
- read-only resources;
- action allowlist;
- download restrictions;
- clipboard restrictions where supported;
- screenshot restrictions where supported.

The expert cannot escape the bounded session into the application's live environment.

## Tool-gap discovery

If the expert uses a tool unavailable to the agent, the expert can emit a ToolGapSignal.

A ToolGapSignal records:
- tool name;
- capability provided;
- why it was needed;
- inputs/outputs;
- external/manual nature;
- access requirements;
- cost/latency if known;
- evidence of use;
- recommended integration boundary;
- whether substitution was possible.

ToolGapSignal can feed:
Tool specification
→ Adapter request
→ Body improvement
→ capability benchmark
→ marketplace artifact.

## Knowledge capture

An expert can mark a statement as:
- temporary task-specific guidance;
- scoped reusable knowledge;
- candidate domain rule;
- verified domain constraint.

Arena must not silently promote task-specific advice to universal knowledge.

## Session completion

The expert submits:
- result;
- evidence;
- annotations;
- corrections;
- optional knowledge artifacts;
- optional tool-gap signals;
- consent/rights statement for reusable learning.

The session then enters Arena validation.

## Replay

Every session is replayable when rights permit.

Replay should show:

state → human action → observable consequence → evidence

and clearly indicate that it was a bounded expert session rather than a live-world mutation.

## Research basis

Interactive imitation-learning work treats human intervention and corrective feedback inside the agent's task state as a learning signal; adaptive intervention mechanisms have been studied to reduce expert burden while collecting higher-quality demonstrations. citeturn956631academia0turn956631academia1
