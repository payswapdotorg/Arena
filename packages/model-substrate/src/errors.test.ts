/**
 * Error taxonomy tests: closed codes, categories, structured wire form,
 * strictly validating parser (unknown codes rejected), normalization.
 */

import { describe, expect, it } from 'vitest';
import {
  MODEL_SUBSTRATE_ERROR_CATEGORIES,
  MODEL_SUBSTRATE_ERROR_CODES,
  ModelSubstrateError,
  categoryForModelSubstrateCode,
  fromModelSubstrateErrorStruct,
  isModelSubstrateError,
  isModelSubstrateErrorCode,
  normalizeToModelSubstrateError,
  toModelSubstrateErrorStruct,
} from './errors.js';

describe('ModelSubstrateError (positive)', () => {
  it('carries code, category, message and optional details/correlationId', () => {
    const error = new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_SUBSTRATE, {
      message: 'bad substrate',
      details: { field: 'modelId' },
    });
    expect(error.code).toBe('MODEL_SUBSTRATE_INVALID_SUBSTRATE');
    expect(error.category).toBe('validation');
    expect(error.message).toBe('bad substrate');
    expect(error.details).toEqual({ field: 'modelId' });
    expect(error.name).toBe('ModelSubstrateError');
    expect(isModelSubstrateError(error)).toBe(true);
  });

  it('every code maps to a known category', () => {
    for (const code of Object.values(MODEL_SUBSTRATE_ERROR_CODES)) {
      expect(MODEL_SUBSTRATE_ERROR_CATEGORIES).toContain(categoryForModelSubstrateCode(code));
    }
    // Integrity-class codes exist (conflicts, tamper) and versioning too.
    expect(categoryForModelSubstrateCode(MODEL_SUBSTRATE_ERROR_CODES.REGISTRY_CONFLICT)).toBe(
      'integrity',
    );
    expect(categoryForModelSubstrateCode(MODEL_SUBSTRATE_ERROR_CODES.TAMPERED)).toBe('integrity');
    expect(categoryForModelSubstrateCode(MODEL_SUBSTRATE_ERROR_CODES.UNSUPPORTED_VERSION)).toBe(
      'versioning',
    );
  });

  it('structured form round-trips through the validating parser', () => {
    const error = new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.REGISTRY_CONFLICT, {
      message: 'conflict',
      details: { substrateId: 'sub-1' },
    });
    const struct = toModelSubstrateErrorStruct(error);
    const parsed = fromModelSubstrateErrorStruct(JSON.parse(JSON.stringify(struct)));
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('normalizeToModelSubstrateError wraps foreign errors', () => {
    expect(normalizeToModelSubstrateError(new Error('boom')).code).toBe(
      MODEL_SUBSTRATE_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToModelSubstrateError('raw string').message).toBe('raw string');
    const kept = new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.TAMPERED, {
      message: 'keep',
    });
    expect(normalizeToModelSubstrateError(kept)).toBe(kept);
  });
});

describe('ModelSubstrateError (negative — parser fails closed)', () => {
  const good = {
    code: 'MODEL_SUBSTRATE_INVALID_SUBSTRATE',
    category: 'validation',
    message: 'm',
  };

  it('rejects non-objects and arrays', () => {
    for (const bad of [null, undefined, 42, 'x', [], [good]]) {
      expect(() => fromModelSubstrateErrorStruct(bad)).toThrow(ModelSubstrateError);
    }
  });

  it('rejects unknown or missing codes', () => {
    expect(() => fromModelSubstrateErrorStruct({ ...good, code: 'MODEL_SUBSTRATE_MADE_UP' })).toThrow(
      /unknown or missing model substrate error code/,
    );
    expect(() => fromModelSubstrateErrorStruct({ ...good, code: undefined })).toThrow(
      /unknown or missing/,
    );
  });

  it('rejects category/code mismatch', () => {
    expect(() => fromModelSubstrateErrorStruct({ ...good, category: 'integrity' })).toThrow(
      /does not match code/,
    );
  });

  it('rejects empty/missing messages and malformed optional fields', () => {
    expect(() => fromModelSubstrateErrorStruct({ ...good, message: '' })).toThrow(/message/);
    expect(() => fromModelSubstrateErrorStruct({ ...good, details: 'not-an-object' })).toThrow(
      /details/,
    );
    expect(() =>
      fromModelSubstrateErrorStruct({ ...good, correlationId: 'not a valid id!!' }),
    ).toThrow(/correlationId/);
  });

  it('isModelSubstrateErrorCode rejects unknown strings', () => {
    expect(isModelSubstrateErrorCode('MODEL_SUBSTRATE_MADE_UP')).toBe(false);
    expect(isModelSubstrateErrorCode(undefined)).toBe(false);
    expect(isModelSubstrateErrorCode(MODEL_SUBSTRATE_ERROR_CODES.TAMPERED)).toBe(true);
  });
});
