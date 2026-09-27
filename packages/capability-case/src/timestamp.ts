/**
 * Timestamps for capability-case records (Work Order A005).
 *
 * Every recorded timestamp is UTC ISO-8601 with EXACTLY millisecond
 * precision and an explicit `Z` designator (e.g. `2026-09-28T12:34:56.789Z`).
 * Validation is explicit and two-layered, mirroring the sibling domain
 * packages' timestamp modules (pattern + calendar round-trip). Duplicated
 * locally because this package's only runtime dependency is
 * @arena/protocol-core; pattern parity is asserted by the generated
 * contracts and the parity suite.
 */

import type { Brand } from '@arena/protocol-core';
import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';

export type CapabilityCaseTimestamp = Brand<string, 'CapabilityCaseTimestamp'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const TIMESTAMP_PATTERN = new RegExp(CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE);

export function isCapabilityCaseTimestamp(
  value: unknown,
): value is CapabilityCaseTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Validate and brand a UTC millisecond-precision timestamp; throws
 * INVALID_TIMESTAMP otherwise.
 */
export function toCapabilityCaseTimestamp(value: string): CapabilityCaseTimestamp {
  if (!isCapabilityCaseTimestamp(value)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid capability-case timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-28T12:34:56.789Z)`,
      details: { pattern: CAPABILITY_CASE_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical CapabilityCaseTimestamp. */
export function nowCapabilityCaseTimestamp(): CapabilityCaseTimestamp {
  return new Date().toISOString() as CapabilityCaseTimestamp;
}
