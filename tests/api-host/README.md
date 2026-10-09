# tests/api-host — the P003 public-transport acceptance battery

Work Order P003 (issue #155) · spec/post-roadmap-production-work-items.md
"## P003" acceptance row: *"generic client uses an actual local URL;
end-to-end result and signed webhook verify; MCP operates against the same
boundary; auth/tenant mismatch, duplicate delivery, forgery, collision,
timeout and retry tests pass. No private chain-of-thought capture."*

Run: `node tests/api-host/run.mjs` (self-contained — drives
services/escalation-api's typescript + vitest; this is NOT a pnpm workspace
project, the tests/runtime-host precedent).

## What the battery boots (all REAL production code)

- the REAL durable components (`createDurableRuntimeComponents`) over the
  in-memory reference SqlTransport — **disclosed**: the persistence layer
  rides the reference transport inside the battery (P002's pglite +
  live-Neon batteries already proved the SAME components over real
  Postgres; P003's proofs target the TRANSPORT boundary);
- the REAL engines — `EscalationApiService` (with the REAL
  `EscalationRoutingService`), `JobOrchestrator` — injected through the
  frozen host seam (`createRuntimeHost`), mirroring
  `deploy/runtime/src/composition.ts` verbatim with one deliberate
  difference: the battery keeps the durable-component handle so the
  webhook proofs can drain the REAL outbox;
- the REAL developer-platform key model (`issueDeveloperKey` /
  `authorizeDeveloperKey` over `createNodeSecretHasher` +
  `createNodeSecretMaterialGenerator`) behind the http-host's
  `ApiKeyAuthenticator` port — a real key registry with real secret hashes
  (issue / revoke lifecycles), never stub verdicts;
- the REAL HTTP listener (`startEscalationHttpHost` on an ephemeral port) —
  **the actual local URL** the generic plain-fetch client talks to;
- for the webhook proofs: the REAL `@arena/webhook-delivery` service
  draining the REAL durable outbox into a REAL `node:http` webhook
  receiver.

## Proofs (api-host.e2e.test.ts)

| spec acceptance clause | proof |
|---|---|
| generic client / actual local URL | plain `fetch` against the ephemeral-port listener; create → status → result (201 + `escalation-created`, lens-stamped status, healthz/readyz fail-closed aggregate) |
| end-to-end result | status polling returns the durable record (state, history, request id) |
| collision | idempotency replay → 200 `escalation-replayed` + `duplicate:true` with the recorded outcome verbatim; key + differing body → typed `409 ESCALATION_IDENTITY_CONFLICT` |
| auth mismatch | missing / malformed / unknown secrets → typed 401 `DEVELOPER_SECRET_INVALID` / `DEVELOPER_KEY_NOT_FOUND`; sandbox key on the live surface → 403 `DEVELOPER_ENVIRONMENT_MISMATCH`; missing scope → 403 `DEVELOPER_SCOPE_MISSING`; revoked key → 403 `DEVELOPER_KEY_REVOKED` |
| tenant mismatch | client-claimed tenant ≠ key tenant → typed 403 `DEVELOPER_CROSS_TENANT_ACCESS`; cross-tenant read → typed 404 `RUNTIME_ESCALATION_NOT_FOUND` (indistinguishable from unknown) |
| MCP same boundary | POST /mcp `tools/list` + `tools/call` create/status over the SAME authority (the REST surface sees the same record); JSON-RPC negatives (−32601/−32602/−32700); MCP auth + tenant negatives carry the SAME typed taxonomy |
| signed webhook verify | every outbox event delivered SIGNED (HMAC-SHA256 `v1=<hex>`, full header set) and verified by the consumer contract |
| forgery | tampered signature / tampered payload / malformed header → `signature-mismatch` / `malformed-signature-header`; a correctly-signed-but-stale delivery → `timestamp-mismatch` (replay window) |
| duplicate delivery | a transient failure re-delivers the SAME event id; the consumer dedupes per EVENT ID (unique set = pending count), never per type (R-032) |
| timeout and retry | a hanging endpoint fails the attempt on the bounded transport timeout (no HTTP status), retries to success; a dead endpoint dead-letters after maxAttempts and is SKIPPED on re-sweep |
| no private chain-of-thought capture | every typed error payload is asserted free of stacks/traces/internal reasoning |

## Mirror parity pins (parity-pins.test.ts)

The http-host/mcp-host structural mirrors, pinned value-for-value against
the REAL vocabularies imported from the REAL packages: scopes,
environments, denial reasons, secret pattern source, the full
developer-platform code set + categories + denial→code table, truth lenses,
capacity statuses, the runtime boundary codes (covering the frozen
lifecycle + lens namespaces; every mirrored code proven present in the
frozen sources — no invented vocabulary), the escalation rendering table
covering the FULL code set, the documented HTTP rendering classes, and the
MCP tool catalog verbatim against the C001 `McpToolServer`.
