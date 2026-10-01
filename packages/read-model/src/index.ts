/**
 * @arena/read-model — canonical read models over the B002 control plane
 * (Work Order B005; issue #71).
 *
 * A PURE package: typed read shapes + projections + a read-query
 * vocabulary over the persistence port's `ControlPlaneRecord` types.
 * No state, no writes, no caching, no clock reads inside projections —
 * the read model is a PROJECTION over canonical Arena objects, never a
 * second authority (versions, provenance and tenant boundaries are READ
 * from the control plane, never recomputed).
 */

export * from './errors.js';
export * from './models.js';
export * from './queries.js';
export * from './contracts.js';

/** The read-model package version (contract surface marker). */
export const READ_MODEL_PACKAGE_VERSION = '1.0.0' as const;
