# @arena/webhook-delivery — the Arena signed webhook delivery service

Work Order P003 (issue #155); ADR-P001-08 rule 4 + ADR-P001-01. This service
drains the **P002 durable webhook outbox** (the frozen `@arena/runtime-host`
`WebhookOutboxPort` — the real Postgres implementation ships in P002's durable
components) and delivers every pending event **signed, at-least-once, deduped
per EVENT ID** (never per type — R-032: event types legitimately recur across
lifecycle transitions) through the **EXISTING** `adapters/escalation`
`WebhookDeliveryAdapter` contract:

- **HMAC-SHA256** over `<timestamp>.<payload>` → `x-arena-signature: v1=<hex>`;
- the stable consumer dedupe key `x-arena-event-id` (the webhook eventId);
- **deterministic exponential backoff retry** (injected clock, never a wall
  clock — A015 law) and the **explicit dead-letter state** after `maxAttempts`
  (auditable, never silently dropped);
- a **REAL HTTP transport** (`node` fetch with a bounded per-attempt timeout —
  a hanging endpoint fails the attempt; a thrown transport error is ONE failed
  attempt, never a crash).

## Surface

| module           | what it is                                                     |
| ---------------- | -------------------------------------------------------------- |
| `service.ts`     | `createWebhookDeliveryService` — the drain composition (adapter + ledger + loop factory) |
| `http-transport.ts` | the real node-fetch wire transport + fail-closed endpoint URL validation |
| `ledger.ts`      | the reference (process-local) attempt ledger + dead-letter lot |
| `loop.ts`        | the dedicated durable drain loop (interval + fail-closed tick audit) |

The host composition site injects: the durable outbox (frozen port), the
endpoint URL, the **signer** (`hmacSha256WebhookSigner` — the signing material
never lives in this package), the clock, and optionally transport/ledger/
backoff overrides.

## Honest disclosure — the job-kind question (ADR-P001-01)

ADR-P001-01 binds P003 to "job-driven webhook dispatch" through the ONE shared
durable job runner **where the host interface provides it**. The frozen host
seam provides no registrable webhook job kind: `RUNTIME_JOB_KIND_NAMES` is a
CLOSED registry inside `packages/runtime-host`, and `HostJobsSurface
.submitByKind` resolves only those names. Adding a `webhook-delivery` kind
would edit the frozen P002 package — prohibited. Dispatch therefore rides the
documented alternative: **a dedicated durable loop, honestly disclosed**
(`loop.ts` — the outbox itself is the durable substrate).

## Honest limitation — process-local dead-letter ledger

The attempt ledger and dead-letter lot are **process-local** (the reference
`InMemoryWebhookDeliveryLedger`). The DURABLE at-least-once substrate is the
outbox (`listPending` / `markDelivered`): a restart re-arms pending events and
re-attempts them — at-least-once holds and nothing is silently dropped.
**Dead-letter permanence across restart is not yet durable** (an exhausted
event becomes pending again after restart and is retried before re-dead-
lettering). Durable dead-lettering needs either a delivery-ledger migration in
the frozen P002-owned surface or a webhook job kind in the frozen host
registry — both recorded as TL follow-ups.

## Tests

`src/service.test.ts` — real `node:http` receivers on ephemeral ports: signed
wire headers end-to-end, consumer signature verification, deterministic
backoff + dead-letter + skip-after-dead-letter, bounded transport timeout,
at-least-once duplicate delivery with per-event-id consumer dedupe, fail-closed
endpoint URL validation, and the drain loop's tick audit. The full
durable-outbox end-to-end proofs (real Postgres composition → HTTP host →
signed webhook receiver) live in `tests/api-host`.
