/**
 * CapacityMeter port (Work Order B002; issue #64; FT2.0 "Cost safety":
 * quota behavior is tested in CI using fake meters; tests never require
 * live provider auth).
 *
 * Quota observation: remaining/limit/window per provider dimension. The
 * meter is a read-only probe — it never mutates state and never gates
 * operations by itself; gating happens through the fail-closed capacity
 * policy in ./capacity.ts.
 */

import type { CapacitySnapshot } from '../capacity.js';

/**
 * The provider-neutral capacity meter port. Implementations: the fake
 * (deterministic quota scenarios for CI) and hosted adapters (declared
 * allowances; live usage reporting is a deployment-tier concern).
 */
export interface CapacityMeter {
  probe(): Promise<CapacitySnapshot>;
}

/**
 * The provider-neutral capacity probe every hosted adapter exposes: the
 * FT2.0 state (AVAILABLE/DEGRADED/EXHAUSTED/DISABLED) plus structured
 * reasons. Unlike the meter (pure quota observation), the probe also
 * reflects the adapter's configuration state — a hosted adapter without
 * its configuration probes as DISABLED, never as an error.
 */
export interface CapacityProbe {
  capacityProbe(): Promise<CapacitySnapshot>;
}
