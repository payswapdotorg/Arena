/**
 * Fee computation (Work Order C010; issue #77; handoff §8 "Arena platform
 * fee" + "expert payout").
 *
 * The split rules are EXPLICIT, VERSIONED and DETERMINISTIC:
 *   - a FeeSchedule is an immutable, content-declared rule (schedule id +
 *     version + basis points + optional min/max platform fee in minor
 *     units);
 *   - computeFeeSplit is a PURE function: same schedule + same gross →
 *     byte-identical split, forever (BigInt arithmetic only);
 *   - the platform fee is floor(gross * bps / 10_000), clamped to
 *     [min, max] (max = null means uncapped); the expert payout is
 *     ALWAYS gross - platformFee (the split is exhaustive — no rounding
 *     residue is lost or created);
 *   - a caller-supplied split is never trusted: validateFeeSplit
 *     recomputes it and any divergence is a typed machine-readable
 *     verdict (fee-split tampering fails closed, never silently
 *     accepted).
 */

import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import type { Money, MinorUnits } from './money.js';
import { isMinorUnits, minorUnitsToBigInt, toMinorUnits, toMoney } from './money.js';
import { isPlainJsonValue } from './shared.js';

// ---------------------------------------------------------------------------
// FeeSchedule — the versioned rule
// ---------------------------------------------------------------------------

export const FEE_SCHEDULE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
const FEE_SCHEDULE_ID_RE = new RegExp(FEE_SCHEDULE_ID_PATTERN_SOURCE);

export interface FeeSchedule {
  /** Rule identity (e.g. 'arena-reference'). */
  readonly scheduleId: string;
  /** Rule version — splits record it so audits reproduce the rule used. */
  readonly version: number;
  /** Platform fee in basis points: integer 0..10_000 (0%..100%). */
  readonly platformFeeBps: number;
  /** Minimum platform fee in minor units ('0' = no floor). */
  readonly minPlatformFeeMinorUnits: MinorUnits;
  /** Maximum platform fee in minor units (null = uncapped). */
  readonly maxPlatformFeeMinorUnits: MinorUnits | null;
}

export function isFeeSchedule(value: unknown): value is FeeSchedule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['scheduleId'] === 'string' &&
    FEE_SCHEDULE_ID_RE.test(candidate['scheduleId']) &&
    typeof candidate['version'] === 'number' &&
    Number.isInteger(candidate['version']) &&
    candidate['version'] >= 1 &&
    typeof candidate['platformFeeBps'] === 'number' &&
    Number.isInteger(candidate['platformFeeBps']) &&
    candidate['platformFeeBps'] >= 0 &&
    candidate['platformFeeBps'] <= 10_000 &&
    isMinorUnits(candidate['minPlatformFeeMinorUnits']) &&
    (candidate['maxPlatformFeeMinorUnits'] === null ||
      isMinorUnits(candidate['maxPlatformFeeMinorUnits']))
  );
}

/** Validate and freeze a fee schedule (strict, fail-closed). */
export function toFeeSchedule(value: FeeSchedule): FeeSchedule {
  if (!isFeeSchedule(value)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `not a FeeSchedule: ${JSON.stringify(value)} (scheduleId ${FEE_SCHEDULE_ID_PATTERN_SOURCE}, version >= 1, platformFeeBps 0..10000, min/max minor units canonical)`,
    });
  }
  if (
    value.maxPlatformFeeMinorUnits !== null &&
    minorUnitsToBigInt(value.maxPlatformFeeMinorUnits) < minorUnitsToBigInt(value.minPlatformFeeMinorUnits)
  ) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `fee schedule ${value.scheduleId} v${value.version}: max platform fee ${value.maxPlatformFeeMinorUnits} is below min ${value.minPlatformFeeMinorUnits}`,
    });
  }
  return Object.freeze({ ...value });
}

/**
 * The deterministic reference schedule shipped with the domain (10%).
 * Hosts may inject their own; production fee policy is a commercial
 * decision recorded at the composition root.
 */
export const ARENA_REFERENCE_FEE_SCHEDULE: FeeSchedule = Object.freeze({
  scheduleId: 'arena-reference',
  version: 1,
  platformFeeBps: 1_000,
  minPlatformFeeMinorUnits: toMinorUnits('0'),
  maxPlatformFeeMinorUnits: null,
});

// ---------------------------------------------------------------------------
// FeeSplit — the computed outcome
// ---------------------------------------------------------------------------

export interface FeeSplit {
  readonly scheduleId: string;
  readonly scheduleVersion: number;
  readonly currency: string;
  readonly grossMinorUnits: MinorUnits;
  readonly platformFeeMinorUnits: MinorUnits;
  readonly expertPayoutMinorUnits: MinorUnits;
}

export function isFeeSplit(value: unknown): value is FeeSplit {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['scheduleId'] === 'string' &&
    typeof candidate['scheduleVersion'] === 'number' &&
    typeof candidate['currency'] === 'string' &&
    isMinorUnits(candidate['grossMinorUnits']) &&
    isMinorUnits(candidate['platformFeeMinorUnits']) &&
    isMinorUnits(candidate['expertPayoutMinorUnits'])
  );
}

/**
 * Compute the platform-fee + expert-payout split (PURE and
 * DETERMINISTIC). fee = clamp(floor(gross * bps / 10000), min, max);
 * payout = gross - fee. The two legs always sum back to the gross.
 */
export function computeFeeSplit(schedule: FeeSchedule, gross: Money): FeeSplit {
  if (!isFeeSchedule(schedule)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `not a FeeSchedule: ${JSON.stringify(schedule)}`,
    });
  }
  const grossUnits = minorUnitsToBigInt(gross.minorUnits);
  let fee = (grossUnits * BigInt(schedule.platformFeeBps)) / 10_000n;
  const min = minorUnitsToBigInt(schedule.minPlatformFeeMinorUnits);
  if (fee < min) fee = min;
  if (schedule.maxPlatformFeeMinorUnits !== null) {
    const max = minorUnitsToBigInt(schedule.maxPlatformFeeMinorUnits);
    if (fee > max) fee = max;
  }
  // Degenerate-but-deterministic: a floor above the gross eats the whole
  // gross (payout 0). Recorded, not silently corrected.
  if (fee > grossUnits) fee = grossUnits;
  const payout = grossUnits - fee;
  return Object.freeze({
    scheduleId: schedule.scheduleId,
    scheduleVersion: schedule.version,
    currency: gross.currency,
    grossMinorUnits: gross.minorUnits,
    platformFeeMinorUnits: toMinorUnits(fee.toString(10)),
    expertPayoutMinorUnits: toMinorUnits(payout.toString(10)),
  });
}

// ---------------------------------------------------------------------------
// Split validation — callers are NEVER trusted
// ---------------------------------------------------------------------------

export const FEE_SPLIT_INVALID_REASONS = Object.freeze([
  'split_wrong_schedule',
  'split_currency_mismatch',
  'split_gross_mismatch',
  'split_sum_mismatch',
  'split_negative',
] as const);
export type FeeSplitInvalidReason = (typeof FEE_SPLIT_INVALID_REASONS)[number];

export type FeeSplitVerdict =
  | { readonly valid: true; readonly split: FeeSplit }
  | { readonly valid: false; readonly reason: FeeSplitInvalidReason; readonly declared: FeeSplit; readonly computed: FeeSplit };

/**
 * Recompute the split and compare against the declared one. ANY
 * divergence (wrong schedule, wrong gross, legs not summing to gross, or
 * not matching the deterministic computation) is an INVALID verdict —
 * the caller-side fee-split tampering guard.
 */
export function validateFeeSplit(schedule: FeeSchedule, gross: Money, declared: FeeSplit): FeeSplitVerdict {
  const computed = computeFeeSplit(schedule, gross);
  if (
    declared.scheduleId !== schedule.scheduleId ||
    declared.scheduleVersion !== schedule.version
  ) {
    return { valid: false, reason: 'split_wrong_schedule', declared, computed };
  }
  if (declared.currency !== gross.currency) {
    return { valid: false, reason: 'split_currency_mismatch', declared, computed };
  }
  if (declared.grossMinorUnits !== gross.minorUnits) {
    return { valid: false, reason: 'split_gross_mismatch', declared, computed };
  }
  const declaredFee = minorUnitsToBigInt(declared.platformFeeMinorUnits);
  const declaredPayout = minorUnitsToBigInt(declared.expertPayoutMinorUnits);
  const declaredGross = minorUnitsToBigInt(declared.grossMinorUnits);
  if (declaredFee < 0n || declaredPayout < 0n) {
    return { valid: false, reason: 'split_negative', declared, computed };
  }
  if (declaredFee + declaredPayout !== declaredGross) {
    return { valid: false, reason: 'split_sum_mismatch', declared, computed };
  }
  if (
    declaredFee !== minorUnitsToBigInt(computed.platformFeeMinorUnits) ||
    declaredPayout !== minorUnitsToBigInt(computed.expertPayoutMinorUnits)
  ) {
    return { valid: false, reason: 'split_sum_mismatch', declared, computed };
  }
  return { valid: true, split: computed };
}

/** Throwing form of validateFeeSplit (PAYMENTS_SPLIT_MISMATCH on tamper). */
export function assertFeeSplit(schedule: FeeSchedule, gross: Money, declared: FeeSplit): FeeSplit {
  const verdict = validateFeeSplit(schedule, gross, declared);
  if (!verdict.valid) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.SPLIT_MISMATCH, {
      message: `declared fee split does not match the deterministic computation (${verdict.reason}) — fee-split tampering refused`,
      details: {
        reason: verdict.reason,
        declared: verdict.declared,
        computed: verdict.computed,
      },
    });
  }
  return verdict.split;
}

/** The two legs of a split as Money values. */
export function splitLegs(split: FeeSplit): { readonly platformFee: Money; readonly expertPayout: Money } {
  return Object.freeze({
    platformFee: toMoney({ amount: split.platformFeeMinorUnits, currency: split.currency }),
    expertPayout: toMoney({ amount: split.expertPayoutMinorUnits, currency: split.currency }),
  });
}

/** The wire (plain-JSON) form of a fee split. */
export function feeSplitWire(split: FeeSplit) {
  return isPlainJsonValue(split) ? split : { ...split };
}
