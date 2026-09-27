/**
 * Timestamp suite (Work Order A005 gate 11): pattern + calendar round-trip
 * validation, positive and negative.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE,
  isCapabilityCaseTimestamp,
  nowCapabilityCaseTimestamp,
  toCapabilityCaseTimestamp,
} from './timestamp.js';
import { CapabilityCaseError } from './errors.js';

describe('CapabilityCaseTimestamp (positive)', () => {
  it('accepts UTC millisecond-precision timestamps', () => {
    expect(isCapabilityCaseTimestamp('2026-09-28T10:00:00.000Z')).toBe(true);
    expect(isCapabilityCaseTimestamp('2026-12-31T23:59:59.999Z')).toBe(true);
    expect(toCapabilityCaseTimestamp('2026-09-28T10:00:00.000Z')).toBe(
      '2026-09-28T10:00:00.000Z',
    );
  });

  it('now() produces a canonical timestamp', () => {
    const now = nowCapabilityCaseTimestamp();
    expect(isCapabilityCaseTimestamp(now)).toBe(true);
  });

  it('the pattern source is the canonical one (parity with siblings)', () => {
    expect(CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
  });
});

describe('CapabilityCaseTimestamp (negative)', () => {
  it('rejects second precision, offsets and impossible dates', () => {
    expect(isCapabilityCaseTimestamp('2026-09-28T10:00:00Z')).toBe(false); // no ms
    expect(isCapabilityCaseTimestamp('2026-09-28T10:00:00.000+00:00')).toBe(false); // offset
    expect(isCapabilityCaseTimestamp('2026-09-28 10:00:00.000')).toBe(false); // space, no Z
    expect(isCapabilityCaseTimestamp('2026-13-01T00:00:00.000Z')).toBe(false); // month 13
    expect(isCapabilityCaseTimestamp('2026-02-30T00:00:00.000Z')).toBe(false); // Feb 30
    expect(isCapabilityCaseTimestamp('')).toBe(false);
    expect(isCapabilityCaseTimestamp(12345)).toBe(false);
    expect(() => toCapabilityCaseTimestamp('2026-09-28T10:00:00Z')).toThrow(
      CapabilityCaseError,
    );
  });
});
