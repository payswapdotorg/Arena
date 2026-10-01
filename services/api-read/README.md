# @arena/api-read

The auth-gated read API boundary (Work Order B005; issue #71). Consumed by
B006/B007 UI wiring per `spec/service-boundaries.md`.

## Protocol (v1 read-specific envelope — disclosed choice)

The A025 `@arena/arena-sdk` api-query-request envelope carries a CLOSED
query-kind vocabulary registered in the arena-sdk schema registry (a
frozen surface). B005 therefore adopts a v1 read-specific envelope that
mirrors the A025 protocol shape:

- closed request kinds, strictly validated (`read-canonical`,
  `scroll-by-kind`, `list-kinds`), echoed on every response;
- reads are not commands — no idempotency keys anywhere;
- versioned envelopes (`recordVersion: 1`);
- typed error envelopes over the house code vocabulary
  (`READ_MODEL_*` + `AUTH_*`, category-coherent, fail-closed parser).

## The boundary contract

`handleReadRequest(sessionToken, rawRequest)`:

1. **B004 `validateSession` FIRST** — a missing, malformed, tampered,
   expired, revoked or rotated session yields a typed `AUTH_*` error
   envelope. Anonymous reads are NOT representable.
2. **Tenant from the validated context** — the request grammar has no
   tenant field at all; any tenant field in a payload is typed-rejected.
3. Dispatch to the injected `@arena/read-model-service`; success
   envelopes carry the canonical read results with source version,
   as-stored provenance and read-at.

The handler never throws for typed outcomes — every failure is a typed
error envelope (fail closed, nothing partial). Read-only: no write path
exists on this surface (asserted by the hygiene tests).

## Dependencies

Workspace links only (`@arena/auth`, `@arena/auth-service`,
`@arena/persistence`, `@arena/read-model`, `@arena/read-model-service`,
`@arena/role-context`, `@arena/security`). Zero external dependencies.
