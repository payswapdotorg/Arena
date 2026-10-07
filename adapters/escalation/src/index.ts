/**
 * @arena/escalation-adapters — escalation WIRE TRANSPORT adapters
 * (Work Order C001; issue #75; spec/expert-escalation-api.md ES1.0).
 *
 *   - WebhookDeliveryAdapter — signed webhook delivery (HMAC-SHA256),
 *     deterministic retry/backoff, explicit dead-letter state, at-least-
 *     once with eventId consumer dedupe, over the escalation-api outbox;
 *   - McpStdioTransport — the MCP stdio transport binding (newline-
 *     delimited JSON-RPC 2.0) over the escalation-api MCP tool layer.
 *
 * Adapter law (architecture-lock rule 10): providers/adapters stay out
 * of domain packages; boundary rule B4 keeps adapters from importing
 * services — every coupling below is a PURELY STRUCTURAL port that the
 * host composition root wires (compile-time compatibility with
 * services/escalation-api is asserted by that package's wiring test).
 */

export * from './webhook-delivery.js';
export * from './mcp-stdio.js';
