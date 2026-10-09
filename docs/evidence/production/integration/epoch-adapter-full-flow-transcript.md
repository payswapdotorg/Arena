# P006 integrated acceptance — epoch-adapter-full-flow

- captured-at: 2026-10-09T10:41:42.185Z (fresh timestamp — no historical evidence rewritten)
- deployed-source-sha: 19fbcf775ba7038981dec74a18bbc776c22d80d9
- engine: embedded-postgres (evidence class AUTOMATED-TEST-ONLY)
- transport: public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) consumed through the adapter’s consumeEpochWebhook — the REAL webhook-delivery service draining the REAL durable outbox — http://127.0.0.1:40583
- truth-lens: customer (ADR-P001-02; recorded per observation, never blended)
- payment-posture: DEMO provider (executesCustomerMoney=false) — CI moves NO real money

## Observations

- epoch-trigger-mapping: wire trigger parsed closed-shape; adapter mapped it onto the ES1.0 create input (capabilityNeed=construction.quantity-surveying.boq-verification; 2 context refs incl. the EPI1.0 trajectory digest)
- request: POST /v1/escalations → 201 requestId=esc_1952ecb50da14b50a78ddbc8f1f04a13
- capability-demand/routing: poll → offered (expert=expert-kwame; the REAL routing service over the REAL capability graph + candidate directory)
- webhook-drain/offer: 4 signed deliveries → 4 consumed (cumulative 4); dead-lettered=0
- bounded-expert-session: capsule a55ce95301ac…; 5 observable events; intervention actions recorded (read-context, run-approved-tools, propose-patch, annotate-evidence, signal-tool-gap)
- webhook-drain/completion: 9 signed deliveries → 9 consumed (cumulative 13); dead-lettered=0
- validation/adjudication: poll → state=closed validationStatus=passed
- typed-result: poll → result kind=unblock
- mcp-transport: tools/list + get-escalation-status over POST /mcp → state=closed (one authority, two transports)
- payment-test/sandbox: provider truth=demo executesCustomerMoney=false; release cost 25000 minor units (fee 2500) — demo money only
- own-authority-application: appliedBy=client-own-authority; workflow resumed
- sla-measurement: 4 clocks (accept:met, start:met, submit:met, validate:met); typed states + reasons (ADR-P001-04)
- learning-gate: unconsented BLOCKED (rights-insufficient); consented compilable → gate adopted-with-evidence (Q1.0 ✓✓✓✓✓) → 1 gated proposal(s)
- observational-replay: kind=bounded-expert-session-replay liveMutation=false (1 frames); asLiveMutation DENIED (REPLAY_AS_LIVE)
- identical-public-flow-receipt: the SAME §15 receipt the generic client produces (machine-checked in identical-flow.e2e.test.ts): terminal closed, result unblock, validation passed, cost 25000, 11 distinct event types, Q1.0 adopted-with-evidence
- delivery-projections: 13 read-only EpochEscalationDelivery projections from consumed events (deep-frozen; epochJobId back-linked on every one)
- terminal-delivery: state=closed; resultKind=unblock; validation=passed; cost=25000 (payout paid); refs=[escalation-request-ref, evidence-ref, expert-session-ref]; learningArtifactRefs=none (posture allowArtifactReuse=false — rights-gated)
- own-authority-application: appliedBy=client-own-authority over the frozen delivery; application recorded on the Epoch side (Arena never writes Epoch state)
- authority-boundary: observe-delivery permitted; every other delivery action forbidden; attemptEpochAuthoritativeWrite DENIED for ALL 5 authoritative stores (EPOCH_ESCALATION_WRITEBACK_FORBIDDEN — EPI1.0 Authority, lock rules 13-15/36)
- webhook-consumption-adversarial: forged signature → rejected signature-mismatch; correctly-signed foreign-tenant event → rejected tenant-mismatch (the consumer walls of consumeEpochWebhook)
- evidence-class: AUTOMATED-TEST-ONLY (engine embedded-postgres)
