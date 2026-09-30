/**
 * Shared vocabulary and validators for @arena/observability (Work Order
 * A035; requirements R33, R27, R28).
 *
 * Pure TypeScript with zero external runtime dependencies. Everything
 * observability-visible is closed, frozen and fail-closed:
 *
 *   - branded identifiers (Timestamp, TelemetryId, NeutralId,
 *     NeutralText) with strict charset patterns;
 *   - closed vocabularies (metric units/types, log levels, trace
 *     statuses, health statuses, alert severities);
 *   - deepFreeze + structural field validators used by every module.
 *
 * The vocabulary deliberately contains NO provider names and no
 * sensitive-material words (asserted by hygiene.test.ts).
 */

import type { Brand } from '@arena/protocol-core';

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/** Canonical millisecond-UTC instant (integer >= 0). */
export type ObservabilityTimestamp = Brand<number, 'ObservabilityTimestamp'>;

/** Identifier of one telemetry signal (unique within the emitting source). */
export type TelemetryId = Brand<string, 'TelemetryId'>;

/** Neutral identifier (service names, component names, SLO ids...). */
export type NeutralId = Brand<string, 'ObservabilityNeutralId'>;

/** Neutral free text (log messages, human-readable reasons). */
export type NeutralText = Brand<string, 'ObservabilityNeutralText'>;

// ---------------------------------------------------------------------------
// Patterns (pattern SOURCE constants are exported for tests + docs parity)
// ---------------------------------------------------------------------------

export const TELEMETRY_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
export const LABEL_KEY_PATTERN_SOURCE = '^[a-z][a-z0-9_.-]{0,63}$';
export const LABEL_VALUE_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._@:/-]{0,255}$';

const TELEMETRY_ID_PATTERN = new RegExp(TELEMETRY_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);
const LABEL_KEY_PATTERN = new RegExp(LABEL_KEY_PATTERN_SOURCE);
const LABEL_VALUE_PATTERN = new RegExp(LABEL_VALUE_PATTERN_SOURCE);

export function isObservabilityTimestamp(value: unknown): value is ObservabilityTimestamp {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isTelemetryId(value: unknown): value is TelemetryId {
  return typeof value === 'string' && TELEMETRY_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

/** Validate and brand a timestamp (epoch ms). */
export function toObservabilityTimestamp(value: number): ObservabilityTimestamp {
  if (!isObservabilityTimestamp(value)) {
    throw new Error(`invalid observability timestamp (epoch ms integer >= 0): ${String(value)}`);
  }
  return value;
}

/** Validate and brand a telemetry id. */
export function toTelemetryId(value: string): TelemetryId {
  if (!isTelemetryId(value)) {
    throw new Error(`invalid telemetry id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Validate and brand a neutral id. */
export function toNeutralId(value: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new Error(`invalid neutral id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Validate and brand neutral text. */
export function toNeutralText(value: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new Error(`invalid neutral text (printable ASCII, 1..4096)`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const METRIC_UNITS = Object.freeze(['count', 'milliseconds', 'seconds', 'bytes', 'ratio'] as const);
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const METRIC_TYPES = Object.freeze(['counter', 'gauge', 'timer'] as const);
export type MetricType = (typeof METRIC_TYPES)[number];

export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error'] as const);
export type LogLevel = (typeof LOG_LEVELS)[number];

export const TRACE_STATUSES = Object.freeze(['open', 'succeeded', 'failed'] as const);
export type TraceStatus = (typeof TRACE_STATUSES)[number];

export const HEALTH_STATUSES = Object.freeze(['healthy', 'degraded', 'unhealthy', 'unknown'] as const);
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ALERT_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low'] as const);
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export function isEnumMember<T extends string>(value: unknown, members: readonly T[]): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

/** Max number of label/attribute/field entries on one signal. */
export const MAX_ATTRIBUTES = 16;

/** Is `value` a finite non-negative number (metric values, ratios, durations)? */
export function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Is `value` a finite number strictly between 0 and 1 (ratios, targets)? */
export function isStrictRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1;
}

/**
 * Validate a closed attributes map (bounded size, closed key/value
 * charset). Throws plain Errors with precise context messages — callers
 * wrap them into the domain taxonomy where the wire boundary needs it.
 */
export function checkAttributes(
  value: unknown,
  context: string,
): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context}: attributes must be a JSON object of strings`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_ATTRIBUTES) {
    throw new Error(`${context}: at most ${String(MAX_ATTRIBUTES)} attribute entries (got ${String(keys.length)})`);
  }
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!LABEL_KEY_PATTERN.test(key)) {
      throw new Error(`${context}: attribute key ${JSON.stringify(key)} violates ${LABEL_KEY_PATTERN_SOURCE}`);
    }
    const raw = record[key];
    if (typeof raw !== 'string' || !LABEL_VALUE_PATTERN.test(raw)) {
      throw new Error(`${context}: attribute value for ${JSON.stringify(key)} violates ${LABEL_VALUE_PATTERN_SOURCE}`);
    }
    out[key] = raw;
  }
  return Object.freeze(out);
}

/** Deep-freeze helper (frozen surfaces; mutation throws in strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
