/**
 * @arena/network-quality-service — the C020 reference service (dispute
 * intake/resolution, COI registration/checks, anti-gaming + fraud
 * detection jobs) over @arena/network-quality.
 *
 * Public surface:
 *   - NetworkQualitySourcePorts / NetworkQualityStores /
 *     NetworkQualitySinks / Clock (ports.ts — the C009/C013/C010/
 *     registry/engagement seams + persistence + the proposal surfaces);
 *   - NetworkQualityService (service.ts) — idempotent, fail-closed
 *     command handling with envelope events (dispute transitions, COI
 *     verdicts, finding recordings, enforcement updates, profile-evidence
 *     + requalification proposals);
 *   - createNetworkQualityFabric (fabric.ts) — the in-memory reference
 *     fabric: fixed clock, tenant-scoped stores, capturing proposal sinks
 *     and the dep-seam fakes.
 */

export * from './ports.js';
export * from './service.js';
export * from './fabric.js';
