/**
 * The shared persistence contract suite runs against the Upstash Redis
 * adapter through its injected RestCommandTransport seam (FT2.0 "Local
 * parity"): the SAME tests that pass against the in-memory fakes pass
 * against the hosted adapter's coordination logic here, with zero live
 * credentials. When the Upstash env vars exist in the environment (with
 * a usable https URL), the same suite additionally runs against the live
 * REST endpoint (skipped otherwise — tests never REQUIRE live
 * credentials).
 */

import { describe, expect, it } from 'vitest';
import {
  definePersistenceContractSuite,
  isPersistenceError,
  ManualClock,
} from '@arena/persistence';
import type { CoordinationKey } from '@arena/persistence';
import { newIdempotencyKey } from '@arena/protocol-core';
import { UPSTASH_KEY_NAMESPACES, UpstashCoordinationStore } from './adapter.js';
import { readUpstashConfigFromEnv } from './env.js';
import { encodeRestCommand } from './rest-transport.js';
import { FakeRestTransport } from './test-support.js';

const T0 = 1_700_000_000_000;

/** Brand a coordination key literal for port calls (the impl validates it). */
function key(value: string): CoordinationKey {
  return value as CoordinationKey;
}

definePersistenceContractSuite('upstash-redis (transport seam)', () => {
  const clock = new ManualClock(T0);
  const transport = new FakeRestTransport({ clock });
  return {
    coordination: new UpstashCoordinationStore({ transport, clock }),
    clock,
  };
});

// Live runs require a USABLE configuration (see ./env.ts).
const hasLiveCredentials = readUpstashConfigFromEnv() !== null;

/**
 * Run-unique key namespace prefix for live contract runs: the live suite
 * writes REAL keys into the shared free-tier Redis, so every run must own a
 * fresh namespace — live state NEVER leaks between runs (hermetic live
 * tests) and production keys (empty prefix) are never touched.
 */
function liveRunKeyPrefix(): string {
  const stamp = Date.now().toString(36);
  const entropy = Math.random().toString(36).slice(2, 10);
  return `arena-live-test-${stamp}-${entropy}:`;
}

describe.skipIf(!hasLiveCredentials)('upstash-redis live contract suite (credentials present)', () => {
  definePersistenceContractSuite('upstash-redis (live)', () => ({
    coordination: new UpstashCoordinationStore({
      keyNamespacePrefix: liveRunKeyPrefix(),
    }),
  }));
});

describe('upstash-redis adapter discipline', () => {
  it('namespaces every key per sub-surface (bounded, collision-free)', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeRestTransport({ clock });
    const store = new UpstashCoordinationStore({ transport, clock });
    await store.cacheSet(key('cache:alpha'), 'value-1', 60_000);
    await store.openIdempotencyWindow(newIdempotencyKey(), 'a'.repeat(64), 60_000);
    await store.hitRateLimit(key('rl:alpha'), 60_000, 5);
    await store.acquireLease(key('lease:alpha'), 'holder-1', 60_000);
    const keys = transport.liveKeys();
    expect(keys).toHaveLength(4);
    expect(keys.some((entry) => entry.startsWith(`${UPSTASH_KEY_NAMESPACES.cache}:`))).toBe(true);
    expect(keys.some((entry) => entry.startsWith(`${UPSTASH_KEY_NAMESPACES.idempotency}:`))).toBe(
      true,
    );
    expect(keys.some((entry) => entry.startsWith(`${UPSTASH_KEY_NAMESPACES.rateLimit}:`))).toBe(
      true,
    );
    expect(keys.some((entry) => entry.startsWith(`${UPSTASH_KEY_NAMESPACES.lease}:`))).toBe(true);
  });

  it('rate-limit counters self-expire at their window reset (bounded state)', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeRestTransport({ clock });
    const store = new UpstashCoordinationStore({ transport, clock });
    const hit = await store.hitRateLimit(key('rl:alpha'), 1_000, 5);
    expect(hit.count).toBe(1);
    // The counter key carries the window's TTL; advancing past the reset
    // drops it from the live set.
    clock.advance(1_001);
    expect(transport.liveKeys()).toEqual([]);
  });

  it('encodes commands to the flat REST argument form Upstash accepts', () => {
    expect(encodeRestCommand({ command: 'GET', key: 'k' })).toEqual(['GET', 'k']);
    expect(encodeRestCommand({ command: 'SET', key: 'k', value: 'v', ttlMs: 1500 })).toEqual([
      'SET',
      'k',
      'v',
      'PX',
      '1500',
    ]);
    expect(encodeRestCommand({ command: 'SET', key: 'k', value: 'v', ttlMs: 1500, nx: true })).toEqual([
      'SET',
      'k',
      'v',
      'PX',
      '1500',
      'NX',
    ]);
    expect(encodeRestCommand({ command: 'DEL', key: 'k' })).toEqual(['DEL', 'k']);
    expect(encodeRestCommand({ command: 'INCR', key: 'k' })).toEqual(['INCR', 'k']);
    expect(encodeRestCommand({ command: 'PEXPIRE', key: 'k', ttlMs: 42 })).toEqual([
      'PEXPIRE',
      'k',
      '42',
    ]);
    expect(encodeRestCommand({ command: 'PEXPIRE', key: 'k', ttlMs: 42, nx: true })).toEqual([
      'PEXPIRE',
      'k',
      '42',
      'NX',
    ]);
    expect(encodeRestCommand({ command: 'PTTL', key: 'k' })).toEqual(['PTTL', 'k']);
    expect(encodeRestCommand({ command: 'PING' })).toEqual(['PING']);
  });

  it('wraps transport failures in the typed TRANSPORT_FAILED error (no detail leak)', async () => {
    const CANARY = 'https://canary-rest.canary.upstash.io';
    const store = new UpstashCoordinationStore({
      transport: new FakeRestTransport({ fails: true }),
    });
    let caught: unknown;
    try {
      await store.cacheSet(key('cache:alpha'), 'value-1', 60_000);
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { message: string; code: string };
    expect(typed.code).toBe('PERSISTENCE_TRANSPORT_FAILED');
    expect(typed.message).not.toContain('canary');
    expect(String(caught)).not.toContain('canary');
    expect(String(caught)).not.toContain(CANARY);
  });

  it('probes AVAILABLE with a healthy transport and DEGRADED with a failing one', async () => {
    const clock = new ManualClock(T0);
    const healthy = new UpstashCoordinationStore({
      transport: new FakeRestTransport({ clock }),
      clock,
    });
    const snapshot = await healthy.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.checkedAt).toBe(T0);

    const failing = new UpstashCoordinationStore({
      transport: new FakeRestTransport({ clock, fails: true }),
      clock,
    });
    const degraded = await failing.capacityProbe();
    expect(degraded.status).toBe('DEGRADED');
    expect(degraded.reasons).toEqual([{ code: 'probe-failed' }]);
    expect(JSON.stringify(degraded)).not.toContain('ETIMEDOUT');

    const wrongPong = new UpstashCoordinationStore({
      transport: new FakeRestTransport({ clock, pingResult: 'NOPE' }),
      clock,
    });
    expect((await wrongPong.capacityProbe()).status).toBe('DEGRADED');
  });

  it('surfaces declared allowances as unknown-usage dimension readings', async () => {
    const store = new UpstashCoordinationStore({
      transport: new FakeRestTransport(),
      declaredAllowances: [{ dimension: 'requests', limit: 500_000, windowMs: 2_592_000_000 }],
    });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.dimensions).toEqual([
      { dimension: 'requests', used: null, limit: 500000, remaining: null, windowMs: 2592000000 },
    ]);
    expect(snapshot.reasons).toEqual([]);
  });

  it('prepends a validated keyNamespacePrefix to every issued key (isolated namespaces)', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeRestTransport({ clock });
    const store = new UpstashCoordinationStore({
      transport,
      clock,
      keyNamespacePrefix: 'arena-live-test-run42:',
    });
    await store.cacheSet(key('cache:alpha'), 'value-1', 60_000);
    await store.openIdempotencyWindow(newIdempotencyKey(), 'a'.repeat(64), 60_000);
    await store.hitRateLimit(key('rl:alpha'), 60_000, 5);
    await store.acquireLease(key('lease:alpha'), 'holder-1', 60_000);
    const keys = transport.liveKeys();
    expect(keys).toHaveLength(4);
    // EVERY key carries the run prefix before the sub-surface namespace, and
    // no bare production-namespace key was written.
    for (const entry of keys) {
      expect(entry.startsWith('arena-live-test-run42:')).toBe(true);
    }
    expect(keys.some((entry) => entry.startsWith('arena-live-test-run42:arena:cache:'))).toBe(true);
    expect(keys.some((entry) => entry.startsWith('arena-live-test-run42:arena:lease:'))).toBe(true);
    expect(keys.some((entry) => entry.startsWith('arena:cache:'))).toBe(false);
  });

  it('rejects malformed keyNamespacePrefix values with the typed coordination-key error', () => {
    const transport = new FakeRestTransport();
    for (const bad of ['arena', 'Arena:', 'arena:live:', 'arena live:', ':', 'x']) {
      let caught: unknown;
      try {
        new UpstashCoordinationStore({ transport, keyNamespacePrefix: bad });
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceError(caught)).toBe(true);
      expect((caught as { code: string }).code).toBe('PERSISTENCE_INVALID_COORDINATION_KEY');
    }
  });

  it('idempotency replays return the open-time expiry even when the clock advances between calls', async () => {
    // Regression: replays used to recompute `expiresAt` from PTTL + the
    // CURRENT clock, so any latency between open and replay drifted the
    // reported expiry. The stored value now carries the absolute expiry, so
    // the replay returns it VERBATIM (deterministic windows).
    const clock = new ManualClock(T0);
    const transport = new FakeRestTransport({ clock });
    const store = new UpstashCoordinationStore({ transport, clock });
    const windowKey = newIdempotencyKey();
    const first = await store.openIdempotencyWindow(windowKey, 'd'.repeat(64), 60_000);
    expect(first.outcome).toBe('opened');
    clock.advance(2_000); // "latency" between open and replay
    const replay = await store.openIdempotencyWindow(windowKey, 'd'.repeat(64), 60_000);
    expect(replay.outcome).toBe('duplicate');
    expect(replay.expiresAt).toBe(first.expiresAt);
    expect(replay.payloadDigest).toBe(first.payloadDigest);
  });
});
