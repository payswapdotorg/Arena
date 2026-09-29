/**
 * Error taxonomy tests (Work Order A024) — closed codes, category
 * mapping, structured wire-safe round trip, strict parser.
 */

import { describe, expect, it } from 'vitest';
import {
  BODY_REGISTRY_ERROR_CATEGORIES,
  BODY_REGISTRY_ERROR_CODES,
  BodyRegistryError,
  categoryForBodyRegistryCode,
  fromBodyRegistryErrorStruct,
  isBodyRegistryError,
  isBodyRegistryErrorCode,
  normalizeToBodyRegistryError,
  toBodyRegistryErrorStruct,
} from './errors.js';

describe('body-registry error taxonomy', () => {
  it('the code vocabulary is closed and frozen', () => {
    expect(Object.isFrozen(BODY_REGISTRY_ERROR_CODES)).toBe(true);
    expect(Object.values(BODY_REGISTRY_ERROR_CODES).length).toBeGreaterThanOrEqual(25);
    expect(BODY_REGISTRY_ERROR_CODES.REGISTRATION_REJECTED).toBe('BODY_REGISTRY_REGISTRATION_REJECTED');
    expect(BODY_REGISTRY_ERROR_CODES.TAMPERED).toBe('BODY_REGISTRY_TAMPERED');
  });

  it('every code maps to a known category', () => {
    for (const code of Object.values(BODY_REGISTRY_ERROR_CODES)) {
      expect(BODY_REGISTRY_ERROR_CATEGORIES).toContain(categoryForBodyRegistryCode(code));
    }
    expect(categoryForBodyRegistryCode(BODY_REGISTRY_ERROR_CODES.TAMPERED)).toBe('integrity');
    expect(categoryForBodyRegistryCode(BODY_REGISTRY_ERROR_CODES.INVALID_CHANNEL)).toBe('validation');
    expect(categoryForBodyRegistryErrorCodes_UNKNOWN()).toBe('unknown');
  });

  it('guards recognize codes and instances', () => {
    expect(isBodyRegistryErrorCode('BODY_REGISTRY_TAMPERED')).toBe(true);
    expect(isBodyRegistryErrorCode('BODY_FORGE_TAMPERED')).toBe(false);
    const error = new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.NOT_FOUND, {
      message: 'not found',
    });
    expect(isBodyRegistryError(error)).toBe(true);
    expect(isBodyRegistryError(new Error('x'))).toBe(false);
  });

  it('structured round trip preserves code, category, details, correlation', () => {
    const error = new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.REGISTRATION_REJECTED, {
      message: 'gate rejected the candidate',
      details: { rejections: [{ reason: 'certification-unsatisfied' }] },
      correlationId: 'corr-release-1' as never,
    });
    const struct = toBodyRegistryErrorStruct(error);
    expect(struct.code).toBe(BODY_REGISTRY_ERROR_CODES.REGISTRATION_REJECTED);
    expect(struct.category).toBe('integrity');
    const parsed = fromBodyRegistryErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.correlationId).toBe('corr-release-1');
  });

  it('the parser REJECTS malformed structs (fail closed)', () => {
    expect(() => fromBodyRegistryErrorStruct('nope')).toThrow(BodyRegistryError);
    expect(() => fromBodyRegistryErrorStruct({})).toThrow(BodyRegistryError);
    expect(() =>
      fromBodyRegistryErrorStruct({ code: 'BODY_FORGE_TAMPERED', category: 'integrity', message: 'x' }),
    ).toThrow(BodyRegistryError);
    expect(() =>
      fromBodyRegistryErrorStruct({
        code: 'BODY_REGISTRY_TAMPERED',
        category: 'validation', // wrong category for the code
        message: 'x',
      }),
    ).toThrow(BodyRegistryError);
    expect(() =>
      fromBodyRegistryErrorStruct({
        code: 'BODY_REGISTRY_TAMPERED',
        category: 'integrity',
        message: '',
      }),
    ).toThrow(BodyRegistryError);
    expect(() =>
      fromBodyRegistryErrorStruct({
        code: 'BODY_REGISTRY_TAMPERED',
        category: 'integrity',
        message: 'x',
        details: 'not-an-object',
      }),
    ).toThrow(BodyRegistryError);
  });

  it('normalize wraps foreign errors as UNKNOWN_ERROR', () => {
    const fromString = normalizeToBodyRegistryError('boom');
    expect(fromString.code).toBe(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR);
    const fromError = normalizeToBodyRegistryError(new Error('boom'));
    expect(fromError.code).toBe(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR);
    const passthrough = normalizeToBodyRegistryError(
      new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.NOT_FOUND, { message: 'x' }),
    );
    expect(passthrough.code).toBe(BODY_REGISTRY_ERROR_CODES.NOT_FOUND);
  });
});

function categoryForBodyRegistryErrorCodes_UNKNOWN(): string {
  return categoryForBodyRegistryCode(BODY_REGISTRY_ERROR_CODES.UNKNOWN_ERROR);
}
