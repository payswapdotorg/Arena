/**
 * Test support (Work Order C016 service layer) — deterministic fixtures
 * binding REAL @arena/payments ledger journeys (the C010 commercial
 * truth) plus C009/C015 structural-mirror views to the economics
 * service through the injected ports. Mirrors the domain package's
 * test-support convention; the domain package's test-support is
 * deliberately NOT part of its public surface (see
 * @arena/entitlements' test-support header for the house rule).
 */

import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  applyAcceptanceOperation,
  applyCaptureOperation,
  applyHoldOperation,
  applyOfferOperation,
  applyReleaseOperation,
  computeFeeSplit,
  openPaymentLedger,
  toMoney,
} from '@arena/payments';
import type { PaymentLedger } from '@arena/payments';

export const FIXED_NOW = '2026-10-08T10:00:00.000Z';
export const TENANT = 'tenant-econ';

/**
 * A fixed, valid settled ledger journey (hold → offer → acceptance →
 * capture → release under the 10% reference schedule) — real C010
 * operations with deterministic ids/timestamps so every economics
 * fixture stays C010-backed truth.
 */
export async function settledLedgerFixture(
  overrides: Partial<{
    requestId: string;
    tenantId: string;
    currency: string;
    truth: 'demo' | 'customer';
    grossMinorUnits: number;
  }> = {},
): Promise<PaymentLedger> {
  const requestId = overrides.requestId ?? 'req-econ-0001';
  const tenantId = overrides.tenantId ?? TENANT;
  const currency = overrides.currency ?? 'USD';
  const truth = overrides.truth ?? 'customer';
  const gross = overrides.grossMinorUnits ?? 25_000;
  let ledger = openPaymentLedger({
    requestId,
    tenantId,
    correlationId: `corr-${requestId}`,
    currency,
    truth,
    now: FIXED_NOW,
  });
  const amount = toMoney({ amount: gross, currency });
  ledger = (
    await applyHoldOperation(ledger, {
      amount,
      operationKey: 'op-hold-0001',
      operationId: `payop_${'1'.repeat(32)}`,
      lifecycleState: 'created',
      now: '2026-10-08T10:01:00.000Z',
    })
  ).ledger;
  ledger = (
    await applyOfferOperation(ledger, {
      amount,
      operationKey: 'op-offer-0002',
      operationId: `payop_${'2'.repeat(32)}`,
      lifecycleState: 'offered',
      now: '2026-10-08T10:02:00.000Z',
    })
  ).ledger;
  ledger = (
    await applyAcceptanceOperation(ledger, {
      operationKey: 'op-accept-0003',
      operationId: `payop_${'3'.repeat(32)}`,
      lifecycleState: 'accepted',
      now: '2026-10-08T10:03:00.000Z',
    })
  ).ledger;
  ledger = (
    await applyCaptureOperation(ledger, {
      amount,
      operationKey: 'op-capture-0004',
      operationId: `payop_${'4'.repeat(32)}`,
      lifecycleState: 'accepted',
      now: '2026-10-08T10:04:00.000Z',
    })
  ).ledger;
  const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, amount);
  ledger = (
    await applyReleaseOperation(ledger, {
      schedule: ARENA_REFERENCE_FEE_SCHEDULE,
      split,
      operationKey: 'op-release-0005',
      operationId: `payop_${'5'.repeat(32)}`,
      lifecycleState: 'result_accepted',
      now: '2026-10-08T10:05:00.000Z',
    })
  ).ledger;
  return ledger;
}

/** The canonical accepted C009 validation-outcome view. */
export function acceptedValidationFixture(
  overrides: Partial<{
    verdict: 'accepted' | 'revision_required' | 'rejected' | 'needs_more_evidence' | 'pending';
    attemptNumber: number;
    replacementCount: number;
    verdictId: string;
    recordDigest: string;
  }> = {},
) {
  return {
    verdict: 'accepted',
    attemptNumber: 1,
    replacementCount: 0,
    verdictId: 'verdict-0001',
    recordDigest: 'a'.repeat(64),
    ...overrides,
  } as const;
}

/** The canonical matched C015 routing-decision view (expert class). */
export function expertRoutingFixture() {
  return { outcome: 'matched', resourceClasses: ['expert'], matchDigest: 'b'.repeat(64) } as const;
}

/** The canonical effort-signal view (90 minutes, one source ref). */
export function effortFixture(overrides: { sessionDurationMinutes?: number } = {}) {
  return {
    sessionDurationMinutes: 90,
    revisionRounds: 0,
    replacementCount: 0,
    sourceRefs: ['expert-session:0001'],
    ...overrides,
  } as const;
}
