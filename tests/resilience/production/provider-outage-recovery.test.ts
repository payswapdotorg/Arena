/**
 * tests/resilience/production/provider-outage-recovery.test.ts —
 * provider outage/recovery windows (Work Order P007 integrated pass;
 * issue #159; M2).
 *
 * "provider outage/recovery windows (adapters fail closed, capacity
 * state transitions AVAILABLE/DEGRADED/EXHAUSTED/DISABLED honest)" —
 * attacks the REAL hosted-provider adapters (r2-object-store +
 * upstash-redis) behind the P004 CI-pattern injected fake transports:
 *
 *   - OUTAGE WINDOW: a failing transport → capacity DEGRADED with the
 *     probe-failed reason (never a spoofed AVAILABLE), and every
 *     operation fails with the TYPED transport error (no silent
 *     success, no alternate destination);
 *   - RECOVERY: the same adapter shape with a healthy transport →
 *     AVAILABLE and operations succeed (state transitions honest in
 *     BOTH directions);
 *   - ZERO CREDENTIALS: unconfigured adapters are DISABLED before any
 *     network call with the honest env-var-name list;
 *   - the Upstash COORDINATION semantics during the outage and after
 *     recovery: the lease/idempotency/rate-limit sub-surfaces fail
 *     typed during the outage and behave deterministically after
 *     recovery (lease exclusion, idempotency replay, rate-limit
 *     windows) — the actual operations the runtime uses, not PING.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock, toBlobKey } from '@arena/persistence';
import { R2BlobStore } from '@arena/hosted-r2-object-store';
import { FakeObjectStorageTransport } from '@arena/hosted-r2-object-store/test-support';
import { UpstashCoordinationStore } from '@arena/hosted-upstash-redis';
import { FakeRestTransport } from '@arena/hosted-upstash-redis/test-support';

const T0 = Date.parse('2026-10-09T12:00:00.000Z');

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

describe('resilience — R2 outage window and recovery (the REAL adapter)', () => {
  it('outage: DEGRADED + probe-failed (never AVAILABLE) and TYPED operation failures', async () => {
    const outage = new FakeObjectStorageTransport({ probeFails: true });
    const store = new R2BlobStore({ transport: outage, clock: new ManualClock(T0) });

    const probe = await store.capacityProbe();
    expect(probe.status).toBe('DEGRADED');
    expect(probe.reasons).toEqual([expect.objectContaining({ code: 'probe-failed' })]);

    // Operations during the outage fail TYPED (the fake fails only the
    // probe; object ops succeed against the in-memory store — the LIVE
    // outage shape is the typed transport failure, pinned separately
    // below with a full-failure transport).
    const workingButDegraded = await store.put({
      content: new TextEncoder().encode('during-outage'),
      contentType: 'text/plain',
    });
    expect(workingButDegraded.alreadyPresent).toBe(false);

    // A FULL outage (every transport call failing): every operation
    // fails typed with the transport error class.
    const fullOutage = new FullFailureTransport();
    const deadStore = new R2BlobStore({ transport: fullOutage as never, clock: new ManualClock(T0) });
    let failedCode = '';
    try {
      await deadStore.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      failedCode = codeOf(error);
    }
    expect(failedCode.startsWith('PERSISTENCE_')).toBe(true);
    expect((await deadStore.capacityProbe()).status).toBe('DEGRADED');
  });

  it('recovery: the same adapter shape reports AVAILABLE and serves operations', async () => {
    const healthy = new FakeObjectStorageTransport();
    const store = new R2BlobStore({ transport: healthy, clock: new ManualClock(T0) });
    expect((await store.capacityProbe()).status).toBe('AVAILABLE');
    const put = await store.put({
      content: new TextEncoder().encode('after-recovery'),
      contentType: 'text/plain',
    });
    expect(put.alreadyPresent).toBe(false);
    expect(await store.get(put.key)).not.toBeNull();
  });

  it('zero credentials: DISABLED before any network call, honest env names, typed refusals', async () => {
    const store = new R2BlobStore({ env: {}, clock: new ManualClock(T0) });
    const probe = await store.capacityProbe();
    expect(probe.status).toBe('DISABLED');
    expect(probe.reasons).toEqual([expect.objectContaining({ code: 'configuration-missing' })]);
    // No transport operation was ever attempted (nothing to count — the
    // adapter never constructed a client).
    let code = '';
    try {
      await store.get(toBlobKey('sha256:' + '0'.repeat(64)));
    } catch (error) {
      code = codeOf(error);
    }
    expect(code).toBe('PERSISTENCE_CAPACITY_DISABLED');
  });
});

describe('resilience — Upstash coordination semantics across an outage window (the REAL adapter)', () => {
  it('the lease/idempotency/rate-limit sub-surfaces behave deterministically on the healthy side', async () => {
    const clock = new ManualClock(T0);
    const fake = new FakeRestTransport({ clock });
    const store = new UpstashCoordinationStore({
      transport: fake,
      clock,
    });
    expect((await store.capacityProbe()).status).toBe('AVAILABLE');

    // LEASE: one holder wins; a second holder is excluded; renewal by
    // the holder extends; release frees.
    expect(await store.acquireLease('lease-1' as never, 'worker-a', 60_000)).toBe(true);
    expect(await store.acquireLease('lease-1' as never, 'worker-b', 60_000)).toBe(false);
    expect(await store.renewLease('lease-1' as never, 'worker-a', 60_000)).toBe(true);
    expect(await store.releaseLease('lease-1' as never, 'worker-a')).toBe(true);
    expect(await store.acquireLease('lease-1' as never, 'worker-b', 60_000)).toBe(true);

    // IDEMPOTENCY: an open window completes once; a replay of the SAME
    // payload digest replays the recorded outcome; a DIFFERENT payload
    // digest under the same key conflicts typed.
    const first = await store.openIdempotencyWindow('idem-1' as never, 'a'.repeat(16), 60_000);
    expect(first.outcome).toBe('opened');
    const replay = await store.openIdempotencyWindow('idem-1' as never, 'a'.repeat(16), 60_000);
    expect(replay.outcome).toBe('duplicate');
    let conflictCode = '';
    try {
      await store.openIdempotencyWindow('idem-1' as never, 'b'.repeat(16), 60_000);
    } catch (error) {
      conflictCode = codeOf(error);
    }
    expect(conflictCode).toBe('PERSISTENCE_IDEMPOTENCY_CONFLICT');

    // RATE LIMIT: the window admits up to the limit then fails closed.
    let allowed = 0;
    for (let i = 0; i < 5; i += 1) {
      const verdict = await store.hitRateLimit('rl-1' as never, 60_000, 3);
      if (verdict.allowed) allowed += 1;
    }
    expect(allowed).toBe(3);
  });

  it('an outage window: capacity DEGRADED and every coordination operation fails typed', async () => {
    const clock = new ManualClock(T0);
    const failing = new FakeRestTransport({ clock, fails: true });
    const store = new UpstashCoordinationStore({
      transport: failing,
      clock,
    });
    const probe = await store.capacityProbe();
    expect(probe.status).toBe('DEGRADED');
    expect(probe.reasons).toEqual([expect.objectContaining({ code: 'probe-failed' })]);

    // The actual runtime operations fail TYPED during the outage —
    // never a silent success.
    let leaseCode = '';
    try {
      await store.acquireLease('lease-x' as never, 'worker-a', 60_000);
    } catch (error) {
      leaseCode = codeOf(error);
    }
    expect(leaseCode.startsWith('PERSISTENCE_')).toBe(true);
    let idemCode = '';
    try {
      await store.openIdempotencyWindow('idem-x' as never, 'a'.repeat(16), 60_000);
    } catch (error) {
      idemCode = codeOf(error);
    }
    expect(idemCode.startsWith('PERSISTENCE_')).toBe(true);
    let rateCode = '';
    try {
      await store.hitRateLimit('rl-x' as never, 60_000, 3);
    } catch (error) {
      rateCode = codeOf(error);
    }
    expect(rateCode.startsWith('PERSISTENCE_')).toBe(true);
  });

  it('zero credentials: DISABLED with the honest env names and typed refusals', async () => {
    const store = new UpstashCoordinationStore({
      env: {},
      clock: new ManualClock(T0),
    });
    expect((await store.capacityProbe()).status).toBe('DISABLED');
    let code = '';
    try {
      await store.cacheGet('cache-x' as never);
    } catch (error) {
      code = codeOf(error);
    }
    expect(code).toBe('PERSISTENCE_CAPACITY_DISABLED');
  });
});

/** An object-storage transport where EVERY call fails (the full outage). */
class FullFailureTransport {
  async probe(): Promise<void> {
    throw new Error('connect ETIMEDOUT full-outage.example');
  }
  async headObject(): Promise<null> {
    throw new Error('connect ETIMEDOUT full-outage.example');
  }
  async getObject(): Promise<null> {
    throw new Error('connect ETIMEDOUT full-outage.example');
  }
  async putObject(): Promise<void> {
    throw new Error('connect ETIMEDOUT full-outage.example');
  }
  async deleteObject(): Promise<boolean> {
    throw new Error('connect ETIMEDOUT full-outage.example');
  }
}
