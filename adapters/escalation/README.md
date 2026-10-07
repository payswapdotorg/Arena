# @arena/escalation-adapters

Escalation **wire-transport** adapters (Work Order **C001**, issue #75; `spec/expert-escalation-api.md` ES1.0).

Two adapters, one law: transports never live in domain or service packages (architecture-lock rule 10), and adapters never import services (boundary rule B4). Every coupling below is a **purely structural port** wired at the host composition root — this package has **zero workspace runtime dependencies**.

## 1. Signed webhook delivery — `WebhookDeliveryAdapter`

Drains the durable, at-least-once webhook outbox maintained by `services/escalation-api` (`WebhookOutbox` / `InMemoryWebhookOutbox`):

- **Signed payloads** — HMAC-SHA256 over `<timestamp>.<payload>`; header `x-arena-signature: v1=<hex>`; the signing *material* is host-injected (`hmacSha256WebhookSigner({ signingKeyId, hmacInput })`) and never lives in the repo.
- **At-least-once** — the `x-arena-event-id` header carries the escalation `eventId`, which IS the idempotent consumer key; duplicate deliveries (e.g. crash between POST and ack) keep the same key, so consumers dedupe safely.
- **Retry with deterministic backoff** — failed/non-2xx/throwing POSTs retry with `baseDelayMs * multiplier^(attempt-1)` computed from the injected clock; every attempt is appended to the `WebhookDeliveryLedger` audit trail.
- **Dead-letter state** — after `maxAttempts` (default 5) the delivery moves to an explicit, auditable dead-letter record; later sweeps skip it; nothing is ever silently dropped.
- **Machine-readable verdicts** — `deliverPending()` returns a `WebhookDeliverySweepReport`; `verifyWebhookSignature()` returns `{ outcome: 'verified' }` or `{ outcome: 'rejected', reason }` (tamper-proof comparison via `timingSafeEqual`).

## 2. MCP stdio transport binding — `McpStdioTransport`

Newline-delimited JSON-RPC 2.0 framing over `services/escalation-api`'s `McpToolServer` (MCP is a *surface*, not a semantic authority):

- the handler port is a structural mirror of `McpToolServer.handleToolCall` — `new McpStdioTransport({ handler: mcpToolServer })` type-checks without any import edge;
- chunk-safe line buffering (`handleChunk`) plus fail-closed end-of-stream `flush()`;
- unparseable lines answer `-32700 PARSE_ERROR` (id `null`) and never kill the stream; handler-side error normalization stays in the tool layer.

## Wiring (host composition root)

```ts
import { EscalationApiService, McpToolServer } from '@arena/escalation-api';
import { WebhookDeliveryAdapter, McpStdioTransport, hmacSha256WebhookSigner } from '@arena/escalation-adapters';

const service = new EscalationApiService({ clock, store, outbox, routing });
const mcp = new McpStdioTransport({ handler: new McpToolServer(service) });
const webhooks = new WebhookDeliveryAdapter({
  source: service.outbox,                        // structural port — no import edge
  endpoint: { url: 'https://client.example/hooks/arena' },
  signer: hmacSha256WebhookSigner({ signingKeyId: 'wh-2026-10', hmacInput: process.env.ARENA_WEBHOOK_SIGNING_INPUT }),
  transport: httpTransport,                       // host-supplied HTTP client
  clock, ledger,
});
await webhooks.deliverPending();                  // host drain schedule
```

Compile-time structural compatibility with the service surfaces is asserted by `services/escalation-api/src/wiring.test.ts` (test-only devDependency, direction service → adapter, allowed by boundary rule B4).

## Tests

`pnpm --filter @arena/escalation-adapters test` — signed delivery, retry/backoff, dead-letter, at-least-once duplicates, consumer verification, stdio framing, hygiene (provider neutrality, no `any`, no workspace imports).
