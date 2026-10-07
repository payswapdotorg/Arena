/**
 * Money primitives tests (Work Order C010): string-scaled integers,
 * never floats; multi-currency representation without conversion claims.
 */

import { describe, expect, it } from 'vitest';
import {
  addMoney,
  cmpMoney,
  isMoney,
  moneyEquals,
  moneyToNumber,
  moneyWire,
  minorUnitsFromNumber,
  subMoney,
  toMinorUnits,
  toMoney,
  totalMoney,
  zeroMoney,
} from './money.js';
import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';

function expectPaymentError(action: () => unknown, code: string): PaymentError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(code);
    return error as PaymentError;
  }
  throw new Error(`expected a PaymentError with code ${code}`);
}

describe('money — typed value construction', () => {
  it('accepts number and canonical string amounts', () => {
    expect(toMoney({ amount: 25_000, currency: 'USD' })).toEqual({ minorUnits: '25000', currency: 'USD' });
    expect(toMoney({ amount: '0', currency: 'GHS' })).toEqual({ minorUnits: '0', currency: 'GHS' });
    expect(toMoney({ amount: '999999999999999', currency: 'EUR' })).toEqual({
      minorUnits: '999999999999999',
      currency: 'EUR',
    });
  });

  it('rejects floats, negatives, leading zeros, oversized and junk amounts', () => {
    expectPaymentError(() => toMoney({ amount: 1.5, currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: -1, currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: '01', currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: '1e3', currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: '9999999999999999', currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
  });

  it('rejects malformed currency codes', () => {
    expectPaymentError(() => toMoney({ amount: 1, currency: 'usd' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: 1, currency: 'USDD' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMoney({ amount: 1, currency: '' }), PAYMENTS_ERROR_CODES.INVALID_MONEY);
  });

  it('guards and brands minor units', () => {
    expect(toMinorUnits('42')).toBe('42');
    expectPaymentError(() => toMinorUnits('4.2'), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expectPaymentError(() => toMinorUnits('-42'), PAYMENTS_ERROR_CODES.INVALID_MONEY);
    expect(minorUnitsFromNumber(0)).toBe('0');
    expectPaymentError(() => minorUnitsFromNumber(0.5), PAYMENTS_ERROR_CODES.INVALID_MONEY);
  });

  it('structural guard accepts only the canonical typed form', () => {
    expect(isMoney(toMoney({ amount: 1, currency: 'USD' }))).toBe(true);
    expect(isMoney({ minorUnits: '1', currency: 'usd' })).toBe(false);
    expect(isMoney({ minorUnits: 1, currency: 'USD' })).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney('25000')).toBe(false);
  });
});

describe('money — arithmetic (BigInt only, never floats)', () => {
  it('adds and subtracts exact integer minor units', () => {
    const a = toMoney({ amount: '4503599627370495', currency: 'USD' });
    const b = toMoney({ amount: '4503599627370496', currency: 'USD' });
    const sum = addMoney(a, b);
    expect(sum).toEqual({ minorUnits: '9007199254740991', currency: 'USD' }); // exactly MAX_SAFE_INTEGER
    expect(subMoney(sum, a)).toEqual({ minorUnits: '4503599627370496', currency: 'USD' });
  });

  it('arithmetic overflow past the safe bound fails closed (typed)', () => {
    const max = toMoney({ amount: '9007199254740991', currency: 'USD' });
    expectPaymentError(() => addMoney(max, max), PAYMENTS_ERROR_CODES.INVALID_MONEY);
  });

  it('float-visible corruption is impossible: canonical strings survive JSON', () => {
    const total = addMoney(
      toMoney({ amount: '100000000000000', currency: 'USD' }),
      toMoney({ amount: '1', currency: 'USD' }),
    );
    expect(JSON.parse(JSON.stringify(total)).minorUnits).toBe('100000000000001');
    expect(moneyToNumber(total)).toBe(100000000000001); // display-only read stays exact here
  });

  it('subtraction refuses negative results (fail-closed)', () => {
    expectPaymentError(
      () => subMoney(toMoney({ amount: '5', currency: 'USD' }), toMoney({ amount: '6', currency: 'USD' })),
      PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS,
    );
  });

  it('compares and equates', () => {
    const five = toMoney({ amount: 5, currency: 'USD' });
    const six = toMoney({ amount: 6, currency: 'USD' });
    expect(cmpMoney(five, six)).toBe(-1);
    expect(cmpMoney(six, five)).toBe(1);
    expect(cmpMoney(five, toMoney({ amount: '5', currency: 'USD' }))).toBe(0);
    expect(moneyEquals(five, toMoney({ amount: '5', currency: 'USD' }))).toBe(true);
    expect(moneyEquals(five, six)).toBe(false);
  });

  it('totals a same-currency list and refuses mixed currencies', () => {
    expect(totalMoney('USD', [toMoney({ amount: 1, currency: 'USD' }), toMoney({ amount: 2, currency: 'USD' })])).toEqual({
      minorUnits: '3',
      currency: 'USD',
    });
    expect(totalMoney('USD', [])).toEqual({ minorUnits: '0', currency: 'USD' });
    expectPaymentError(
      () => totalMoney('USD', [toMoney({ amount: 1, currency: 'EUR' })]),
      PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH,
    );
  });
});

describe('money — multi-currency representation without conversion claims', () => {
  it('mixing currencies in an operation is a typed mismatch, never a conversion', () => {
    const usd = toMoney({ amount: 100, currency: 'USD' });
    const eur = toMoney({ amount: 100, currency: 'EUR' });
    for (const op of [() => addMoney(usd, eur), () => subMoney(usd, eur), () => cmpMoney(usd, eur)]) {
      expectPaymentError(op, PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH);
    }
  });

  it('a foreign-currency value is recorded exactly as declared', () => {
    const ghs = toMoney({ amount: '250000', currency: 'GHS' });
    expect(ghs.currency).toBe('GHS');
    expect(ghs.minorUnits).toBe('250000');
    expect(moneyWire(ghs)).toEqual({ minorUnits: '250000', currency: 'GHS' });
  });

  it('zero money is currency-typed', () => {
    expect(zeroMoney('USD')).toEqual({ minorUnits: '0', currency: 'USD' });
    expect(moneyEquals(zeroMoney('USD'), zeroMoney('EUR'))).toBe(false);
  });
});
