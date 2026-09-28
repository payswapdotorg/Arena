/**
 * Timestamp tests (Work Order A006) — pattern + calendar round-trip,
 * positive and negative.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_TIMESTAMP_PATTERN_SOURCE,
  isExpertRegistryTimestamp,
  nowExpertRegistryTimestamp,
  toExpertRegistryTimestamp,
} from './timestamp.js';
import { ExpertRegistryError } from './errors.js';

describe('expert timestamps (positive)', () => {
  it('accepts UTC millisecond-precision timestamps', () => {
    expect(isExpertRegistryTimestamp('2026-09-28T12:34:56.789Z')).toBe(true);
    expect(toExpertRegistryTimestamp('2026-01-01T00:00:00.000Z')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('nowExpertRegistryTimestamp produces a canonical timestamp', () => {
    const now = nowExpertRegistryTimestamp();
    expect(isExpertRegistryTimestamp(now)).toBe(true);
  });

  it('exposes the pattern source for contract parity', () => {
    expect(EXPERT_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
  });
});

describe('expert timestamps (negative)', () => {
  it('rejects non-UTC, offset and wrong-precision forms', () => {
    expect(isExpertRegistryTimestamp('2026-09-28T12:34:56Z')).toBe(false);
    expect(isExpertRegistryTimestamp('2026-09-28T12:34:56.789+02:00')).toBe(false);
    expect(isExpertRegistryTimestamp('2026-09-28T12:34:56.789123Z')).toBe(false);
    expect(isExpertRegistryTimestamp('2026-13-01T00:00:00.000Z')).toBe(false);
    expect(isExpertRegistryTimestamp('not a timestamp')).toBe(false);
    expect(() => toExpertRegistryTimestamp('2026-09-28T12:34:56Z')).toThrow(
      ExpertRegistryError,
    );
  });

  it('rejects non-strings', () => {
    expect(isExpertRegistryTimestamp(123)).toBe(false);
    expect(isExpertRegistryTimestamp(null)).toBe(false);
  });
});
