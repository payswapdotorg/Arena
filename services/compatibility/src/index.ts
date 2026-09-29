/**
 * @arena/compatibility-fabric — the A022 reference compatibility service
 * (in-process registry + evaluation engine + record ledger).
 *
 * Work Order A022; requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4.
 *
 * Pure TypeScript, ZERO external runtime dependencies (only @arena/compatibility,
 * @arena/agent-body, @arena/model-substrate, @arena/protocol-core).
 *
 * Public surface:
 *   - CompatibilityService / createCompatibilityService (main service)
 *   - CompatibilityRegistry (record management)
 *   - CompatibilityEngine (evaluation orchestration)
 *
 * Fail-closed errors, tenant/workspace scoping, deep-frozen records,
 * idempotent commands, correlation IDs, envelope wiring.
 */

export * from './service.js';
export * from './registry.js';
export * from './engine.js';

import { createCompatibilityService } from './service.js';

/** Construct a fresh compatibility service with its own registry and engine. */
export function createCompatibilityFabric(): ReturnType<typeof createCompatibilityService> {
  return createCompatibilityService();
}