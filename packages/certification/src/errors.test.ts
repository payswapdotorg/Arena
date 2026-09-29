/**
 * Error taxonomy tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_ERROR_CATEGORIES,
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  categoryForCertificationCode,
  fromCertificationErrorStruct,
  isCertificationError,
  isCertificationErrorCode,
  normalizeToCertificationError,
  toCertificationErrorStruct,
} from './errors.js';

describe('closed error code set', () => {
  it('every code carries a non-empty message and a known category', () => {
    for (const code of Object.values(CERTIFICATION_ERROR_CODES)) {
      const category = categoryForCertificationCode(code);
      expect((CERTIFICATION_ERROR_CATEGORIES as readonly string[]).includes(category)).toBe(true);
    }
  });
  it('codes are stable strings (do not drift across releases)', () => {
    expect(CERTIFICATION_ERROR_CODES.INVALID_SUITE).toBe('CERTIFICATION_INVALID_SUITE');
    expect(CERTIFICATION_ERROR_CODES.TAMPERED).toBe('CERTIFICATION_TAMPERED');
    expect(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR).toBe('CERTIFICATION_UNKNOWN_ERROR');
  });
});

describe('error class', () => {
  it('constructs with code + category + message + details + correlationId', () => {
    const error = new CertificationError(
      CERTIFICATION_ERROR_CODES.INVALID_SUITE,
      {
        message: 'bad suite',
        details: { field: 'suiteId' },
      },
    );
    expect(error.code).toBe(CERTIFICATION_ERROR_CODES.INVALID_SUITE);
    expect(error.category).toBe('validation');
    expect(error.message).toBe('bad suite');
    expect(error.details).toEqual({ field: 'suiteId' });
    expect(isCertificationError(error)).toBe(true);
    expect(isCertificationError(new Error('plain'))).toBe(false);
  });
  it('exposes a wire-safe structured form', () => {
    const error = new CertificationError(
      CERTIFICATION_ERROR_CODES.TAMPERED,
      { message: 'digest mismatch' },
    );
    const struct = toCertificationErrorStruct(error);
    expect(struct.code).toBe(CERTIFICATION_ERROR_CODES.TAMPERED);
    expect(struct.category).toBe('integrity');
    expect(struct.message).toBe('digest mismatch');
  });
});

describe('code/category guards', () => {
  it('isCertificationErrorCode returns true for known codes only', () => {
    expect(isCertificationErrorCode(CERTIFICATION_ERROR_CODES.TAMPERED)).toBe(true);
    expect(isCertificationErrorCode('NOT_A_CODE')).toBe(false);
    expect(isCertificationErrorCode(42)).toBe(false);
  });
});

describe('structured-error parser (fail-closed on every malformed shape)', () => {
  it('round-trips a well-formed struct', () => {
    const error = new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'bad',
    });
    const struct = toCertificationErrorStruct(error);
    const reconstructed = fromCertificationErrorStruct(struct);
    expect(reconstructed.code).toBe(error.code);
    expect(reconstructed.category).toBe(error.category);
    expect(reconstructed.message).toBe(error.message);
  });
  it('rejects a non-object struct', () => {
    expect(() => fromCertificationErrorStruct(null)).toThrowError(CertificationError);
    expect(() => fromCertificationErrorStruct('bad')).toThrowError(CertificationError);
    expect(() => fromCertificationErrorStruct(42)).toThrowError(CertificationError);
  });
  it('rejects an unknown code', () => {
    expect(() =>
      fromCertificationErrorStruct({
        code: 'NOT_A_CODE',
        category: 'validation',
        message: 'bad',
      }),
    ).toThrowError(CertificationError);
  });
  it('rejects a category/code mismatch', () => {
    expect(() =>
      fromCertificationErrorStruct({
        code: CERTIFICATION_ERROR_CODES.TAMPERED,
        category: 'validation', // mismatched — TAMPERED is integrity
        message: 'bad',
      }),
    ).toThrowError(CertificationError);
  });
  it('rejects an empty message', () => {
    expect(() =>
      fromCertificationErrorStruct({
        code: CERTIFICATION_ERROR_CODES.TAMPERED,
        category: 'integrity',
        message: '',
      }),
    ).toThrowError(CertificationError);
  });
});

describe('normalizeToCertificationError', () => {
  it('passes through a CertificationError', () => {
    const error = new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: 'bad',
    });
    expect(normalizeToCertificationError(error)).toBe(error);
  });
  it('wraps a plain Error as UNKNOWN_ERROR', () => {
    const wrapped = normalizeToCertificationError(new Error('plain'));
    expect(wrapped.code).toBe(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR);
    expect(wrapped.message).toBe('plain');
  });
  it('wraps a non-Error thrown value', () => {
    const wrapped = normalizeToCertificationError('just a string');
    expect(wrapped.code).toBe(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR);
    expect(wrapped.message).toBe('just a string');
  });
});
