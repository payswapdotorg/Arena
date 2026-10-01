import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_ERROR_CATEGORIES,
  MARKETPLACE_ERROR_CODES,
  MarketplaceError,
  categoryForMarketplaceCode,
  fromMarketplaceErrorStruct,
  isMarketplaceError,
  isMarketplaceErrorCode,
  normalizeToMarketplaceError,
  toMarketplaceErrorStruct,
} from './errors.js';

describe('marketplace error taxonomy', () => {
  it('codes are unique and closed', () => {
    const codes = Object.values(MARKETPLACE_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(isMarketplaceErrorCode(code)).toBe(true);
      expect([...MARKETPLACE_ERROR_CATEGORIES]).toContain(categoryForMarketplaceCode(code));
    }
  });

  it('unknown codes are rejected (fail closed)', () => {
    expect(isMarketplaceErrorCode('MARKETPLACE_NOT_A_CODE')).toBe(false);
    expect(categoryForMarketplaceCode('SOMETHING_ELSE')).toBe('unknown');
    expect(() =>
      fromMarketplaceErrorStruct({ code: 'MARKETPLACE_NOPE', message: 'x' }),
    ).toThrowError(MarketplaceError);
  });

  it('struct round trip preserves code, category and message', () => {
    const error = new MarketplaceError(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED, {
      message: 'gate rejected',
      details: { rejections: [] },
      correlationId: 'corr-1',
    });
    const struct = toMarketplaceErrorStruct(error);
    expect(struct.code).toBe(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED);
    expect(struct.category).toBe('authorization');
    const restored = fromMarketplaceErrorStruct(struct);
    expect(restored.code).toBe(error.code);
    expect(restored.message).toBe(error.message);
    expect(restored.correlationId).toBe('corr-1');
  });

  it('normalizeToMarketplaceError passes marketplace errors through', () => {
    const original = new MarketplaceError(MARKETPLACE_ERROR_CODES.NOT_FOUND, {
      message: 'missing',
    });
    const normalized = normalizeToMarketplaceError(original, 'corr-2');
    expect(normalized.code).toBe(MARKETPLACE_ERROR_CODES.NOT_FOUND);
    expect(normalized.correlationId).toBe('corr-2');
  });

  it('normalizeToMarketplaceError wraps foreign errors (fail closed)', () => {
    const normalized = normalizeToMarketplaceError(new Error('boom'));
    expect(isMarketplaceError(normalized)).toBe(true);
    expect(normalized.code).toBe(MARKETPLACE_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalized.message).toBe('boom');
  });

  it('normalizeToMarketplaceError is total over non-errors', () => {
    const normalized = normalizeToMarketplaceError('nonsense');
    expect(normalized.code).toBe(MARKETPLACE_ERROR_CODES.UNKNOWN_ERROR);
  });
});
