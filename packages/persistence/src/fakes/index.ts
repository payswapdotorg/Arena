/**
 * Local fakes barrel (Work Order B002) — full local parity for every
 * persistence port (FT2.0 "Local parity": every hosted adapter has a
 * local fake/in-memory implementation exercising the same contract).
 */

export * from './clock.js';
export * from './fake-control-plane-repository.js';
export * from './fake-blob-store.js';
export * from './fake-coordination-store.js';
export * from './fake-migration-runner.js';
export * from './fake-capacity-meter.js';
