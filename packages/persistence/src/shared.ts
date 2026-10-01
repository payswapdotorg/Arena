/**
 * Shared vocabulary for @arena/persistence (Work Order B002; issue #64).
 *
 * Branded key types, closed patterns, the canonical-JSON-safe value type,
 * deep-freeze helpers and the injected Clock seam. Everything here is
 * provider-neutral by construction (see the hygiene suite: no provider
 * name, auth-shaped word or alternate-route word appears in this
 * package's non-test sources).
 */

import { canonicalJson } from '@arena/protocol-core';
import type { Brand } from '@arena/protocol-core';
import { PERSISTENCE_ERROR_CODES, PersistenceError } from './errors.js';

// ---------------------------------------------------------------------------
// Bounded identifiers
// ---------------------------------------------------------------------------

/**
 * Coordination keys: the bounded, rebuildable store's addressing space.
 * Same charset as the protocol identifiers plus ':' for namespacing, max
 * 128 chars. URL-path safe (never percent-encoded by transports).
 */
export const COORDINATION_KEY_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const COORDINATION_KEY_PATTERN = new RegExp(COORDINATION_KEY_PATTERN_SOURCE);

export type CoordinationKey = Brand<string, 'CoordinationKey'>;

export function isCoordinationKey(value: unknown): value is CoordinationKey {
  return typeof value === 'string' && COORDINATION_KEY_PATTERN.test(value);
}

/** Validate and brand a coordination key; throws PersistenceError when invalid. */
export function toCoordinationKey(value: string): CoordinationKey {
  if (!isCoordinationKey(value)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_KEY, {
      message: `invalid coordination key: ${JSON.stringify(value)}`,
      details: { pattern: COORDINATION_KEY_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Control-plane record ids: caller-supplied stable identifiers. */
export const RECORD_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const RECORD_ID_PATTERN = new RegExp(RECORD_ID_PATTERN_SOURCE);

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

/** Tenant ids: the tenancy scoping vocabulary (architecture-lock tenancy rules). */
export const TENANT_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
const TENANT_ID_PATTERN = new RegExp(TENANT_ID_PATTERN_SOURCE);

export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

/** Record kinds: closed per consuming service, bounded here. */
export const RECORD_KIND_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
const RECORD_KIND_PATTERN = new RegExp(RECORD_KIND_PATTERN_SOURCE);

export function isRecordKind(value: unknown): value is string {
  return typeof value === 'string' && RECORD_KIND_PATTERN.test(value);
}

/** Neutral logical provider ids (roles like 'control-plane', 'blob-store'). */
export const PROVIDER_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
const PROVIDER_ID_PATTERN = new RegExp(PROVIDER_ID_PATTERN_SOURCE);

export function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value);
}

/** Lease holder ids: bounded like coordination keys. */
export function isLeaseHolder(value: unknown): value is string {
  return isCoordinationKey(value);
}

// ---------------------------------------------------------------------------
// Canonical-JSON-safe payloads
// ---------------------------------------------------------------------------

/** Values that survive canonical JSON serialization unchanged. */
export type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue };

/**
 * Structural check for canonical-JSON-safe values (finite numbers only,
 * no undefined, no symbols, no functions). Rejects anything the canonical
 * serializer would silently corrupt.
 */
export function isJsonSafeValue(value: unknown, depth = 0): value is JsonSafeValue {
  if (depth > 64) return false;
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) {
        return value.every((entry) => isJsonSafeValue(entry, depth + 1));
      }
      if (value instanceof Date || value instanceof Uint8Array) return false;
      const record = value as Record<string, unknown>;
      return Object.keys(record).every((key) => isJsonSafeValue(record[key], depth + 1));
    }
    default:
      return false;
  }
}

/** Validate a control-plane payload; throws PersistenceError when unsafe. */
export function toRecordData(value: unknown): JsonSafeValue {
  if (!isJsonSafeValue(value)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: 'record data must be canonical-JSON-safe (finite numbers, no undefined/symbols)',
    });
  }
  return value;
}

/** Canonical-JSON equality for two payloads (deterministic insert replay). */
export function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Deep freeze (returned records are frozen — read discipline)
// ---------------------------------------------------------------------------

/** Recursively freeze a JSON-safe value (records/arrays/leaves). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Maximum cache value length in characters (bounded/rebuildable state only). */
export const MAX_CACHE_VALUE_LENGTH = 4096;
/** Maximum blob size in bytes (large immutable artifacts; 512 MiB default). */
export const MAX_BLOB_BYTES = 512 * 1024 * 1024;
/** Maximum metadata entries per blob put. */
export const MAX_BLOB_METADATA_ENTRIES = 16;
/** Maximum metadata key/value length per blob put. */
export const MAX_BLOB_METADATA_FIELD_LENGTH = 128;
/** Maximum rate-limit limit value. */
export const MAX_RATE_LIMIT = 1_000_000;
/** Maximum TTL in milliseconds (30 days — rebuildable state only). */
export const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
