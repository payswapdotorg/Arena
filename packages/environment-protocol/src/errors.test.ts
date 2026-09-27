/**
 * Error taxonomy tests (mirrors A002/A003 error suites): closed codes,
 * category mapping, structured wire form round-trip, strict parsing of
 * unknown codes, normalization.
 */

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_ERROR_CATEGORIES,
  ENVIRONMENT_ERROR_CODES,
  EnvironmentError,
  categoryForEnvironmentCode,
  fromEnvironmentErrorStruct,
  isEnvironmentError,
  isEnvironmentErrorCode,
  normalizeToEnvironmentError,
  toEnvironmentErrorStruct,
} from './errors.js';

describe('environment error taxonomy', () => {
  it('codes are unique and prefixed', () => {
    const codes = Object.values(ENVIRONMENT_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.startsWith('ENVIRONMENT_')).toBe(true);
    }
  });

  it('every code maps to a known category', () => {
    for (const code of Object.values(ENVIRONMENT_ERROR_CODES)) {
      expect(ENVIRONMENT_ERROR_CATEGORIES).toContain(categoryForEnvironmentCode(code));
    }
    expect(categoryForEnvironmentCode(ENVIRONMENT_ERROR_CODES.TAMPERED)).toBe('integrity');
    expect(categoryForEnvironmentCode(ENVIRONMENT_ERROR_CODES.VERSION_CONFLICT)).toBe('integrity');
    expect(categoryForEnvironmentCode(ENVIRONMENT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION)).toBe(
      'versioning',
    );
    expect(categoryForEnvironmentCode(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR)).toBe('unknown');
  });

  it('isEnvironmentErrorCode accepts known codes only', () => {
    expect(isEnvironmentErrorCode(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION)).toBe(true);
    expect(isEnvironmentErrorCode('ENVIRONMENT_NOT_A_CODE')).toBe(false);
    expect(isEnvironmentErrorCode(42)).toBe(false);
  });
});

describe('structured error form', () => {
  it('round-trips through the struct form', () => {
    const error = new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY, {
      message: 'egress must be default-deny',
      details: { field: 'egress' },
    });
    const struct = toEnvironmentErrorStruct(error);
    expect(struct.code).toBe('ENVIRONMENT_INVALID_NETWORK_POLICY');
    expect(struct.category).toBe('validation');
    expect(struct.message).toBe('egress must be default-deny');
    const parsed = fromEnvironmentErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
  });

  it('unknown codes are rejected at parse time', () => {
    expect(() =>
      fromEnvironmentErrorStruct({ code: 'ENVIRONMENT_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrowError(EnvironmentError);
  });

  it('category/code mismatches are rejected at parse time', () => {
    expect(() =>
      fromEnvironmentErrorStruct({
        code: ENVIRONMENT_ERROR_CODES.TAMPERED,
        category: 'validation',
        message: 'x',
      }),
    ).toThrowError(EnvironmentError);
  });

  it.each([
    null,
    42,
    'nope',
    [],
    { code: ENVIRONMENT_ERROR_CODES.TAMPERED, category: 'integrity' },
    {
      code: ENVIRONMENT_ERROR_CODES.TAMPERED,
      category: 'integrity',
      message: '',
    },
  ])('malformed struct %j is rejected', (bad) => {
    expect(() => fromEnvironmentErrorStruct(bad)).toThrowError(EnvironmentError);
  });

  it('normalizeToEnvironmentError wraps unknown throwables', () => {
    expect(normalizeToEnvironmentError(new Error('boom'))).toBeInstanceOf(EnvironmentError);
    expect(normalizeToEnvironmentError('boom').message).toBe('boom');
    const already = new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: 'same',
    });
    expect(normalizeToEnvironmentError(already)).toBe(already);
  });

  it('isEnvironmentError guards the class', () => {
    expect(isEnvironmentError(new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, { message: 'x' }))).toBe(true);
    expect(isEnvironmentError(new Error('x'))).toBe(false);
  });
});
