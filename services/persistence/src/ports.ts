/**
 * Persistence service ports (Work Order B002) — the ONLY thing
 * services/persistence depends on besides @arena/persistence (the
 * observability/billing service precedent:
 * inject everything; ALL effects go through ports).
 *
 * The service is provider-neutral BY CONSTRUCTION: it consumes the
 * @arena/persistence ports only. Hosted adapters and the local fakes
 * are injected at composition time as `RegisteredPersistenceProvider`
 * entries — the service never learns a provider name (provider ids are
 * neutral logical roles like 'control-plane', 'blob-store',
 * 'coordination').
 *
 * Authority boundary (spec/service-boundaries.md): this service OWNS
 * health aggregation, quota visibility, the fail-closed capacity gate
 * and deterministic bootstrap orchestration. It NEVER judges domain
 * outcomes and never reaches into another service's state.
 */

import type {
  CapacityMeter,
  CapacityProbe,
  Clock,
  ControlPlaneRepository,
} from '@arena/persistence';

/** Injected time source (epoch milliseconds; the domain Clock seam). */
export type { Clock };

/**
 * One persistence provider registered at composition time: a neutral
 * logical id, the adapter's capacity probe, and (when the provider
 * reports one) its quota meter. The meter defaults to the probe.
 */
export interface RegisteredPersistenceProvider {
  /** Neutral logical provider id (e.g. 'control-plane', 'blob-store'). */
  readonly providerId: string;
  /** The adapter's capacity probe (FT2.0 capacity states). */
  readonly probe: CapacityProbe;
  /** Quota meter when available; defaults to the probe's snapshot. */
  readonly meter?: CapacityMeter;
}

/**
 * The seed step of bootstrap (B016's local seed / B015's hosted seed
 * provide the concrete predicates): `isSeeded` checks presence through
 * the control plane; `apply` seeds when absent. Both are idempotent by
 * contract — bootstrap re-runs call `isSeeded` first and skip `apply`
 * when the seed is already present.
 */
export interface SeedStep {
  isSeeded(controlPlane: ControlPlaneRepository): Promise<boolean>;
  apply(controlPlane: ControlPlaneRepository): Promise<void>;
}
