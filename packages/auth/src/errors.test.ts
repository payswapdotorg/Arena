/**
 * Auth error taxonomy tests (Work Order B004) — closed codes, category
 * mapping, the strictly validating parser (fail closed), normalization.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_CATEGORIES,
  AUTH_ERROR_CODES,
  AuthError,
  categoryForAuthCode,
  fromAuthErrorStruct,
  isAuthError,
  isAuthErrorCode,
  normalizeToAuthError,
  toAuthErrorStruct,
} from './errors.js';

describe('AUTH_* error taxonomy', () => {
  it('exposes the closed code set with unique values', () => {
    const codes = Object.values(AUTH_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      expect(code.startsWith('AUTH_')).toBe(true);
    }
  });

  it('maps every code onto the closed category vocabulary', () => {
    for (const code of Object.values(AUTH_ERROR_CODES)) {
      expect(AUTH_ERROR_CATEGORIES).toContain(categoryForAuthCode(code));
    }
  });

  it('round-trips through the structured form', () => {
    const error = new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED, {
      message: 'session expired',
      details: { sessionId: 'abc' },
    });
    const struct = toAuthErrorStruct(error);
    expect(struct.code).toBe('AUTH_SESSION_EXPIRED');
    expect(struct.category).toBe('access');
    expect(struct.details).toEqual({ sessionId: 'abc' });
    const parsed = fromAuthErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(isAuthError(parsed)).toBe(true);
  });

  it('parser fails closed on malformed input', () => {
    for (const malformed of [
      null,
      'nope',
      42,
      [],
      {},
      { code: 'AUTH_NOT_A_CODE', category: 'access', message: 'x' },
      { code: 'AUTH_SESSION_EXPIRED', category: 'validation', message: 'x' },
      { code: 'AUTH_SESSION_EXPIRED', category: 'access', message: '' },
      { code: 'AUTH_SESSION_EXPIRED', category: 'access', message: 'x', details: 'nope' },
    ]) {
      expect(() => fromAuthErrorStruct(malformed)).toThrowError(AuthError);
    }
  });

  it('recognizes codes structurally and normalizes unknown throwables', () => {
    expect(isAuthErrorCode('AUTH_DISABLED')).toBe(true);
    expect(isAuthErrorCode('AUTH_NOPE')).toBe(false);
    expect(normalizeToAuthError(new Error('boom')).code).toBe('AUTH_UNKNOWN_ERROR');
    expect(normalizeToAuthError('plain string').code).toBe('AUTH_UNKNOWN_ERROR');
    const original = new AuthError(AUTH_ERROR_CODES.TOKEN_TAMPERED, { message: 't' });
    expect(normalizeToAuthError(original)).toBe(original);
  });
});
