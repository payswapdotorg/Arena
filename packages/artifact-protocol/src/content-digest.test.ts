import { describe, expect, it } from 'vitest';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  isContentDigest,
  toContentDigest,
} from './content-digest.js';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import {
  ARTIFACT_TIMESTAMP_PATTERN_SOURCE,
  isTimestamp,
  nowTimestamp,
  timestampToDate,
  toTimestamp,
} from './timestamp.js';

describe('ContentDigest (positive)', () => {
  it('accepts lowercase sha256 hex digests', () => {
    const digest = 'a'.repeat(64);
    expect(toContentDigest(digest)).toBe(digest);
    expect(isContentDigest('0123456789abcdef'.repeat(4))).toBe(true);
  });
});

describe('ContentDigest (negative)', () => {
  it('rejects malformed digests', () => {
    for (const bad of ['', 'ZZZ', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 42, null]) {
      expect(() => toContentDigest(bad as string)).toThrow(ArtifactError);
    }
    expect(isContentDigest('g'.repeat(64))).toBe(false);
    try {
      toContentDigest('xyz');
    } catch (error) {
      expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.INVALID_DIGEST);
    }
  });

  it('pattern source anchors contract parity', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
  });
});

describe('Timestamp (positive)', () => {
  it('accepts UTC millisecond-precision timestamps', () => {
    const value = '2026-09-26T12:34:56.789Z';
    expect(toTimestamp(value)).toBe(value);
    expect(isTimestamp(value)).toBe(true);
    expect(timestampToDate(toTimestamp(value)).toISOString()).toBe(value);
  });

  it('produces canonical now timestamps', () => {
    const now = nowTimestamp();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(isTimestamp(now)).toBe(true);
  });
});

describe('Timestamp (negative — explicit validation)', () => {
  it('rejects non-millisecond precision', () => {
    expect(isTimestamp('2026-09-26T12:34:56Z')).toBe(false);
    expect(isTimestamp('2026-09-26T12:34:56.7Z')).toBe(false);
    expect(isTimestamp('2026-09-26T12:34:56.7891Z')).toBe(false);
    expect(() => toTimestamp('2026-09-26T12:34:56Z')).toThrow(ArtifactError);
  });

  it('rejects non-UTC offsets', () => {
    expect(isTimestamp('2026-09-26T12:34:56.789+02:00')).toBe(false);
    expect(isTimestamp('2026-09-26T12:34:56.789-05:00')).toBe(false);
    expect(() => toTimestamp('2026-09-26T12:34:56.789+02:00')).toThrow(ArtifactError);
  });

  it('rejects calendar-invalid and malformed values', () => {
    for (const bad of [
      '2026-13-01T00:00:00.000Z',
      '2026-02-30T00:00:00.000Z',
      '2026-09-26T24:00:00.000Z',
      '2026-09-26T12:60:00.000Z',
      'not-a-date',
      '',
      42,
      null,
    ]) {
      expect(isTimestamp(bad)).toBe(false);
      expect(() => toTimestamp(bad as string)).toThrow(ArtifactError);
    }
    try {
      toTimestamp('2026-02-30T00:00:00.000Z');
    } catch (error) {
      expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.INVALID_TIMESTAMP);
    }
  });

  it('pattern source anchors contract parity', () => {
    expect(ARTIFACT_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
  });
});
