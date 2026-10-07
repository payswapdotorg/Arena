/**
 * Test support (Work Order C010) — deterministic fixtures for the
 * payments domain tests, mirroring @arena/escalation's test-support.ts
 * convention. Exported from the package so downstream surfaces
 * (services/payments, adapters/payments) reuse ONE canonical fixture
 * factory instead of drifting local copies.
 */

import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  computeFeeSplit,
} from './index.js';
import type { FeeSchedule, FeeSplit } from './index.js';
import type { Money } from './index.js';
import { toMoney } from './index.js';

/** A fixed, valid money value (25_000 minor units = 250.00 USD). */
export function validMoney(overrides: Partial<{ amount: number | string; currency: string }> = {}): Money {
  return toMoney({
    amount: overrides.amount ?? 25_000,
    currency: overrides.currency ?? 'USD',
  });
}

/** A fixed, valid fee schedule (deterministic 10% reference rule). */
export function validFeeSchedule(overrides: Partial<FeeSchedule> = {}): FeeSchedule {
  return {
    ...ARENA_REFERENCE_FEE_SCHEDULE,
    ...overrides,
  };
}

/** The deterministic split of `validMoney()` under the reference schedule. */
export function referenceSplit(amount: Money = validMoney(), schedule: FeeSchedule = ARENA_REFERENCE_FEE_SCHEDULE): FeeSplit {
  return computeFeeSplit(schedule, amount);
}

/** Fixed, valid ledger operation context fields (deterministic timestamps). */
export const FIXED_NOW = '2026-10-07T10:00:00.000Z';

export function fixedOperationContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationKey: 'op-0001',
    lifecycleState: 'created',
    now: FIXED_NOW,
    ...overrides,
  };
}
