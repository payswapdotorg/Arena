# @arena/arena-sdk

The **public/private Arena API and SDK** (Work Order A025) — the typed client surface over the platform's read/query paths. Once a Body version has been certified (A023), released (A024), registered and published, it becomes programmatically consumable through this package.

## Surface

- **Closed query vocabulary** (`API_QUERY_KINDS`, 16 kinds): registry reads (release records, body-version registrations, release publications, certification suites, body versions), certification statement reads (records carry the DERIVED scoped statement — the design law survives the API hop), compatibility verdict reads, and compound projections (active release per channel, release lifecycle status + publication visibility).
- **`ArenaApiClient`** — the typed, fail-closed, deep-frozen client over an injected `ArenaApiTransport`; one strict send/validate path per method.
- **Envelope wiring** — queries and responses travel in `@arena/protocol-core` `Envelope<T>` with the `query` / `response` envelope kinds (the first consumer of the full core envelope vocabulary). Idempotency keys remain command-only (architecture-lock rule 17); pairs are correlated by `correlationId` and validated fail-closed.
- **Tenant scoping** — every query carries a REQUIRED `ApiReadScope { tenant }`; the reserved namespace `public` sees only explicitly public records; cross-tenant reads fail closed with `ARENA_API_CROSS_TENANT_ACCESS` (lock rule 11).
- **Typed errors** — closed `ARENA_API_*` code set with category mapping and a strictly validating wire-safe struct.

## Read-only by construction

The SDK never redefines sibling record shapes: results are validated against the owning packages' structural guards (`isReleaseRecord`, `isCertificationRecord`, `isCompatibilityRecord`, `isCertificationSuite`, `isBodyVersion`, `isReleasePublicationRecord`). There is no write or mutation API on this surface — the platform's write paths stay in their owning work orders.

## Contracts

Generated contracts live in `contracts/api/` at the repository root (A025 owned surface), emitted by `scripts/generate-contracts.mjs` (auto-discovered by governance G9). Drift is checked by `src/drift.test.ts` + `contracts:check`, and parity against this TS surface by `src/contracts.parity.test.ts`. Domain-record payloads are carried opaquely by the wire contracts — their shapes belong to their domain packages' own contracts; the SDK asserts structural parity through the owning packages' guards instead of duplicating schemas.

## Reference server

`services/api` (`@arena/api-fabric`) is the reference server-side fabric: an in-process, guard-validated read model over the sibling record kinds with tenant-scoped dispatch and the envelope-wired facade. Wire it into the client with `createLoopbackTransport(fabric)` — the loopback still constructs and validates real response envelopes on every hop.
