/**
 * Timestamps for expert-registry records (Work Order A006).
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
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';

export type ExpertRegistryTimestamp = Brand<string, 'ExpertRegistryTimestamp'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const EXPERT_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

const TIMESTAMP_PATTERN = new RegExp(EXPERT_TIMESTAMP_PATTERN_SOURCE);

export function isExpertRegistryTimestamp(
  value: unknown,
): value is ExpertRegistryTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Validate and brand a UTC millisecond-precision timestamp; throws
 * INVALID_TIMESTAMP otherwise.
 */
export function toExpertRegistryTimestamp(value: string): ExpertRegistryTimestamp {
  if (!isExpertRegistryTimestamp(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid expert-registry timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-28T12:34:56.789Z)`,
      details: { pattern: EXPERT_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical ExpertRegistryTimestamp. */
export function nowExpertRegistryTimestamp(): ExpertRegistryTimestamp {
  return new Date().toISOString() as ExpertRegistryTimestamp;
}
