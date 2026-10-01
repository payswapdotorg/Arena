/**
 * FakeCoordinationStore (Work Order B002) — the local in-memory
 * implementation of the bounded coordination port with FULL contract
 * parity with the hosted adapter (shared contract suite; FT2.0 "Local
 * parity"). All TTL semantics are evaluated against the injected clock,
 * so expiry is deterministic under ManualClock.
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';
import type { Clock } from '../ports/clock.js';
import {
  validateCacheSetArgs,
  validateIdempotencyArgs,
  validateLeaseArgs,
  validateRateLimitArgs,
  windowStartFor,
} from '../ports/coordination-store.js';
import type {
  CoordinationStore,
  IdempotencyWindowResult,
  RateLimitResult,
} from '../ports/coordination-store.js';
import type { CoordinationKey } from '../shared.js';
import { SystemClock } from './clock.js';
import type { IdempotencyKey } from '@arena/protocol-core';

interface TtlEntry {
  readonly value: string;
  readonly expiresAt: number;
}

interface LeaseEntry {
  readonly holder: string;
  readonly expiresAt: number;
}

export interface FakeCoordinationStoreOptions {
  readonly clock?: Clock;
}

export class FakeCoordinationStore implements CoordinationStore {
  private readonly clock: Clock;
  private readonly cache = new Map<string, TtlEntry>();
  private readonly idempotency = new Map<string, TtlEntry>();
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();
  private readonly leases = new Map<string, LeaseEntry>();

  constructor(options: FakeCoordinationStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  async cacheSet(key: CoordinationKey, value: string, ttlMs: number): Promise<void> {
    const args = validateCacheSetArgs(key, value, ttlMs);
    this.cache.set(args.key, { value: args.value, expiresAt: this.clock.now() + args.ttlMs });
  }

  async cacheGet(key: CoordinationKey): Promise<string | null> {
    const entry = this.cache.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async cacheDelete(key: CoordinationKey): Promise<boolean> {
    return this.cache.delete(key);
  }

  async openIdempotencyWindow(
    key: IdempotencyKey,
    payloadDigest: string,
    ttlMs: number,
  ): Promise<IdempotencyWindowResult> {
    const args = validateIdempotencyArgs(key, payloadDigest, ttlMs);
    const existing = this.idempotency.get(args.key);
    const now = this.clock.now();
    if (existing !== undefined && existing.expiresAt > now) {
      if (existing.value !== args.payloadDigest) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${args.key} is open with a different payload digest`,
          details: { key: args.key },
        });
      }
      return {
        outcome: 'duplicate',
        payloadDigest: existing.value,
        expiresAt: existing.expiresAt,
      };
    }
    const expiresAt = now + args.ttlMs;
    this.idempotency.set(args.key, { value: args.payloadDigest, expiresAt });
    return { outcome: 'opened', payloadDigest: args.payloadDigest, expiresAt };
  }

  async hitRateLimit(
    key: CoordinationKey,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitResult> {
    const args = validateRateLimitArgs(key, windowMs, limit);
    const now = this.clock.now();
    const start = windowStartFor(now, args.windowMs);
    const counterKey = `${args.key}:${String(start)}`;
    const existing = this.counters.get(counterKey);
    const count = (existing !== undefined && existing.expiresAt > now ? existing.count : 0) + 1;
    this.counters.set(counterKey, { count, expiresAt: start + args.windowMs });
    return {
      allowed: count <= args.limit,
      count,
      limit: args.limit,
      remaining: Math.max(0, args.limit - count),
      resetAt: start + args.windowMs,
    };
  }

  async acquireLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean> {
    const args = validateLeaseArgs(key, holder, ttlMs);
    const existing = this.leases.get(args.key);
    const now = this.clock.now();
    if (existing !== undefined && existing.expiresAt > now && existing.holder !== args.holder) {
      return false;
    }
    this.leases.set(args.key, { holder: args.holder, expiresAt: now + args.ttlMs });
    return true;
  }

  async renewLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean> {
    const args = validateLeaseArgs(key, holder, ttlMs);
    const existing = this.leases.get(args.key);
    const now = this.clock.now();
    if (existing === undefined || existing.expiresAt <= now || existing.holder !== args.holder) {
      return false;
    }
    this.leases.set(args.key, { holder: args.holder, expiresAt: now + args.ttlMs });
    return true;
  }

  async releaseLease(key: CoordinationKey, holder: string): Promise<boolean> {
    if (!this.isLiveLease(key, holder)) return false;
    return this.leases.delete(key);
  }

  async leaseHolder(key: CoordinationKey): Promise<string | null> {
    const existing = this.leases.get(key);
    if (existing === undefined) return null;
    if (existing.expiresAt <= this.clock.now()) {
      this.leases.delete(key);
      return null;
    }
    return existing.holder;
  }

  /** Number of live cache entries (test/inspection helper). */
  get cacheSize(): number {
    return this.cache.size;
  }

  private isLiveLease(key: CoordinationKey, holder: string): boolean {
    const existing = this.leases.get(key);
    return (
      existing !== undefined &&
      existing.expiresAt > this.clock.now() &&
      existing.holder === holder
    );
  }
}
