/**
 * Fail-closed quota guard for the hosted preview (Work Order B015).
 *
 * This is the B015 enforcement surface for the product truth: "the wiring
 * fails CLOSED when a quota is exhausted — no automatic paid fallback,
 * ever" and spec/free-tier-contract.md FT2.0: "Adapters never silently
 * switch to a paid path."
 *
 * Nothing here re-implements capacity logic: every rule COMPOSES the B002
 * contracts (`@arena/persistence`) — `CapacityService.guard()` is the
 * composition-level gate, `assertCapacityUsable` is the only sanctioned
 * reaction to a blocking status, and `deriveCapacityStatus` is the
 * status derivation. The value B015 adds: wiring those contracts to the
 * hosted-preview provider set + deterministic tests proving the refusal
 * semantics (see fail-closed.test.ts).
 */

import {
  assertCapacityUsable,
  CAPACITY_BLOCKING_STATUSES,
  CAPACITY_EXHAUSTION_POLICY,
  deriveCapacityStatus,
  isCapacityUsable,
} from '@arena/persistence';
import type {
  CapacityDimensionReading,
  CapacityObservation,
  CapacityReason,
  Clock,
  ProviderCapacityStatus,
} from '@arena/persistence';
import { CapacityService } from '@arena/persistence-service';
import type { CapacityReport, RegisteredPersistenceProvider } from '@arena/persistence-service';

/**
 * The hosted-preview exhaustion policy: `fail-closed` (FT2.0 single
 * inhabitant type — a billable fallback is not representable).
 */
export const HOSTED_PREVIEW_EXHAUSTION_POLICY = CAPACITY_EXHAUSTION_POLICY;

/**
 * Mirrors the B014 operations view-model fact (`noBillableFallback: true`)
 * so deploy tooling and the operations UX assert the SAME product truth.
 */
export const NO_BILLABLE_FALLBACK = true as const;

export { CAPACITY_BLOCKING_STATUSES, isCapacityUsable, assertCapacityUsable, deriveCapacityStatus };

/**
 * The composition-level fail-closed gate for the hosted preview: returns
 * the capacity report when every registered provider is usable
 * (AVAILABLE/DEGRADED); throws the typed `PersistenceCapacityError` for
 * the FIRST blocking provider (EXHAUSTED/DISABLED) in registration order.
 *
 * There is no alternate route, no retry-on-paid, no degrade-to-billing
 * parameter: callers either proceed with the report or surface the typed
 * refusal (quota visibility: ops/deployment/quota-exhaustion-playbook.md).
 */
export async function guardHostedPreviewCapacity(
  providers: readonly RegisteredPersistenceProvider[],
  clock: Clock,
): Promise<CapacityReport> {
  return new CapacityService({ clock, providers }).guard();
}

/**
 * Evaluate a single quota reading (used/limit both known) through the
 * normative status derivation: remaining === 0 => EXHAUSTED; remaining /
 * limit below the near-limit fraction => DEGRADED; else AVAILABLE. Pure
 * and deterministic — the fail-closed tests pin the boundaries.
 */
export function evaluateHostedQuotaReading(
  used: number,
  limit: number,
): { readonly status: ProviderCapacityStatus; readonly reasons: readonly CapacityReason[] } {
  const reading: CapacityDimensionReading = Object.freeze({
    dimension: 'quota',
    used,
    limit,
    remaining: limit - used,
    windowMs: null,
  });
  return deriveCapacityStatus([reading]);
}

/**
 * The hosted-preview reaction to a blocking capacity observation: refuse
 * (typed error) — the ONLY sanctioned reaction (FT2.0). Wraps
 * `assertCapacityUsable` so the wiring surface name and the contract stay
 * aligned; the tests prove an EXHAUSTED/DISABLED observation can never
 * pass through this module silently.
 */
export function refuseHostedOperationWhenBlocking(observation: CapacityObservation): void {
  assertCapacityUsable(observation);
}
