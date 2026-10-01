/**
 * @arena/marketplace-artifacts-fabric — the dataset / evaluation-suite /
 * environment marketplace (Work Order A032).
 *
 * Public surface:
 *   - `errors`      — the closed MARKETPLACE_* error taxonomy;
 *   - `shared`      — structural helpers + tenant visibility discipline;
 *   - `offers`      — versioned offer/license records, append-only lineage;
 *   - `gate`        — listing admission gate (provenance + verification);
 *   - `grants`      — access grants with A034 data-rights + license rules;
 *   - `reviews`     — review/rating records (closed vocabularies);
 *   - `queries`     — the closed search/browse query vocabulary;
 *   - `envelopes`   — command/event/query envelope wiring;
 *   - `fabric`      — the pure reference fabric (injected evidence stores);
 *   - `service`     — the envelope-wired facade.
 */

export * from './errors.js';
export * from './shared.js';
export * from './offers.js';
export * from './gate.js';
export * from './grants.js';
export * from './reviews.js';
export * from './queries.js';
export * from './envelopes.js';
export * from './fabric.js';
export * from './service.js';
import { MARKETPLACE_ERROR_CODES } from './errors.js';

export const MARKETPLACE_ARTIFACTS_PROTOCOL_VERSION = '1.0.0' as const;

export const SUPPORTED_MARKETPLACE_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(MARKETPLACE_ERROR_CODES),
);
