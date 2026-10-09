# P006 integrated acceptance — generic-client-full-flow

- captured-at: 2026-10-09T12:47:04.712Z (fresh timestamp — no historical evidence rewritten)
- deployed-source-sha: c207d01db003e80ff90101a5ed6d6431572ce390
- engine: embedded-postgres (evidence class AUTOMATED-TEST-ONLY)
- transport: public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) from the REAL webhook-delivery service draining the REAL durable outbox — http://127.0.0.1:44551
- truth-lens: customer (ADR-P001-02; recorded per observation, never blended)
- payment-posture: DEMO provider (executesCustomerMoney=false) — CI moves NO real money

## Observations

- boot: listener http://127.0.0.1:44551; webhook endpoint http://127.0.0.1:38427/webhooks
- request: POST /v1/escalations → 201 created requestId=esc_7e49e9f02ff2456b9f5adab6bc752e13
- capability-demand/routing: poll → offered (expert=expert-kwame; the REAL routing service over the REAL capability graph + candidate directory)
- offer/webhook-drain-1: 4 signed deliveries verified + deduped (escalation.progressed, escalation.progressed, escalation.matched, escalation.created)
- bounded-expert-session: capsule digest ac3b03b973c2bdc6…; 5 observable session events; mode authorization allowed=true
- intervention: permitted actions recorded: read-context, propose-patch, annotate-evidence, signal-tool-gap
- webhook-drain-2: 9 more signed deliveries (13 total accepted); every type in the closed 13-type taxonomy observed through the public boundary
- webhook-dedupe: redelivered event id rejected as duplicate-event (per-event-id dedupe)
- validation/adjudication: poll → validationStatus=passed (recorded verdict — the C009 seam)
- typed-result: poll → result kind=unblock summary="Block C foundation depth follows the 450mm local…"
- mcp-transport: tools/list + get-escalation-status over POST /mcp → the SAME record's state/result/cost (one authority, two transports)
- payment-test/sandbox: DEMO_PROVIDER_POSTURE.executesCustomerMoney=false; releasePayout cost 25000 minor units (fee 2500) — demo money only
- own-authority-application: appliedBy=client-own-authority; workflow resumed
- sla-measurement: four clocks measured: accept:met, start:met, submit:met, validate:met (typed states + reasons; ADR-P001-04)
- learning-gate: unconsented candidate BLOCKED (rights-insufficient); consented candidate compiled → Q1.0 gate verdict adopted-with-evidence (all five conditions met) → 1 gated proposal(s) routed (body-forge)
- observational-replay: replay trace kind=bounded-expert-session-replay liveMutation=false (1 frames); asLiveMutation DENIED (REPLAY_AS_LIVE)
- evidence-class: AUTOMATED-TEST-ONLY (engine embedded-postgres)
