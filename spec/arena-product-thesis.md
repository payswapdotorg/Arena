# Arena Product Thesis AT1.0

## North star

> Arena is the Stripe of human expert escalation for AI automation.

Any AI-enabled application can integrate Arena when its automation reaches a capability boundary and needs a human expert.

The application does not need to recruit, qualify, route, supervise, validate or pay that expert itself.

Arena handles the human escalation lifecycle.

## Canonical loop

Application / Agent
→ Escalation Request
→ Capability Need
→ Expert Matching
→ Expert Session
→ Human Intervention
→ Validation
→ Result
→ Payment
→ Learning / Tool / Knowledge capture

## What Arena sells

Arena is not primarily selling labels or generic outsourced labor.

It sells reliable human capability at the moment an AI system needs it, returned through an API in a machine-consumable form.

The intervention may be:
- correction;
- unblock;
- decision;
- answer;
- complete solution;
- validated review;
- demonstration;
- tool-gap discovery;
- domain-knowledge artifact.

## Epoch is a customer, not the operating system

Epoch is one application using Arena's API.

Conceptually:

Stripe:
merchant app → Stripe API → payment infrastructure → merchant receives result

Arena:
AI application → Arena escalation API → expert infrastructure → application receives result

Arena must therefore be application-agnostic.

## Capability improvement loop

Arena can improve an application in four distinct ways:

1. Better immediate answer.
2. Better domain knowledge.
3. Better tools.
4. Better Agent Body / workflow behavior.

The product is successful even when the intervention does not change the underlying model.

## Escalation modes

Every request declares one or more modes:

- SOLVE — expert completes the subproblem.
- CORRECT — expert corrects an existing agent result.
- UNBLOCK — expert supplies the missing decision/information needed to continue.
- REVIEW — expert validates or critiques output.
- TEACH — expert demonstrates a solution so Arena can capture reusable capability.
- TOOL_GAP — expert identifies a missing tool or capability.
- KNOWLEDGE — expert supplies structured domain knowledge/constraints.
- EVALUATE — expert evaluates competing candidate solutions.

The same request can move through more than one mode when the contract permits it.

## Immediate versus reusable value

Arena separates:

### Operational result

What the application needs now to continue its workflow.

### Learning artifact

What Arena is permitted to retain and reuse to improve a Body, tool specification, knowledge asset, evaluator, benchmark or future routing.

Learning permission must be explicit and scoped.

## Example

A building-estimation agent is preparing a BOQ for a house in Accra.

The agent encounters uncertainty around a local construction practice, rate, measurement convention or other domain fact.

It calls the Arena escalation API.

Arena:
1. identifies the capability need;
2. selects a qualified expert;
3. creates a privacy-sanitized replica of the exact workflow state;
4. gives the expert a secure session link;
5. lets the expert inspect and manipulate the same environment available to the agent;
6. records observable actions, tool usage and submitted evidence;
7. lets the expert correct, unblock or solve the issue;
8. validates the result;
9. returns structured output to the application;
10. pays the expert according to accepted commercial terms;
11. retains Arena-permitted learning artifacts;
12. records missing-tool signals if the expert relied on an unavailable tool.

The agent can observe the expert session, subject to privacy policy and expert consent.

## Product principle

Human escalation is not a failure of automation.

It is a programmable capability boundary.

Arena turns that boundary into infrastructure.
