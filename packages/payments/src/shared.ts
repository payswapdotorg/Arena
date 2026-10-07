/**
 * Shared primitives for the Arena payments domain core (Work Order C010;
 * issue #77; docs/LLM-ARCHITECT-FINAL-HANDOFF.md §8 commercial model).
 *
 * House conventions mirrored from @arena/escalation / @arena/job-protocol
 * shared.ts:
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     all timestamps are injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline (every protocol-visible field is
 *     JSON-serializable);
 *   - deep-freeze helpers so domain objects are immutable in place.
 *
 * MONEY LAW (the reason this package exists): amounts are STRING-SCALED
 * MINOR UNITS — canonical decimal strings operated on with BigInt
 * arithmetic. Floating-point NEVER touches a money value (see money.ts).
 */

// ---------------------------------------------------------------------------
// Wire version
// ---------------------------------------------------------------------------

/** Wire version of every payments payload shape in this package. */
export const PAYMENTS_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type TenantId = string & { readonly __brand: 'PaymentsTenantId' };
export type LedgerOperationId = string & { readonly __brand: 'LedgerOperationId' };
export type AuditEventId = string & { readonly __brand: 'PaymentsAuditEventId' };

export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const LEDGER_OPERATION_ID_PATTERN_SOURCE = '^payop_[0-9a-f]{32}$';
export const AUDIT_EVENT_ID_PATTERN_SOURCE = '^cevt_[0-9a-f]{32}$';

const TENANT_ID_RE = new RegExp(TENANT_ID_PATTERN_SOURCE);
const LEDGER_OPERATION_ID_RE = new RegExp(LEDGER_OPERATION_ID_PATTERN_SOURCE);
const AUDIT_EVENT_ID_RE = new RegExp(AUDIT_EVENT_ID_PATTERN_SOURCE);

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_RE.test(value);
}

export function isLedgerOperationId(value: unknown): value is LedgerOperationId {
  return typeof value === 'string' && LEDGER_OPERATION_ID_RE.test(value);
}

export function isAuditEventId(value: unknown): value is AuditEventId {
  return typeof value === 'string' && AUDIT_EVENT_ID_RE.test(value);
}

function brandId<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand a tenant id. */
export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new TypeError(`invalid tenant id: ${JSON.stringify(value)} (expected ${TENANT_ID_PATTERN_SOURCE})`);
  }
  return brandId<TenantId>(value);
}

/** Validate and brand a ledger operation id (payop_ + 32 lowercase hex). */
export function toLedgerOperationId(value: string): LedgerOperationId {
  if (!isLedgerOperationId(value)) {
    throw new TypeError(`invalid ledger operation id: ${JSON.stringify(value)} (expected ${LEDGER_OPERATION_ID_PATTERN_SOURCE})`);
  }
  return brandId<LedgerOperationId>(value);
}

/** Validate and brand a commercial audit event id (cevt_ + 32 lowercase hex). */
export function toAuditEventId(value: string): AuditEventId {
  if (!isAuditEventId(value)) {
    throw new TypeError(`invalid audit event id: ${JSON.stringify(value)} (expected ${AUDIT_EVENT_ID_PATTERN_SOURCE})`);
  }
  return brandId<AuditEventId>(value);
}

/** Generate a fresh ledger operation id. */
export function newLedgerOperationId(): LedgerOperationId {
  return toLedgerOperationId(`payop_${crypto.randomUUID().replaceAll('-', '')}`);
}

/** Generate a fresh commercial audit event id. */
export function newAuditEventId(): AuditEventId {
  return toAuditEventId(`cevt_${crypto.randomUUID().replaceAll('-', '')}`);
}

// ---------------------------------------------------------------------------
// Timestamps (canonical ms-UTC strings; always injected, never wall-clock)
// ---------------------------------------------------------------------------

export const PAYMENTS_TIMESTAMP_PATTERN_SOURCE =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

const TIMESTAMP_RE = new RegExp(PAYMENTS_TIMESTAMP_PATTERN_SOURCE);

export type PaymentsTimestamp = string;

export function isPaymentsTimestamp(value: unknown): value is PaymentsTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Normalize an injected time (epoch ms, ISO string or Date) to the canonical form. */
export function toPaymentsTimestamp(input: number | string | Date): PaymentsTimestamp {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`invalid payments timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** ISO-4217-shaped currency codes (3 uppercase letters) — as declared, NEVER converted. */
export const CURRENCY_PATTERN_SOURCE = '^[A-Z]{3}$';
const CURRENCY_RE = new RegExp(CURRENCY_PATTERN_SOURCE);

export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_RE.test(value);
}

/**
 * The C010 commercial-state vocabulary the ledger binds to. These are the
 * C001 escalation lifecycle states the money operations are guarded
 * against (spec/expert-escalation-api.md "Lifecycle"); the ledger NEVER
 * imports the escalation package — the binding is a closed structural
 * vocabulary, so the payments domain stays provider- and lifecycle-neutral
 * (the service layer maps C001 records onto it).
 */
export const PAYMENT_BOUND_LIFECYCLE_STATES = Object.freeze([
  'created',
  'triaged',
  'matching',
  'offered',
  'accepted',
  'session_ready',
  'in_progress',
  'submitted',
  'validating',
  'result_accepted',
  'revision_required',
  'result_rejected',
  'paid',
  'learning_captured',
  'expert_replaced',
  'closed',
  'cancelled',
  'timed_out',
] as const);
export type BoundLifecycleState = (typeof PAYMENT_BOUND_LIFECYCLE_STATES)[number];

export function isBoundLifecycleState(value: unknown): value is BoundLifecycleState {
  return (
    typeof value === 'string' &&
    (PAYMENT_BOUND_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

/**
 * THE TRUTH-LABEL LAW (spec/free-tier-contract.md + AGENTS.md "Replay /
 * demo": demo state is never customer-authoritative state). Every money
 * record declares whether it is DEMO money (deterministic fake-provider
 * state) or CUSTOMER money. Demo money is NEVER customer money; the demo
 * provider may never execute customer-money instructions; a customer
 * ledger may never ride a demo provider (see provider.ts).
 */
export const MONEY_TRUTH_LABELS = Object.freeze(['demo', 'customer'] as const);
export type MoneyTruth = (typeof MONEY_TRUTH_LABELS)[number];

export function isMoneyTruth(value: unknown): value is MoneyTruth {
  return typeof value === 'string' && (MONEY_TRUTH_LABELS as readonly string[]).includes(value);
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

/** Deep-freeze a plain-JSON value. */
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
