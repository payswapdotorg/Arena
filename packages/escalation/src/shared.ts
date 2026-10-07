/**
 * Shared primitives for the Arena expert escalation domain core
 * (Work Order C001; spec/expert-escalation-api.md ES1.0).
 *
 * House conventions mirrored from @arena/job-protocol's shared.ts:
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

/** Wire version of every escalation payload shape in this package. */
export const ESCALATION_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type EscalationId = string & { readonly __brand: 'EscalationId' };
export type TenantId = string & { readonly __brand: 'TenantId' };
export type ClientAppId = string & { readonly __brand: 'ClientAppId' };
export type ExpertRef = string & { readonly __brand: 'ExpertRef' };
export type SessionRef = string & { readonly __brand: 'SessionRef' };
export type EventId = string & { readonly __brand: 'EventId' };

export const ESCALATION_ID_PATTERN_SOURCE = '^esc_[0-9a-f]{32}$';
export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const CLIENT_APP_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const EXPERT_REF_PATTERN_SOURCE = '^expert-[a-z0-9][a-z0-9-]{0,62}$';
export const SESSION_REF_PATTERN_SOURCE = '^session-[a-z0-9][a-z0-9-]{0,62}$';
export const EVENT_ID_PATTERN_SOURCE = '^evt_[0-9a-f]{32}$';

const ESCALATION_ID_RE = new RegExp(ESCALATION_ID_PATTERN_SOURCE);
const TENANT_ID_RE = new RegExp(TENANT_ID_PATTERN_SOURCE);
const CLIENT_APP_ID_RE = new RegExp(CLIENT_APP_ID_PATTERN_SOURCE);
const EXPERT_REF_RE = new RegExp(EXPERT_REF_PATTERN_SOURCE);
const SESSION_REF_RE = new RegExp(SESSION_REF_PATTERN_SOURCE);
const EVENT_ID_RE = new RegExp(EVENT_ID_PATTERN_SOURCE);

export function isEscalationId(value: unknown): value is EscalationId {
  return typeof value === 'string' && ESCALATION_ID_RE.test(value);
}

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_RE.test(value);
}

export function isClientAppId(value: unknown): value is ClientAppId {
  return typeof value === 'string' && CLIENT_APP_ID_RE.test(value);
}

export function isExpertRef(value: unknown): value is ExpertRef {
  return typeof value === 'string' && EXPERT_REF_RE.test(value);
}

export function isSessionRef(value: unknown): value is SessionRef {
  return typeof value === 'string' && SESSION_REF_RE.test(value);
}

export function isEventId(value: unknown): value is EventId {
  return typeof value === 'string' && EVENT_ID_RE.test(value);
}

function brandId<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand an escalation id (esc_ + 32 lowercase hex). */
export function toEscalationId(value: string): EscalationId {
  if (!isEscalationId(value)) {
    throw new TypeError(`invalid escalation id: ${JSON.stringify(value)} (expected ${ESCALATION_ID_PATTERN_SOURCE})`);
  }
  return brandId<EscalationId>(value);
}

/** Validate and brand a tenant id. */
export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new TypeError(`invalid tenant id: ${JSON.stringify(value)} (expected ${TENANT_ID_PATTERN_SOURCE})`);
  }
  return brandId<TenantId>(value);
}

/** Validate and brand a client application id. */
export function toClientAppId(value: string): ClientAppId {
  if (!isClientAppId(value)) {
    throw new TypeError(`invalid client app id: ${JSON.stringify(value)} (expected ${CLIENT_APP_ID_PATTERN_SOURCE})`);
  }
  return brandId<ClientAppId>(value);
}

/** Validate and brand an expert reference. */
export function toExpertRef(value: string): ExpertRef {
  if (!isExpertRef(value)) {
    throw new TypeError(`invalid expert ref: ${JSON.stringify(value)} (expected ${EXPERT_REF_PATTERN_SOURCE})`);
  }
  return brandId<ExpertRef>(value);
}

/** Validate and brand a session reference. */
export function toSessionRef(value: string): SessionRef {
  if (!isSessionRef(value)) {
    throw new TypeError(`invalid session ref: ${JSON.stringify(value)} (expected ${SESSION_REF_PATTERN_SOURCE})`);
  }
  return brandId<SessionRef>(value);
}

/** Validate and brand a webhook event id. */
export function toEventId(value: string): EventId {
  if (!isEventId(value)) {
    throw new TypeError(`invalid event id: ${JSON.stringify(value)} (expected ${EVENT_ID_PATTERN_SOURCE})`);
  }
  return brandId<EventId>(value);
}

/** Generate a fresh escalation id (esc_ + 32 lowercase hex). */
export function newEscalationId(): EscalationId {
  return toEscalationId(`esc_${crypto.randomUUID().replaceAll('-', '')}`);
}

/** Generate a fresh webhook event id. */
export function newEventId(): EventId {
  return toEventId(`evt_${crypto.randomUUID().replaceAll('-', '')}`);
}

// ---------------------------------------------------------------------------
// Timestamps (canonical ms-UTC strings; always injected, never wall-clock)
// ---------------------------------------------------------------------------

export const ESCALATION_TIMESTAMP_PATTERN_SOURCE =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

const TIMESTAMP_RE = new RegExp(ESCALATION_TIMESTAMP_PATTERN_SOURCE);

export type EscalationTimestamp = string;

export function isEscalationTimestamp(value: unknown): value is EscalationTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Normalize an injected time (epoch ms, ISO string or Date) to the canonical form. */
export function toEscalationTimestamp(input: number | string | Date): EscalationTimestamp {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`invalid escalation timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Closed vocabularies (ES1.0)
// ---------------------------------------------------------------------------

/** The eight approved escalation modes (architecture-lock rule 27). */
export const ESCALATION_MODES = Object.freeze([
  'solve',
  'correct',
  'unblock',
  'review',
  'teach',
  'tool_gap',
  'knowledge',
  'evaluate',
] as const);
export type EscalationMode = (typeof ESCALATION_MODES)[number];

export function isEscalationMode(value: unknown): value is EscalationMode {
  return typeof value === 'string' && (ESCALATION_MODES as readonly string[]).includes(value);
}

/** Urgency classes (closed vocabulary). */
export const ESCALATION_URGENCIES = Object.freeze([
  'routine',
  'priority',
  'urgent',
  'critical',
] as const);
export type EscalationUrgency = (typeof ESCALATION_URGENCIES)[number];

export function isEscalationUrgency(value: unknown): value is EscalationUrgency {
  return typeof value === 'string' && (ESCALATION_URGENCIES as readonly string[]).includes(value);
}

/** ISO-4217-shaped currency codes (3 uppercase letters). */
export const CURRENCY_PATTERN_SOURCE = '^[A-Z]{3}$';
const CURRENCY_RE = new RegExp(CURRENCY_PATTERN_SOURCE);

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_RE.test(value);
}

/** BCP-47-shaped locale tags (subset: ll, ll-CC, lll, lll-CC). */
export const LOCALE_PATTERN_SOURCE = '^[a-z]{2,3}(-[A-Z]{2})?$';
const LOCALE_RE = new RegExp(LOCALE_PATTERN_SOURCE);

export function isLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && LOCALE_RE.test(value);
}

/** Capability-need references (dot-separated lowercase segments). */
export const CAPABILITY_NEED_PATTERN_SOURCE = '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){0,31}$';
const CAPABILITY_NEED_RE = new RegExp(CAPABILITY_NEED_PATTERN_SOURCE);

export function isCapabilityNeed(value: unknown): value is string {
  return typeof value === 'string' && CAPABILITY_NEED_RE.test(value);
}

/** Free-form external reference (workflow/run/task refs, context refs). */
export const SOURCE_REF_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$';
const SOURCE_REF_RE = new RegExp(SOURCE_REF_PATTERN_SOURCE);

export function isSourceRef(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_REF_RE.test(value);
}

// ---------------------------------------------------------------------------
// JSON discipline + freezing
// ---------------------------------------------------------------------------

/** A value that is safely JSON-serializable (plain data only). */
export type PlainJsonValue = null | boolean | number | string | readonly PlainJsonValue[] | { readonly [key: string]: PlainJsonValue };

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

/** Deep-freeze a plain-JSON value (mirrors @arena/job-protocol shared.ts). */
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
