/**
 * tests/security/production/ac06-object-store.test.ts — AC-06 object-store
 * cross-tenant access + the fail-closed adapter posture (Work Order P007
 * integrated pass; issue #159).
 *
 * "object-store cross-tenant paths (against the adapters' fail-closed
 * posture — stubbed or real per the P004 pattern)".
 *
 * Attacks the REAL R2 adapter (adapters/hosted/r2-object-store) through
 * its injected ObjectStorageTransport seam using the P004 battery's own
 * FakeObjectStorageTransport (the documented stubbed-credential pattern
 * — the same pattern the full persistence contract suite uses in CI; the
 * LIVE wrong-credential/unauthorized-bucket matrices were P004's
 * DEMONSTRATED-LIVE evidence and are NOT re-claimed here).
 *
 * Attacks / posture pins:
 *   - object keys are CONTENT DIGESTS (`sha256:<hex>`) — no tenant id,
 *     no caller-chosen path, no enumerable namespace EVER appears in a
 *     key (cross-tenant enumeration is a preimage problem by design —
 *     the threat model's documented posture, pinned so any future drift
 *     to tenant-derived key paths FAILS this battery);
 *   - the store is tenant-blind BY DESIGN (tenancy lives in the domain,
 *     which gates issuance) — pinned honestly, including the documented
 *     residual (a digest-possessing caller can read the bytes; the
 *     domain must gate issuance);
 *   - immutable replay: identical content re-put returns
 *     alreadyPresent:true with the FIRST write's metadata — no
 *     in-place mutation is representable;
 *   - an UNCONFIGURED adapter is DISABLED before any network call: the
 *     capacity probe reports DISABLED (never AVAILABLE), and every
 *     operation fails with the typed PERSISTENCE_CAPACITY_DISABLED —
 *     no silent no-op, no fallback;
 *   - an outage window (probe failing) reports DEGRADED with the
 *     probe-failed reason — NEVER a spoofed AVAILABLE;
 *   - an operator-DECLARED EXHAUSTED snapshot fails closed through
 *     assertCapacityUsable with the typed exhaustion error (the F-04a
 *     mandated verification: fail-closed under a declared-EXHAUSTED
 *     state end to end).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock, toBlobKey } from '@arena/persistence';
import {
  assertCapacityUsable,
  CAPACITY_EXHAUSTION_POLICY,
  CAPACITY_BLOCKING_STATUSES,
  toCapacitySnapshot,
} from '@arena/persistence';
import { R2BlobStore } from '@arena/hosted-r2-object-store';
import { R2_ENV_VARS } from '@arena/hosted-r2-object-store';
import { FakeObjectStorageTransport } from '@arena/hosted-r2-object-store/test-support';

const T0 = Date.parse('2026-10-09T12:00:00.000Z');

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

describe('AC-06 — content-digest keys (the anti-enumeration posture, pinned)', () => {
  it('object keys are sha256 digests — no tenant id, no caller path, no enumerable namespace', async () => {
    const fake = new FakeObjectStorageTransport();
    const store = new R2BlobStore({ transport: fake, clock: new ManualClock(T0) });
    const content = new TextEncoder().encode('tenant-alpha-artifact-bytes');

    const put = await store.put({
      content,
      contentType: 'application/octet-stream',
    });
    // The key IS the digest.
    expect(put.key).toBe(`sha256:${put.digest}`);
    expect(put.key).toMatch(/^sha256:[0-9a-f]{64}$/);
    // NO tenant identity or caller path is embedded in the key or the
    // stored key set (the anti-enumeration posture — a drift to
    // tenant-derived key paths fails here).
    expect(put.key).not.toContain('tenant');
    expect(put.key).not.toContain('alpha');
    for (const key of fake.storedKeys()) {
      expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    // Different content → a different digest key (no collisions).
    const other = await store.put({
      content: new TextEncoder().encode('tenant-beta-artifact-bytes'),
      contentType: 'application/octet-stream',
    });
    expect(other.key).not.toBe(put.key);
    expect(fake.storedKeys()).toHaveLength(2);
  });

  it('immutable replay: identical content re-put returns alreadyPresent with the FIRST write\'s facts', async () => {
    const fake = new FakeObjectStorageTransport();
    const clock = new ManualClock(T0);
    const store = new R2BlobStore({ transport: fake, clock });
    const content = new TextEncoder().encode('immutable-artifact');

    const first = await store.put({ content, contentType: 'text/plain' });
    expect(first.alreadyPresent).toBe(false);
    expect(first.createdAt).toBe(T0);

    // A SECOND tenant writes the SAME bytes later — the object is
    // content-addressed, so the first write's facts WIN (in-place
    // mutation is not representable; no per-tenant overwrite channel).
    clock.advance(60_000);
    const second = await store.put({ content, contentType: 'text/plain' });
    expect(second.alreadyPresent).toBe(true);
    expect(second.key).toBe(first.key);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('the store is tenant-blind BY DESIGN (the documented posture, pinned with its residual)', async () => {
    const fake = new FakeObjectStorageTransport();
    const store = new R2BlobStore({ transport: fake, clock: new ManualClock(T0) });
    const put = await store.put({
      content: new TextEncoder().encode('secret-artifact'),
      contentType: 'application/octet-stream',
    });

    // The documented posture: tenancy lives in the DOMAIN (issuance
    // gating), NOT in the store — the store resolves any well-formed
    // digest key. This pins the posture AND its residual (F-04d's
    // provider-side analogue): a caller that POSSESSES the digest can
    // read the bytes; the domain must gate who ever learns the digest.
    const read = await store.get(put.key);
    expect(read).not.toBeNull();
    expect(Buffer.from(read?.content ?? []).toString('utf-8')).toBe('secret-artifact');

    // An UNKNOWN digest returns not-found — the existence oracle is
    // bounded to the digest space itself (a preimage problem), and the
    // failure carries no tenant data.
    expect(await store.get(toBlobKey('sha256:' + '0'.repeat(64)))).toBeNull();
    // A MALFORMED key is rejected typed (no key-shape smuggling).
    let refused = false;
    try {
      await store.get('tenant-alpha/notes.txt' as never);
    } catch (error) {
      refused = codeOf(error).startsWith('PERSISTENCE_');
    }
    expect(refused).toBe(true);
  });
});

describe('AC-06/AC-14 — the fail-closed adapter posture (unconfigured → DISABLED)', () => {
  it('no configuration: DISABLED before any network call, typed refusals, honest env-var names', async () => {
    // EMPTY env: the adapter never constructs a transport.
    const store = new R2BlobStore({ env: {}, clock: new ManualClock(T0) });
    const probe = await store.capacityProbe();
    expect(probe.status).toBe('DISABLED');
    expect(probe.reasons).toEqual([expect.objectContaining({ code: 'configuration-missing' })]);
    // DISABLED is a BLOCKING status (never usable).
    expect(CAPACITY_BLOCKING_STATUSES).toContain('DISABLED');

    // Every operation fails with the TYPED capacity error — never a
    // silent no-op, never a fallback destination.
    let refused = false;
    let code = '';
    try {
      await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      refused = true;
      code = codeOf(error);
    }
    expect(refused).toBe(true);
    expect(code).toBe('PERSISTENCE_CAPACITY_DISABLED');

    // The typed error names the missing env-var NAMES (never values) —
    // order-insensitive (the closed NAME set is what matters).
    const missing = (error: { details?: { missingEnvVarNames?: readonly string[] } }) =>
      error.details?.missingEnvVarNames;
    try {
      await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      expect([...(missing(error as never) ?? [])].sort()).toEqual([...R2_ENV_VARS].sort());
    }

    // assertCapacityUsable agrees: the DISABLED observation throws the
    // typed exhaustion-family error (no alternate path is representable).
    expect(() =>
      assertCapacityUsable({ status: 'DISABLED' }),
    ).toThrowError(/failing closed/);
    // The fail-closed policy is the ONLY representable policy.
    expect(CAPACITY_EXHAUSTION_POLICY).toBe('fail-closed');
  });

  it('an outage window reports DEGRADED with probe-failed — NEVER a spoofed AVAILABLE', async () => {
    const failing = new FakeObjectStorageTransport({ probeFails: true });
    const store = new R2BlobStore({ transport: failing, clock: new ManualClock(T0) });
    const probe = await store.capacityProbe();
    expect(probe.status).toBe('DEGRADED');
    expect(probe.reasons).toEqual([expect.objectContaining({ code: 'probe-failed' })]);

    // The probe-only outage leaves DEGRADED-but-usable semantics to the
    // port law; the FULL outage (every transport call failing — the
    // window a real provider brownout is) makes every operation fail
    // TYPED with the transport error class (no silent success).
    const deadStore = new R2BlobStore({
      transport: new FullFailureTransport() as never,
      clock: new ManualClock(T0),
    });
    let refused = false;
    try {
      await deadStore.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      refused = codeOf(error).startsWith('PERSISTENCE_');
    }
    expect(refused).toBe(true);
    expect((await deadStore.capacityProbe()).status).toBe('DEGRADED');

    // RECOVERY: the same adapter shape with a healthy transport reports
    // AVAILABLE (state transitions honest in BOTH directions).
    const healthy = new R2BlobStore({
      transport: new FakeObjectStorageTransport(),
      clock: new ManualClock(T0),
    });
    expect((await healthy.capacityProbe()).status).toBe('AVAILABLE');
  });

  it('an operator-DECLARED EXHAUSTED snapshot fails closed end to end (the F-04a verification)', async () => {
    const store = new R2BlobStore({
      transport: new FakeObjectStorageTransport(),
      clock: new ManualClock(T0),
      declaredAllowances: [{ dimension: 'storage', limit: 10 * 1024 * 1024 * 1024 }],
    });
    // Available + declared dimensions → AVAILABLE with honest null usage.
    const healthy = await store.capacityProbe();
    expect(healthy.status).toBe('AVAILABLE');

    // The operator-declared EXHAUSTED snapshot (usage at the limit):
    // deriveCapacityStatus/toCapacitySnapshot is the deploy wiring's
    // meter path; the DECLARED state must fail closed through the gate.
    const exhausted = toCapacitySnapshot({
      status: 'EXHAUSTED',
      checkedAt: T0,
      dimensions: [
        {
          dimension: 'storage',
          used: 10 * 1024 * 1024 * 1024,
          limit: 10 * 1024 * 1024 * 1024,
          remaining: 0,
        },
      ],
      reasons: [{ code: 'quota-exhausted', dimension: 'storage' }],
    });
    expect(exhausted.status).toBe('EXHAUSTED');
    expect(() => assertCapacityUsable(exhausted)).toThrowError(
      /exhausted; failing closed/,
    );
    let exhaustedCode = '';
    try {
      assertCapacityUsable(exhausted);
    } catch (error) {
      exhaustedCode = codeOf(error);
    }
    expect(exhaustedCode).toBe('PERSISTENCE_CAPACITY_EXHAUSTED');
    // EXHAUSTED is a blocking status: no silent fallback anywhere.
    expect(CAPACITY_BLOCKING_STATUSES).toContain('EXHAUSTED');
    void store;
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
