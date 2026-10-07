/**
 * Shared primitives for the Arena live human intervention domain core
 * (Work Order C007; issue #114; spec/human-escalation-work-items.md
 * "Escalation modes" + spec/expert-escalation-api.md ES1.0).
 *
 * House conventions mirrored from @arena/escalation's shared.ts:
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     all timestamps are injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline (every protocol-visible field is
 *     JSON-serializable);
 *   - deep-freeze helpers so domain objects are immutable in place.
 */

// ---------------------------------------------------------------------------
// Wire version
// ---------------------------------------------------------------------------

/** Wire version of every intervention payload shape in this package. */
export const INTERVENTION_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type InterventionId = string & { readonly __brand: 'InterventionId' };

export const INTERVENTION_ID_PATTERN_SOURCE = '^ivn_[0-9a-f]{32}$';

const INTERVENTION_ID_RE = new RegExp(INTERVENTION_ID_PATTERN_SOURCE);

export function isInterventionId(value: unknown): value is InterventionId {
  return typeof value === 'string' && INTERVENTION_ID_RE.test(value);
}

function brandInterventionId(value: string): InterventionId {
  return Object.freeze(value) as InterventionId;
}

/** Validate and brand an intervention id (ivn_ + 32 lowercase hex). */
export function toInterventionId(value: string): InterventionId {
  if (!isInterventionId(value)) {
    throw new TypeError(
      `invalid intervention id: ${JSON.stringify(value)} (expected ${INTERVENTION_ID_PATTERN_SOURCE})`,
    );
  }
  return brandInterventionId(value);
}

/** Generate a fresh intervention id (ivn_ + 32 lowercase hex). */
export function newInterventionId(): InterventionId {
  return toInterventionId(`ivn_${crypto.randomUUID().replaceAll('-', '')}`);
}

// ---------------------------------------------------------------------------
// Timestamps (canonical ms-UTC strings; always injected, never wall-clock)
// ---------------------------------------------------------------------------

export const INTERVENTION_TIMESTAMP_PATTERN_SOURCE =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

const TIMESTAMP_RE = new RegExp(INTERVENTION_TIMESTAMP_PATTERN_SOURCE);

export type InterventionTimestamp = string;

export function isInterventionTimestamp(value: unknown): value is InterventionTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Normalize an injected time (epoch ms, ISO string or Date) to the canonical form. */
export function toInterventionTimestamp(input: number | string | Date): InterventionTimestamp {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`invalid intervention timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// JSON discipline + freezing
// ---------------------------------------------------------------------------

/** A value that is safely JSON-serializable (plain data only). */
export type PlainJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PlainJsonValue[]
  | { readonly [key: string]: PlainJsonValue };

export function isPlainJsonValue(value: unknown): value is PlainJsonValue {
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

/** Deep-freeze a plain-JSON value (mirrors @arena/escalation shared.ts). */
export function deepFreeze<T extends PlainJsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, PlainJsonValue>)[key] as PlainJsonValue);
    }
    return Object.freeze(value);
  }
  return value;
}

/** Structurally compare two plain-JSON values (canonical serialization). */
export function plainJsonEquals(a: PlainJsonValue, b: PlainJsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
