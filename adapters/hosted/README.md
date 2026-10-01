# @arena/hosted-adapters — hosted free-tier infrastructure adapters (B002)

The hosted persistence/infrastructure adapter surface for Arena (Work
Order B002; issue #64; governing spec `spec/free-tier-contract.md` FT2.0).
Three adapters implement the provider-neutral ports from
`@arena/persistence`:

| Adapter | Port | Infrastructure touchpoint | Exact-pinned dependency |
|---|---|---|---|
| `neon-postgres/` | `ControlPlaneRepository` + `MigrationRunner` | `SqlTransport` (named parameterized statements) | `@neondatabase/serverless@0.10.4` |
| `r2-object-store/` | `BlobStore` | `ObjectStorageTransport` (probe/head/get/put/delete) | `@aws-sdk/client-s3@3.1144.0` |
| `upstash-redis/` | `CoordinationStore` | `RestCommandTransport` (closed Redis command vocabulary, plain `fetch`) | **ZERO new dependencies** |

## Posture (FT2.0, uniformly enforced)

- **Provider names live HERE and only here.** `packages/persistence/src`
  is provider-neutral by construction (purity test in that package).
- **Fail closed, never a silent paid fallback.** Without configuration an
  adapter is DISABLED: every port operation throws the typed capacity
  error (`PERSISTENCE_CAPACITY_DISABLED`) BEFORE any network call, and
  `capacityProbe()` reports DISABLED with the structured reason
  `configuration-missing`. There is no alternate-route vocabulary
  anywhere in the ports, the adapters or the error taxonomy.
- **Capacity states.** Every adapter exposes `capacityProbe()` returning
  the FT2.0 states (`AVAILABLE` / `DEGRADED` / `EXHAUSTED` / `DISABLED`)
  with structured reasons and declared-allowance dimension readings.
- **Secrets stay server-side.** Configuration is read ONLY from env vars
  (names below). Values are never committed and never logged — error
  details carry variable NAMES; driver/transport error detail is attached
  as `cause`, never surfaced in typed messages (canary-tested).
- **Local parity is executed.** The shared
  `definePersistenceContractSuite` from `@arena/persistence` runs the SAME
  contract tests against every adapter through its injected transport
  seam — with ZERO live credentials. Live runs of the same suite are
  additionally registered but SKIPPED unless usable credentials exist in
  the environment (tests never REQUIRE live credentials; quota behavior
  is covered by fake meters in `@arena/persistence`).

## Env-var contracts (NAMES only — values are secrets)

| Adapter | Required env vars |
|---|---|
| `neon-postgres` | `DATABASE_URL` **or** `NEON_CONNECTION_STRING` (`postgres://` / `postgresql://`; `DATABASE_URL` wins; other schemes resolve to DISABLED, not crash) |
| `r2-object-store` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and either `R2_S3_ENDPOINT` (http(s) URL) or `R2_ACCOUNT_ID` (endpoint derived as `https://<account>.r2.cloudflarestorage.com`) |
| `upstash-redis` | `UPSTASH_REDIS_REST_URL` (http(s)), `UPSTASH_REDIS_REST_TOKEN` |

## Adapter notes

- **neon-postgres** — the authoritative control-plane store (FT2.0
  "Database"). Versioned, ordered SQL migrations (`migrations/*.sql`,
  mirrored one-to-one into the inlined `SQL_MIGRATION_SOURCES`) with an
  applied-record ledger (`arena_migration_ledger`); the runner
  bootstraps the ledger with idempotent DDL, applies missing migrations
  ascending and re-runs are no-ops. The default transport is the Neon
  serverless HTTP driver (plain fetch, Vercel-compatible).
- **r2-object-store** — the default preview blob store (FT2.0
  "Storage"). Content addressing is structural: the object key IS the
  sha256 digest (`sha256:<hex>`), the port's `put` takes no key, and
  identical replays preserve the FIRST write's metadata and creation
  time. Object metadata keys in the reserved `arena-` namespace are
  rejected (the adapter stores `arena-created-at` internally).
- **upstash-redis** — bounded/rebuildable state ONLY (FT2.0 "Redis"):
  TTL cache, idempotency windows, fixed-window rate-limit counters,
  leases — namespaced under `arena:cache:` / `arena:idem:` / `arena:rl:`
  / `arena:lease:`. Atomic window opens use SET NX; counters
  self-expire at their window reset. Plain `fetch` REST, no new
  dependencies.

## Workspace wiring (READ THIS — known glob gap, the adapters/models precedent)

`pnpm-workspace.yaml` declares the glob `adapters/*`, which matches **this
directory itself** (`adapters/hosted`) but NOT the nested adapter
packages (`adapters/hosted/neon-postgres`, ...) — standard glob
semantics, `*` does not cross `/`. Root files are outside B002's owned
surfaces, so the gap is worked around INSIDE the owned surface:

- `adapters/hosted` is the pnpm workspace package (`@arena/hosted-adapters`).
  Its scripts typecheck / lint / test / build ALL three adapters (vitest
  includes `*/src/**/*.test.ts`; the build runs each adapter's
  `tsconfig.build.json`), so the full battery covers the hosted adapters
  today.
- Each adapter is ALSO a self-contained, workspace-READY package (own
  `package.json` with `workspace:*` deps + exact-pinned provider deps,
  own tsconfigs, own vitest config) so that the ONE-LINE root intake —
  adding `adapters/hosted/*` to `pnpm-workspace.yaml`'s packages list —
  makes them first-class workspace packages with no further changes.

Related gaps flagged for Tech Lead root intake (see the B002 PR):

1. `pnpm-workspace.yaml` glob `adapters/*` does not reach
   `adapters/hosted/*` (this README's workaround).
2. New external dependencies (`@neondatabase/serverless@0.10.4`,
   `@aws-sdk/client-s3@3.1144.0`) are declared in the container manifest
   and are NOT in the committed lockfile (workers never commit
   `pnpm-lock.yaml`) — PR CI will show `ERR_PNPM_OUTDATED_LOCKFILE` until
   the Tech Lead's serialized intake.

## Development

From the repository root (or here):

```bash
pnpm install
pnpm --filter @arena/hosted-adapters typecheck   # tsc --noEmit (all three adapters)
pnpm --filter @arena/hosted-adapters test        # vitest run (contract + disabled suites)
pnpm --filter @arena/hosted-adapters build       # tsc -p */tsconfig.build.json (dist/ per adapter)
```
