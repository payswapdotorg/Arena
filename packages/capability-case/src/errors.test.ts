/**
 * Error taxonomy suite (Work Order A005 gate 11): positive and negative
 * tests for the CapabilityCaseError surface — closed codes, category
 * mapping, struct round-trip and the strictly validating parser.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CASE_ERROR_CATEGORIES,
  CAPABILITY_CASE_ERROR_CODES,
  CapabilityCaseError,
  categoryForCapabilityCaseCode,
  fromCapabilityCaseErrorStruct,
  isCapabilityCaseError,
  isCapabilityCaseErrorCode,
  normalizeToCapabilityCaseError,
  toCapabilityCaseErrorStruct,
} from './errors.js';

describe('CapabilityCaseError (positive)', () => {
  it('carries a closed code set with stable wire values', () => {
    expect(CAPABILITY_CASE_ERROR_CODES.TERMINAL_STATE).toBe(
      'CAPABILITY_CASE_TERMINAL_STATE',
    );
    expect(CAPABILITY_CASE_ERROR_CODES.CROSS_TENANT_ACCESS).toBe(
      'CAPABILITY_CASE_CROSS_TENANT_ACCESS',
    );
    expect(CAPABILITY_CASE_ERROR_CODES.EVIDENCE_REMOVAL).toBe(
      'CAPABILITY_CASE_EVIDENCE_REMOVAL',
    );
    expect(Object.keys(CAPABILITY_CASE_ERROR_CODES).length).toBe(23);
  });

  it('every code maps to a known category', () => {
    for (const code of Object.values(CAPABILITY_CASE_ERROR_CODES)) {
      expect(CAPABILITY_CASE_ERROR_CATEGORIES).toContain(
        categoryForCapabilityCaseCode(code),
      );
    }
  });

  it('struct round-trip preserves code, category, message, details', () => {
    const error = new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION,
      {
        message: 'nope',
        details: { from: 'draft' },
      },
    );
    const struct = toCapabilityCaseErrorStruct(error);
    expect(struct.code).toBe('CAPABILITY_CASE_INVALID_TRANSITION');
    expect(struct.category).toBe('validation');
    expect(struct.message).toBe('nope');
    expect(struct.details).toEqual({ from: 'draft' });
    const parsed = fromCapabilityCaseErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(isCapabilityCaseError(parsed)).toBe(true);
  });

  it('normalizeToCapabilityCaseError wraps foreign errors', () => {
    const wrapped = normalizeToCapabilityCaseError(new Error('boom'));
    expect(wrapped.code).toBe('CAPABILITY_CASE_UNKNOWN_ERROR');
    expect(wrapped.message).toBe('boom');
    expect(normalizeToCapabilityCaseError(wrapped)).toBe(wrapped);
  });
});

describe('CapabilityCaseError (negative)', () => {
  it('isCaseCapabilityCaseErrorCode rejects unknown codes', () => {
    expect(isCapabilityCaseErrorCode('NOT_A_CODE')).toBe(false);
    expect(isCapabilityCaseErrorCode(42)).toBe(false);
    expect(isCapabilityCaseErrorCode(undefined)).toBe(false);
  });

  it('the struct parser rejects malformed structs (fail closed)', () => {
    expect(() => fromCapabilityCaseErrorStruct(null)).toThrow(
      CapabilityCaseError,
    );
    expect(() => fromCapabilityCaseErrorStruct([])).toThrow(CapabilityCaseError);
    expect(() => fromCapabilityCaseErrorStruct({})).toThrow(CapabilityCaseError);
    expect(() =>
      fromCapabilityCaseErrorStruct({
        code: 'CAPABILITY_CASE_NOT_A_CODE',
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(/unknown or missing capability-case error code/);
    expect(() =>
      fromCapabilityCaseErrorStruct({
        code: 'CAPABILITY_CASE_INVALID_CASE',
        category: 'integrity', // WRONG category for this code
        message: 'x',
      }),
    ).toThrow(/does not match code/);
    expect(() =>
      fromCapabilityCaseErrorStruct({
        code: 'CAPABILITY_CASE_INVALID_CASE',
        category: 'validation',
        message: '',
      }),
    ).toThrow(/non-empty string/);
    expect(() =>
      fromCapabilityCaseErrorStruct({
        code: 'CAPABILITY_CASE_INVALID_CASE',
        category: 'validation',
        message: 'x',
        details: 'not-an-object',
      }),
    ).toThrow(/plain object/);
  });
});
