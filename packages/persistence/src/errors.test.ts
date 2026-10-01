import { describe, expect, it } from 'vitest';
import {
  PERSISTENCE_ERROR_CODES,
  PersistenceError,
  categoryForPersistenceCode,
  fromPersistenceErrorStruct,
  isPersistenceError,
  normalizeToPersistenceError,
  toPersistenceErrorStruct,
} from './index.js';

describe('persistence error taxonomy', () => {
  it('codes map onto the closed category vocabulary', () => {
    expect(categoryForPersistenceCode('PERSISTENCE_RECORD_EXISTS')).toBe('conflict');
    expect(categoryForPersistenceCode('PERSISTENCE_CAPACITY_EXHAUSTED')).toBe('capacity');
    expect(categoryForPersistenceCode('PERSISTENCE_CAPACITY_DISABLED')).toBe('capacity');
    expect(categoryForPersistenceCode('PERSISTENCE_TRANSPORT_FAILED')).toBe('unavailable');
    expect(categoryForPersistenceCode('PERSISTENCE_UNKNOWN_ERROR')).toBe('unknown');
  });

  it('round-trips a structured error', () => {
    const error = new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
      message: 'record exists',
      details: { recordId: 'r-1' },
    });
    const struct = toPersistenceErrorStruct(error);
    expect(struct.code).toBe('PERSISTENCE_RECORD_EXISTS');
    expect(struct.category).toBe('conflict');
    const parsed = fromPersistenceErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual({ recordId: 'r-1' });
  });

  it('the strict parser rejects unknown codes, category mismatches and junk (fail closed)', () => {
    expect(() =>
      fromPersistenceErrorStruct({
        code: 'PERSISTENCE_NOT_A_CODE',
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(PersistenceError);
    expect(() =>
      fromPersistenceErrorStruct({
        code: 'PERSISTENCE_RECORD_EXISTS',
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(PersistenceError);
    expect(() => fromPersistenceErrorStruct('nope')).toThrow(PersistenceError);
    expect(() => fromPersistenceErrorStruct(null)).toThrow(PersistenceError);
    expect(() =>
      fromPersistenceErrorStruct({ code: 'PERSISTENCE_RECORD_EXISTS', category: 'conflict' }),
    ).toThrow(PersistenceError);
  });

  it('normalizes arbitrary thrown values', () => {
    expect(isPersistenceError(normalizeToPersistenceError(new Error('boom')))).toBe(true);
    expect(isPersistenceError(normalizeToPersistenceError('raw string'))).toBe(true);
    expect(
      normalizeToPersistenceError(
        new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, { message: 'c' }),
      ).code,
    ).toBe('PERSISTENCE_REVISION_CONFLICT');
  });

  it('carries no fallback-shaped code in the closed vocabulary (FT2.0)', () => {
    const codes = Object.values(PERSISTENCE_ERROR_CODES) as string[];
    for (const forbidden of ['FALLBACK', 'UPGRADE', 'ALTERNATE', 'PAID', 'RETRY_WITH']) {
      expect(
        codes.filter((code) => code.includes(forbidden)),
        `no code may contain ${forbidden}`,
      ).toEqual([]);
    }
  });
});
