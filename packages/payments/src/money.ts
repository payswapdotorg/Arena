/**
 * Money primitives (Work Order C010; issue #77; handoff §8).
 *
 * THE MONEY LAW:
 *   - an amount is a typed value: currency + minor units;
 *   - minor units are STRING-SCALED INTEGERS (canonical decimal strings,
 *     no sign, no leading zeros, bounded to 15 digits so every value is
 *     also a safe IEEE double for plain-JSON transport) — arithmetic is
 *     BigInt-only; FLOATING-POINT NEVER TOUCHES A MONEY VALUE;
 *   - multi-currency is REPRESENTATION ONLY: a Money value records the
 *     declared currency exactly as declared; currency CONVERSION is a
 *     provider concern that is explicitly OUT OF SCOPE — mixing
 *     currencies in an operation is a typed PAYMENTS_CURRENCY_MISMATCH
 *     failure, never an implicit conversion.
 */

import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import type { CurrencyCode, PlainJsonValue } from './shared.js';
import { deepFreeze, isCurrencyCode } from './shared.js';

// ---------------------------------------------------------------------------
// MinorUnits — string-scaled integers
// ---------------------------------------------------------------------------

/**
 * Canonical minor-units string: /^(0|[1-9][0-9]{0,15})$/ AND value <=
 * 2^53-1 — every amount round-trips a plain-JSON number safely.
 */
export const MINOR_UNITS_PATTERN_SOURCE = '^(0|[1-9][0-9]{0,15})$';
const MINOR_UNITS_RE = new RegExp(MINOR_UNITS_PATTERN_SOURCE);
const MAX_MINOR_UNITS = 9007199254740991n; // Number.MAX_SAFE_INTEGER

export type MinorUnits = string & { readonly __brand: 'MinorUnits' };

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === 'string' && MINOR_UNITS_RE.test(value);
}

/** Validate and brand a minor-units string (fail-closed on shape AND bound). */
export function toMinorUnits(value: string): MinorUnits {
  if (!isMinorUnits(value) || BigInt(value) > MAX_MINOR_UNITS) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: `minor units must match ${MINOR_UNITS_PATTERN_SOURCE} and stay <= ${MAX_MINOR_UNITS.toString()} (string-scaled integer, no floats): ${JSON.stringify(value)}`,
    });
  }
  return value as MinorUnits;
}

/** Convert a safe non-negative integer into canonical minor units. */
export function minorUnitsFromNumber(value: number): MinorUnits {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: `minor units from number must be a safe integer >= 0: ${JSON.stringify(value)}`,
    });
  }
  return toMinorUnits(value.toString(10));
}

/** Read minor units as a BigInt (the ONLY arithmetic form). */
export function minorUnitsToBigInt(value: MinorUnits): bigint {
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// Money — currency + amount as ONE typed value
// ---------------------------------------------------------------------------

export interface Money {
  readonly minorUnits: MinorUnits;
  readonly currency: CurrencyCode;
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isMinorUnits(candidate['minorUnits']) && isCurrencyCode(candidate['currency']);
}

export interface MoneyInput {
  /** Minor units: a safe integer number OR a canonical decimal string. */
  readonly amount: number | string;
  readonly currency: string;
}

/** Validate and freeze a Money value (strict, fail-closed). */
export function toMoney(input: MoneyInput): Money {
  if (typeof input !== 'object' || input === null) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: 'money input must be an object { amount, currency }',
    });
  }
  const minorUnits =
    typeof input.amount === 'number'
      ? minorUnitsFromNumber(input.amount)
      : toMinorUnits(input.amount);
  if (!isCurrencyCode(input.currency)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: `currency must be an ISO-4217-shaped code: ${JSON.stringify(input.currency)}`,
    });
  }
  return Object.freeze({ minorUnits, currency: input.currency });
}

/** The zero amount of a currency. */
export function zeroMoney(currency: string): Money {
  return toMoney({ amount: '0', currency });
}

/** True iff both values declare the SAME currency (representation only — never converts). */
export function isSameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

function assertSameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH, {
      message: `${op} refused: ${a.currency} vs ${b.currency} — multi-currency is recorded as declared; conversion is a provider concern and out of scope`,
      details: { left: a.currency, right: b.currency },
    });
  }
}

/** Sum two same-currency amounts (BigInt arithmetic — never floats). */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'addMoney');
  return toMoney({ amount: (minorUnitsToBigInt(a.minorUnits) + minorUnitsToBigInt(b.minorUnits)).toString(10), currency: a.currency });
}

/**
 * Subtract b from a (same currency). Fail-closed with
 * PAYMENTS_INSUFFICIENT_FUNDS when the result would go negative — money
 * records never carry negative balances.
 */
export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'subMoney');
  const result = minorUnitsToBigInt(a.minorUnits) - minorUnitsToBigInt(b.minorUnits);
  if (result < 0n) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS, {
      message: `subMoney refused: ${a.minorUnits} ${a.currency} - ${b.minorUnits} ${b.currency} would be negative`,
      details: { left: a.minorUnits, right: b.minorUnits, currency: a.currency },
    });
  }
  return toMoney({ amount: result.toString(10), currency: a.currency });
}

/** Three-way comparison of same-currency amounts. */
export function cmpMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, 'cmpMoney');
  const left = minorUnitsToBigInt(a.minorUnits);
  const right = minorUnitsToBigInt(b.minorUnits);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Structural equality (currency AND canonical amount). */
export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minorUnits === b.minorUnits;
}

/** Read a Money value as a plain number (DISPLAY ONLY — never arithmetic). */
export function moneyToNumber(value: Money): number {
  return Number(value.minorUnits);
}

/** Total a same-currency list of Money values (empty list requires a currency). */
export function totalMoney(currency: string, values: readonly Money[]): Money {
  let sum = 0n;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH, {
        message: `totalMoney refused: ${value.currency} entry in a ${currency} total`,
        details: { expected: currency, actual: value.currency },
      });
    }
    sum += minorUnitsToBigInt(value.minorUnits);
  }
  return toMoney({ amount: sum.toString(10), currency });
}

/** The wire (plain-JSON) form of a Money value. */
export function moneyWire(value: Money): PlainJsonValue {
  return deepFreeze({ minorUnits: value.minorUnits, currency: value.currency });
}

/**
 * Guard used across the package: reject any value that smuggles a
 * floating-point amount. Accepts ONLY the typed canonical form.
 */
export function assertMoney(value: Money): Money {
  if (!isMoney(value)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: `not a Money value: ${JSON.stringify(value)}`,
    });
  }
  return value;
}
