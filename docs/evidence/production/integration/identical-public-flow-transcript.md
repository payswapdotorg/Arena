# P006 integrated acceptance — identical-public-flow

- captured-at: 2026-10-09T12:47:00.028Z (fresh timestamp — no historical evidence rewritten)
- deployed-source-sha: c207d01db003e80ff90101a5ed6d6431572ce390
- engine: embedded-postgres (evidence class AUTOMATED-TEST-ONLY)
- transport: public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) from the REAL webhook-delivery service draining the REAL durable outbox — http://127.0.0.1:38385
- truth-lens: customer (ADR-P001-02; recorded per observation, never blended)
- payment-posture: DEMO provider (executesCustomerMoney=false) — CI moves NO real money

## Observations

## Client A — the generic AI application client

- request: POST /v1/escalations → 201 requestId=esc_ad5761a0762b4bac8e413080637abf8c
- capability-demand/routing: poll → offered (expert=expert-kwame; the REAL routing service over the REAL capability graph + candidate directory)
- webhook-drain/offer: 4 signed deliveries → 4 consumed (cumulative 4); dead-lettered=0
- bounded-expert-session: capsule 22d6a4699cba…; 5 observable events; intervention actions recorded (read-context, propose-patch, annotate-evidence, signal-tool-gap)
- webhook-drain/completion: 9 signed deliveries → 9 consumed (cumulative 13); dead-lettered=0
- validation/adjudication: poll → state=closed validationStatus=passed
- typed-result: poll → result kind=unblock
- mcp-transport: tools/list + get-escalation-status over POST /mcp → state=closed (one authority, two transports)
- payment-test/sandbox: provider truth=demo executesCustomerMoney=false; release cost 25000 minor units (fee 2500) — demo money only
- own-authority-application: appliedBy=client-own-authority; workflow resumed
- sla-measurement: 4 clocks (accept:met, start:met, submit:met, validate:met); typed states + reasons (ADR-P001-04)
- learning-gate: unconsented BLOCKED (rights-insufficient); consented compilable → gate adopted-with-evidence (Q1.0 ✓✓✓✓✓) → 1 gated proposal(s)
- observational-replay: kind=bounded-expert-session-replay liveMutation=false (1 frames); asLiveMutation DENIED (REPLAY_AS_LIVE)
- client-a-receipt: terminal closed; result unblock; validation passed; cost 25000 minor units (arena fee present); 11 distinct signed event types observed

## Client B — the Epoch adapter client (adapters/epoch-escalation over the public transport)

- request: POST /v1/escalations → 201 requestId=esc_edfec8652a1446c69848a981740a63ee
- capability-demand/routing: poll → offered (expert=expert-kwame; the REAL routing service over the REAL capability graph + candidate directory)
- webhook-drain/offer: 4 signed deliveries → 4 consumed (cumulative 4); dead-lettered=0
- bounded-expert-session: capsule 125e479e824f…; 5 observable events; intervention actions recorded (read-context, run-approved-tools, propose-patch, annotate-evidence, signal-tool-gap)
- webhook-drain/completion: 9 signed deliveries → 9 consumed (cumulative 13); dead-lettered=0
- validation/adjudication: poll → state=closed validationStatus=passed
- typed-result: poll → result kind=unblock
- mcp-transport: tools/list + get-escalation-status over POST /mcp → state=closed (one authority, two transports)
- payment-test/sandbox: provider truth=demo executesCustomerMoney=false; release cost 25000 minor units (fee 2500) — demo money only
- own-authority-application: appliedBy=client-own-authority; workflow resumed
- sla-measurement: 4 clocks (accept:met, start:met, submit:met, validate:met); typed states + reasons (ADR-P001-04)
- learning-gate: unconsented BLOCKED (rights-insufficient); consented compilable → gate adopted-with-evidence (Q1.0 ✓✓✓✓✓) → 1 gated proposal(s)
- observational-replay: kind=bounded-expert-session-replay liveMutation=false (1 frames); asLiveMutation DENIED (REPLAY_AS_LIVE)
- client-b-receipt: terminal closed; result unblock; validation passed; cost 25000; 11 distinct event types; delivery projection frozen (read-only); applied by Epoch's OWN authority
- identical-public-flow: receipt equality on every public-flow field (client identity excepted) — generic [lens:customer] vs epoch [lens:customer]; both observed 11 distinct signed event types, terminal closed, validation passed, Q1.0 adopted-with-evidence
- evidence-class: AUTOMATED-TEST-ONLY (engine embedded-postgres)
