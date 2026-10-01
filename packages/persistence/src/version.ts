/**
 * Version stamp for the @arena/persistence port surface (Work Order
 * B002). Bumping this means a breaking change to a port — consumers
 * surface it in their own versioned contracts (spec/service-boundaries.md
 * versioned-contract discipline).
 */

export const PERSISTENCE_SCHEMA_VERSION = '1.0.0' as const;
