/**
 * CoordinationStore port (Work Order B002; issue #64; FT2.0 coordination
 * storage discipline: bounded/rebuildable state ONLY — short-lived cache,
 * idempotency windows, rate-limit counters, ephemeral locks/leases.
 * Authoritative facts remain in the control plane or immutable artifact
 * storage).
 *
 * Four bounded sub-surfaces, all TTL-disciplined:
 *
 *   - cache: get/set/delete of bounded string values with a TTL;
 *   - idempotency windows: replay-detection for command keys (same key +
 *     same payload digest = duplicate; same key + different digest =
 *     typed conflict — architecture-lock rule 17 discipline);
 *   - rate-limit counters: fixed-window counters with explicit limit;
 *   - leases: ephemeral named locks with holder identity and TTL.
 *
 * Everything here is rebuildable by definition: losing the store loses NO
 * authoritative Arena state. Keys are bounded (COORDINATION_KEY_PATTERN)
 * and values bounded (MAX_CACHE_VALUE_LENGTH) — implementations MUST
 * enforce both.
 */

import type { IdempotencyKey } from '@arena/protocol-core';
import { isIdempotencyKey } from '@arena/protocol-core';
import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';
import {
  isCoordinationKey,
  isLeaseHolder,
  MAX_CACHE_VALUE_LENGTH,
  MAX_RATE_LIMIT,
  MAX_TTL_MS,
  toCoordinationKey,
} from '../shared.js';
import type { CoordinationKey } from '../shared.js';

/** Outcome of opening an idempotency window. */
export type IdempotencyWindowOutcome = 'opened' | 'duplicate';

export interface IdempotencyWindowResult {
  readonly outcome: IdempotencyWindowOutcome;
  /** The payload digest recorded for the window. */
  readonly payloadDigest: string;
  /** When the window expires (epoch ms). */
  readonly expiresAt: number;
}

/** Fixed-window rate-limit decision. */
export interface RateLimitResult {
  /** True when this hit was within the limit. */
  readonly allowed: boolean;
  /** Hits in the current window INCLUDING this one. */
  readonly count: number;
  readonly limit: number;
  /** max(0, limit - count). */
  readonly remaining: number;
  /** When the current window resets (epoch ms). */
  readonly resetAt: number;
}

/**
 * The provider-neutral bounded coordination port. Implementations: fakes
 * (local parity) and hosted adapters. Values and keys are bounded; every
 * entry is TTL-expired lazily or eagerly — expiry semantics are asserted
 * by the shared contract suite.
 */
export interface CoordinationStore {
  /** Set a bounded cache value with a TTL (ms). */
  cacheSet(key: CoordinationKey, value: string, ttlMs: number): Promise<void>;
  /** The live value, or null when absent/expired. */
  cacheGet(key: CoordinationKey): Promise<string | null>;
  /** True when a live entry was deleted. */
  cacheDelete(key: CoordinationKey): Promise<boolean>;
  /**
   * Open (or replay) an idempotency window for a command key. Same digest
   * -> 'duplicate'; different digest under an unexpired window ->
   * PERSISTENCE_IDEMPOTENCY_CONFLICT; expired windows are reopened.
   */
  openIdempotencyWindow(
    key: IdempotencyKey,
    payloadDigest: string,
    ttlMs: number,
  ): Promise<IdempotencyWindowResult>;
  /**
   * Fixed-window rate-limit hit. The window is aligned to
   * floor(now / windowMs) * windowMs; the counter is scoped to
   * (key, window start); decisions are deterministic given the clock.
   */
  hitRateLimit(key: CoordinationKey, windowMs: number, limit: number): Promise<RateLimitResult>;
  /**
   * Acquire an ephemeral lease: true when acquired (absent/expired, or
   * already held by the same holder — re-acquire extends the TTL), false
   * when another holder owns a live lease.
   */
  acquireLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean>;
  /** Extend a live lease the holder owns; false otherwise. */
  renewLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean>;
  /** Release a live lease the holder owns; false otherwise. */
  releaseLease(key: CoordinationKey, holder: string): Promise<boolean>;
  /** The live lease's holder, or null when absent/expired. */
  leaseHolder(key: CoordinationKey): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Shared validation (fail closed; used by fakes AND hosted adapters)
// ---------------------------------------------------------------------------

export function validateTtlMs(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TTL, {
      message: `ttlMs must be an integer in 1..${String(MAX_TTL_MS)}`,
      details: { received: ttlMs },
    });
  }
}

export function validateWindowMs(windowMs: number): void {
  if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > MAX_TTL_MS) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_WINDOW, {
      message: `windowMs must be an integer in 1..${String(MAX_TTL_MS)}`,
      details: { received: windowMs },
    });
  }
}

export function validateRateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RATE_LIMIT) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_LIMIT, {
      message: `limit must be an integer in 1..${String(MAX_RATE_LIMIT)}`,
      details: { received: limit },
    });
  }
}

export function validateCacheValue(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CACHE_VALUE_LENGTH) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_VALUE, {
      message: `cache value must be 1..${String(MAX_CACHE_VALUE_LENGTH)} characters`,
      details: { receivedLength: value.length },
    });
  }
}

export function validateLeaseHolder(holder: string): void {
  if (!isLeaseHolder(holder)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_HOLDER, {
      message: `invalid lease holder: ${JSON.stringify(holder)}`,
    });
  }
}

export function validatePayloadDigest(digest: string): void {
  if (typeof digest !== 'string' || !/^[0-9a-f]{16,128}$/.test(digest)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_VALUE, {
      message: 'payload digest must be 16..128 lowercase hex characters',
    });
  }
}

/** Normalize + validate the arguments of cacheSet (fail closed). */
export function validateCacheSetArgs(
  key: CoordinationKey,
  value: string,
  ttlMs: number,
): { key: CoordinationKey; value: string; ttlMs: number } {
  toCoordinationKey(key);
  validateCacheValue(value);
  validateTtlMs(ttlMs);
  return { key, value, ttlMs };
}

/** Normalize + validate the arguments of openIdempotencyWindow (fail closed). */
export function validateIdempotencyArgs(
  key: IdempotencyKey,
  payloadDigest: string,
  ttlMs: number,
): { key: IdempotencyKey; payloadDigest: string; ttlMs: number } {
  if (!isIdempotencyKey(key)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_KEY, {
      message: `invalid idempotency key: ${JSON.stringify(key)}`,
    });
  }
  validatePayloadDigest(payloadDigest);
  validateTtlMs(ttlMs);
  return { key, payloadDigest, ttlMs };
}

/** Normalize + validate the arguments of hitRateLimit (fail closed). */
export function validateRateLimitArgs(
  key: CoordinationKey,
  windowMs: number,
  limit: number,
): { key: CoordinationKey; windowMs: number; limit: number } {
  toCoordinationKey(key);
  validateWindowMs(windowMs);
  validateRateLimit(limit);
  return { key, windowMs, limit };
}

/** Normalize + validate the arguments of lease operations (fail closed). */
export function validateLeaseArgs(
  key: CoordinationKey,
  holder: string,
  ttlMs: number,
): { key: CoordinationKey; holder: string; ttlMs: number } {
  if (!isCoordinationKey(key)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_KEY, {
      message: `invalid coordination key: ${JSON.stringify(key)}`,
    });
  }
  validateLeaseHolder(holder);
  validateTtlMs(ttlMs);
  return { key, holder, ttlMs };
}

/** Fixed-window alignment: the window start containing `now`. */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}
