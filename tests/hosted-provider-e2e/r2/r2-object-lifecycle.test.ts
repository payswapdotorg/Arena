/**
 * P004 — R2 object lifecycle against the REAL provider (release gate §5.3).
 *
 * Exercises the EXISTING adapter (`adapters/hosted/r2-object-store` —
 * `R2BlobStore`) against live Cloudflare R2 with the real S3 credentials,
 * in a DEDICATED evidence bucket (`ARENA_HOSTED_E2E_R2_BUCKET`):
 *
 *   authorized write → head → read/download → digest leg → immutable
 *   replay → provider-side list (supplementary verification) → delete →
 *   empty-bucket verification.
 *
 * Honesty rules baked into the suite:
 *   - the port exposes NO list operation — the gate's "list-or-digest"
 *     leg is satisfied by the DIGEST (content addressing: the key IS the
 *     sha256), and a provider-side ListObjectsV2 is recorded as
 *     SUPPLEMENTARY verification (same credentials, same client
 *     construction as the adapter's transport — not an adapter op);
 *   - the port exposes NO retention primitive — object deletion is
 *     immediate; retention/lifecycle rules are not representable through
 *     the adapter (recorded as an honest limitation, not a test);
 *   - a configured resource or an empty bucket is NOT proof: every step
 *     below moves real bytes through the adapter.
 *
 * Skips gracefully (explicit reason, no failure) when credentials or the
 * dedicated evidence bucket are absent — CI never carries them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeBlobDigest } from '@arena/persistence';
import type { BlobKey, BlobPutResult } from '@arena/persistence';
import { R2BlobStore } from '@arena/hosted-r2-object-store';
import type { R2AdapterConfig } from '@arena/hosted-r2-object-store';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { resolveR2Live, r2AdapterEnv, type R2LiveEnvironment } from '../support/live-env.js';
import { recordNote, recordTranscript } from '../support/transcript.js';

const FACET = 'r2-lifecycle';

const gate = resolveR2Live();

describe('r2 live gate (always runs)', () => {
  it('reports the live-suite activation status with an explicit reason', (ctx) => {
    if (gate.live !== null) {
      recordNote(
        FACET,
        `live suite ACTIVE — dedicated evidence bucket: ${gate.live.evidenceBucket}, endpoint: ${gate.live.config.endpoint}`,
      );
      return;
    }
    ctx.skip(gate.skipReason ?? 'unknown reason');
  });
});

describe.skipIf(gate.live === null)('r2 object lifecycle (live provider)', () => {
  // Constructed in beforeAll (which does NOT run when the suite is
  // skipped — collection must stay null-safe without credentials).
  let live!: R2LiveEnvironment;
  let store!: R2BlobStore;
  let providerClient!: S3Client;
  const runId = globalThis.crypto.randomUUID();

  const content = new TextEncoder().encode(
    JSON.stringify({
      surface: 'p004-hosted-provider-e2e',
      step: 'r2-object-lifecycle',
      run: runId,
      note: 'real bytes written through the existing R2BlobStore adapter against live Cloudflare R2',
    }),
  );

  let put: BlobPutResult | null = null;
  let key: BlobKey | null = null;

  beforeAll(() => {
    live = gate.live!;
    /** The adapter under test — the EXISTING R2BlobStore, real transport. */
    store = new R2BlobStore({ env: r2AdapterEnv(live.evidenceBucket) });
    /** Supplementary provider-side client (same construction as the adapter transport). */
    providerClient = new S3Client({
      region: 'auto',
      endpoint: live.config.endpoint,
      credentials: {
        accessKeyId: live.config.accessKeyId,
        secretAccessKey: live.config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    // Best-effort cleanup: never leave evidence objects behind on failure.
    if (key !== null && store !== undefined) {
      try {
        await store.delete(key);
      } catch {
        // cleanup is best-effort; the lifecycle test itself asserts deletion
      }
    }
  });

  it('capacity probe reports AVAILABLE (the probe alone is not the lifecycle proof)', async () => {
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('AVAILABLE');
    recordTranscript(FACET, {
      step: 'probe',
      command: 'R2BlobStore.capacityProbe() [transport: HeadBucket]',
      resource: `bucket ${live.evidenceBucket}`,
      result: `status=AVAILABLE checkedAt=${String(snapshot.checkedAt)} (probe only — the lifecycle proof is the write/read/delete steps below)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('authorized write (put) stores the content-addressed object', async () => {
    const digest = await computeBlobDigest(content);
    put = await store.put({
      content,
      contentType: 'application/json',
      metadata: { surface: 'p004-hosted-provider-e2e', run: runId },
    });
    key = put.key;
    expect(put.alreadyPresent).toBe(false);
    expect(put.key).toBe(`sha256:${digest}`);
    expect(put.byteLength).toBe(content.byteLength);
    recordTranscript(FACET, {
      step: 'authorized write',
      command: 'R2BlobStore.put({content, contentType=application/json, metadata}) [transport: HeadObject + PutObject]',
      resource: `bucket ${live.evidenceBucket}, key ${put.key}`,
      result: `byteLength=${String(put.byteLength)} createdAt=${String(put.createdAt)} alreadyPresent=false`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('head (exists) confirms the stored object', async () => {
    expect(key).not.toBeNull();
    const present = await store.exists(key!);
    expect(present).toBe(true);
    recordTranscript(FACET, {
      step: 'head',
      command: 'R2BlobStore.exists(key) [transport: HeadObject]',
      resource: `bucket ${live.evidenceBucket}, key ${key}`,
      result: 'exists=true',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('authorized read + download returns the identical bytes', async () => {
    expect(key).not.toBeNull();
    const record = await store.get(key!);
    expect(record).not.toBeNull();
    expect(record!.key).toBe(key);
    expect(record!.contentType).toBe('application/json');
    expect(record!.byteLength).toBe(content.byteLength);
    expect(Array.from(record!.content)).toEqual(Array.from(content));
    expect(record!.metadata['surface']).toBe('p004-hosted-provider-e2e');
    expect(record!.metadata['run']).toBe(runId);
    expect(record!.digest).toBe(key!.slice('sha256:'.length));
    recordTranscript(FACET, {
      step: 'authorized read + download',
      command: 'R2BlobStore.get(key) [transport: GetObject + transformToByteArray]',
      resource: `bucket ${live.evidenceBucket}, key ${key}`,
      result: `bytes=${String(record!.byteLength)} contentType=application/json metadata={surface,run} — downloaded bytes byte-equal to the written payload`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('digest leg: sha256 recomputed over the downloaded bytes equals the stored key', async () => {
    expect(key).not.toBeNull();
    const record = await store.get(key!);
    expect(record).not.toBeNull();
    const recomputed = await computeBlobDigest(record!.content);
    expect(recomputed).toBe(key!.slice('sha256:'.length));
    recordTranscript(FACET, {
      step: 'digest leg (list-or-digest)',
      command: 'computeBlobDigest(downloadedContent) === blobKeyDigest(key)',
      resource: `bucket ${live.evidenceBucket}, key ${key}`,
      result: `sha256 recomputed over downloaded bytes matches the content-addressed key (the BlobStore port exposes no list op; the key IS the digest — this is the gate's digest leg)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('immutable replay: an identical put preserves the FIRST write', async () => {
    expect(put).not.toBeNull();
    const replay = await store.put({
      content,
      contentType: 'application/json',
      metadata: { surface: 'p004-hosted-provider-e2e', run: runId, attempt: 'second' },
    });
    expect(replay.alreadyPresent).toBe(true);
    expect(replay.createdAt).toBe(put!.createdAt);
    const record = await store.get(replay.key);
    expect(record!.metadata['attempt']).toBeUndefined(); // first write's metadata wins
    recordTranscript(FACET, {
      step: 'immutable replay',
      command: 'R2BlobStore.put(identical content, different metadata)',
      resource: `bucket ${live.evidenceBucket}, key ${replay.key}`,
      result: `alreadyPresent=true createdAt preserved (${String(replay.createdAt)}); first write's metadata preserved (content addressing — in-place mutation unrepresentable)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('provider-side list (supplementary verification) shows exactly the evidence object', async () => {
    expect(key).not.toBeNull();
    const listing = await providerClient.send(
      new ListObjectsV2Command({ Bucket: live.evidenceBucket, MaxKeys: 100 }),
    );
    const keys = (listing.Contents ?? []).map((entry) => entry.Key ?? '');
    expect(keys).toContain(key);
    recordTranscript(FACET, {
      step: 'provider-side list (supplementary)',
      command: 'S3Client.send(ListObjectsV2Command) — same credentials/client construction as the adapter transport; NOT an adapter op (the port has no list vocabulary)',
      resource: `bucket ${live.evidenceBucket}`,
      result: `keys=[${keys.join(', ')}] — the evidence object is present`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('delete removes the object (idempotent second delete returns false)', async () => {
    expect(key).not.toBeNull();
    const deleted = await store.delete(key!);
    expect(deleted).toBe(true);
    expect(await store.exists(key!)).toBe(false);
    expect(await store.get(key!)).toBeNull();
    expect(await store.delete(key!)).toBe(false);
    recordTranscript(FACET, {
      step: 'delete',
      command: 'R2BlobStore.delete(key) [transport: HeadObject + DeleteObject]; then exists/get/delete-again',
      resource: `bucket ${live.evidenceBucket}, key ${key}`,
      result: 'delete=true; exists=false; get=null; second delete=false (lifecycle closed)',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('provider-side list after delete: the evidence bucket is empty again', async () => {
    const listing = await providerClient.send(
      new ListObjectsV2Command({ Bucket: live.evidenceBucket, MaxKeys: 100 }),
    );
    expect(listing.KeyCount ?? 0).toBe(0);
    recordTranscript(FACET, {
      step: 'provider-side list after delete (supplementary)',
      command: 'S3Client.send(ListObjectsV2Command)',
      resource: `bucket ${live.evidenceBucket}`,
      result: `keyCount=${String(listing.KeyCount ?? 0)} — bucket empty after the lifecycle (not "configured resource" evidence: real bytes were written and removed)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('records the retention posture honestly (no retention primitive in the port)', () => {
    // The BlobStore port and the ObjectStorageTransport seam expose exactly
    // probe/head/get/put/delete — there is no retention/lifecycle-rule
    // operation anywhere in the adapter. This row exists so the evidence
    // file cannot be read as claiming a retention demonstration.
    recordTranscript(FACET, {
      step: 'retention (not supported by the adapter)',
      command: 'n/a — no retention/lifecycle op exists in BlobStore or ObjectStorageTransport',
      resource: `bucket ${live.evidenceBucket}`,
      result: 'deletion is immediate; retention rules are not representable through this adapter — recorded as NOT CLAIMED, per the gate wording "(retention if the adapter supports it)"',
      classification: 'AUTOMATED-TEST-ONLY',
    });
    expect(true).toBe(true);
  });
});
