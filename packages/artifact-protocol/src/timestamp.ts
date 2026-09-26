/**
 * Timestamps for artifact protocol records (docs/architecture.md §15).
 *
 * Every recorded timestamp is UTC ISO-8601 with EXACTLY millisecond
 * precision and an explicit `Z` designator (e.g. `2026-09-26T12:34:56.789Z`).
 * Validation is explicit and two-layered:
 *   1. a strict lexical pattern (exactly 3 fractional digits, `Z` only —
 *      offsets are rejected), and
 *   2. a calendar round-trip through Date (rejecting impossible dates such
 *      as 2026-02-30 or hour 24, which the pattern alone would admit).
 */

import type { Brand } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

export type Timestamp = Brand<string, 'Timestamp'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const ARTIFACT_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const TIMESTAMP_PATTERN = new RegExp(ARTIFACT_TIMESTAMP_PATTERN_SOURCE);

export function isTimestamp(value: unknown): value is Timestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Validate and brand a UTC millisecond-precision timestamp; throws otherwise. */
export function toTimestamp(value: string): Timestamp {
  if (!isTimestamp(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid artifact timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-26T12:34:56.789Z)`,
      details: { pattern: ARTIFACT_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical Timestamp (Date#toISOString is always ms UTC). */
export function nowTimestamp(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

/** Convert a Timestamp back to a Date (the value is already validated). */
export function timestampToDate(value: Timestamp): Date {
  return new Date(value);
}
