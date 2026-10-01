# @arena/persistence-service

Persistence health/capacity/bootstrap service for Arena (Work Order B002; issue #64; governing spec `spec/free-tier-contract.md` FT2.0).

A deterministic, in-process service fabric over the `@arena/persistence` ports: it composes adapters behind provider-neutral ports and owns health aggregation, quota visibility, the fail-closed capacity gate and deterministic bootstrap orchestration. Zero external dependencies; the ONLY workspace dependency is `@arena/persistence` (adapters are injected at composition time — apps/deployment wiring, never imported here; layer rules B2/B4).

## Law

- **Provider-neutral by construction.** The service consumes `@arena/persistence` ports only. Hosted adapters and local fakes are injected at composition time as `RegisteredPersistenceProvider` entries with NEUTRAL logical ids (`control-plane`, `blob-store`, `coordination`); the service never learns a provider name (hygiene suite enforces the deny-list).
- **Health is worst-of, versioned and parseable.** `ProviderHealthService.health()` aggregates every provider's capacity probe into a `ProviderHealthSnapshot` (worst-of severity: `DISABLED > EXHAUSTED > DEGRADED > AVAILABLE`) wrapped in a versioned `HealthReport` (`recordVersion`); `toHealthReport` is a strictly fail-closed parser — impossible aggregates, wrong versions and malformed entries are rejected, never coerced.
- **Capacity is visible and the gate fails closed.** `CapacityService.capacity()` emits the versioned `CapacityReport` (dimensions per provider for later UI surfacing). `guard()` returns the report only while EVERY registered provider is usable; the first blocking provider (EXHAUSTED or DISABLED) throws the typed `PersistenceCapacityError` — there is no parameter, return path or alternate destination that could silently switch to a billable provider (FT2.0).
- **A throwing probe degrades, never crashes.** A provider probe that throws produces a `DEGRADED` entry with the structured `probe-failed` reason; transport detail stays out of the report (canary-tested).
- **Bootstrap is deterministic and re-runnable.** `BootstrapService.bootstrap(migrations)` runs migrations FIRST (typed failures abort before the seed ever runs), then the seed check (apply only when absent). Re-runs skip applied migrations and an already-present seed — reproducible by contract; the versioned `BootstrapReport` round-trips through `toBootstrapReport`.

## Surfaces

- `service.ts` — `ProviderHealthService`, `CapacityService`, `BootstrapService`
- `ports.ts` — `Clock` (injected), `RegisteredPersistenceProvider`, `SeedStep`
- `in-memory.ts` — `createLocalPersistenceStack` / `createLocalProviderRegistry` (FT2.0 local parity: the fakes composed exactly like the hosted adapters will be at composition time; the shared contract suite runs against this stack in `parity.test.ts`)
- `shared.ts` — the versioned contract surface (`HealthReport`, `CapacityReport`, `BootstrapReport` + fail-closed parsers; `spec/service-boundaries.md` discipline)

## Tests

`pnpm --filter @arena/persistence-service test` — positive + adversarial service tests (`service.test.ts`), the executed local-parity contract suite (`parity.test.ts`) and the provider-leakage/workspace hygiene suite (`hygiene.test.ts`). Quota behavior is exercised ONLY through fake meters (FT2.0 "Cost safety": tests never require live provider credentials).
