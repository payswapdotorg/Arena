/**
 * @arena/persistence — the provider-neutral persistence/infrastructure
 * port layer (Work Order B002; issue #64; governing spec
 * spec/free-tier-contract.md FT2.0).
 *
 * Public surface (dependency order):
 *   errors       — closed PERSISTENCE_* error taxonomy (fail-closed parser)
 *   shared       — branded keys, closed patterns, JSON-safe values, bounds
 *   capacity     — FT2.0 capacity state model (AVAILABLE/DEGRADED/
 *                  EXHAUSTED/DISABLED), structured reasons, snapshots,
 *                  the fail-closed exhaustion policy and the aggregate
 *                  ProviderHealthSnapshot
 *   ports        — ControlPlaneRepository, BlobStore, CoordinationStore,
 *                  MigrationRunner, CapacityMeter, Clock
 *   fakes        — full local parity implementations of every port
 *                  (in-memory, deterministic under ManualClock)
 *   testing      — the shared contract test kit
 *                  (definePersistenceContractSuite) that runs the SAME
 *                  tests against any implementation
 *
 * The package's ONLY workspace dependency is @arena/protocol-core
 * (protocol layer). ZERO provider names, provider SDKs or provider types
 * appear here — hosted providers live exclusively in adapters/hosted/*
 * (enforced by the hygiene suite, mirroring the protocol-core G7 purity
 * style).
 */

export * from './errors.js';
export * from './shared.js';
export * from './capacity.js';
export * from './ports/clock.js';
export * from './ports/control-plane-repository.js';
export * from './ports/blob-store.js';
export * from './ports/coordination-store.js';
export * from './ports/migration-runner.js';
export * from './ports/capacity-meter.js';
export * from './fakes/index.js';
export * from './testing/contract-suite.js';

import { PERSISTENCE_SCHEMA_VERSION } from './version.js';

/** Version of this package's port surface. */
export const PERSISTENCE_VERSION = PERSISTENCE_SCHEMA_VERSION;
