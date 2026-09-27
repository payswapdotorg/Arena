/**
 * Timestamps for capability-graph records (Work Order A004).
 *
 * Every recorded timestamp is UTC ISO-8601 with EXACTLY millisecond
 * precision and an explicit `Z` designator (e.g. `2026-09-26T12:34:56.789Z`).
 * Validation is explicit and two-layered, mirroring
 * @arena/artifact-protocol's timestamp module (pattern + calendar
 * round-trip). Duplicated locally because this package's only runtime
 * dependency is @arena/protocol-core; pattern parity with the other domain
 * packages is asserted by the generated contracts and the parity suite.
 */

import type { Brand } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';

export type CapabilityTimestamp = Brand<string, 'CapabilityTimestamp'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CAPABILITY_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const TIMESTAMP_PATTERN = new RegExp(CAPABILITY_TIMESTAMP_PATTERN_SOURCE);

export function isCapabilityTimestamp(
  value: unknown,
): value is CapabilityTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Validate and brand a UTC millisecond-precision timestamp; throws otherwise. */
export function toCapabilityTimestamp(value: string): CapabilityTimestamp {
  if (!isCapabilityTimestamp(value)) {
    throw new CapabilityGraphError(
      CAPABILITY_GRAPH_ERROR_CODES.INVALID_TIMESTAMP,
      {
        message: `invalid capability-graph timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-26T12:34:56.789Z)`,
        details: { pattern: CAPABILITY_TIMESTAMP_PATTERN_SOURCE },
      },
    );
  }
  return value;
}

/** Current time as a canonical CapabilityTimestamp. */
export function nowCapabilityTimestamp(): CapabilityTimestamp {
  return new Date().toISOString() as CapabilityTimestamp;
}
