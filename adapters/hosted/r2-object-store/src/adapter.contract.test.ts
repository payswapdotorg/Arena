/**
 * The shared persistence contract suite runs against the Cloudflare R2
 * adapter through its injected ObjectStorageTransport seam (FT2.0 "Local
 * parity"): the SAME tests that pass against the in-memory fakes pass
 * against the hosted adapter's blob-store logic here, with zero live
 * credentials. When the R2 env vars exist in the environment (with a
 * usable endpoint), the same suite additionally runs against the live
 * S3-compatible endpoint (skipped otherwise — tests never REQUIRE live
 * credentials).
 */

import { describe, expect, it } from 'vitest';
import {
  computeBlobDigest,
  definePersistenceContractSuite,
  isPersistenceError,
  ManualClock,
} from '@arena/persistence';
import { R2BlobStore, R2_CREATED_AT_METADATA_KEY } from './adapter.js';
import { readR2ConfigFromEnv } from './env.js';
import { FakeObjectStorageTransport } from './test-support.js';

const T0 = 1_700_000_000_000;

definePersistenceContractSuite('r2-object-store (transport seam)', () => {
  const clock = new ManualClock(T0);
  const transport = new FakeObjectStorageTransport();
  return {
    blobStore: new R2BlobStore({ transport, clock }),
    clock,
  };
});

// Live runs require a USABLE configuration (see ./env.ts); an unusable or
// partial environment must NOT trigger live runs.
const hasLiveCredentials = readR2ConfigFromEnv() !== null;

describe.skipIf(!hasLiveCredentials)('r2-object-store live contract suite (credentials present)', () => {
  definePersistenceContractSuite('r2-object-store (live)', () => ({
    blobStore: new R2BlobStore(),
  }));
});

describe('r2-object-store adapter discipline', () => {
  it('derives the object key from the content digest (content addressing)', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeObjectStorageTransport();
    const store = new R2BlobStore({ transport, clock });
    const content = new TextEncoder().encode('arena-blob-content');
    const put = await store.put({ content, contentType: 'text/plain' });
    expect(put.key).toBe(`sha256:${await computeBlobDigest(content)}`);
    // Exactly one object exists, addressed by the digest.
    expect(transport.storedKeys()).toEqual([put.key]);
  });

  it('stores the creation timestamp under the reserved metadata namespace', async () => {
    const clock = new ManualClock(T0);
    const transport = new FakeObjectStorageTransport();
    const store = new R2BlobStore({ transport, clock });
    const put = await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    const stored = await transport.headObject(put.key);
    expect(stored?.metadata[R2_CREATED_AT_METADATA_KEY]).toBe(String(T0));
    // The reserved fact never leaks into the port's user metadata.
    const record = await store.get(put.key);
    expect(record?.metadata).toEqual({});
  });

  it('preserves the FIRST write on identical replays (immutability)', async () => {
    const clock = new ManualClock(T0);
    const store = new R2BlobStore({ transport: new FakeObjectStorageTransport(), clock });
    const first = await store.put({
      content: new TextEncoder().encode('immutable'),
      contentType: 'text/plain',
      metadata: { origin: 'first' },
    });
    clock.advance(5_000);
    const replay = await store.put({
      content: new TextEncoder().encode('immutable'),
      contentType: 'text/plain',
      metadata: { origin: 'second' },
    });
    expect(replay.alreadyPresent).toBe(true);
    expect(replay.createdAt).toBe(first.createdAt);
    const record = await store.get(first.key);
    expect(record?.metadata).toEqual({ origin: 'first' });
    expect(record?.createdAt).toBe(first.createdAt);
  });

  it('rejects caller metadata in the reserved namespace (typed error)', async () => {
    const store = new R2BlobStore({ transport: new FakeObjectStorageTransport() });
    let caught: unknown;
    try {
      await store.put({
        content: new TextEncoder().encode('x'),
        contentType: 'text/plain',
        metadata: { 'arena-forged': 'nope' },
      });
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe('PERSISTENCE_INVALID_BLOB_METADATA');
  });

  it('rejects non-token metadata keys (S3 metadata constraint, typed error)', async () => {
    const store = new R2BlobStore({ transport: new FakeObjectStorageTransport() });
    let caught: unknown;
    try {
      await store.put({
        content: new TextEncoder().encode('x'),
        contentType: 'text/plain',
        metadata: { 'bad key': 'value' },
      });
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe('PERSISTENCE_INVALID_BLOB_METADATA');
  });

  it('wraps transport failures in the typed TRANSPORT_FAILED error (no detail leak)', async () => {
    const CANARY = 'https://canary-account.canary.r2.cloudflarestorage.com/canary-bucket';
    const store = new R2BlobStore({
      transport: {
        async probe(): Promise<void> {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
        async headObject(): Promise<null> {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
        async getObject(): Promise<null> {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
        async putObject(): Promise<void> {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
        async deleteObject(): Promise<boolean> {
          throw new Error(`connect ETIMEDOUT ${CANARY}`);
        },
      },
    });
    let caught: unknown;
    try {
      await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { message: string; code: string };
    expect(typed.code).toBe('PERSISTENCE_TRANSPORT_FAILED');
    expect(typed.message).not.toContain('canary');
    expect(String(caught)).not.toContain('canary');
  });

  it('probes AVAILABLE with a healthy transport and DEGRADED with a failing one', async () => {
    const clock = new ManualClock(T0);
    const healthy = new R2BlobStore({ transport: new FakeObjectStorageTransport(), clock });
    const snapshot = await healthy.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.checkedAt).toBe(T0);

    const failing = new R2BlobStore({
      transport: new FakeObjectStorageTransport({ probeFails: true }),
      clock,
    });
    const degraded = await failing.capacityProbe();
    expect(degraded.status).toBe('DEGRADED');
    expect(degraded.reasons).toEqual([{ code: 'probe-failed' }]);
    // Probe failures never carry transport detail.
    expect(JSON.stringify(degraded)).not.toContain('ETIMEDOUT');
  });

  it('surfaces declared allowances as unknown-usage dimension readings', async () => {
    const store = new R2BlobStore({
      transport: new FakeObjectStorageTransport(),
      clock: new ManualClock(T0),
      declaredAllowances: [{ dimension: 'storage', limit: 10 * 1024 * 1024 * 1024 }],
    });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.dimensions).toEqual([
      { dimension: 'storage', used: null, limit: 10737418240, remaining: null, windowMs: null },
    ]);
    expect(snapshot.reasons).toEqual([]);
  });
});
