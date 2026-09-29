/**
 * Artifact-service error taxonomy tests (Work Order A014): closed codes,
 * category mapping, structured wire form round-trip and the strictly
 * validating parser (adversarial inputs are REJECTED, not normalized).
 */

import { describe, expect, it } from 'vitest';
import {
  ARTIFACTS_ERROR_CATEGORIES,
  ARTIFACTS_ERROR_CODES,
  ArtifactsError,
  categoryForArtifactsCode,
  fromArtifactsErrorStruct,
  isArtifactsError,
  isArtifactsErrorCode,
  normalizeToArtifactsError,
  toArtifactsErrorStruct,
} from './errors.js';

describe('artifact-service error taxonomy', () => {
  it('the code set is small, closed and prefixed (A02x codes are reused from A002)', () => {
    const codes = Object.values(ARTIFACTS_ERROR_CODES);
    expect(codes).toHaveLength(3);
    expect(codes).toContain('ARTIFACTS_TENANT_FORBIDDEN');
    expect(codes).toContain('ARTIFACTS_NOT_FOUND');
    expect(codes).toContain('ARTIFACTS_UNKNOWN_ERROR');
    for (const code of codes) {
      expect(code.startsWith('ARTIFACTS_')).toBe(true);
    }
  });

  it('every code maps onto the core category vocabulary', () => {
    expect([...ARTIFACTS_ERROR_CATEGORIES]).toEqual([
      'validation',
      'encoding',
      'versioning',
      'integrity',
      'unknown',
    ]);
    for (const code of Object.values(ARTIFACTS_ERROR_CODES)) {
      expect(ARTIFACTS_ERROR_CATEGORIES).toContain(categoryForArtifactsCode(code));
    }
  });

  it('isArtifactsErrorCode accepts known codes and rejects everything else', () => {
    expect(isArtifactsErrorCode('ARTIFACTS_TENANT_FORBIDDEN')).toBe(true);
    expect(isArtifactsErrorCode('ARTIFACTS_FABRICATED')).toBe(false);
    expect(isArtifactsErrorCode(7)).toBe(false);
    expect(isArtifactsErrorCode(null)).toBe(false);
  });

  it('constructs, structures and round-trips an ArtifactsError', () => {
    const error = new ArtifactsError(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN, {
      message: 'caller tenant tenant-b cannot read namespace tenant-a',
      details: { callerTenant: 'tenant-b', artifactNamespace: 'tenant-a' },
    });
    expect(error.name).toBe('ArtifactsError');
    expect(error.category).toBe('validation');
    expect(isArtifactsError(error)).toBe(true);
    expect(isArtifactsError(new Error('plain'))).toBe(false);

    const struct = toArtifactsErrorStruct(error);
    expect(struct.code).toBe('ARTIFACTS_TENANT_FORBIDDEN');
    const parsed = fromArtifactsErrorStruct(struct);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('the parser REJECTS malformed structures (fail closed, adversarial)', () => {
    const bad = (value: unknown) => {
      expect(() => fromArtifactsErrorStruct(value)).toThrow(ArtifactsError);
    };
    bad(null);
    bad('ARTIFACTS_NOT_FOUND');
    bad(42);
    bad([]);
    bad({});
    bad({ code: 'ARTIFACTS_NOT_FOUND', category: 'integrity', message: 'x' }); // category mismatch
    bad({ code: 'ARTIFACTS_NOT_FOUND', category: 'validation' }); // missing message
    bad({ code: 'ARTIFACTS_NOT_FOUND', category: 'validation', message: '' });
    bad({ code: 'ARTIFACTS_UNKNOWN', category: 'unknown', message: 'x' }); // unknown code
    bad({
      code: 'ARTIFACTS_NOT_FOUND',
      category: 'validation',
      message: 'x',
      details: 'not-an-object',
    });
  });

  it('normalizeToArtifactsError wraps foreign throwables', () => {
    expect(normalizeToArtifactsError(new Error('boom')).code).toBe(
      ARTIFACTS_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToArtifactsError(9).message).toBe('9');
    const already = new ArtifactsError(ARTIFACTS_ERROR_CODES.NOT_FOUND, {
      message: 'missing',
    });
    expect(normalizeToArtifactsError(already)).toBe(already);
  });
});
