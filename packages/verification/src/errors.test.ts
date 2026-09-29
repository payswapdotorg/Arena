/**
 * VerificationError tests (Work Order A013): closed code set, category
 * mapping, structured round trips and STRICT parse rejection of
 * unknown/malformed structures.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId } from '@arena/protocol-core';
import {
  VERIFICATION_ERROR_CATEGORIES,
  VERIFICATION_ERROR_CODES,
  VerificationError,
  categoryForVerificationCode,
  fromVerificationErrorStruct,
  isVerificationError,
  isVerificationErrorCode,
  normalizeToVerificationError,
  toVerificationErrorStruct,
} from './errors.js';

describe('VERIFICATION_ERROR_CODES', () => {
  it('is a frozen closed set of VERIFICATION_* codes', () => {
    expect(Object.isFrozen(VERIFICATION_ERROR_CODES)).toBe(true);
    const values = Object.values(VERIFICATION_ERROR_CODES);
    expect(values.length).toBeGreaterThan(20);
    for (const value of values) {
      expect(value.startsWith('VERIFICATION_')).toBe(true);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('every code maps into the closed category set', () => {
    for (const code of Object.values(VERIFICATION_ERROR_CODES)) {
      const category = categoryForVerificationCode(code);
      expect(VERIFICATION_ERROR_CATEGORIES).toContain(category);
    }
  });

  it('isVerificationErrorCode accepts members and rejects everything else', () => {
    expect(isVerificationErrorCode('VERIFICATION_TAMPERED')).toBe(true);
    expect(isVerificationErrorCode('EVALUATION_TAMPERED')).toBe(false);
    expect(isVerificationErrorCode('verif_tampered')).toBe(false);
    expect(isVerificationErrorCode(42)).toBe(false);
    expect(isVerificationErrorCode(null)).toBe(false);
  });
});

describe('VerificationError', () => {
  it('carries code, category, message, details and correlation id', () => {
    const error = new VerificationError(VERIFICATION_ERROR_CODES.TAMPERED, {
      message: 'evidence digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
      correlationId: toCorrelationId('corr-1'),
    });
    expect(isVerificationError(error)).toBe(true);
    expect(error.name).toBe('VerificationError');
    expect(error.code).toBe('VERIFICATION_TAMPERED');
    expect(error.category).toBe('integrity');
    expect(error.message).toBe('evidence digest mismatch');
    expect(error.details).toEqual({ expected: 'a'.repeat(64), actual: 'b'.repeat(64) });
    expect(error.correlationId).toBe('corr-1');
  });

  it('optional details and correlationId are absent when not supplied', () => {
    const error = new VerificationError(VERIFICATION_ERROR_CODES.NOT_FOUND, {
      message: 'missing',
    });
    expect(error.details).toBeUndefined();
    expect(error.correlationId).toBeUndefined();
    expect(error.category).toBe('validation');
  });

  it('structured round trip preserves every field', () => {
    const error = new VerificationError(VERIFICATION_ERROR_CODES.REQUIREMENT_MISMATCH, {
      message: 'summary speaks for an undeclared requirement',
      details: { requirementId: 'requirement-999' },
      correlationId: toCorrelationId('corr-2'),
    });
    const struct = toVerificationErrorStruct(error);
    expect(struct).toEqual({
      code: 'VERIFICATION_REQUIREMENT_MISMATCH',
      category: 'validation',
      message: 'summary speaks for an undeclared requirement',
      details: { requirementId: 'requirement-999' },
      correlationId: toCorrelationId('corr-2'),
    });
    const parsed = fromVerificationErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
    expect(parsed.correlationId).toBe(error.correlationId);
  });
});

describe('fromVerificationErrorStruct (strict parse — adversarial)', () => {
  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 7, 'nope', [], true]) {
      expect(() => fromVerificationErrorStruct(bad)).toThrowError(VerificationError);
    }
  });

  it('rejects unknown codes', () => {
    expect(() =>
      fromVerificationErrorStruct({ code: 'VERIFICATION_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrowError(/unknown or missing verification error code/);
  });

  it('rejects category/code mismatches', () => {
    expect(() =>
      fromVerificationErrorStruct({
        code: 'VERIFICATION_TAMPERED',
        category: 'validation', // actual: integrity
        message: 'x',
      }),
    ).toThrowError(/does not match code/);
  });

  it('rejects empty/missing messages and malformed optional fields', () => {
    expect(() =>
      fromVerificationErrorStruct({ code: 'VERIFICATION_NOT_FOUND', category: 'validation', message: '' }),
    ).toThrowError(/non-empty string/);
    expect(() =>
      fromVerificationErrorStruct({ code: 'VERIFICATION_NOT_FOUND', category: 'validation', message: 'x', details: [] }),
    ).toThrowError(/plain object/);
    expect(() =>
      fromVerificationErrorStruct({ code: 'VERIFICATION_NOT_FOUND', category: 'validation', message: 'x', correlationId: 'not valid id!' }),
    ).toThrowError(/correlation id/);
  });

  it('the rejection itself is a VerificationError with UNKNOWN_ERROR', () => {
    try {
      fromVerificationErrorStruct({ code: 'bogus' });
      expect.unreachable('must throw');
    } catch (error) {
      expect(isVerificationError(error)).toBe(true);
      expect((error as VerificationError).code).toBe('VERIFICATION_UNKNOWN_ERROR');
    }
  });
});

describe('normalizeToVerificationError', () => {
  it('passes VerificationErrors through unchanged', () => {
    const error = new VerificationError(VERIFICATION_ERROR_CODES.VERSION_CONFLICT, { message: 'x' });
    expect(normalizeToVerificationError(error)).toBe(error);
  });

  it('wraps generic Errors and primitive throws', () => {
    const wrapped = normalizeToVerificationError(new Error('boom'));
    expect(isVerificationError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('VERIFICATION_UNKNOWN_ERROR');
    expect(wrapped.message).toBe('boom');
    const primitive = normalizeToVerificationError('just a string');
    expect(primitive.code).toBe('VERIFICATION_UNKNOWN_ERROR');
    expect(primitive.message).toBe('just a string');
  });
});
