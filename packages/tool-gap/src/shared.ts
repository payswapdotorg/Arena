/**
 * Shared primitives for @arena/tool-gap (Work Order C008) — mirrors the
 * sibling domain packages' discipline (@arena/intervention, @arena/
 * expert-session): branded identifiers with a strict wire pattern,
 * ms-precision UTC timestamps, deep-frozen plain JSON, and a
 * deterministic content key for duplicate-signal detection.
 */

/** Wire version of the tool-gap record surface. */
export const TOOL_GAP_WIRE_VERSION = 1 as const;

/** Branded tool-gap signal record id (tgs_ + 32 lowercase hex). */
export type ToolGapSignalId = string & { readonly __brand: 'ToolGapSignalId' };

/** Exact pattern source for tool-gap signal record ids. */
export const TOOL_GAP_SIGNAL_ID_PATTERN_SOURCE = '^tgs_[0-9a-f]{32}$';

const TOOL_GAP_SIGNAL_ID_PATTERN = new RegExp(TOOL_GAP_SIGNAL_ID_PATTERN_SOURCE);

export function isToolGapSignalId(value: unknown): value is ToolGapSignalId {
  return typeof value === 'string' && TOOL_GAP_SIGNAL_ID_PATTERN.test(value);
}

/** Validate and brand a tool-gap signal record id; throws on invalid input. */
export function toToolGapSignalId(value: string, context: string): ToolGapSignalId {
  if (!isToolGapSignalId(value)) {
    throw new Error(`${context}: invalid tool-gap signal record id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Generate a fresh tool-gap signal record id (crypto-random). */
export function newToolGapSignalId(): ToolGapSignalId {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tgs_${hex}` as ToolGapSignalId;
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

export function isToolGapTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value);
}

/** Normalize a time input to a ms-precision UTC ISO timestamp. */
export function toToolGapTimestamp(input: number | string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  const ms = typeof input === 'number' ? input : date.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`invalid timestamp input: ${JSON.stringify(input)}`);
  }
  return new Date(ms).toISOString();
}

/**
 * Deterministic canonical key over a plain-JSON value (sorted object keys,
 * stable serialization). Used for duplicate-signal detection: two captures
 * of the same signal content yield the SAME key — injected duplicates can
 * never inflate triage counts.
 */
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
