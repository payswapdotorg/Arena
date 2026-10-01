# Arena Escalation Reference Flow ERF1.0

## Reference scenario

A third-party AI application is producing a house BOQ for Accra.

The agent reaches an uncertainty boundary:
- it does not know whether a local construction convention applies;
- it lacks a relevant specialist tool;
- or its current BOQ contains a questionable quantity/rate/assumption.

## Agent call

The application calls Arena with:
- capability need;
- current task/run reference;
- required output shape;
- urgency;
- budget;
- privacy/session policy;
- allowed intervention modes.

## Arena

1. Triages the need.
2. Resolves required capabilities.
3. Finds qualified available experts.
4. Makes an offer.
5. Creates an isolated environment capsule from the agent's state.
6. Gives the accepted expert a secure session link.
7. Allows the expert to inspect and work in the same task environment.
8. Streams approved observable events to the originating application/agent.
9. Lets the expert solve, correct or unblock.
10. Captures evidence and any tool-gap/knowledge signals.
11. Validates the submission.
12. Requests revision/replaces the expert if validation fails.
13. Returns a typed result.
14. Settles expert payment and Arena fee.
15. Compiles approved reusable learning artifacts.
16. Updates capability/network evidence.

## Agent response

The originating application can:
- apply the immediate correction;
- resume the paused workflow;
- store approved domain facts;
- request a missing tool;
- trigger a future Body improvement;
- use the evidence in a future evaluation.

## Important boundary

Arena does not silently modify the application's live state.

The host application consumes the returned result and decides how/when to apply it through its own authority.

## Example intervention types

### UNBLOCK
Expert supplies one missing local rule.

### CORRECT
Expert fixes a flawed BOQ assumption.

### SOLVE
Expert completes the quantity-surveying subproblem.

### TEACH
Expert performs the solution in the environment so the agent can observe.

### TOOL_GAP
Expert says:
“This required a local rate database/search/calculation tool that the agent environment lacks.”

### KNOWLEDGE
Expert provides a reusable, scoped construction rule backed by evidence.

### REVIEW
Expert verifies whether the generated BOQ is acceptable.

## Payment state

Payment is released only after the agreed validation condition is satisfied.

The application can pre-authorize a budget; Arena controls the expert-side settlement lifecycle.

## Learning state

The immediate result is returned independently of whether the customer permits Arena to retain a reusable learning artifact.

This keeps operational delivery and training-data rights separate.
