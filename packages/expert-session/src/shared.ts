/**
 * Shared primitives for the Arena expert environment session domain core
 * (Work Order C006; spec/expert-environment-session.md EES1.0).
 *
 * House conventions mirrored from @arena/escalation / @arena/job-protocol:
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     all timestamps are injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline (every protocol-visible field is
 *     JSON-serializable);
 *   - deep-freeze helpers so domain objects are immutable in place.
 *
 * The expert-session id pattern deliberately matches @arena/escalation's
 * SessionRef pattern (`session-…`) so a capsule id is directly bindable
 * as the escalation record's sessionRef when the session enters
 * SESSION_READY.
 */

// ---------------------------------------------------------------------------
// Wire version
// ---------------------------------------------------------------------------

/** Wire version of every expert-session payload shape in this package. */
export const EXPERT_SESSION_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type ExpertSessionId = string & { readonly __brand: 'ExpertSessionId' };
export type ExpertSessionEventId = string & { readonly __brand: 'ExpertSessionEventId' };
export type KnowledgeArtifactId = string & { readonly __brand: 'KnowledgeArtifactId' };
export type TenantId = string & { readonly __brand: 'TenantId' };
export type EscalationIdRef = string & { readonly __brand: 'EscalationIdRef' };
export type ExpertRef = string & { readonly __brand: 'ExpertRef' };

export const EXPERT_SESSION_ID_PATTERN_SOURCE = '^session-[a-z0-9][a-z0-9-]{0,62}$';
export const EXPERT_SESSION_EVENT_ID_PATTERN_SOURCE = '^esevt_[0-9a-f]{32}$';
export const KNOWLEDGE_ARTIFACT_ID_PATTERN_SOURCE = '^esknow_[0-9a-f]{32}$';
export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ESCALATION_ID_REF_PATTERN_SOURCE = '^esc_[0-9a-f]{32}$';
export const EXPERT_REF_PATTERN_SOURCE = '^expert-[a-z0-9][a-z0-9-]{0,62}$';

const EXPERT_SESSION_ID_RE = new RegExp(EXPERT_SESSION_ID_PATTERN_SOURCE);
const EXPERT_SESSION_EVENT_ID_RE = new RegExp(EXPERT_SESSION_EVENT_ID_PATTERN_SOURCE);
const KNOWLEDGE_ARTIFACT_ID_RE = new RegExp(KNOWLEDGE_ARTIFACT_ID_PATTERN_SOURCE);
const TENANT_ID_RE = new RegExp(TENANT_ID_PATTERN_SOURCE);
const ESCALATION_ID_REF_RE = new RegExp(ESCALATION_ID_REF_PATTERN_SOURCE);
const EXPERT_REF_RE = new RegExp(EXPERT_REF_PATTERN_SOURCE);

export function isExpertSessionId(value: unknown): value is ExpertSessionId {
  return typeof value === 'string' && EXPERT_SESSION_ID_RE.test(value);
}

export function isExpertSessionEventId(value: unknown): value is ExpertSessionEventId {
  return typeof value === 'string' && EXPERT_SESSION_EVENT_ID_RE.test(value);
}

export function isKnowledgeArtifactId(value: unknown): value is KnowledgeArtifactId {
  return typeof value === 'string' && KNOWLEDGE_ARTIFACT_ID_RE.test(value);
}

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_RE.test(value);
}

export function isEscalationIdRef(value: unknown): value is EscalationIdRef {
  return typeof value === 'string' && ESCALATION_ID_REF_RE.test(value);
}

export function isExpertRef(value: unknown): value is ExpertRef {
  return typeof value === 'string' && EXPERT_REF_RE.test(value);
}

function brandId<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Validate and brand an expert session id (session- + lowercase slug). */
export function toExpertSessionId(value: string): ExpertSessionId {
  if (!isExpertSessionId(value)) {
    throw new TypeError(
      `invalid expert session id: ${JSON.stringify(value)} (expected ${EXPERT_SESSION_ID_PATTERN_SOURCE})`,
    );
  }
  return brandId<ExpertSessionId>(value);
}

/** Generate a fresh expert session id (bindable as an escalation sessionRef). */
export function newExpertSessionId(): ExpertSessionId {
  return toExpertSessionId(`session-exp-${randomHex(12)}`);
}

export function toExpertSessionEventId(value: string): ExpertSessionEventId {
  if (!isExpertSessionEventId(value)) {
    throw new TypeError(
      `invalid expert session event id: ${JSON.stringify(value)} (expected ${EXPERT_SESSION_EVENT_ID_PATTERN_SOURCE})`,
    );
  }
  return brandId<ExpertSessionEventId>(value);
}

export function newExpertSessionEventId(): ExpertSessionEventId {
  return toExpertSessionEventId(`esevt_${randomHex(16)}`);
}

export function toKnowledgeArtifactId(value: string): KnowledgeArtifactId {
  if (!isKnowledgeArtifactId(value)) {
    throw new TypeError(
      `invalid knowledge artifact id: ${JSON.stringify(value)} (expected ${KNOWLEDGE_ARTIFACT_ID_PATTERN_SOURCE})`,
    );
  }
  return brandId<KnowledgeArtifactId>(value);
}

export function newKnowledgeArtifactId(): KnowledgeArtifactId {
  return toKnowledgeArtifactId(`esknow_${randomHex(16)}`);
}

export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new TypeError(
      `invalid tenant id: ${JSON.stringify(value)} (expected ${TENANT_ID_PATTERN_SOURCE})`,
    );
  }
  return brandId<TenantId>(value);
}

export function toEscalationIdRef(value: string): EscalationIdRef {
  if (!isEscalationIdRef(value)) {
    throw new TypeError(
      `invalid escalation id: ${JSON.stringify(value)} (expected ${ESCALATION_ID_REF_PATTERN_SOURCE})`,
    );
  }
  return brandId<EscalationIdRef>(value);
}

export function toExpertRef(value: string): ExpertRef {
  if (!isExpertRef(value)) {
    throw new TypeError(
      `invalid expert ref: ${JSON.stringify(value)} (expected ${EXPERT_REF_PATTERN_SOURCE})`,
    );
  }
  return brandId<ExpertRef>(value);
}

// ---------------------------------------------------------------------------
// Timestamps (canonical ms-UTC strings — always injected)
// ---------------------------------------------------------------------------

export type ExpertSessionTimestamp = string;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isExpertSessionTimestamp(value: unknown): value is ExpertSessionTimestamp {
  return typeof value === 'string' && TIMESTAMP_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function toExpertSessionTimestamp(input: number | string | Date): ExpertSessionTimestamp {
  const ms = typeof input === 'number' ? input : input instanceof Date ? input.getTime() : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`invalid timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Plain-JSON discipline
// ---------------------------------------------------------------------------

export type PlainJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PlainJsonValue[]
  | { readonly [key: string]: PlainJsonValue };

export function isPlainJsonValue(value: unknown): value is PlainJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) return value.every((entry) => isPlainJsonValue(entry));
  if (typeof value === 'object' && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      return false;
    }
    return Object.values(value).every((entry) => isPlainJsonValue(entry));
  }
  return false;
}

export function deepFreeze<T extends PlainJsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value) as T;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, PlainJsonValue>)[key as string] as PlainJsonValue);
    }
    return Object.freeze(value) as T;
  }
  return value;
}
