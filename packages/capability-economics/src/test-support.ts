/**
 * Test support (Work Order C016) — deterministic fixtures for the
 * capability-economics domain tests, mirroring the sibling packages'
 * test-support.ts convention. Exported from the package so downstream
 * surfaces (services/capability-economics) reuse ONE canonical fixture
 * factory instead of drifting local copies.
 *
 * The ledger fixture is built with the REAL @arena/payments operations
 * (hold → offer → acceptance → capture → release under the reference
 * fee schedule), so every economics fixture stays C010-backed truth.
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
} from '@arena/payments';
import type { PaymentLedger } from '@arena/payments';
import { toMoney } from '@arena/payments';
import { ARENA_REFERENCE_ECONOMICS_POLICY } from './policy.js';
import type { EconomicsPolicy } from './policy.js';
import type { EffortBasisInput, RoutingBasisInput, ValidationBasisInput } from './record.js';

/** A fixed, valid settled ledger (250.00 USD gross, 10% reference fee). */
export const FIXED_NOW = '2026-10-08T10:00:00.000Z';
export const FIXED_REQUEST_ID = 'req-econ-0001';
export const FIXED_TENANT_ID = 'tenant-econ';
export const FIXED_CORRELATION_ID = 'corr-econ-0001';
export const FIXED_GROSS_MINOR_UNITS = 25_000;

/** Build the canonical settled ledger (deterministic timestamps). */
export async function settledLedgerFixture(
  overrides: Partial<{
    requestId: string;
    tenantId: string;
    currency: string;
    truth: 'demo' | 'customer';
    grossMinorUnits: number;
    correlationId: string;
  }> = {},
): Promise<PaymentLedger> {
  const requestId = overrides.requestId ?? FIXED_REQUEST_ID;
  const tenantId = overrides.tenantId ?? FIXED_TENANT_ID;
  const currency = overrides.currency ?? 'USD';
  const truth = overrides.truth ?? 'customer';
  const gross = overrides.grossMinorUnits ?? FIXED_GROSS_MINOR_UNITS;
  const correlationId = overrides.correlationId ?? FIXED_CORRELATION_ID;
  let ledger = openPaymentLedger({
    requestId,
    tenantId,
    correlationId,
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

/** The deterministic 10% split of the settled fixture. */
export function settledFixtureSplit(grossMinorUnits = FIXED_GROSS_MINOR_UNITS, currency = 'USD') {
  return computeFeeSplit(
    ARENA_REFERENCE_FEE_SCHEDULE,
    toMoney({ amount: grossMinorUnits, currency }),
  );
}

/** The canonical accepted validation-outcome view. */
export function acceptedValidationFixture(
  overrides: Partial<ValidationBasisInput> = {},
): ValidationBasisInput {
  return {
    verdict: 'accepted',
    attemptNumber: 1,
    replacementCount: 0,
    verdictId: 'verdict-0001',
    recordDigest: 'a'.repeat(64),
    ...overrides,
  };
}

/** The canonical matched routing view (expert class). */
export function expertRoutingFixture(
  overrides: Partial<RoutingBasisInput> = {},
): RoutingBasisInput {
  return {
    outcome: 'matched',
    resourceClasses: ['expert'],
    matchDigest: 'b'.repeat(64),
    ...overrides,
  };
}

/** The canonical effort view (90 minutes, one source ref). */
export function effortFixture(overrides: Partial<EffortBasisInput> = {}): EffortBasisInput {
  return {
    sessionDurationMinutes: 90,
    revisionRounds: 0,
    replacementCount: 0,
    sourceRefs: ['expert-session:0001'],
    ...overrides,
  };
}

/** The reference economics policy (or an overridden copy). */
export function referencePolicyFixture(overrides: Partial<EconomicsPolicy> = {}): EconomicsPolicy {
  return {
    ...ARENA_REFERENCE_ECONOMICS_POLICY,
    ...overrides,
  } as EconomicsPolicy;
}
