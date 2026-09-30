/**
 * Unit tests for the Arena API error taxonomy (Work Order A025).
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_API_ERROR_CATEGORIES,
  ARENA_API_ERROR_CODES,
  ArenaApiError,
  categoryForArenaApiCode,
  fromArenaApiErrorStruct,
  isArenaApiError,
  isArenaApiErrorCode,
  normalizeToArenaApiError,
  toArenaApiErrorStruct,
} from './errors.js';

describe('arena api error taxonomy', () => {
  it('the error code set is closed and frozen', () => {
    expect(Object.isFrozen(ARENA_API_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(ARENA_API_ERROR_CATEGORIES)).toBe(true);
    const values = Object.values(ARENA_API_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value.startsWith('ARENA_API_')).toBe(true);
    }
  });

  it('every code maps to exactly one category', () => {
    for (const code of Object.values(ARENA_API_ERROR_CODES)) {
      expect(ARENA_API_ERROR_CATEGORIES).toContain(categoryForArenaApiCode(code));
    }
    expect(categoryForArenaApiCode('ARENA_API_CROSS_TENANT_ACCESS')).toBe('scope');
    expect(categoryForArenaApiCode('ARENA_API_TAMPERED')).toBe('integrity');
    expect(categoryForArenaApiCode('ARENA_API_UNSUPPORTED_VERSION')).toBe('versioning');
  });

  it('isArenaApiErrorCode accepts members and rejects everything else', () => {
    expect(isArenaApiErrorCode('ARENA_API_INVALID_QUERY')).toBe(true);
    expect(isArenaApiErrorCode('ARENA_API_NOT_A_CODE')).toBe(false);
    expect(isArenaApiErrorCode(42)).toBe(false);
    expect(isArenaApiErrorCode(null)).toBe(false);
  });

  it('the error class carries code, category, details and correlation id', () => {
    const error = new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: 'cross-tenant read rejected',
      details: { tenant: 'globex' },
    });
    expect(error.name).toBe('ArenaApiError');
    expect(error.code).toBe('ARENA_API_CROSS_TENANT_ACCESS');
    expect(error.category).toBe('scope');
    expect(error.details).toEqual({ tenant: 'globex' });
    expect(isArenaApiError(error)).toBe(true);
    expect(isArenaApiError(new Error('plain'))).toBe(false);
  });

  it('the wire-safe struct round-trips through the strict parser', () => {
    const error = new ArenaApiError(ARENA_API_ERROR_CODES.CORRELATION_MISMATCH, {
      message: 'correlation mismatch',
      details: { expected: 'corr-1', received: 'corr-2' },
    });
    const struct = toArenaApiErrorStruct(error);
    const parsed = fromArenaApiErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('the strict parser rejects malformed structs (fail-closed)', () => {
    expect(() => fromArenaApiErrorStruct(null)).toThrow(ArenaApiError);
    expect(() => fromArenaApiErrorStruct('nope')).toThrow(ArenaApiError);
    expect(() => fromArenaApiErrorStruct([])).toThrow(ArenaApiError);
    expect(() => fromArenaApiErrorStruct({ code: 'ARENA_API_NOT_A_CODE' })).toThrow(ArenaApiError);
    expect(() =>
      fromArenaApiErrorStruct({
        code: 'ARENA_API_INVALID_QUERY',
        category: 'integrity',
        message: 'wrong category',
      }),
    ).toThrow(ArenaApiError);
    expect(() =>
      fromArenaApiErrorStruct({
        code: 'ARENA_API_INVALID_QUERY',
        category: 'validation',
        message: '',
      }),
    ).toThrow(ArenaApiError);
    const withBadCorrelation = {
      code: 'ARENA_API_INVALID_QUERY',
      category: 'validation',
      message: 'ok',
      correlationId: 'not a correlation id at all!',
    };
    expect(() => fromArenaApiErrorStruct(withBadCorrelation)).toThrow(ArenaApiError);
  });

  it('normalizeToArenaApiError wraps unknown throwables, passes ArenaApiError through', () => {
    const original = new ArenaApiError(ARENA_API_ERROR_CODES.TAMPERED, { message: 'kept' });
    expect(normalizeToArenaApiError(original)).toBe(original);
    const wrapped = normalizeToArenaApiError(new Error('boom'));
    expect(wrapped.code).toBe('ARENA_API_UNKNOWN_ERROR');
    expect(wrapped.message).toBe('boom');
    expect(normalizeToArenaApiError('string error').message).toBe('string error');
  });
});
