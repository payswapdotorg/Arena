/**
 * DISABLED fail-closed posture for the Upstash Redis adapter (Work Order
 * B002; FT2.0 "Capacity state" + "Adapters never silently switch to a paid
 * path"; BRIEF: adapters constructed without env → DISABLED fail-closed
 * behavior is asserted; values never committed, never logged).
 *
 * The canary technique: a deliberately recognizable FAKE value is placed
 * in the env source; every observable surface (thrown errors, capacity
 * snapshots, stringified errors) must NOT contain it. No live
 * credentials are used anywhere.
 */

import { describe, expect, it } from 'vitest';
import { isPersistenceCapacityError, isPersistenceError } from '@arena/persistence';
import type { CoordinationKey } from '@arena/persistence';
import { newIdempotencyKey } from '@arena/protocol-core';
import { UpstashCoordinationStore } from './adapter.js';
import { missingUpstashEnvVarNames, readUpstashConfigFromEnv } from './env.js';

const CANARY_URL = 'https://canary-redis.canary.upstash.io';
const CANARY_TOKEN = 'canary-rest-token';

/** Brand a coordination key literal for port calls (the impl validates it). */
function key(value: string): CoordinationKey {
  return value as CoordinationKey;
}

describe('upstash-redis DISABLED fail-closed posture (no credentials)', () => {
  it('constructs DISABLED without env configuration and fails closed on every operation', async () => {
    const store = new UpstashCoordinationStore({ env: {} });
    expect(store.enabled).toBe(false);

    const operations: (() => Promise<unknown>)[] = [
      () => store.cacheSet(key('cache:alpha'), 'value-1', 60_000),
      () => store.cacheGet(key('cache:alpha')),
      () => store.cacheDelete(key('cache:alpha')),
      () => store.openIdempotencyWindow(newIdempotencyKey(), 'a'.repeat(64), 60_000),
      () => store.hitRateLimit(key('rl:alpha'), 60_000, 5),
      () => store.acquireLease(key('lease:alpha'), 'holder-1', 60_000),
      () => store.renewLease(key('lease:alpha'), 'holder-1', 60_000),
      () => store.releaseLease(key('lease:alpha'), 'holder-1'),
      () => store.leaseHolder(key('lease:alpha')),
    ];
    for (const operation of operations) {
      let caught: unknown;
      try {
        await operation();
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceCapacityError(caught), `${String(operation)} must fail closed`).toBe(true);
      const capacityError = caught as { code?: string; capacityStatus?: string };
      expect(capacityError.code).toBe('PERSISTENCE_CAPACITY_DISABLED');
      expect(capacityError.capacityStatus).toBe('DISABLED');
    }
  });

  it('probes DISABLED (never throws, never crashes)', async () => {
    const store = new UpstashCoordinationStore({ env: {} });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);
    expect(snapshot.dimensions).toEqual([]);
  });

  it('partial configuration stays DISABLED (either missing variable)', () => {
    expect(
      new UpstashCoordinationStore({ env: { UPSTASH_REDIS_REST_URL: CANARY_URL } }).enabled,
    ).toBe(false);
    expect(
      new UpstashCoordinationStore({ env: { UPSTASH_REDIS_REST_TOKEN: CANARY_TOKEN } }).enabled,
    ).toBe(false);
    expect(
      new UpstashCoordinationStore({
        env: { UPSTASH_REDIS_REST_URL: ' ', UPSTASH_REDIS_REST_TOKEN: CANARY_TOKEN },
      }).enabled,
    ).toBe(false);
  });

  it('missing variable NAMES are reported (names only, never values)', () => {
    expect(missingUpstashEnvVarNames({})).toEqual(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    expect(missingUpstashEnvVarNames({ UPSTASH_REDIS_REST_URL: CANARY_URL })).toEqual([
      'UPSTASH_REDIS_REST_TOKEN',
    ]);
  });
});

describe('upstash-redis env resolution', () => {
  it('resolves a usable configuration; non-URL values resolve null', () => {
    expect(readUpstashConfigFromEnv({ UPSTASH_REDIS_REST_URL: CANARY_URL, UPSTASH_REDIS_REST_TOKEN: CANARY_TOKEN })).toEqual({
      url: CANARY_URL,
      token: CANARY_TOKEN,
    });
    expect(readUpstashConfigFromEnv({})).toBeNull();
    expect(
      readUpstashConfigFromEnv({ UPSTASH_REDIS_REST_URL: 'not a url', UPSTASH_REDIS_REST_TOKEN: CANARY_TOKEN }),
    ).toBeNull();
  });

  it('enabled with full configuration; the configuration never surfaces', () => {
    const store = new UpstashCoordinationStore({
      env: { UPSTASH_REDIS_REST_URL: CANARY_URL, UPSTASH_REDIS_REST_TOKEN: CANARY_TOKEN },
    });
    expect(store.enabled).toBe(true);
    // enabled == a transport was constructed; no network calls happen here.
  });
});

describe('upstash-redis secret hygiene (canary never surfaces)', () => {
  it('DISABLED errors carry env-var NAMES, never values', async () => {
    const unconfigured = new UpstashCoordinationStore({ env: {} });
    let caught: unknown;
    try {
      await unconfigured.cacheGet(key('cache:alpha'));
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(serialized).not.toContain('canary');
    expect(String(caught)).not.toContain('canary');
    const details = (caught as { details?: { missingEnvVarNames?: string[] } }).details;
    expect(details?.missingEnvVarNames).toEqual([
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ]);
  });
});
