# @arena/read-model

Canonical read models over the B002 control plane (Work Order B005; issue #71).

## What this package is

A **pure projection layer** over the persistence port's versioned
`ControlPlaneRecord` objects. It defines:

- **Typed canonical read shapes** (`CanonicalRead`, plus per-kind reads over
  the bounded, disclosed kind vocabulary `READ_MODEL_KINDS`):
  `arena-session`, `arena-session-epoch` (written today by the B004
  ControlPlaneSessionStore) and `capability-case`, `agent-body`,
  `expert-qualification`, `certification` (the canonical domain-object
  kinds the A-series packages own as B008+ product flows land).
  Every read carries: record id, tenant id, kind, the source record's
  **version** and **revision** (as stored — the staleness contract), the
  record's `data`, as-stored **provenance** (`createdAt`/`updatedAt`,
  never recomputed), and an injected `readAt` timestamp.
- **Pure projection functions** (`toCanonicalRead`, `toKindedRead`, the
  per-kind `toXRead` mappers) with fail-closed runtime validation
  (`READ_MODEL_INVALID_RECORD`, `READ_MODEL_KIND_MISMATCH`). Deterministic,
  side-effect-free, no clock reads inside the projection (`readAt` is
  injected by callers), outputs deep-frozen.
- **A typed read-query vocabulary** (`by-id`, `by-kind` scroll,
  `by-tenant` listing) with bounded page sizes
  (`READ_MODEL_MAX_PAGE_SIZE` = 100) and opaque, strictly validated
  continuation tokens (`READ_MODEL_INVALID_CONTINUATION` on malformed or
  scope-mismatched tokens). The query grammar has **no tenant field at
  all** — tenancy is server-controlled (see the read-model service).

## What this package is NOT

- **Not a second authority.** No state, no write path, no caching, no
  cache-and-serve-stale. Every read result carries the source record's
  version + revision so consumers detect reload drift by re-reading.
- **Not role-aware.** Reads are role-NEUTRAL canonical projections; role
  lenses compose later (B007, over `@arena/role-context`).

## Error taxonomy

Closed codes with categories + wire-safe struct form + strict parser
(mirroring `@arena/persistence`'s `PersistenceError` pattern):
`READ_MODEL_KIND_MISMATCH`, `READ_MODEL_INVALID_RECORD`,
`READ_MODEL_INVALID_QUERY`, `READ_MODEL_INVALID_CONTINUATION`,
`READ_MODEL_INVALID_READ_AT`, `READ_MODEL_RECORD_NOT_FOUND`,
`READ_MODEL_TENANT_SCOPE_VIOLATION` (scope — distinct from not-found, so
cross-tenant existence is not silently hidden), `READ_MODEL_UNKNOWN_ERROR`.

## Dependencies

Workspace links only (`@arena/persistence`, `@arena/protocol-core`).
Zero external runtime dependencies; zero Next.js / provider imports
(asserted by the hygiene test).
