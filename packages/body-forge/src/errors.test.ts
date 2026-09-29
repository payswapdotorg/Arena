/**
 * Error-taxonomy tests (Work Order A021): closed code set, category
 * mapping, structured wire form round-trip, strict parsing (unknown
 * codes rejected), normalization.
 */

import { describe, expect, it } from 'vitest';
import type { CorrelationId } from '@arena/protocol-core';
import {
  BODY_FORGE_ERROR_CATEGORIES,
  BODY_FORGE_ERROR_CODES,
  BODY_FORGE_PROTOCOL_VERSION,
  BodyForgeError,
  SUPPORTED_BODY_FORGE_ERROR_CODES,
  categoryForBodyForgeCode,
  fromBodyForgeErrorStruct,
  isBodyForgeError,
  normalizeToBodyForgeError,
  toBodyForgeErrorStruct,
} from './index.js';
import { CORR_ID, expectSyncCode } from './test-support.js';

describe('the closed code set', () => {
  it('enumerates exactly the forge codes with stable values', () => {
    expect(SUPPORTED_BODY_FORGE_ERROR_CODES).toEqual(Object.values(BODY_FORGE_ERROR_CODES));
    expect(SUPPORTED_BODY_FORGE_ERROR_CODES).toContain('BODY_FORGE_LEARNING_PROVENANCE_REJECTED');
    expect(SUPPORTED_BODY_FORGE_ERROR_CODES).toContain('BODY_FORGE_LINEAGE_VIOLATION');
    expect(SUPPORTED_BODY_FORGE_ERROR_CODES).toHaveLength(21);
    expect(BODY_FORGE_PROTOCOL_VERSION).toBe('1.0.0');
  });

  it('every code maps into the closed category set', () => {
    expect(BODY_FORGE_ERROR_CATEGORIES).toEqual(['validation', 'encoding', 'versioning', 'integrity', 'unknown']);
    for (const code of Object.values(BODY_FORGE_ERROR_CODES)) {
      expect(BODY_FORGE_ERROR_CATEGORIES).toContain(categoryForBodyForgeCode(code));
    }
    expect(categoryForBodyForgeCode(BODY_FORGE_ERROR_CODES.TAMPERED)).toBe('integrity');
    expect(categoryForBodyForgeCode(BODY_FORGE_ERROR_CODES.INVALID_MANIFEST)).toBe('validation');
    expect(categoryForBodyForgeCode(BODY_FORGE_ERROR_CODES.UNSUPPORTED_RECORD_VERSION)).toBe('versioning');
  });

  it('a hypothetical extra code would not match the closed set', () => {
    expect(SUPPORTED_BODY_FORGE_ERROR_CODES).not.toContain('BODY_FORGE_MADE_UP');
  });
});

describe('the structured wire form', () => {
  it('round-trips a structured error', () => {
    const error = new BodyForgeError(BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED, {
      message: 'silently embedded un-provenanced content',
      details: { uncited: ['arena-skills/x@1.0.0'] },
      correlationId: CORR_ID as CorrelationId,
    });
    expect(isBodyForgeError(error)).toBe(true);
    const struct = toBodyForgeErrorStruct(error);
    expect(struct.code).toBe(BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED);
    expect(struct.category).toBe('integrity');
    expect(struct.correlationId).toBe(CORR_ID);
    const parsed = fromBodyForgeErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.category).toBe(error.category);
  });

  it('REJECTS malformed structured errors (strict parsing)', () => {
    expectSyncCode(() => fromBodyForgeErrorStruct(null), BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR);
    expectSyncCode(() => fromBodyForgeErrorStruct('nope'), BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR);
    expectSyncCode(
      () => fromBodyForgeErrorStruct({ code: 'BODY_FORGE_MADE_UP', category: 'validation', message: 'x' }),
      BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR,
    );
    expectSyncCode(
      () =>
        fromBodyForgeErrorStruct({
          code: BODY_FORGE_ERROR_CODES.TAMPERED,
          category: 'validation', // mismatch
          message: 'x',
        }),
      BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR,
    );
    expectSyncCode(
      () => fromBodyForgeErrorStruct({ code: BODY_FORGE_ERROR_CODES.TAMPERED, category: 'integrity', message: '' }),
      BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR,
    );
    expectSyncCode(
      () =>
        fromBodyForgeErrorStruct({
          code: BODY_FORGE_ERROR_CODES.TAMPERED,
          category: 'integrity',
          message: 'x',
          correlationId: 'no pe',
        }),
      BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR,
    );
  });

  it('normalizes arbitrary thrown values', () => {
    expect(normalizeToBodyForgeError(new Error('boom')).code).toBe(BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToBodyForgeError(42).message).toBe('42');
    const original = new BodyForgeError(BODY_FORGE_ERROR_CODES.CONFLICT, { message: 'dup' });
    expect(normalizeToBodyForgeError(original)).toBe(original);
  });
});
