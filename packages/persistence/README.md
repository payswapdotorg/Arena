# @arena/persistence — provider-neutral persistence/infrastructure ports (B002)

The provider-neutral port layer for Arena's hosted persistence and
infrastructure (Work Order B002; issue #64; governing spec
`spec/free-tier-contract.md` FT2.0). It defines the contracts the hosted
free-tier adapters implement and the local fakes that keep development and
CI credential-free.

**Zero provider surface.** No provider name, provider SDK, provider type
or credential-shaped word appears in this package (enforced by the
hygiene suite, mirroring the protocol-core G7 governance style). Hosted
providers (Neon PostgreSQL, R2 object storage, Upstash Redis) live
exclusively in `adapters/hosted/*`. The package's only workspace
dependency is `@arena/protocol-core`.

## Surface

| Module | Contents |
|---|---|
| `errors` | Closed `PERSISTENCE_*` error taxonomy with a fail-closed parser (mirrors the EntitlementError pattern). Includes the typed capacity errors `PERSISTENCE_CAPACITY_EXHAUSTED` / `PERSISTENCE_CAPACITY_DISABLED`. There is no fallback-shaped code in the vocabulary. |
| `shared` | Branded `CoordinationKey`, bounded id/kind/tenant patterns, canonical-JSON-safe payload validation, canonical equality, deep freeze, bounds. |
| `capacity` | FT2.0 capacity state model: `AVAILABLE` / `DEGRADED` / `EXHAUSTED` / `DISABLED`, structured reasons, dimension readings (used/limit/remaining/window), `CapacitySnapshot`, `ProviderHealth` + aggregate `ProviderHealthSnapshot` (worst-of severity), status derivation, and the **fail-closed exhaustion policy**: `CAPACITY_EXHAUSTION_POLICY` is the literal `'fail-closed'` — its type has exactly one inhabitant, and `assertCapacityUsable` throws the typed exhaustion error on `EXHAUSTED`/`DISABLED`. A silent paid fallback is not representable. |
| `ports` | `ControlPlaneRepository` (authoritative, versioned, optimistic-concurrency records), `BlobStore` (content-addressed immutable artifacts — `put` takes no key), `CoordinationStore` (TTL cache, idempotency windows, fixed-window rate-limit counters, leases), `MigrationRunner` (versioned, ordered, idempotent migrations with an applied-record ledger), `CapacityMeter` (quota observation), `Clock` (injected time). |
| `fakes` | Full local-parity implementations of every port, deterministic under `ManualClock`. |
| `testing` | The shared contract test kit: `definePersistenceContractSuite(name, factory)` runs the SAME tests against any implementation (fakes in CI; hosted adapters via their transport seams; live adapters when credentials exist). |

## Contract semantics (asserted for every implementation)

- **Control plane**: idempotent insert (identical replay → `created: false`;
  conflicting insert → `PERSISTENCE_RECORD_EXISTS`), optimistic-concurrency
  update (`expectedRevision` mismatch → `PERSISTENCE_REVISION_CONFLICT`),
  deterministic listing (recordId ascending, limit/offset), frozen records.
- **Blobs**: keys are `sha256:<digest>` derived from content; `put` accepts
  no key, so overwriting is unrepresentable; identical puts replay
  (`alreadyPresent: true`, first-write metadata wins); `get` returns
  defensive copies.
- **Coordination**: TTL expiry evaluated against the injected clock;
  idempotency windows replay/conflict by payload digest; fixed-window rate
  limits with aligned resets; leases with holder identity, renew/release
  and TTL expiry. Bounded keys and values only (rebuildable state).
- **Migrations**: ascending version order, unique positive versions,
  applied-record ledger, idempotent re-run, failed apply never recorded.
- **Capacity**: snapshots are frozen and validated fail-closed; quotas are
  tested with fake meters (FT2.0 cost safety — tests never require live
  credentials).

## Note on the contract kit dependency

`src/testing/contract-suite.ts` imports `vitest` (a devDependency of this
package and of every package that runs the suite). Running the suite
against an implementation requires `vitest` to be resolvable — true for
all workspace packages under the house devDependency set.

## Development

```bash
pnpm --filter @arena/persistence typecheck
pnpm --filter @arena/persistence lint
pnpm --filter @arena/persistence test
pnpm --filter @arena/persistence build
```
