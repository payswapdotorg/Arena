/**
 * @arena/product-flows — guided product workflows (Work Order B008; #80).
 *
 * Pure, zero new external dependencies. The guided-flow DEFINITIONS
 * (frozen, versioned, canonical-lifecycle-bound) + the flow RUNTIME that
 * applies canonical A005 transitions through the B002
 * ControlPlaneRepository port. No parallel lifecycle, no parallel store.
 */

export * from './errors.js';
export * from './definitions.js';
export * from './case-codec.js';
export * from './runtime.js';
