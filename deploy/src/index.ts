/**
 * @arena/deploy — DEP1.0 public surface (Work Order A036).
 *
 * Typed, versioned deployment descriptors for the Arena v1 service
 * topology, with health gates wired to the A035 SLO catalog and
 * security gates reflecting A034. All validation is fail-closed.
 */

export * from './shared.js';
export * from './model.js';
export * from './slo-catalog.js';
export * from './health-gates.js';
export * from './reference.js';
