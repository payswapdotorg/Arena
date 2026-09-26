import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_ERROR_CATEGORIES,
  ARTIFACT_ERROR_CODES,
  ArtifactError,
  categoryForArtifactCode,
  fromArtifactErrorStruct,
  isArtifactError,
  isArtifactErrorCode,
  normalizeToArtifactError,
  toArtifactErrorStruct,
} from './errors.js';
import { toCorrelationId } from '@arena/protocol-core';

describe('ArtifactError taxonomy (positive)', () => {
  it('exposes a closed code set with consistent categories', () => {
    for (const code of Object.values(ARTIFACT_ERROR_CODES)) {
      expect(isArtifactErrorCode(code)).toBe(true);
      expect(ARTIFACT_ERROR_CATEGORIES).toContain(categoryForArtifactCode(code));
    }
    expect(isArtifactErrorCode('ARTIFACT_MADE_UP')).toBe(false);
    expect(isArtifactErrorCode('PROTOCOL_INVALID_JSON')).toBe(false);
  });

  it('round-trips the structured wire form', () => {
    const error = new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
      message: 'artifact digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
      correlationId: toCorrelationId('flow-1'),
    });
    const struct = toArtifactErrorStruct(error);
    expect(struct).toEqual({
      code: 'ARTIFACT_TAMPERED',
      category: 'integrity',
      message: 'artifact digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
      correlationId: 'flow-1',
    });
    const parsed = fromArtifactErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.correlationId).toBe(error.correlationId);
  });

  it('normalizes unknown throwables', () => {
    expect(normalizeToArtifactError(new Error('boom')).code).toBe(
      ARTIFACT_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToArtifactError('plain string').code).toBe(
      ARTIFACT_ERROR_CODES.UNKNOWN_ERROR,
    );
    const artifact = new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: 'x',
    });
    expect(normalizeToArtifactError(artifact)).toBe(artifact);
  });

  it('isArtifactError distinguishes ArtifactError from other errors', () => {
    const artifact = new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, { message: 'x' });
    expect(isArtifactError(artifact)).toBe(true);
    expect(isArtifactError(new Error('x'))).toBe(false);
    expect(artifact instanceof Error).toBe(true);
  });
});

describe('ArtifactError taxonomy (negative — parsing fails closed)', () => {
  const malformed: unknown[] = [
    'not-an-object',
    null,
    42,
    [],
    { code: 'ARTIFACT_MADE_UP', category: 'validation', message: 'x' },
    { code: 'ARTIFACT_TAMPERED', category: 'validation', message: 'x' },
    { code: 'ARTIFACT_TAMPERED', category: 'integrity' },
    { code: 'ARTIFACT_TAMPERED', category: 'integrity', message: '' },
    {
      code: 'ARTIFACT_TAMPERED',
      category: 'integrity',
      message: 'x',
      details: 'not-an-object',
    },
    {
      code: 'ARTIFACT_TAMPERED',
      category: 'integrity',
      message: 'x',
      correlationId: 'not a valid correlation id!',
    },
  ];

  it('rejects malformed structured errors with ARTIFACT_UNKNOWN_ERROR', () => {
    for (const bad of malformed) {
      try {
        fromArtifactErrorStruct(bad);
        expect.unreachable(`expected rejection for ${JSON.stringify(bad)}`);
      } catch (error) {
        expect(isArtifactError(error)).toBe(true);
        expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.UNKNOWN_ERROR);
      }
    }
  });
});
