/**
 * Host runtime health & readiness (Work Order P002; issue #154;
 * ADR-P001-07 §7 — fail-closed capacity is owned and demonstrated at
 * the host).
 *
 * Health is a PURE snapshot over component reports:
 *   - the persistence capacity snapshot (the FT2.0 posture:
 *     AVAILABLE/DEGRADED/EXHAUSTED/DISABLED, probed BEFORE any network
 *     call the adapter did not already gate);
 *   - the durable job runner's component state;
 *   - the mounted escalation lifecycle surface's component state.
 *
 * The host is READY only when every component reports ready AND the
 * persistence capacity is AVAILABLE. Anything else is NOT ready —
 * fail-closed, never a silent partial readiness (there is no alternate
 * route to switch to; the vocabulary makes one unrepresentable).
 */

import type {
  CapacitySnapshot,
  ProviderCapacityStatus,
} from '@arena/persistence';
import type { RuntimeHostState } from './lifecycle.js';

/** The closed component-state vocabulary (mirrors the FT2.0 posture). */
export const RUNTIME_COMPONENT_STATES = Object.freeze([
  'ready',
  'disabled',
  'degraded',
  'failed',
] as const);
export type RuntimeComponentState = (typeof RUNTIME_COMPONENT_STATES)[number];

/** One host component's report (pure data; the implementor probes). */
export interface RuntimeComponentHealth {
  /** Neutral component id (closed vocabulary below). */
  readonly component: RuntimeHostComponent;
  readonly state: RuntimeComponentState;
  /** Machine-readable reasons (fail-closed diagnosis; never values). */
  readonly reasons: readonly { readonly code: string }[];
  readonly checkedAt: number;
}

/** The closed host-component vocabulary (ADR-P001-07 responsibilities). */
export const RUNTIME_HOST_COMPONENTS = Object.freeze([
  'persistence',
  'job-runner',
  'escalation-lifecycle',
] as const);
export type RuntimeHostComponent = (typeof RUNTIME_HOST_COMPONENTS)[number];

/** The aggregate host health snapshot (pure data). */
export interface RuntimeHostHealth {
  readonly state: RuntimeHostState;
  /** The persistence capacity snapshot (DISABLED before any network call). */
  readonly capacity: CapacitySnapshot;
  readonly components: readonly RuntimeComponentHealth[];
  /** Ready iff started AND every component is ready AND capacity is AVAILABLE. */
  readonly ready: boolean;
  readonly checkedAt: number;
}

/** Map a capacity status onto the component-state vocabulary (pure). */
export function capacityStatusToComponentState(
  status: ProviderCapacityStatus,
): RuntimeComponentState {
  switch (status) {
    case 'AVAILABLE':
      return 'ready';
    case 'DISABLED':
      return 'disabled';
    case 'EXHAUSTED':
      return 'failed';
    case 'DEGRADED':
      return 'degraded';
  }
}

/** Aggregate component states into one readiness verdict (pure, fail-closed). */
export function aggregateReadiness(
  state: RuntimeHostState,
  components: readonly RuntimeComponentHealth[],
  capacityStatus: ProviderCapacityStatus,
): boolean {
  if (state !== 'started') return false;
  const everyComponentReady = components.every(
    (component) => component.state === 'ready',
  );
  return everyComponentReady && capacityStatus === 'AVAILABLE';
}

/** Type guard for the closed component-state vocabulary. */
export function isRuntimeComponentState(value: unknown): value is RuntimeComponentState {
  return (
    typeof value === 'string' &&
    (RUNTIME_COMPONENT_STATES as readonly string[]).includes(value)
  );
}
