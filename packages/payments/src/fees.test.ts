/**
 * Fee computation tests (Work Order C010): versioned, deterministic
 * platform-fee + expert-payout splits; caller-side tampering fails
 * closed.
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  assertFeeSplit,
  computeFeeSplit,
  isFeeSchedule,
  splitLegs,
  toFeeSchedule,
  toMoney,
  validateFeeSplit,
} from './index.js';
import { PAYMENTS_ERROR_CODES } from './errors.js';
import { toMinorUnits } from './money.js';
import { validFeeSchedule, validMoney } from './test-support.js';

const GROSS = validMoney(); // 25_000 USD

describe('fee schedule — validation', () => {
  it('accepts the reference schedule and well-formed custom schedules', () => {
    expect(isFeeSchedule(ARENA_REFERENCE_FEE_SCHEDULE)).toBe(true);
    expect(toFeeSchedule(validFeeSchedule())).toEqual(ARENA_REFERENCE_FEE_SCHEDULE);
    expect(
      isFeeSchedule(
        toFeeSchedule({
          scheduleId: 'custom-floor',
          version: 3,
          platformFeeBps: 500,
          minPlatformFeeMinorUnits: toMinorUnits('100'),
          maxPlatformFeeMinorUnits: toMinorUnits('900'),
        }),
      ),
    ).toBe(true);
  });

  it('rejects malformed schedules (bps bounds, bad ids, max < min)', () => {
    expect(isFeeSchedule({ ...validFeeSchedule(), platformFeeBps: 10_001 })).toBe(false);
    expect(isFeeSchedule({ ...validFeeSchedule(), platformFeeBps: -1 })).toBe(false);
    expect(isFeeSchedule({ ...validFeeSchedule(), version: 0 })).toBe(false);
    expect(isFeeSchedule({ ...validFeeSchedule(), scheduleId: 'Bad_Id' })).toBe(false);
    expect(() =>
      toFeeSchedule({
        scheduleId: 'inverted',
        version: 1,
        platformFeeBps: 100,
        minPlatformFeeMinorUnits: toMinorUnits('500'),
        maxPlatformFeeMinorUnits: toMinorUnits('100'),
      }),
    ).toThrowError(/max platform fee/);
  });
});

describe('fee split — deterministic computation', () => {
  it('the reference rule splits 10% deterministically', () => {
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS);
    expect(split).toEqual({
      scheduleId: 'arena-reference',
      scheduleVersion: 1,
      currency: 'USD',
      grossMinorUnits: '25000',
      platformFeeMinorUnits: '2500',
      expertPayoutMinorUnits: '22500',
    });
  });

  it('same inputs → byte-identical split, forever (determinism)', () => {
    for (let index = 0; index < 25; index += 1) {
      expect(computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS)).toEqual(
        computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS),
      );
    }
  });

  it('floor rounding never loses or creates residue (legs sum to gross)', () => {
    for (const amount of ['1', '3', '7', '999', '12345', '999999999999999']) {
      const gross = toMoney({ amount, currency: 'USD' });
      const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, gross);
      expect(
        BigInt(split.platformFeeMinorUnits) + BigInt(split.expertPayoutMinorUnits),
      ).toBe(BigInt(amount));
    }
  });

  it('min floor and max cap clamp deterministically', () => {
    const floored = toFeeSchedule({
      scheduleId: 'floored',
      version: 1,
      platformFeeBps: 0,
      minPlatformFeeMinorUnits: toMinorUnits('100'),
      maxPlatformFeeMinorUnits: null,
    });
    expect(computeFeeSplit(floored, toMoney({ amount: '50', currency: 'USD' })).platformFeeMinorUnits).toBe('50');
    expect(computeFeeSplit(floored, toMoney({ amount: '500', currency: 'USD' })).platformFeeMinorUnits).toBe('100');

    const capped = toFeeSchedule({
      scheduleId: 'capped',
      version: 1,
      platformFeeBps: 10_000,
      minPlatformFeeMinorUnits: toMinorUnits('0'),
      maxPlatformFeeMinorUnits: toMinorUnits('100'),
    });
    expect(computeFeeSplit(capped, toMoney({ amount: '500', currency: 'USD' })).platformFeeMinorUnits).toBe('100');
    expect(computeFeeSplit(capped, toMoney({ amount: '50', currency: 'USD' })).expertPayoutMinorUnits).toBe('0');
  });

  it('legs are Money values of the split currency', () => {
    const legs = splitLegs(computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS));
    expect(legs.platformFee).toEqual({ minorUnits: '2500', currency: 'USD' });
    expect(legs.expertPayout).toEqual({ minorUnits: '22500', currency: 'USD' });
  });
});

describe('fee split — tamper validation (callers are never trusted)', () => {
  it('a faithful split validates', () => {
    const declared = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS);
    const verdict = validateFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS, declared);
    expect(verdict.valid).toBe(true);
  });

  it('inflated platform fee is detected and fails closed', () => {
    const declared = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS);
    const tampered = {
      ...declared,
      platformFeeMinorUnits: toMinorUnits('12500'),
      expertPayoutMinorUnits: toMinorUnits('12500'),
    };
    const verdict = validateFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS, tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.valid && true ? null : verdict.reason).toBe('split_sum_mismatch');
    expect(() => assertFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS, tampered)).toThrowError(
      /fee-split tampering refused/,
    );
    try {
      assertFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS, tampered);
    } catch (error) {
      expect((error as { code: string }).code).toBe(PAYMENTS_ERROR_CODES.SPLIT_MISMATCH);
    }
  });

  it('wrong schedule / wrong gross / unbalanced legs are each typed denials', () => {
    const declared = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS);
    const other = toFeeSchedule({ ...validFeeSchedule({ version: 2 }) });
    expect(validateFeeSplit(other, GROSS, declared).valid).toBe(false);
    expect(
      validateFeeSplit(
        ARENA_REFERENCE_FEE_SCHEDULE,
        toMoney({ amount: '999', currency: 'USD' }),
        declared,
      ).valid,
    ).toBe(false);
    const unbalanced = { ...declared, expertPayoutMinorUnits: toMinorUnits('22501') };
    expect(validateFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, GROSS, unbalanced).valid).toBe(false);
  });
});
