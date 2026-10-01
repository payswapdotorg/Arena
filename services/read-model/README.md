# @arena/read-model-service

The canonical read-model service (Work Order B005; issue #71).

## What this service does

Composes the B002 `ControlPlaneRepository` port (injected; fakes in tests,
hosted adapters at composition time) with the pure `@arena/read-model`
projections:

- **`readCanonical(tenantId, recordId)`** — a typed canonical read, or
  `READ_MODEL_RECORD_NOT_FOUND`, or — when the record EXISTS but belongs
  to another tenant — `READ_MODEL_TENANT_SCOPE_VIOLATION` (distinct from
  not-found; existence is never hidden across tenants).
- **`scrollByKind(tenantId, kind, continuation?, limit?)`** — one bounded
  page + an opaque continuation token over the repository's deterministic
  (kind, recordId)-ascending ordering (stable across reloads).
- **`listByTenant(tenantId, continuation?, limit?)`** — paginated
  tenant-wide listing.
- **`listKinds(tenantId)`** — the disclosed kind inventory with counts.

## Contracts

- The tenant ALWAYS comes from the B004-authenticated session context
  (callers pass the validated tenant id); request payloads never carry it.
- READ-ONLY: no mutation operations exist on the service or its index
  (asserted by the hygiene tests).
- No state, no caching: every read re-reads the control plane; results
  carry the source record's version + revision (the staleness contract)
  and a `readAt` stamped from the injected B002 `Clock`.

## Dependencies

Workspace links only (`@arena/persistence`, `@arena/read-model`).
