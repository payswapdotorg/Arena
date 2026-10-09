# escalation-api http-host — the P003 real HTTP transport

Work Order P003 (issue #155) · ADR-P001-07 §4 (host owns transport
mounting) · ADR-P001-08 (public HTTP/MCP/webhook lifecycle).

A real `node:http` listener (zero external runtime dependencies) binding
the frozen P002 host interface to runnable transport: the C001 REST
contracts **verbatim** — same typed codes, same idempotency law — over the
SAME canonical lifecycle authority and schema as the MCP host
(`../mcp-host`; one authority, two transports).

## Routes

| Route | Method | Auth | Contract |
|---|---|---|---|
| `/v1/escalations` | POST | `Authorization: Bearer dak_live_…` · scope `escalations:create` · live keys only | ES1.0 create. `201` created / `200` replay — body is the recorded escalation-response payload **verbatim** (the replay marker `kind:"escalation-replayed"`, `duplicate:true` rides inside). Idempotency key + differing body → `409` typed `ESCALATION_IDENTITY_CONFLICT`. Client-claimed `tenantId` ≠ key tenant → `403` typed `DEVELOPER_CROSS_TENANT_ACCESS`. |
| `/v1/escalations/{request_id}` | GET | `Authorization: Bearer dak_live_…` · scope `escalations:read` | ES1.0 status (tenant-scoped, lens-stamped underneath). `200` body = the escalation-status response payload (`{responseVersion, kind:"escalation-status", record}`). Cross-tenant reads fail closed underneath → `404` typed `RUNTIME_ESCALATION_NOT_FOUND`. |
| `/mcp` | POST | `tools/call` per-tool scopes (`escalations:create` / `escalations:read`); `tools/list` is open contract metadata | JSON-RPC 2.0 MCP tool layer (see `../mcp-host`). |
| `/healthz` | GET | none | Fail-closed aggregate health snapshot. `200` ready / `503` not ready. No tenant data. |
| `/readyz` | GET | none | `200 {"ready":true}` / `503`. |

Unknown routes → `404` (status only); wrong methods → `405` + `Allow`
(transport-level, no typed body — the typed taxonomy belongs to request
processing). Request bodies are bounded (1 MiB default → typed `413`),
`application/json` only (typed `415`), and must parse (typed `400`).

## Shared error taxonomy (ADR-P001-08 rule 5)

Every failure renders as a machine-readable typed body
`{code, category, message, details}` — honest payloads only (no stack
traces, no private reasoning). NO new code vocabulary is invented: the
renderings map onto the existing code sets — the REAL escalation codes
(`@arena/escalation`), the developer-platform codes (a value-for-value
mirror of `@arena/developer-platform`, pinned by tests/api-host), and the
runtime-host boundary codes (`RUNTIME_*`).

| Family | Rendering highlights |
|---|---|
| `ESCALATION_*` | validation → `400`; `IDENTITY_CONFLICT`/state/transition/deadline → `409`; `CROSS_TENANT_ACCESS`/`UNPERMITTED_ACTION` → `403`; unknown → `500` |
| `DEVELOPER_*` | auth (`KEY_NOT_FOUND`, `SECRET_INVALID`, `INVALID_SECRET`) → `401`; scope/status/environment/tenancy (`SCOPE_MISSING`, `KEY_REVOKED`, `KEY_ROTATED`, `ENVIRONMENT_MISMATCH`, `CROSS_TENANT_ACCESS`) → `403`; validation → `400`; capacity fail-closed → `503` |
| `RUNTIME_*` | `NOT_STARTED`/`PERSISTENCE_DISABLED` → `503`; `ESCALATION_NOT_FOUND` → `404`; `CROSS_TENANT_ACCESS`/`LENS_CONFLICT` → `403`; `INVALID_TRANSITION` → `409` |

A missing or malformed `Authorization` header renders as the typed
`DEVELOPER_SECRET_INVALID` `401` (an invalid secret presentation — the
existing vocabulary, never a second code family). Unrecognized error
shapes fail closed as the typed `ESCALATION_UNKNOWN_ERROR` `500`.

## Auth boundary (ADR-P001-08 rule 2)

Scoped API keys per the developer-platform key model: closed scope
vocabulary (`escalations:create|read`, `sandbox:run`, `webhooks:manage`,
`observability:read` — no `keys:manage` by design), append-only
`active → rotated | revoked` lifecycle, sandbox/live separation (sandbox
keys fail closed on this LIVE surface with the typed
`DEVELOPER_ENVIRONMENT_MISMATCH`). The tenant of every request is DERIVED
from the authenticated key — never from a client-claimed field.

The authenticator itself is injected (`ApiKeyAuthenticator` in
`ports.ts`); the composition site (`apps/api`) satisfies it with the REAL
developer-platform domain functions (`issueDeveloperKey` /
`authorizeDeveloperKey`).

## Composition law

This module performs no composition — the host (P002 seam) is injected as
the `HostEscalationsTransport` structural mirror of the frozen
`HostEscalationsSurface`. The real wiring lives in `apps/api` (the P003
deployable shell); the structural parity is pinned by `tests/api-host`
(the tests/runtime-host composition-parity precedent).

## Wiring note (TL-flagged)

`services/escalation-api/package.json` exports only `.` — this sub-surface
is consumed by `apps/api` and `tests/api-host` through tsconfig/vitest
path aliases (`@arena/escalation-api/http-host`, `…/mcp-host`), the same
TL-flagged nested-surface precedent P002 used for
`@arena/runtime-host-composition` and the nested neon-postgres adapter.
Registering first-class subpath exports is a root-manifest action for the
TL at intake.
