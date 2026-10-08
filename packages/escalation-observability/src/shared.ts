/**
 * Shared primitives of @arena/escalation-observability (Work Order C021;
 * issue #127). PROJECTIONS ONLY — nothing here can mutate domain state
 * (spec/service-boundaries.md: the read side owns no domain truth).
 *
 *   - typed, validated projection timestamps (ISO 8601 ms-precision UTC
 *     strings, exactly like the C001 escalation timestamps);
 *   - a tenant-scope guard shared by every projection entry point
 *     (lock rule 11: tenant isolation at the domain level);
 *   - the SMALL-SAMPLE threshold used by SLO rollups and aggregate
 *     endpoints (explicit suppression, never silent blending);
 *   - deepFreeze (the house discipline — every projection record is
 *     frozen at construction).
 */

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';

/** Wire version of the projection records. */
export const ESCALATION_OBSERVABILITY_WIRE_VERSION = 1 as const;

/** Tenant scope: the C001 tenant pattern (^[a-z][a-z0-9-]{1,62}$). */
export const TENANT_SCOPE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
const TENANT_SCOPE_PATTERN = new RegExp(TENANT_SCOPE_PATTERN_SOURCE);

/** Projection ids: obs_ + 32 hex (the C001 event-id shape, projected space). */
export const PROJECTION_ID_PATTERN_SOURCE = '^obs_[0-9a-f]{32}$';
const PROJECTION_ID_PATTERN = new RegExp(PROJECTION_ID_PATTERN_SOURCE);

/** ISO-8601 ms-precision UTC timestamp (the C001 timestamp shape). */
export const PROJECTION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const PROJECTION_TIMESTAMP_PATTERN = new RegExp(PROJECTION_TIMESTAMP_PATTERN_SOURCE);

/** A projection timestamp (ISO string; validated, never a Date on the wire). */
export type ProjectionTimestamp = string;

export function isProjectionTimestamp(value: unknown): value is ProjectionTimestamp {
  return (
    typeof value === 'string' &&
    PROJECTION_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Coerce an injected time (epoch ms / ISO / Date) into a projection timestamp. */
export function toProjectionTimestamp(
  input: number | string | Date,
  field = 'timestamp',
): ProjectionTimestamp {
  let iso: string;
  if (input instanceof Date) {
    iso = input.toISOString();
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new TypeError(`${field}: epoch milliseconds must be finite`);
    }
    iso = new Date(input).toISOString();
  } else {
    if (!PROJECTION_TIMESTAMP_PATTERN.test(input) && !input.endsWith('Z')) {
      throw new TypeError(`${field}: projection timestamps are UTC ISO strings: ${JSON.stringify(input)}`);
    }
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      throw new TypeError(`${field}: unparseable timestamp: ${JSON.stringify(input)}`);
    }
    iso = new Date(parsed).toISOString();
  }
  return iso.replace(/\.(\d{3})\d*Z$/, '.$1Z');
}

/** Validate a tenant scope (fail-closed, typed through the error factory). */
export function toTenantScope(value: string, field = 'tenant'): string {
  if (typeof value !== 'string' || !TENANT_SCOPE_PATTERN.test(value)) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_TENANT,
      {
        message: `${field} requires a scope matching ${TENANT_SCOPE_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
        details: { field },
      },
    );
  }
  return value;
}

/** Validate a projection id (obs_ + 32 hex). */
export function isProjectionId(value: unknown): value is string {
  return typeof value === 'string' && PROJECTION_ID_PATTERN.test(value);
}

/**
 * The DEFAULT small-sample threshold for SLO rollups: a dimensional cell
 * with fewer than 5 contributing escalations is explicitly small-sample
 * (verdict carries the status; aggregate endpoints SUPPRESS the detail
 * instead of blending it in). DERIVED default (no dedicated SLA-operations
 * spec — architecture question in the PR).
 */
export const DEFAULT_SMALL_SAMPLE_MIN = 5 as const;

/** Deterministic ordering helper: sort by (occurredAt, sequence). */
export function byOccurrenceThenSequence<T extends { occurredAt: string; sequence: number }>(
  a: T,
  b: T,
): number {
  const at = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  return at !== 0 ? at : a.sequence - b.sequence;
}

/** Recursively freeze a projection record (the house discipline). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    if (Object.isFrozen(value)) return value;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** A closed-vocabulary membership guard. */
export function isEnumMember<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}
