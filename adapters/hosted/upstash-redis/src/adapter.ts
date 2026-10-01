/**
 * Upstash Redis adapter over the CoordinationStore port (Work Order B002;
 * issue #64; FT2.0 "Redis": bounded/rebuildable state ONLY — short-lived
 * cache, idempotency windows, rate-limit counters, ephemeral locks/
 * leases; authoritative facts remain in the control plane or immutable
 * artifact storage).
 *
 * Posture:
 *   - configuration comes ONLY from server-side env vars
 *     (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — see ./env.ts);
 *     values are never committed and never logged;
 *   - without configuration the adapter is DISABLED and fails closed:
 *     every port operation throws the typed capacity error
 *     (PERSISTENCE_CAPACITY_DISABLED) BEFORE any network call, and the
 *     capacity probe reports DISABLED — no crash, no secret leakage;
 *   - the infrastructure touchpoint is the injected RestCommandTransport
 *     seam (plain fetch REST — ZERO new dependencies), so the full
 *     persistence contract suite runs against this adapter without live
 *     credentials;
 *   - keys are namespaced and bounded (`arena:<surface>:<key>`); values
 *     stay bounded (MAX_CACHE_VALUE_LENGTH) — rebuildable state only;
 *   - FT2.0 fail-closed discipline: EXHAUSTED/DISABLED states surface as
 *     typed errors; no alternate path is representable anywhere in this
 *     adapter (there is no second destination to switch to).
 */

import {
  PERSISTENCE_ERROR_CODES,
  PersistenceCapacityError,
  PersistenceError,
  SystemClock,
  toCapacityDimensionReading,
  toCapacitySnapshot,
  toCoordinationKey,
  validateCacheSetArgs,
  validateIdempotencyArgs,
  validateLeaseArgs,
  validateLeaseHolder,
  validateRateLimitArgs,
  windowStartFor,
} from '@arena/persistence';
import type {
  CapacityDimensionReading,
  CapacityProbe,
  CapacitySnapshot,
  Clock,
  CoordinationKey,
  CoordinationStore,
  IdempotencyWindowResult,
  RateLimitResult,
} from '@arena/persistence';
import type { IdempotencyKey } from '@arena/protocol-core';
import { missingUpstashEnvVarNames, readUpstashConfigFromEnv } from './env.js';
import { createUpstashRestTransport, executeRestCommand } from './rest-transport.js';
import type { RestCommandTransport } from './rest-transport.js';

/** Declared allowance input (limit only — usage is a deployment-tier concern). */
export interface UpstashDeclaredAllowance {
  readonly dimension: string;
  readonly limit: number;
  readonly windowMs?: number;
}

export interface UpstashCoordinationStoreOptions {
  /** Env source; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  /** Injected transport (tests / alternative runtimes). Overrides env discovery. */
  readonly transport?: RestCommandTransport;
  readonly clock?: Clock;
  /** Declared free-tier allowances surfaced through the capacity probe. */
  readonly declaredAllowances?: readonly UpstashDeclaredAllowance[];
  /**
   * Optional key namespace prefix prepended to every key this store issues
   * (default: none). MUST match /^$|^[a-z0-9][a-z0-9-]{0,62}:$/ — lowercase
   * alphanumeric/hyphen, colon-terminated, bounded. Live contract runs use a
   * run-unique prefix so the shared free-tier Redis NEVER carries state
   * between runs (hermetic live tests); production leaves it empty.
   */
  readonly keyNamespacePrefix?: string;
}

/** Key namespaces for the four bounded sub-surfaces (collision-free by construction). */
export const UPSTASH_KEY_NAMESPACES = Object.freeze({
  cache: 'arena:cache',
  idempotency: 'arena:idem',
  rateLimit: 'arena:rl',
  lease: 'arena:lease',
} as const);

export class UpstashCoordinationStore implements CoordinationStore, CapacityProbe {
  private readonly transport: RestCommandTransport | null;
  private readonly clock: Clock;
  private readonly declaredDimensions: readonly CapacityDimensionReading[];
  private readonly missingEnvNames: readonly string[];
  private readonly keyPrefix: string;

  constructor(options: UpstashCoordinationStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.missingEnvNames = missingUpstashEnvVarNames(options.env ?? process.env);
    this.keyPrefix = validateKeyNamespacePrefix(options.keyNamespacePrefix ?? '');
    if (options.transport !== undefined) {
      this.transport = options.transport;
    } else {
      const config = readUpstashConfigFromEnv(options.env ?? process.env);
      // No configuration -> DISABLED (fail closed; no transport is constructed).
      this.transport = config !== null ? createUpstashRestTransport(config) : null;
    }
    this.declaredDimensions = (options.declaredAllowances ?? []).map((allowance) =>
      toCapacityDimensionReading({
        dimension: allowance.dimension,
        used: null,
        limit: allowance.limit,
        remaining: null,
        ...(allowance.windowMs !== undefined ? { windowMs: allowance.windowMs } : {}),
      }),
    );
  }

  async capacityProbe(): Promise<CapacitySnapshot> {
    if (this.transport === null) {
      return toCapacitySnapshot({
        status: 'DISABLED',
        checkedAt: this.clock.now(),
        dimensions: [],
        reasons: [{ code: 'configuration-missing' }],
      });
    }
    try {
      const pong = await executeRestCommand(this.transport, { command: 'PING' });
      if (pong !== 'PONG') {
        return toCapacitySnapshot({
          status: 'DEGRADED',
          checkedAt: this.clock.now(),
          dimensions: this.declaredDimensions,
          reasons: [{ code: 'probe-failed' }],
        });
      }
      return toCapacitySnapshot({
        status: 'AVAILABLE',
        checkedAt: this.clock.now(),
        dimensions: this.declaredDimensions,
        reasons: this.declaredDimensions.length === 0 ? [{ code: 'no-dimensions' }] : [],
      });
    } catch {
      return toCapacitySnapshot({
        status: 'DEGRADED',
        checkedAt: this.clock.now(),
        dimensions: this.declaredDimensions,
        reasons: [{ code: 'probe-failed' }],
      });
    }
  }

  async cacheSet(key: CoordinationKey, value: string, ttlMs: number): Promise<void> {
    const transport = this.gate();
    const args = validateCacheSetArgs(key, value, ttlMs);
    const result = await executeRestCommand(transport, {
      command: 'SET',
      key: this.cacheKey(args.key),
      value: args.value,
      ttlMs: args.ttlMs,
    });
    expectOk(result, 'SET');
  }

  async cacheGet(key: CoordinationKey): Promise<string | null> {
    const transport = this.gate();
    const validated = toCoordinationKey(key);
    const result = await executeRestCommand(transport, {
      command: 'GET',
      key: this.cacheKey(validated),
    });
    return result === null ? null : String(result);
  }

  async cacheDelete(key: CoordinationKey): Promise<boolean> {
    const transport = this.gate();
    const validated = toCoordinationKey(key);
    const result = await executeRestCommand(transport, {
      command: 'DEL',
      key: this.cacheKey(validated),
    });
    return result === 1;
  }

  async openIdempotencyWindow(
    key: IdempotencyKey,
    payloadDigest: string,
    ttlMs: number,
  ): Promise<IdempotencyWindowResult> {
    const transport = this.gate();
    const args = validateIdempotencyArgs(key, payloadDigest, ttlMs);
    const now = this.clock.now();
    const namespaced = this.namespacedKey(UPSTASH_KEY_NAMESPACES.idempotency, args.key);
    // The stored value carries the window's ABSOLUTE expiry alongside the
    // digest (`v1:<digest>:<expiresAtEpochMs>`), so a replay returns the SAME
    // expiresAt the open returned — deterministically, regardless of transport
    // latency or clock drift between the calls. Digests are lowercase hex
    // (16..128 chars), so the `:`-delimited encoding is unambiguous.
    const opened = await executeRestCommand(transport, {
      command: 'SET',
      key: namespaced,
      value: encodeIdempotencyValue(args.payloadDigest, now + args.ttlMs),
      ttlMs: args.ttlMs,
      nx: true,
    });
    if (opened === 'OK') {
      return { outcome: 'opened', payloadDigest: args.payloadDigest, expiresAt: now + args.ttlMs };
    }
    const existing = await executeRestCommand(transport, { command: 'GET', key: namespaced });
    if (existing === null || typeof existing !== 'string') {
      // No LIVE window (expired between the two commands): reopen plainly.
      const reopenAt = this.clock.now();
      await executeRestCommand(transport, {
        command: 'SET',
        key: namespaced,
        value: encodeIdempotencyValue(args.payloadDigest, reopenAt + args.ttlMs),
        ttlMs: args.ttlMs,
      });
      return {
        outcome: 'opened',
        payloadDigest: args.payloadDigest,
        expiresAt: reopenAt + args.ttlMs,
      };
    }
    const decoded = decodeIdempotencyValue(existing);
    if (decoded === null) {
      // Legacy entry holding a bare digest (written before the encoded
      // format): keep the PTTL-derived expiry for compatibility.
      if (existing !== args.payloadDigest) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${args.key} is open with a different payload digest`,
          details: { key: args.key },
        });
      }
      const remaining = await executeRestCommand(transport, {
        command: 'PTTL',
        key: namespaced,
      });
      const ttlRemaining = typeof remaining === 'number' && remaining > 0 ? remaining : 0;
      return {
        outcome: 'duplicate',
        payloadDigest: existing,
        expiresAt: this.clock.now() + ttlRemaining,
      };
    }
    if (decoded.digest !== args.payloadDigest) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${args.key} is open with a different payload digest`,
        details: { key: args.key },
      });
    }
    // Deterministic replay: the window's expiry is the one recorded at open.
    return {
      outcome: 'duplicate',
      payloadDigest: decoded.digest,
      expiresAt: decoded.expiresAt,
    };
  }

  async hitRateLimit(
    key: CoordinationKey,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitResult> {
    const transport = this.gate();
    const args = validateRateLimitArgs(key, windowMs, limit);
    const now = this.clock.now();
    const start = windowStartFor(now, args.windowMs);
    const resetAt = start + args.windowMs;
    const counterKey = this.namespacedKey(
      UPSTASH_KEY_NAMESPACES.rateLimit,
      `${args.key}:${String(start)}`,
    );
    const count = await executeRestCommand(transport, { command: 'INCR', key: counterKey });
    if (typeof count !== 'number' || !Number.isInteger(count)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
        message: 'rate-limit counter command returned a non-integer count',
      });
    }
    if (count === 1) {
      // Bind the fresh counter to its window so it self-expires at resetAt
      // (bounded/rebuildable state; never leaks past the window).
      await executeRestCommand(transport, {
        command: 'PEXPIRE',
        key: counterKey,
        ttlMs: resetAt - now,
      });
    }
    return {
      allowed: count <= args.limit,
      count,
      limit: args.limit,
      remaining: Math.max(0, args.limit - count),
      resetAt,
    };
  }

  async acquireLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean> {
    const transport = this.gate();
    const args = validateLeaseArgs(key, holder, ttlMs);
    const namespaced = this.leaseKey(args.key);
    const acquired = await executeRestCommand(transport, {
      command: 'SET',
      key: namespaced,
      value: args.holder,
      ttlMs: args.ttlMs,
      nx: true,
    });
    if (acquired === 'OK') return true;
    const existing = await executeRestCommand(transport, { command: 'GET', key: namespaced });
    if (existing === args.holder) {
      // Same-holder re-acquire extends the TTL.
      await executeRestCommand(transport, {
        command: 'SET',
        key: namespaced,
        value: args.holder,
        ttlMs: args.ttlMs,
      });
      return true;
    }
    return false;
  }

  async renewLease(key: CoordinationKey, holder: string, ttlMs: number): Promise<boolean> {
    const transport = this.gate();
    const args = validateLeaseArgs(key, holder, ttlMs);
    const existing = await executeRestCommand(transport, {
      command: 'GET',
      key: this.leaseKey(args.key),
    });
    if (existing !== args.holder) return false;
    await executeRestCommand(transport, {
      command: 'SET',
      key: this.leaseKey(args.key),
      value: args.holder,
      ttlMs: args.ttlMs,
    });
    return true;
  }

  async releaseLease(key: CoordinationKey, holder: string): Promise<boolean> {
    const transport = this.gate();
    const validated = toCoordinationKey(key);
    validateLeaseHolder(holder);
    const namespaced = this.leaseKey(validated);
    const existing = await executeRestCommand(transport, { command: 'GET', key: namespaced });
    if (existing !== holder) return false;
    const deleted = await executeRestCommand(transport, { command: 'DEL', key: namespaced });
    return deleted === 1;
  }

  async leaseHolder(key: CoordinationKey): Promise<string | null> {
    const transport = this.gate();
    const validated = toCoordinationKey(key);
    const existing = await executeRestCommand(transport, {
      command: 'GET',
      key: this.leaseKey(validated),
    });
    return existing === null ? null : String(existing);
  }

  /** True when the adapter has configuration / a transport (not DISABLED). */
  get enabled(): boolean {
    return this.transport !== null;
  }

  /** Full key for a sub-surface: `<prefix?><namespace>:<key>`. */
  private namespacedKey(namespace: string, key: string): string {
    return `${this.keyPrefix}${namespace}:${key}`;
  }

  private leaseKey(key: CoordinationKey): string {
    return this.namespacedKey(UPSTASH_KEY_NAMESPACES.lease, key);
  }

  private cacheKey(key: CoordinationKey): string {
    return this.namespacedKey(UPSTASH_KEY_NAMESPACES.cache, key);
  }

  private gate(): RestCommandTransport {
    if (this.transport === null) {
      throw new PersistenceCapacityError(
        PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
        'DISABLED',
        [{ code: 'configuration-missing' }],
        {
          message:
            'the hosted coordination adapter is disabled: no REST configuration was provided (fail closed)',
          details: {
            missingEnvVarNames: this.missingEnvNames,
          },
        },
      );
    }
    return this.transport;
  }
}

function validateKeyNamespacePrefix(prefix: string): string {
  if (!/^(?:|[a-z0-9][a-z0-9-]{0,62}:)$/.test(prefix)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_COORDINATION_KEY, {
      message:
        'invalid keyNamespacePrefix: must be empty or lowercase alphanumeric/hyphen ending with a colon',
      details: { length: prefix.length },
    });
  }
  return prefix;
}

/**
 * Encode an idempotency window entry: `v1:<digest>:<expiresAtEpochMs>`. The
 * digest is 16..128 lowercase hex, so the encoding is unambiguous and a
 * replay can return the open-time expiry VERBATIM (deterministic replays
 * even under live transport latency).
 */
function encodeIdempotencyValue(digest: string, expiresAt: number): string {
  return `v1:${digest}:${String(expiresAt)}`;
}

/** Decode an encoded idempotency entry; null when the value is not encoded. */
function decodeIdempotencyValue(
  raw: string,
): { digest: string; expiresAt: number } | null {
  const match = /^v1:([0-9a-f]{16,128}):(\d{1,16})$/.exec(raw);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return { digest: match[1], expiresAt: Number(match[2]) };
}

function expectOk(result: string | number | null, command: string): void {
  if (result !== 'OK') {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
      message: `command ${command} did not acknowledge on the hosted coordination transport`,
      details: { command },
    });
  }
}
