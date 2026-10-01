/**
 * @arena/read-model-service — versioned contract surface consumed by
 * B006/B007 UI wiring (Work Order B005; spec/service-boundaries.md:
 * services communicate through versioned contracts).
 *
 * READ-ONLY: this index deliberately exports no mutation symbols (the
 * purity/hygiene test asserts it). The service is a projection over the
 * B002 control plane, never a second authority.
 */

export * from './service.js';
