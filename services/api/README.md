# @arena/api-fabric

The **reference server-side layer** for the Arena public/private API (Work Order A025) — the `services/api` reference service over `@arena/arena-sdk`'s closed query vocabulary.

## Two layers (the house pattern)

- **`ApiFabric`** — the in-process reference read model: guard-validated, idempotent-by-digest ingest of the authoritative records of the completed platform core (A003 `BodyVersion`, A023 `CertificationRecord`/`CertificationSuite`, A022 `CompatibilityRecord`, A024 `ReleaseRecord`/`ReleasePublicationRecord`), plus the tenant-scoped query dispatch. The fabric satisfies the SDK's `ArenaQueryHandler` port structurally — hosts wire `createLoopbackTransport(fabric)` or bridge the same envelopes over a network boundary.
- **`ApiService`** — the envelope-wired facade: strict-parse `api-query-request` (envelope kind `query`, NULL idempotency key — reads are not commands), dispatch through the fabric, emit `api-query-response` (envelope kind `response`, same correlation id), with consumer-side pairing guards (`readQueryResponseFor`).

## Discipline

- **Read-only by construction**: the fabric never re-gates, re-certifies or rewrites anything — the platform's write paths stay in their owning work orders; the host populates the read model with authoritative records.
- **Tenant scoping** (the public/private boundary): every dispatch is scope-checked first; cross-tenant reads fail closed with `ARENA_API_CROSS_TENANT_ACCESS`; records with a NULL or `public` tenant are globally visible (lock rule 11).
- **Append-only projections**: supersession/retirement/revocation lineage is projected (superseded, retired, revoked), while every admitted record stays addressable forever.
- **Fail-closed everywhere**: every failure surfaces as a typed `ArenaApiError`; nothing partial escapes.
- **No network/HTTP layer** (the A025 reference slice, like the A013/A023/A024 services). Boundary: service → domain/protocol workspace packages only, never another service.

## Wiring

```ts
import { createApiFabric } from '@arena/api-fabric';
import { createArenaApiClient, createLoopbackTransport } from '@arena/arena-sdk';

const fabric = createApiFabric();
fabric.putReleaseRecord(authoritativeRelease); // host ingest (guard-validated)
const client = createArenaApiClient(createLoopbackTransport(fabric), 'acme');
const release = await client.resolveActiveRelease('acme', 'structural-engineer-body', 'stable');
```
