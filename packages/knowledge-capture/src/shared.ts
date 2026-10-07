/**
 * Shared primitives for @arena/knowledge-capture (Work Order C008) —
 * mirrors @arena/tool-gap's discipline: branded record ids, ms-precision
 * UTC timestamps, deep-frozen plain JSON, deterministic content keys.
 */

/** Wire version of the knowledge-capture record surface. */
export const KNOWLEDGE_CAPTURE_WIRE_VERSION = 1 as const;

/** Branded lattice knowledge record id (kcr_ + 32 lowercase hex). */
export type KnowledgeRecordId = string & { readonly __brand: 'KnowledgeRecordId' };

/** Exact pattern source for lattice knowledge record ids. */
export const KNOWLEDGE_RECORD_ID_PATTERN_SOURCE = '^kcr_[0-9a-f]{32}$';

const KNOWLEDGE_RECORD_ID_PATTERN = new RegExp(KNOWLEDGE_RECORD_ID_PATTERN_SOURCE);

export function isKnowledgeRecordId(value: unknown): value is KnowledgeRecordId {
  return typeof value === 'string' && KNOWLEDGE_RECORD_ID_PATTERN.test(value);
}

/** Validate and brand a lattice knowledge record id; throws on invalid input. */
export function toKnowledgeRecordId(value: string, context: string): KnowledgeRecordId {
  if (!isKnowledgeRecordId(value)) {
    throw new Error(`${context}: invalid knowledge record id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Generate a fresh lattice knowledge record id (crypto-random). */
export function newKnowledgeRecordId(): KnowledgeRecordId {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `kcr_${hex}` as KnowledgeRecordId;
}

/** Branded knowledge patch id (kpatch_ + 32 lowercase hex). */
export type KnowledgePatchId = string & { readonly __brand: 'KnowledgePatchId' };

export const KNOWLEDGE_PATCH_ID_PATTERN_SOURCE = '^kpatch_[0-9a-f]{32}$';

const KNOWLEDGE_PATCH_ID_PATTERN = new RegExp(KNOWLEDGE_PATCH_ID_PATTERN_SOURCE);

export function isKnowledgePatchId(value: unknown): value is KnowledgePatchId {
  return typeof value === 'string' && KNOWLEDGE_PATCH_ID_PATTERN.test(value);
}

export function toKnowledgePatchId(value: string, context: string): KnowledgePatchId {
  if (!isKnowledgePatchId(value)) {
    throw new Error(`${context}: invalid knowledge patch id: ${JSON.stringify(value)}`);
  }
  return value;
}

export function newKnowledgePatchId(): KnowledgePatchId {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `kpatch_${hex}` as KnowledgePatchId;
}

/** Plain-JSON value type (the only shape records may carry). */
export type PlainJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PlainJsonValue[]
  | { readonly [key: string]: PlainJsonValue };

export function isPlainJsonValue(value: unknown): value is PlainJsonValue {
  if (value === null) return true;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) return value.every(isPlainJsonValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isPlainJsonValue);
  }
  return false;
}

/** Deep-freeze a plain-JSON value (records are immutable at every level). */
export function deepFreeze<T extends PlainJsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    Object.freeze(value);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, PlainJsonValue>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isKnowledgeCaptureTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value);
}

/** Normalize a time input to a ms-precision UTC ISO timestamp. */
export function toKnowledgeCaptureTimestamp(input: number | string | Date): string {
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`invalid timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

/** Deterministic canonical key over a plain-JSON value (sorted keys). */
export function canonicalContentKey(value: PlainJsonValue): string {
  const walk = (input: PlainJsonValue): string => {
    if (input === null) return 'null';
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'number') return `n:${input}`;
    if (typeof input === 'string') return `s:${JSON.stringify(input)}`;
    if (Array.isArray(input)) return `[${input.map(walk).join(',')}]`;
    const entries = Object.entries(input as { readonly [k: string]: PlainJsonValue });
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${walk(v)}`).join(',')}}`;
  };
  return walk(value);
}
