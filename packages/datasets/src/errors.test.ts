/**
 * Dataset error taxonomy tests (Work Order A014): closed codes, category
 * mapping, structured wire form round-trip and the strictly validating
 * parser (adversarial inputs are REJECTED, not normalized).
 */

import { describe, expect, it } from 'vitest';
import {
  DATASET_ERROR_CATEGORIES,
  DATASET_ERROR_CODES,
  DatasetError,
  categoryForDatasetCode,
  fromDatasetErrorStruct,
  isDatasetError,
  isDatasetErrorCode,
  normalizeToDatasetError,
  toDatasetErrorStruct,
} from './errors.js';

describe('dataset error taxonomy', () => {
  it('the code set is closed and prefixed', () => {
    const codes = Object.values(DATASET_ERROR_CODES);
    expect(codes).toHaveLength(9);
    for (const code of codes) {
      expect(code.startsWith('DATASET_')).toBe(true);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code maps onto the core category vocabulary', () => {
    expect([...DATASET_ERROR_CATEGORIES]).toEqual([
      'validation',
      'encoding',
      'versioning',
      'integrity',
      'unknown',
    ]);
    for (const code of Object.values(DATASET_ERROR_CODES)) {
      expect(DATASET_ERROR_CATEGORIES).toContain(categoryForDatasetCode(code));
    }
  });

  it('isDatasetErrorCode accepts known codes and rejects everything else', () => {
    expect(isDatasetErrorCode('DATASET_TAMPERED')).toBe(true);
    expect(isDatasetErrorCode('DATASET_NOT_A_CODE')).toBe(false);
    expect(isDatasetErrorCode(42)).toBe(false);
    expect(isDatasetErrorCode(null)).toBe(false);
  });

  it('constructs, structures and round-trips a DatasetError', () => {
    const error = new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
      message: 'dataset manifest digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
    });
    expect(error.name).toBe('DatasetError');
    expect(error.code).toBe('DATASET_TAMPERED');
    expect(error.category).toBe('integrity');
    expect(isDatasetError(error)).toBe(true);
    expect(isDatasetError(new Error('plain'))).toBe(false);

    const struct = toDatasetErrorStruct(error);
    expect(struct.code).toBe('DATASET_TAMPERED');
    expect(struct.category).toBe('integrity');
    expect(struct.details).toEqual({ expected: 'a'.repeat(64), actual: 'b'.repeat(64) });

    const parsed = fromDatasetErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('the parser REJECTS malformed structures (fail closed, adversarial)', () => {
    const bad = (value: unknown) => {
      expect(() => fromDatasetErrorStruct(value)).toThrow(DatasetError);
    };
    bad(null);
    bad(undefined);
    bad('DATASET_TAMPERED');
    bad(42);
    bad([]);
    bad({});
    bad({ code: 'DATASET_NOT_A_CODE', category: 'integrity', message: 'x' });
    // unknown code is REJECTED, not normalized into a known one
    try {
      fromDatasetErrorStruct({ code: 'DATASET_FABRICATED', category: 'unknown', message: 'x' });
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.UNKNOWN_ERROR);
    }
    // category/code mismatch is rejected
    bad({ code: 'DATASET_TAMPERED', category: 'validation', message: 'x' });
    // missing/empty message is rejected
    bad({ code: 'DATASET_TAMPERED', category: 'integrity' });
    bad({ code: 'DATASET_TAMPERED', category: 'integrity', message: '' });
    // malformed optional fields are rejected
    bad({ code: 'DATASET_TAMPERED', category: 'integrity', message: 'x', details: 'nope' });
    bad({ code: 'DATASET_TAMPERED', category: 'integrity', message: 'x', details: [] });
    bad({
      code: 'DATASET_TAMPERED',
      category: 'integrity',
      message: 'x',
      correlationId: 'spaces are not valid correlation ids',
    });
  });

  it('normalizeToDatasetError wraps foreign throwables', () => {
    expect(
      normalizeToDatasetError(new Error('boom')).code,
    ).toBe(DATASET_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToDatasetError('raw string').message).toBe('raw string');
    const already = new DatasetError(DATASET_ERROR_CODES.UNRESOLVED_ENTRY, {
      message: 'entry missing',
    });
    expect(normalizeToDatasetError(already)).toBe(already);
  });
});
