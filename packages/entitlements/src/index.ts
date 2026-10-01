/**
 * @arena/entitlements — the entitlement core for the Arena
 * epoch-consumption stage (Work Order A033; requirements R31, R34, R48).
 *
 * Public surface (dependency order):
 *   errors        — closed ENTITLEMENT_* error taxonomy (fail-closed parser)
 *   shared        — branded ids, patterns, closed vocabularies, deep freeze
 *   grant         — EntitlementGrant records + append-only lineage + expiry
 *   resolution    — tenant-scoped fail-closed grant resolution + flags
 *   usage-meter   — usage-meter event types + per-tenant append-only logs
 *   envelopes     — SchemaRef registry + Envelope<T> wiring (A015 discipline)
 *
 * The package's ONLY workspace dependency is @arena/protocol-core
 * (protocol layer) — never a sibling domain package, never a service.
 */

export * from './errors.js';
export * from './shared.js';
export * from './grant.js';
export * from './resolution.js';
export * from './usage-meter.js';
export * from './envelopes.js';

import { ENTITLEMENT_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const ENTITLEMENTS_VERSION = ENTITLEMENT_SCHEMA_VERSION;
