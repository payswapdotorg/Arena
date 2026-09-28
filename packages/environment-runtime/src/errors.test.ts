/**
 * Error taxonomy tests (Work Order A010 gate 15): closed codes, category
 * mapping, structured wire form round-trip, STRICT parser negatives,
 * normalization.
 */

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_RUNTIME_ERROR_CATEGORIES,
  ENVIRONMENT_RUNTIME_ERROR_CODES,
  EnvironmentRuntimeError,
  categoryForEnvironmentRuntimeCode,
  fromEnvironmentRuntimeErrorStruct,
  isEnvironmentRuntimeError,
  normalizeToEnvironmentRuntimeError,
  toEnvironmentRuntimeErrorStruct,
} from './errors.js';

describe('EnvironmentRuntimeError taxonomy', () => {
  it('has a closed code set with a category for every code (positive)', () => {
    const codes = Object.values(ENVIRONMENT_RUNTIME_ERROR_CODES);
    expect(codes.length).toBeGreaterThan(20);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(ENVIRONMENT_RUNTIME_ERROR_CATEGORIES).toContain(
        categoryForEnvironmentRuntimeCode(code),
      );
    }
  });

  it('carries the offending from/to states on ILLEGAL_TRANSITION (gate 3)', () => {
    const error = new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION,
      {
        message: 'illegal run lifecycle transition',
        details: { from: 'running', to: 'provisioning', event: 'provision-started' },
      },
    );
    expect(error.category).toBe('validation');
    expect(toEnvironmentRuntimeErrorStruct(error).details).toEqual({
      from: 'running',
      to: 'provisioning',
      event: 'provision-started',
    });
  });

  it('round-trips through the structured wire form (positive)', () => {
    const error = new EnvironmentRuntimeError(
      ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED,
      { message: 'over quota', details: { violations: ['cpu'] } },
    );
    const parsed = fromEnvironmentRuntimeErrorStruct(toEnvironmentRuntimeErrorStruct(error));
    expect(parsed.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED);
    expect(parsed.message).toBe('over quota');
    expect(parsed.details).toEqual({ violations: ['cpu'] });
  });

  it('rejects malformed structured errors (negative)', () => {
    expect(() => fromEnvironmentRuntimeErrorStruct(null)).toThrow(EnvironmentRuntimeError);
    expect(() => fromEnvironmentRuntimeErrorStruct('nope')).toThrow(EnvironmentRuntimeError);
    expect(() =>
      fromEnvironmentRuntimeErrorStruct({ code: 'NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      fromEnvironmentRuntimeErrorStruct({
        code: ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED,
        category: 'validation', // wrong category for this code
        message: 'x',
      }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      fromEnvironmentRuntimeErrorStruct({
        code: ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED,
        category: 'integrity',
        message: '',
      }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      fromEnvironmentRuntimeErrorStruct({
        code: ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED,
        category: 'integrity',
        message: 'x',
        details: 'not-an-object',
      }),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('normalizes unknown thrown values (positive)', () => {
    expect(
      normalizeToEnvironmentRuntimeError(new Error('boom')).code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToEnvironmentRuntimeError('plain').message).toBe('plain');
    const kept = new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.TAMPERED, {
      message: 'kept',
    });
    expect(normalizeToEnvironmentRuntimeError(kept)).toBe(kept);
    expect(isEnvironmentRuntimeError(kept)).toBe(true);
    expect(isEnvironmentRuntimeError(new Error('x'))).toBe(false);
  });
});
