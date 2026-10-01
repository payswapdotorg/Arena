/**
 * @arena/persistence-service — the persistence health/capacity/bootstrap
 * service for Arena (Work Order B002; issue #64; FT2.0).
 *
 * Public surface (dependency order):
 *   shared    — the versioned contract surface (HealthReport,
 *               CapacityReport, BootstrapReport + fail-closed parsers;
 *               recordVersion discipline per spec/service-boundaries.md)
 *   ports     — Clock, RegisteredPersistenceProvider, SeedStep (inject
 *               everything; provider ids are NEUTRAL logical roles)
 *   in-memory — createLocalPersistenceStack / createLocalProviderRegistry
 *               (FT2.0 local parity: the fakes composed exactly like the
 *               hosted adapters will be at composition time)
 *   service   — ProviderHealthService, CapacityService (quota visibility
 *               + the fail-closed capacity guard), BootstrapService
 *               (deterministic migrations -> seed-check)
 *
 * Workspace dependency: @arena/persistence (domain ports) — never a
 * sibling service, never an adapter (hosted adapters are injected at
 * composition time).
 */

export * from './shared.js';
export * from './ports.js';
export * from './in-memory.js';
export * from './service.js';

import { PERSISTENCE_SERVICE_RECORD_VERSION } from './shared.js';

/** Version of this package's record surface. */
export const PERSISTENCE_SERVICE_VERSION = PERSISTENCE_SERVICE_RECORD_VERSION;
