/**
 * Shared primitives for the human-data domain core (Work Order C012;
 * issue #118 — human-data production studio for customer AI pipelines).
 *
 * House conventions (mirroring @arena/escalation-validation's shared.ts,
 * consumed — never reimplemented — from the merged domain packages):
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC ISO timestamps as strings (NEVER wall-clock reads —
 *     every timestamp is injected by callers; architecture-lock rule 17);
 *   - plain-JSON value discipline (reused from @arena/escalation);
 *   - deep-freeze helpers so domain objects are immutable in place;
 *   - typed machine-readable verdicts — never a bare boolean.
 */

import type { PlainJsonValue } from '@arena/escalation';
import { isPlainJsonValue } from '@arena/escalation';

export type { PlainJsonValue };

/** Wire version of every human-data payload shape. */
export const HUMAN_DATA_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type CommissionId = string & { readonly __brand: 'CommissionId' };
export type DeliverableId = string & { readonly __brand: 'DeliverableId' };

export const COMMISSION_ID_PATTERN_SOURCE = '^hd_[0-9a-f]{32}$';
export const DELIVERABLE_ID_PATTERN_SOURCE = '^del_[0-9a-f]{32}$';

const COMMISSION_ID_RE = new RegExp(COMMISSION_ID_PATTERN_SOURCE);
const DELIVERABLE_ID_RE = new RegExp(DELIVERABLE_ID_PATTERN_SOURCE);

export function isCommissionId(value: unknown): value is CommissionId {
  return typeof value === 'string' && COMMISSION_ID_RE.test(value);
}

export function isDeliverableId(value: unknown): value is DeliverableId {
  return typeof value === 'string' && DELIVERABLE_ID_RE.test(value);
}

function brand<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand a commission id (hd_ + 32 lowercase hex). */
export function toCommissionId(value: string): CommissionId {
  if (!isCommissionId(value)) {
    throw new TypeError(
      `invalid commission id: ${JSON.stringify(value)} (expected ${COMMISSION_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<CommissionId>(value);
}

/** Validate and brand a deliverable id (del_ + 32 lowercase hex). */
export function toDeliverableId(value: string): DeliverableId {
  if (!isDeliverableId(value)) {
    throw new TypeError(
      `invalid deliverable id: ${JSON.stringify(value)} (expected ${DELIVERABLE_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<DeliverableId>(value);
}

/** Generate a fresh commission id (hd_ + 32 lowercase hex). */
export function newCommissionId(): CommissionId {
  return toCommissionId(`hd_${crypto.randomUUID().replaceAll('-', '')}`);
}

/**
 * Deep-freeze a (possibly nested) value IN PLACE and return it typed as
 * itself (the generic house helper — freezes domain objects without
 * widening their types).
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const entry of value) deepFreeze(entry);
      return Object.freeze(value);
    }
    if (!Object.isFrozen(value)) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
      Object.freeze(value);
    }
    return value;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict value helpers (fail-closed)
// ---------------------------------------------------------------------------

/** A non-empty bounded string (1..4096 chars). */
export function requireBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new TypeError(`${field} must be a non-empty string (<= 4096 chars)`);
  }
  return value;
}

/** A frozen non-empty string array. */
export function requireStringArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must be a non-empty string array`);
  }
  for (const value of values) requireBoundedString(value, `${field} entry`);
  return Object.freeze([...values]);
}

/** A finite number in [0, 1] (normalized thresholds/ratios). */
export function requireUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number in [0, 1]`);
  }
  return value;
}

/** A positive integer within an inclusive upper bound. */
export function requirePositiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${field} must be an integer in [1, ${max}]`);
  }
  return value;
}

/** A plain-JSON object (schema/declaration payloads). */
export function requirePlainJsonObject(value: unknown, field: string): PlainJsonValue {
  if (!isPlainJsonValue(value) || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be a plain-JSON object`);
  }
  return value;
}

/** Canonical ms-UTC ISO timestamp from an injected instant (never a wall-clock read). */
export function toIsoTimestamp(value: number | string | Date): string {
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  const date = value instanceof Date ? value : new Date(ms);
  if (value instanceof Date ? Number.isNaN(date.getTime()) : Number.isNaN(ms)) {
    throw new TypeError(`timestamp is not a valid instant: ${JSON.stringify(value)}`);
  }
  return date.toISOString();
}
