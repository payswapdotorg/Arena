/**
 * Property-style invariants (Work Order C010), deterministic pseudo-
 * random sweeps (a fixed-seed LCG — no flaky randomness):
 *
 *   P1 the double-entry invariant: signed account balances always sum
 *      to zero (debit legs == credit legs on every entry);
 *   P2 funds balances never go negative for any account;
 *   P3 the split invariant: platformFee + expertPayout == gross for
 *      every deterministic schedule/amount combination;
 *   P4 the conservation invariant: after hold → capture → release,
 *      customer-source == platform-fee + expert-payout + refunds.
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  availableForRefund,
  applyAcceptanceOperation,
  applyCaptureOperation,
  applyHoldOperation,
  applyOfferOperation,
  applyRefundOperation,
  applyReleaseOperation,
  computeFeeSplit,
  ledgerBalances,
  openPaymentLedger,
  PAYMENT_ACCOUNTS,
  ACCOUNT_SIDE,
  toMoney,
  verifyLedgerIntegrity,
} from './index.js';
import type { FeeSchedule } from './index.js';
import { toFeeSchedule } from './index.js';
import { toMinorUnits } from './money.js';
import { FIXED_NOW } from './test-support.js';

/** Deterministic LCG (fixed seed — reproducible sweeps). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 43_567;
    return state;
  };
}

const SCHEDULES: readonly FeeSchedule[] = [
  ARENA_REFERENCE_FEE_SCHEDULE,
  toFeeSchedule({ scheduleId: 'zero', version: 1, platformFeeBps: 0, minPlatformFeeMinorUnits: toMinorUnits('0'), maxPlatformFeeMinorUnits: null }),
  toFeeSchedule({ scheduleId: 'full', version: 1, platformFeeBps: 10_000, minPlatformFeeMinorUnits: toMinorUnits('0'), maxPlatformFeeMinorUnits: null }),
  toFeeSchedule({ scheduleId: 'floored', version: 2, platformFeeBps: 300, minPlatformFeeMinorUnits: toMinorUnits('777'), maxPlatformFeeMinorUnits: null }),
  toFeeSchedule({ scheduleId: 'capped', version: 1, platformFeeBps: 9_000, minPlatformFeeMinorUnits: toMinorUnits('0'), maxPlatformFeeMinorUnits: toMinorUnits('1') }),
];

describe('property — fee split invariants (deterministic sweep)', () => {
  it('P3: legs always sum to the gross across schedules and amounts', () => {
    const random = lcg(42);
    for (let trial = 0; trial < 500; trial += 1) {
      const schedule = SCHEDULES[random() % SCHEDULES.length]!;
      const amount = (random() % 100_000).toString(10);
      const split = computeFeeSplit(schedule, toMoney({ amount, currency: 'USD' }));
      expect(
        BigInt(split.platformFeeMinorUnits) + BigInt(split.expertPayoutMinorUnits),
      ).toBe(BigInt(amount));
      expect(BigInt(split.platformFeeMinorUnits)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(split.expertPayoutMinorUnits)).toBeGreaterThanOrEqual(0n);
    }
  });

  it('splits are byte-stable under repetition (determinism)', () => {
    const random = lcg(7);
    const seen = new Map<string, string>();
    for (let trial = 0; trial < 200; trial += 1) {
      const schedule = SCHEDULES[random() % SCHEDULES.length]!;
      const amount = (random() % 5_000).toString(10);
      const key = `${schedule.scheduleId}#${amount}`;
      const split = computeFeeSplit(schedule, toMoney({ amount, currency: 'USD' }));
      const serialized = JSON.stringify(split);
      const previous = seen.get(key);
      if (previous !== undefined) {
        expect(serialized).toBe(previous);
      } else {
        seen.set(key, serialized);
      }
    }
  });
});

describe('property — ledger invariants (deterministic sweep)', () => {
  it('P1+P2+P4: hold → capture → (release | refund) sweeps conserve funds', async () => {
    const random = lcg(2026);
    for (let trial = 0; trial < 60; trial += 1) {
      const budgetUnits = (random() % 50_000 + 1).toString(10);
      const budget = toMoney({ amount: budgetUnits, currency: 'USD' });
      const ledger = openPaymentLedger({
        requestId: `esc-prop-${trial}`,
        tenantId: 'tenant-alpha',
        correlationId: 'corr-prop',
        currency: 'USD',
        truth: 'demo',
        now: FIXED_NOW,
      });
      let current = (
        await applyHoldOperation(ledger, {
          amount: budget,
          operationKey: 'p-hold',
          lifecycleState: 'created',
          now: FIXED_NOW,
        })
      ).ledger;
      current = (
        await applyOfferOperation(current, {
          amount: budget,
          operationKey: 'p-offer',
          lifecycleState: 'offered',
          now: FIXED_NOW,
        })
      ).ledger;
      current = (
        await applyAcceptanceOperation(current, {
          operationKey: 'p-accept',
          lifecycleState: 'accepted',
          now: FIXED_NOW,
        })
      ).ledger;
      current = (
        await applyCaptureOperation(current, {
          amount: budget,
          operationKey: 'p-capture',
          lifecycleState: 'accepted',
          now: FIXED_NOW,
        })
      ).ledger;

      if (random() % 2 === 0) {
        current = (
          await applyReleaseOperation(current, {
            schedule: ARENA_REFERENCE_FEE_SCHEDULE,
            split: computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, budget),
            operationKey: 'p-release',
            lifecycleState: 'result_accepted',
            now: FIXED_NOW,
          })
        ).ledger;
      } else {
        current = (
          await applyRefundOperation(current, {
            amount: budget,
            reason: 'revision_required',
            operationKey: 'p-refund',
            lifecycleState: 'revision_required',
            now: FIXED_NOW,
          })
        ).ledger;
      }

      // P1: signed balances sum to zero.
      const balances = ledgerBalances(current);
      let signedSum = 0n;
      for (const account of PAYMENT_ACCOUNTS) {
        const value = BigInt(balances[account]);
        signedSum += ACCOUNT_SIDE[account] === 'source' ? value : -value;
      }
      expect(signedSum).toBe(0n);

      // P2: no negative funds balances.
      for (const account of PAYMENT_ACCOUNTS) {
        expect(BigInt(balances[account]) >= 0n, `${account} negative in trial ${trial}`).toBe(true);
      }

      // P4: customer-source == platform-fee + expert-payout + refunds.
      expect(BigInt(balances['customer-source'])).toBe(
        BigInt(balances['platform-fee']) +
          BigInt(balances['expert-payout']) +
          BigInt(balances.refunds),
      );

      // The digest chain stays intact across the whole sweep.
      expect(await verifyLedgerIntegrity(current)).toEqual({ ok: true, reason: 'integrity_ok' });
    }
  });

  it('partial-refund sweeps never overdraw and always end conserving funds', async () => {
    const random = lcg(99);
    for (let trial = 0; trial < 40; trial += 1) {
      const budgetUnits = (random() % 10_000 + 1).toString(10);
      const budget = toMoney({ amount: budgetUnits, currency: 'USD' });
      let current = openPaymentLedger({
        requestId: `esc-part-${trial}`,
        tenantId: 'tenant-alpha',
        correlationId: 'corr-part',
        currency: 'USD',
        truth: 'demo',
        now: FIXED_NOW,
      });
      current = (
        await applyHoldOperation(current, {
          amount: budget,
          operationKey: 'q-hold',
          lifecycleState: 'created',
          now: FIXED_NOW,
        })
      ).ledger;
      current = (
        await applyRefundOperation(current, {
          amount: toMoney({ amount: (random() % Number(budgetUnits) + 1).toString(10), currency: 'USD' }),
          reason: 'timed_out',
          operationKey: 'q-refund-1',
          lifecycleState: 'timed_out',
          now: FIXED_NOW,
        })
      ).ledger;
      current = (
        await applyRefundOperation(current, {
          amount: toMoney({ amount: availableForRefund(current), currency: 'USD' }),
          reason: 'timed_out',
          operationKey: 'q-refund-2',
          lifecycleState: 'timed_out',
          now: FIXED_NOW,
        })
      ).ledger;
      expect(current.state).toBe('refunded');
      const balances = ledgerBalances(current);
      expect(balances.escrow).toBe('0');
      expect(balances.refunds).toBe(budgetUnits);
      expect(await verifyLedgerIntegrity(current)).toEqual({ ok: true, reason: 'integrity_ok' });
    }
  });
});
