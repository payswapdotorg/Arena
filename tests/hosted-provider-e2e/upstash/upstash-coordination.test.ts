/**
 * P004 — Upstash coordination semantics against the REAL provider
 * (release gate §5.4: "the actual lock/idempotency/lease/queue operation
 * the runtime uses — not PING alone").
 *
 * Exercises the EXISTING adapter (`adapters/hosted/upstash-redis` —
 * `UpstashCoordinationStore`) against the live Upstash Redis REST endpoint
 * with a RUN-UNIQUE key namespace prefix (the adapter's hermetic-live-run
 * contract: the shared free-tier Redis never carries state between runs):
 *
 *   - lease/lock: acquire → mutual exclusion → renew (holder discipline)
 *     → same-holder re-acquire (TTL extension) → release → expiry;
 *   - idempotency window: open → deterministic duplicate replay →
 *     different-digest typed conflict → expiry re-open;
 *   - fixed-window rate limit: counting → over-limit → window reset;
 *   - cache: TTL set/get/delete and TTL expiry;
 *   - run-namespace isolation (two prefixes never see each other's keys).
 *
 * Honest scope: the CoordinationStore port exposes NO queue primitive —
 * enqueue/dequeue semantics are owned by the durable job runner over the
 * control plane (P002 surface). This suite does not simulate a queue and
 * the evidence records queue ops as NOT PRESENT IN THE PORT.
 *
 * Skips gracefully (explicit reason) without credentials — CI never
 * carries them.
 */

import { describe, expect, it } from 'vitest';
import {
  isPersistenceError,
  PERSISTENCE_ERROR_CODES,
  computeBlobDigest,
  toCoordinationKey,
} from '@arena/persistence';
import type { CoordinationKey } from '@arena/persistence';
import { toIdempotencyKey } from '@arena/protocol-core';
import { UpstashCoordinationStore, UPSTASH_KEY_NAMESPACES } from '@arena/hosted-upstash-redis';
import { resolveUpstashLive } from '../support/live-env.js';
import { recordNote, recordTranscript } from '../support/transcript.js';

const FACET = 'upstash-coordination';

const gate = resolveUpstashLive();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function digestOf(text: string): Promise<string> {
  return computeBlobDigest(new TextEncoder().encode(text));
}

/** Brand a coordination key for this run (validated by the port). */
function ckey(name: string): CoordinationKey {
  return toCoordinationKey(`p004-${RUN_ID}-${name}`);
}

/** Run-unique id segment (uuid) — keys never collide across runs. */
const RUN_ID = globalThis.crypto.randomUUID().slice(0, 8);

describe('upstash live gate (always runs)', () => {
  it('reports the live-suite activation status with an explicit reason', (ctx) => {
    if (gate.live !== null) {
      recordNote(
        FACET,
        `live suite ACTIVE — endpoint: ${gate.live.config.url}, keyNamespacePrefix: ${gate.live.keyNamespacePrefix} (run-unique; hermetic live run)`,
      );
      return;
    }
    ctx.skip(gate.skipReason ?? 'unknown reason');
  });
});

describe.skipIf(gate.live === null)('upstash coordination semantics (live provider)', () => {
  const live = gate.live!;
  const runId = RUN_ID;

  const store = new UpstashCoordinationStore({
    env: {
      UPSTASH_REDIS_REST_URL: live.config.url,
      UPSTASH_REDIS_REST_TOKEN: live.config.token,
    },
    keyNamespacePrefix: live.keyNamespacePrefix,
  });

  it('capacity probe reports AVAILABLE via PING (the probe alone is not the coordination proof)', async () => {
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    recordTranscript(FACET, {
      step: 'probe (context only)',
      command: 'UpstashCoordinationStore.capacityProbe() [transport: PING over REST]',
      resource: live.config.url,
      result: 'status=AVAILABLE (PING — deliberately NOT counted as coordination proof; the lease/idempotency/rate-limit rows below are)',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  describe('lease / lock semantics', () => {
    it('acquire → holder read-back → mutual exclusion → renew discipline → release', async () => {
      const key = ckey('lease-primary');
      const holderA = 'p004-holder-a';
      const holderB = 'p004-holder-b';

      const acquired = await store.acquireLease(key, holderA, 60_000);
      expect(acquired).toBe(true);
      expect(await store.leaseHolder(key)).toBe(holderA);

      const stolen = await store.acquireLease(key, holderB, 60_000);
      expect(stolen).toBe(false); // mutual exclusion — the LOCK property

      const foreignRenew = await store.renewLease(key, holderB, 60_000);
      expect(foreignRenew).toBe(false); // non-holder cannot extend

      const renewed = await store.renewLease(key, holderA, 60_000);
      expect(renewed).toBe(true);

      const reacquired = await store.acquireLease(key, holderA, 60_000);
      expect(reacquired).toBe(true); // same-holder re-acquire extends the TTL

      const foreignRelease = await store.releaseLease(key, holderB);
      expect(foreignRelease).toBe(false); // non-holder cannot release

      const released = await store.releaseLease(key, holderA);
      expect(released).toBe(true);
      expect(await store.leaseHolder(key)).toBeNull();

      recordTranscript(FACET, {
        step: 'lease lifecycle (lock semantics)',
        command: 'acquireLease/leaseHolder/acquireLease(other)/renewLease(other+self)/acquireLease(self)/releaseLease(other+self) [transport: SET NX PX, GET, SET PX, DEL]',
        resource: `${live.config.url} key ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.lease}:${key}`,
        result: 'acquire=true; read-back=holder-a; competing acquire=false; foreign renew=false; self renew=true; self re-acquire=true (TTL extension); foreign release=false; self release=true; holder=null',
        classification: 'DEMONSTRATED-LIVE',
      });
    });

    it('lease TTL expiry frees the lock for the next holder', async () => {
      const key = ckey('lease-expiry');
      const holderA = 'p004-holder-a';
      const holderB = 'p004-holder-b';
      const acquired = await store.acquireLease(key, holderA, 1_200);
      expect(acquired).toBe(true);
      await sleep(1_700); // > TTL: Upstash expires the key server-side
      expect(await store.leaseHolder(key)).toBeNull();
      const next = await store.acquireLease(key, holderB, 60_000);
      expect(next).toBe(true); // expiry freed the lock
      expect(await store.releaseLease(key, holderB)).toBe(true);
      recordTranscript(FACET, {
        step: 'lease expiry',
        command: 'acquireLease(ttl=1200ms) → sleep 1700ms → leaseHolder → acquireLease(other holder)',
        resource: `${live.config.url} key ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.lease}:${key}`,
        result: 'after TTL: holder=null; next holder acquires=true (server-side PX expiry observed live — not a clock simulation)',
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  });

  describe('idempotency window semantics', () => {
    it('open → deterministic duplicate replay (same expiresAt) → typed conflict on a different digest', async () => {
      const key = toIdempotencyKey(globalThis.crypto.randomUUID());
      const digestA = await digestOf(`p004-idem-${runId}-payload-a`);
      const digestB = await digestOf(`p004-idem-${runId}-payload-b`);

      const opened = await store.openIdempotencyWindow(key, digestA, 60_000);
      expect(opened.outcome).toBe('opened');
      expect(opened.payloadDigest).toBe(digestA);

      const replay = await store.openIdempotencyWindow(key, digestA, 60_000);
      expect(replay.outcome).toBe('duplicate');
      expect(replay.expiresAt).toBe(opened.expiresAt); // deterministic replay

      let caught: unknown;
      try {
        await store.openIdempotencyWindow(key, digestB, 60_000);
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceError(caught)).toBe(true);
      expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.IDEMPOTENCY_CONFLICT);

      recordTranscript(FACET, {
        step: 'idempotency window: open / duplicate / conflict',
        command: 'openIdempotencyWindow(key, digestA, ttl) → replay(digestA) → replay(digestB) [transport: SET NX PX, GET]',
        resource: `${live.config.url} key ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.idempotency}:${key}`,
        result: `opened (expiresAt=${String(opened.expiresAt)}); duplicate with the SAME expiresAt (deterministic replay); different digest → typed PERSISTENCE_IDEMPOTENCY_CONFLICT`,
        classification: 'DEMONSTRATED-LIVE',
      });
    });

    it('an expired window reopens (window TTL enforced server-side)', async () => {
      const key = toIdempotencyKey(globalThis.crypto.randomUUID());
      const digest = await digestOf(`p004-idem-${runId}-expiry`);
      const first = await store.openIdempotencyWindow(key, digest, 1_200);
      expect(first.outcome).toBe('opened');
      await sleep(1_700); // > TTL
      const reopened = await store.openIdempotencyWindow(key, digest, 60_000);
      expect(reopened.outcome).toBe('opened');
      expect(reopened.expiresAt).toBeGreaterThan(first.expiresAt);
      recordTranscript(FACET, {
        step: 'idempotency window: expiry',
        command: 'openIdempotencyWindow(ttl=1200ms) → sleep 1700ms → openIdempotencyWindow(60s)',
        resource: `${live.config.url} key ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.idempotency}:${key}`,
        result: 'outcome=opened with a fresh expiry (the expired window no longer dedupes — server-side TTL observed live)',
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  });

  describe('fixed-window rate-limit semantics', () => {
    it('counts hits in the window, denies over-limit, resets at the window boundary', async () => {
      const key = ckey('ratelimit');
      const windowMs = 3_000;
      const limit = 3;

      // Start EARLY inside a fresh window so the four rapid hits cannot
      // straddle a window boundary (the counter is keyed by window start).
      const pre = Date.now();
      const intoWindow = pre - Math.floor(pre / windowMs) * windowMs;
      if (intoWindow > windowMs / 2) {
        await sleep(windowMs - intoWindow + 50);
      }

      const hit1 = await store.hitRateLimit(key, windowMs, limit);
      expect(hit1.allowed).toBe(true);
      expect(hit1.count).toBe(1);
      expect(hit1.remaining).toBe(2);

      const hit2 = await store.hitRateLimit(key, windowMs, limit);
      expect(hit2.count).toBe(2);
      const hit3 = await store.hitRateLimit(key, windowMs, limit);
      expect(hit3.allowed).toBe(true);
      expect(hit3.count).toBe(3);
      expect(hit3.remaining).toBe(0);

      const hit4 = await store.hitRateLimit(key, windowMs, limit);
      expect(hit4.allowed).toBe(false); // over the limit — denied, counted
      expect(hit4.count).toBe(4);

      // Wait past the window boundary (the counter is self-expiring).
      await sleep(Math.max(200, hit4.resetAt - Date.now() + 250));
      const fresh = await store.hitRateLimit(key, windowMs, limit);
      expect(fresh.count).toBe(1); // a NEW window key — old counter expired
      expect(fresh.allowed).toBe(true);

      recordTranscript(FACET, {
        step: 'rate-limit fixed window',
        command: 'hitRateLimit(key, windowMs=3000, limit=3) ×4 → wait past resetAt → hit again [transport: INCR, PEXPIRE]',
        resource: `${live.config.url} key ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.rateLimit}:${key}:<windowStart>`,
        result: `counts 1,2,3 allowed; 4th denied (allowed=false, remaining=0, resetAt=${String(hit4.resetAt)}); after the window boundary the counter restarts at 1 (self-expiring window observed live)`,
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  });

  describe('cache TTL semantics', () => {
    it('set → get → delete → absent; TTL expiry returns null', async () => {
      const key = ckey('cache');
      await store.cacheSet(key, `p004-cache-value-${runId}`, 60_000);
      expect(await store.cacheGet(key)).toBe(`p004-cache-value-${runId}`);
      expect(await store.cacheDelete(key)).toBe(true);
      expect(await store.cacheGet(key)).toBeNull();
      expect(await store.cacheDelete(key)).toBe(false);

      const ttlKey = ckey('cache-ttl');
      await store.cacheSet(ttlKey, 'expires-fast', 1_200);
      expect(await store.cacheGet(ttlKey)).toBe('expires-fast');
      await sleep(1_700);
      expect(await store.cacheGet(ttlKey)).toBeNull(); // TTL expiry

      recordTranscript(FACET, {
        step: 'cache TTL',
        command: 'cacheSet/cacheGet/cacheDelete; cacheSet(ttl=1200ms) → sleep 1700ms → cacheGet [transport: SET PX, GET, DEL]',
        resource: `${live.config.url} keys ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.cache}:${key}, …:${ttlKey}`,
        result: 'value round-trips; delete=true then false; expired value reads null (server-side PX expiry)',
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  });

  describe('run-namespace isolation', () => {
    it('a second store with a different run prefix never observes the first run\u2019s keys', async () => {
      const key = ckey('isolation');
      const otherPrefix = `p004-${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)}:`;
      const other = new UpstashCoordinationStore({
        env: {
          UPSTASH_REDIS_REST_URL: live.config.url,
          UPSTASH_REDIS_REST_TOKEN: live.config.token,
        },
        keyNamespacePrefix: otherPrefix,
      });
      const acquired = await store.acquireLease(key, 'p004-holder-a', 60_000);
      expect(acquired).toBe(true);
      expect(await other.leaseHolder(key)).toBeNull(); // different namespace → invisible
      expect(await store.releaseLease(key, 'p004-holder-a')).toBe(true);
      recordTranscript(FACET, {
        step: 'namespace isolation (bounded/rebuildable state scoping)',
        command: 'store(prefix A).acquireLease → store(prefix B).leaseHolder(same logical key)',
        resource: `${live.config.url} keys ${live.keyNamespacePrefix}${UPSTASH_KEY_NAMESPACES.lease}:${key} vs ${otherPrefix}${UPSTASH_KEY_NAMESPACES.lease}:${key}`,
        result: 'prefix B observes null — runs never share state on the shared free-tier Redis (hermetic live runs)',
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  });

  it('records the queue posture honestly (no queue primitive in the port)', () => {
    recordNote(
      FACET,
      'queue enqueue/dequeue: NOT PRESENT in the CoordinationStore port (cache/idempotency/rate-limit/lease are the four bounded sub-surfaces). The runtime queue semantics are owned by the durable job runner over the control plane (P002 surface) — no queue claim is made here and none is simulated.',
    );
    expect(Object.keys(UPSTASH_KEY_NAMESPACES).sort()).toEqual([
      'cache',
      'idempotency',
      'lease',
      'rateLimit',
    ]);
  });
});
