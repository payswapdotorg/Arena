/**
 * FakeCapacityMeter (Work Order B002) — the deterministic quota meter used
 * to test quota behavior in CI (FT2.0 "Cost safety": quota behavior is
 * tested using fake meters; tests never require live provider auth).
 *
 * Scenarios are plain data: dimension readings (or a status + reasons)
 * returned verbatim from probe(). Validation is fail-closed — a malformed
 * scenario is a PERSISTENCE_INVALID_CAPACITY_READING error, not a silent
 * AVAILABLE.
 */

import {
  deriveCapacityStatus,
  toCapacityDimensionReading,
  toCapacitySnapshot,
} from '../capacity.js';
import type {
  CapacityDimensionReading,
  CapacityReason,
  CapacitySnapshot,
} from '../capacity.js';
import type { CapacityMeter } from '../ports/capacity-meter.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from './clock.js';

export interface FakeCapacityMeterOptions {
  readonly clock?: Clock;
  /** Explicit dimensions; status is derived unless `status` is given. */
  readonly dimensions?: readonly (CapacityDimensionReading | unknown)[];
  /** Override the derived status (e.g. DISABLED for missing config). */
  readonly status?: CapacitySnapshot['status'];
  readonly reasons?: readonly CapacityReason[];
}

export class FakeCapacityMeter implements CapacityMeter {
  private readonly clock: Clock;
  private readonly snapshot: CapacitySnapshot;

  constructor(options: FakeCapacityMeterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const dimensions = (options.dimensions ?? []).map((entry) =>
      toCapacityDimensionReading(entry),
    );
    const derived = options.status === undefined
      ? deriveCapacityStatus(dimensions)
      : { status: options.status, reasons: [] as CapacityReason[] };
    const reasons = [
      ...derived.reasons,
      ...(options.reasons ?? []),
    ];
    this.snapshot = toCapacitySnapshot({
      status: derived.status,
      checkedAt: this.clock.now(),
      dimensions,
      reasons,
    });
  }

  async probe(): Promise<CapacitySnapshot> {
    return this.snapshot;
  }
}
