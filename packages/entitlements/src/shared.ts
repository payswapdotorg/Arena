/**
 * Shared entitlement value types (Work Order A033; requirements R31, R34,
 * R48; architecture-lock rule 11 — customer data is tenant-scoped and never
 * silently reused across tenants).
 *
 * @arena/entitlements is a DOMAIN package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer) — never a sibling domain package.
 * Tenant ids, feature keys, grant ids and canonical timestamps are defined
 * HERE as validated branded plain-string types, exactly like
 * @arena/job-protocol's shared.ts; they are structurally compatible with the
 * corresponding security/job-protocol types (plain strings accept branded
 * strings).
 */

import type { Brand } from '@arena/protocol-core';
import { ENTITLEMENT_ERROR_CODES, EntitlementError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — the single source of truth for this package's shapes.
// ---------------------------------------------------------------------------

export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const GRANT_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
/** Dotted feature key (e.g. job.compute, evaluation.run). */
export const FEATURE_KEY_PATTERN_SOURCE =
  '^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*){0,3}$';
export const USAGE_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const ENTITLEMENT_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const METER_NOTE_PATTERN_SOURCE = '^\\S.{0,199}$';

const TENANT_ID_PATTERN = new RegExp(TENANT_ID_PATTERN_SOURCE);
const GRANT_ID_PATTERN = new RegExp(GRANT_ID_PATTERN_SOURCE);
const FEATURE_KEY_PATTERN = new RegExp(FEATURE_KEY_PATTERN_SOURCE);
const USAGE_ID_PATTERN = new RegExp(USAGE_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(ENTITLEMENT_TIMESTAMP_PATTERN_SOURCE);
const METER_NOTE_PATTERN = new RegExp(METER_NOTE_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type TenantId = Brand<string, 'EntitlementsTenantId'>;
export type GrantId = Brand<string, 'EntitlementsGrantId'>;
export type FeatureKey = Brand<string, 'EntitlementsFeatureKey'>;
export type UsageId = Brand<string, 'EntitlementsUsageId'>;
export type MeterTimestamp = Brand<string, 'EntitlementsMeterTimestamp'>;
export type MeterNote = Brand<string, 'EntitlementsMeterNote'>;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The three kinds of entitlement a grant can carry. */
export const ENTITLEMENT_GRANT_KINDS = Object.freeze([
  'feature-flag',
  'quota',
  'rate-limit',
] as const);
export type EntitlementGrantKind = (typeof ENTITLEMENT_GRANT_KINDS)[number];

/** Append-only lineage vocabulary for grant records. */
export const GRANT_LINEAGE_KINDS = Object.freeze(['granted', 'amended', 'revoked'] as const);
export type GrantLineageKind = (typeof GRANT_LINEAGE_KINDS)[number];

/** Metered aggregation windows for quota grants. */
export const METER_WINDOWS = Object.freeze(['day', 'month'] as const);
export type MeterWindow = (typeof METER_WINDOWS)[number];

/** Usage-meter event taxonomy (closed set, v1). */
export const USAGE_METER_EVENT_KINDS = Object.freeze(['usage-recorded', 'usage-revised'] as const);
export type UsageMeterEventKind = (typeof USAGE_METER_EVENT_KINDS)[number];

/** Grant-resolution decision reasons (closed set). */
export const GRANT_RESOLUTION_REASONS = Object.freeze([
  'grant-match',
  'no-matching-feature',
  'tenant-mismatch',
  'grant-revoked',
  'grant-expired',
  'grant-not-yet-active',
] as const);
export type GrantResolutionReason = (typeof GRANT_RESOLUTION_REASONS)[number];

/** Feature-flag decision reasons (closed set). */
export const FEATURE_FLAG_REASONS = Object.freeze([
  'flag-enabled',
  'flag-disabled',
  'flag-absent',
] as const);
export type FeatureFlagReason = (typeof FEATURE_FLAG_REASONS)[number];

/** Hard bound on metered units per event (guards absurd ingestion values). */
export const MAX_METER_UNITS = 1_000_000_000;

// ---------------------------------------------------------------------------
// Predicates / validators
// ---------------------------------------------------------------------------

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isGrantId(value: unknown): value is GrantId {
  return typeof value === 'string' && GRANT_ID_PATTERN.test(value);
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && FEATURE_KEY_PATTERN.test(value);
}

export function isUsageId(value: unknown): value is UsageId {
  return typeof value === 'string' && USAGE_ID_PATTERN.test(value);
}

/** Timestamps are canonical ms-precision UTC ISO-8601 strings. */
export function isMeterTimestamp(value: unknown): value is MeterTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function isMeterNote(value: unknown): value is MeterNote {
  return typeof value === 'string' && METER_NOTE_PATTERN.test(value);
}

export function isEntitlementGrantKind(value: unknown): value is EntitlementGrantKind {
  return (
    typeof value === 'string' &&
    (ENTITLEMENT_GRANT_KINDS as readonly string[]).includes(value)
  );
}

export function isGrantLineageKind(value: unknown): value is GrantLineageKind {
  return (
    typeof value === 'string' && (GRANT_LINEAGE_KINDS as readonly string[]).includes(value)
  );
}

export function isMeterWindow(value: unknown): value is MeterWindow {
  return typeof value === 'string' && (METER_WINDOWS as readonly string[]).includes(value);
}

export function isUsageMeterEventKind(value: unknown): value is UsageMeterEventKind {
  return (
    typeof value === 'string' &&
    (USAGE_METER_EVENT_KINDS as readonly string[]).includes(value)
  );
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid tenant id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: TENANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toGrantId(value: string): GrantId {
  if (!isGrantId(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid grant id: ${JSON.stringify(value)}`,
      details: { pattern: GRANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toFeatureKey(value: string): FeatureKey {
  if (!isFeatureKey(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid feature key: ${JSON.stringify(value)} (dotted lowercase identifier like job.compute)`,
      details: { pattern: FEATURE_KEY_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toUsageId(value: string): UsageId {
  if (!isUsageId(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid usage id: ${JSON.stringify(value)}`,
      details: { pattern: USAGE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMeterTimestamp(value: string): MeterTimestamp {
  if (!isMeterTimestamp(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid meter timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-01-15T09:30:00.000Z)`,
      details: { pattern: ENTITLEMENT_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMeterNote(value: string): MeterNote {
  if (!isMeterNote(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid meter note: ${JSON.stringify(value)} (1..200 characters, no leading whitespace)`,
      details: { pattern: METER_NOTE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMeterWindow(value: string): MeterWindow {
  if (!isMeterWindow(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_GRANT, {
      message: `invalid meter window: ${JSON.stringify(value)} (known: ${METER_WINDOWS.join(', ')})`,
      details: { known: [...METER_WINDOWS] },
    });
  }
  return value;
}

/** Current time as a canonical meter timestamp (Date#toISOString is always ms UTC). */
export function nowMeterTimestamp(): MeterTimestamp {
  return new Date().toISOString() as MeterTimestamp;
}

/** Generate a fresh random grant id (UUIDv4-based). */
export function newGrantId(): GrantId {
  return globalThis.crypto.randomUUID() as GrantId;
}

/** Generate a fresh random usage id (UUIDv4-based). */
export function newUsageId(): UsageId {
  return globalThis.crypto.randomUUID() as UsageId;
}

// ---------------------------------------------------------------------------
// Plain-JSON screening (canonical serializability of payloads)
// ---------------------------------------------------------------------------

/** True iff the value is plain JSON (canonically serializable, no undefined). */
export function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item));
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every((item) => isPlainJsonValue(item));
    }
    default:
      return false;
  }
}

/** Fail closed with ENTITLEMENT_INVALID_EVENT when a payload is not plain JSON. */
export function assertPlainJson(value: unknown, field: string): void {
  if (!isPlainJsonValue(value)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_EVENT, {
      message: `${field} must be plain JSON (canonically serializable: no undefined, non-finite numbers, bigints, dates or class instances)`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

/** Recursively freeze a plain-JSON domain object; frozen inputs stay frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
