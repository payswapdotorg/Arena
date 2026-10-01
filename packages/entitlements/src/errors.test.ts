import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  categoryForEntitlementCode,
  fromEntitlementErrorStruct,
  isEntitlementError,
  normalizeToEntitlementError,
  toEntitlementErrorStruct,
} from './index.js';

describe('entitlement error taxonomy', () => {
  it('codes map onto the closed category vocabulary', () => {
    expect(categoryForEntitlementCode('ENTITLEMENT_TENANT_MISMATCH')).toBe('integrity');
    expect(categoryForEntitlementCode('ENTITLEMENT_INVALID_GRANT')).toBe('validation');
    expect(categoryForEntitlementCode('ENTITLEMENT_UNKNOWN_ERROR')).toBe('unknown');
  });

  it('round-trips a structured error', () => {
    const error = new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: 'bad grant',
      details: { grantId: 'g1' },
    });
    const struct = toEntitlementErrorStruct(error);
    expect(struct.code).toBe('ENTITLEMENT_INVALID_GRANT');
    expect(struct.category).toBe('validation');
    const parsed = fromEntitlementErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual({ grantId: 'g1' });
  });

  it('the strict parser rejects unknown codes, category mismatches and junk (fail closed)', () => {
    expect(() =>
      fromEntitlementErrorStruct({ code: 'ENTITLEMENT_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrow(EntitlementError);
    expect(() =>
      fromEntitlementErrorStruct({
        code: 'ENTITLEMENT_INVALID_GRANT',
        category: 'integrity',
        message: 'x',
      }),
    ).toThrow(EntitlementError);
    expect(() => fromEntitlementErrorStruct('nope')).toThrow(EntitlementError);
    expect(() => fromEntitlementErrorStruct(null)).toThrow(EntitlementError);
    expect(() =>
      fromEntitlementErrorStruct({ code: 'ENTITLEMENT_INVALID_GRANT', category: 'validation' }),
    ).toThrow(EntitlementError);
  });

  it('normalizes arbitrary thrown values', () => {
    expect(isEntitlementError(normalizeToEntitlementError(new Error('boom')))).toBe(true);
    expect(isEntitlementError(normalizeToEntitlementError('raw string'))).toBe(true);
    expect(
      normalizeToEntitlementError(new EntitlementError(ENTITLEMENT_ERROR_CODES.TAMPERED, { message: 't' }))
        .code,
    ).toBe('ENTITLEMENT_TAMPERED');
  });
});
