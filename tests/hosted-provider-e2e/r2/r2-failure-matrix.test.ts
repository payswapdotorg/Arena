/**
 * P004 — R2 failure/capacity matrix (release gate §5.3 posture).
 *
 * What the adapter must do when things go wrong — demonstrated against the
 * real endpoint where safe, simulated (and CLASSIFIED as such) where a live
 * trigger is not safely reproducible:
 *
 *   LIVE rows (real endpoint, real network):
 *     - wrong secret access key → typed PERSISTENCE_TRANSPORT_FAILED
 *       (fail closed; no fallback), capacity probe DEGRADED;
 *     - bucket outside this account (nonexistent bucket name — the
 *       client-side shape of a cross-tenant/unauthorized bucket attempt)
 *       → typed error, no data, no fallback;
 *     - anonymous (unsigned) request for a live object → provider rejects
 *       with 401/403 (private-by-default; the adapter's authorized path is
 *       the only read path);
 *     - wrong-secret READ of an object that exists → rejected before any
 *       object-level authorization (auth precedes access).
 *
 *   AUTOMATED-TEST-ONLY rows (never claimed as live):
 *     - retry behavior: the adapter performs NO adapter-level retry (one
 *       transport call per operation — asserted with a counting fake);
 *       the underlying @aws-sdk/client-s3 default retry policy
 *       (maxAttempts=3, exponential backoff on 5xx/throttle) is exercised
 *       against a local HTTP stub returning 500,500,200 — the same client
 *       construction the adapter's transport uses;
 *     - quota exhaustion: not safely triggerable live on the shared
 *       account (would require filling the free-tier storage allowance or
 *       throttling the shared credentials). The code path is documented
 *       and simulated: a transport-level 429 SlowDown surfaces as the
 *       typed TRANSPORT_FAILED error (exactly one attempt — no silent
 *       fallback, no second destination), and the port-level fail-closed
 *       exhaustion policy (assertCapacityUsable on an EXHAUSTED snapshot)
 *       throws PERSISTENCE_CAPACITY_EXHAUSTED.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assertCapacityUsable,
  CAPACITY_EXHAUSTION_POLICY,
  isPersistenceError,
  PERSISTENCE_ERROR_CODES,
  toCapacitySnapshot,
  type BlobKey,
  type CapacitySnapshot,
} from '@arena/persistence';
import {
  R2BlobStore,
  readR2ConfigFromEnv,
  type R2AdapterConfig,
} from '@arena/hosted-r2-object-store';
import { HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { resolveR2Live, r2AdapterEnv, R2_EVIDENCE_BUCKET_ENV_VAR, type R2LiveEnvironment } from '../support/live-env.js';
import { recordNote, recordTranscript } from '../support/transcript.js';

const FACET = 'r2-failure-capacity';

const fullGate = resolveR2Live();
const baseConfig: R2AdapterConfig | null = readR2ConfigFromEnv();

/** The deliberately-invalid secret used for the wrong-credential rows. */
const WRONG_SECRET = 'arena-p004-deliberately-invalid-secret';

describe('r2 failure matrix gates (always run)', () => {
  it('reports the live-suite activation status with an explicit reason', (ctx) => {
    if (baseConfig === null) {
      ctx.skip(
        'R2 adapter configuration incomplete — the live failure rows need a usable R2 endpoint + credentials (the wrong-credential rows exercise the REAL endpoint)',
      );
      return;
    }
    if (fullGate.live === null) {
      recordNote(
        FACET,
        `live failure rows PARTIAL: base configuration present, but ${R2_EVIDENCE_BUCKET_ENV_VAR} is unset — the object-dependent rows (anonymous access, wrong-secret read of a live object) are skipped`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// LIVE rows: wrong credentials / unauthorized bucket access
// ---------------------------------------------------------------------------

describe.skipIf(baseConfig === null)('r2 wrong-credential posture (live endpoint)', () => {
  const config = baseConfig!;

  it('wrong secret access key → typed TRANSPORT_FAILED (fail closed, no fallback)', async () => {
    const store = new R2BlobStore({
      env: {
        R2_ACCESS_KEY_ID: config.accessKeyId,
        R2_SECRET_ACCESS_KEY: WRONG_SECRET,
        R2_S3_ENDPOINT: config.endpoint,
        R2_BUCKET: config.bucket,
      },
    });
    expect(store.enabled).toBe(true); // configured (but wrong) — NOT disabled
    let caught: unknown;
    try {
      await store.put({
        content: new TextEncoder().encode('p004 wrong-credential probe'),
        contentType: 'text/plain',
      });
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { code?: string; message?: string; cause?: unknown };
    expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    // Provider detail stays in `cause`, never in the typed message.
    expect(typed.message).not.toContain(WRONG_SECRET);
    const cause = typed.cause as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = cause?.$metadata?.httpStatusCode;
    recordTranscript(FACET, {
      step: 'wrong credentials (secret access key)',
      command: 'R2BlobStore.put(...) with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadObject]',
      resource: `bucket ${config.bucket} @ ${config.endpoint}`,
      result: `typed PERSISTENCE_TRANSPORT_FAILED (provider answered ${String(status ?? 'n/a')}, cause name ${String(cause?.name ?? 'n/a')}) — fail closed, no silent fallback, secret value absent from the typed message`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('wrong credentials → capacity probe DEGRADED (probe-failed), not AVAILABLE', async () => {
    const store = new R2BlobStore({
      env: {
        R2_ACCESS_KEY_ID: config.accessKeyId,
        R2_SECRET_ACCESS_KEY: WRONG_SECRET,
        R2_S3_ENDPOINT: config.endpoint,
        R2_BUCKET: config.bucket,
      },
    });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DEGRADED');
    expect(snapshot.reasons).toEqual([{ code: 'probe-failed' }]);
    recordTranscript(FACET, {
      step: 'wrong credentials — capacity state',
      command: 'R2BlobStore.capacityProbe() with R2_SECRET_ACCESS_KEY=<deliberately-invalid> [transport: HeadBucket]',
      resource: `bucket ${config.bucket} @ ${config.endpoint}`,
      result: `status=DEGRADED reasons=[probe-failed] (a misconfigured adapter is never reported healthy)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('bucket outside this account (cross-tenant attempt shape) → typed error, no data', async () => {
    const foreignBucket = `arena-p004-evidence-nonexistent-${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const store = new R2BlobStore({
      env: {
        R2_ACCESS_KEY_ID: config.accessKeyId,
        R2_SECRET_ACCESS_KEY: config.secretAccessKey,
        R2_S3_ENDPOINT: config.endpoint,
        R2_BUCKET: foreignBucket,
      },
    });
    let caught: unknown;
    try {
      await store.put({
        content: new TextEncoder().encode('p004 foreign-bucket probe'),
        contentType: 'text/plain',
      });
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const typed = caught as { code?: string; cause?: unknown };
    expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    const cause = typed.cause as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = cause?.$metadata?.httpStatusCode;
    recordTranscript(FACET, {
      step: 'unauthorized/foreign bucket access',
      command: `R2BlobStore.put(...) with R2_BUCKET=${foreignBucket} (valid credentials, bucket not present in this account)`,
      resource: `bucket ${foreignBucket} @ ${config.endpoint}`,
      result: `typed PERSISTENCE_TRANSPORT_FAILED (provider answered ${String(status ?? 'n/a')}, cause name ${String(cause?.name ?? 'n/a')}) — no object data, no fallback path. Honest scope: single-account credentials — a TRUE cross-tenant bucket (another Cloudflare account) is not reachable from here; a nonexistent bucket name is the client-side shape of that attempt.`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });
});

// ---------------------------------------------------------------------------
// LIVE rows that need the dedicated evidence bucket (a real object exists)
// ---------------------------------------------------------------------------

describe.skipIf(fullGate.live === null)(
  'r2 unauthorized object access (live endpoint, dedicated evidence bucket)',
  () => {
    // Constructed in beforeAll (skipped suites never run it — collection
    // stays null-safe without credentials).
    let live!: R2LiveEnvironment;
    let store!: R2BlobStore;
    let key: BlobKey | null = null;

    beforeAll(() => {
      live = fullGate.live!;
      store = new R2BlobStore({ env: r2AdapterEnv(live.evidenceBucket) });
    });

    afterEach(async () => {
      if (key !== null) {
        try {
          await store.delete(key);
        } catch {
          // best-effort cleanup
        }
        key = null;
      }
    });

    it('anonymous (unsigned) request for a live object is rejected by the provider', async () => {
      const put = await store.put({
        content: new TextEncoder().encode(
          `p004 anonymous-access probe ${globalThis.crypto.randomUUID()}`,
        ),
        contentType: 'text/plain',
      });
      key = put.key;
      // Unsigned plain HTTP GET — no SigV4 Authorization header at all.
      const response = await fetch(
        `${live.config.endpoint}/${live.evidenceBucket}/${put.key}`,
        { method: 'GET' },
      );
      const body = await response.text();
      // The provider must reject the unsigned request and never return the
      // object bytes. (Observed on live R2: HTTP 400 InvalidArgument
      // "Authorization" — the rejection happens before object access.)
      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(body).not.toContain('anonymous-access probe'); // no object bytes leak
      recordTranscript(FACET, {
        step: 'anonymous object access (no credentials)',
        command: `fetch GET ${live.config.endpoint}/${live.evidenceBucket}/${put.key} — unsigned, no Authorization header`,
        resource: `bucket ${live.evidenceBucket}, key ${put.key}`,
        result: `HTTP ${String(response.status)} ${body.slice(0, 160).replaceAll('\n', ' ')} — private-by-default: the provider rejects unsigned reads before object access; object bytes never returned`,
        classification: 'DEMONSTRATED-LIVE',
      });
    });

    it('wrong-secret READ of an existing object is rejected before object-level authorization', async () => {
      const put = await store.put({
        content: new TextEncoder().encode(
          `p004 wrong-secret-read probe ${globalThis.crypto.randomUUID()}`,
        ),
        contentType: 'text/plain',
      });
      key = put.key;
      const wrongSecretStore = new R2BlobStore({
        env: {
          R2_ACCESS_KEY_ID: live.config.accessKeyId,
          R2_SECRET_ACCESS_KEY: WRONG_SECRET,
          R2_S3_ENDPOINT: live.config.endpoint,
          R2_BUCKET: live.evidenceBucket,
        },
      });
      let caught: unknown;
      try {
        await wrongSecretStore.get(put.key);
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceError(caught)).toBe(true);
      const typed = caught as { code?: string; cause?: unknown };
      expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
      const cause = typed.cause as { name?: string; $metadata?: { httpStatusCode?: number } };
      recordTranscript(FACET, {
        step: 'wrong-secret read of an existing object',
        command: `R2BlobStore.get(key) with R2_SECRET_ACCESS_KEY=<deliberately-invalid>`,
        resource: `bucket ${live.evidenceBucket}, key ${put.key}`,
        result: `typed PERSISTENCE_TRANSPORT_FAILED (provider answered ${String(cause?.$metadata?.httpStatusCode ?? 'n/a')}) — authentication precedes object-level authorization: the object's existence/bytes are not disclosed`,
        classification: 'DEMONSTRATED-LIVE',
      });
    });
  },
);

// ---------------------------------------------------------------------------
// AUTOMATED-TEST-ONLY rows: retry behavior + quota-exhaustion posture
// ---------------------------------------------------------------------------

describe('r2 retry behavior (AUTOMATED-TEST-ONLY — local stub, same client construction)', () => {
  let server: Server | null = null;
  let hits = 0;
  let port = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits += 1;
      if (hits <= 2) {
        response.writeHead(500, { 'content-type': 'application/xml' });
        response.end(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>stub-induced 500</Message></Error>',
        );
        return;
      }
      response.writeHead(200, { 'x-amz-bucket-region': 'auto' });
      response.end();
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        port = (server!.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  it('the adapter itself performs NO retry (exactly one transport call per operation)', async () => {
    let putObjectCalls = 0;
    const countingTransport = {
      async probe(): Promise<void> {},
      async headObject(): Promise<null> {
        return null;
      },
      async getObject(): Promise<null> {
        return null;
      },
      async putObject(): Promise<void> {
        putObjectCalls += 1;
        throw new S3ServiceException({
          name: 'SlowDown',
          $fault: 'client',
          message: 'stub throttle',
          $metadata: { httpStatusCode: 429 },
        });
      },
      async deleteObject(): Promise<boolean> {
        return false;
      },
    };
    const store = new R2BlobStore({ transport: countingTransport });
    let caught: unknown;
    try {
      await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      caught = error;
    }
    expect(putObjectCalls).toBe(1); // one attempt — no adapter-level retry loop
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    recordTranscript(FACET, {
      step: 'adapter-level retry posture',
      command: 'R2BlobStore.put(...) over an injected counting transport that always fails',
      resource: 'in-process transport seam (no network)',
      result: 'exactly 1 putObject call — the ADAPTER does not retry; failures surface as the typed TRANSPORT_FAILED error (deterministic single-attempt semantics; retry policy is delegated to the transport layer)',
      classification: 'AUTOMATED-TEST-ONLY',
    });
  });

  it('the SDK transport (same construction as the adapter) retries 5xx by default: 500,500,200 → 3 attempts', async () => {
    // Identical client construction to createR2ObjectStorageTransport
    // (region 'auto', forcePathStyle, static credentials) — pointed at a
    // local HTTP stub that answers 500, 500, then 200.
    const client = new S3Client({
      region: 'auto',
      endpoint: `http://127.0.0.1:${String(port)}`,
      credentials: { accessKeyId: 'stub-key', secretAccessKey: 'stub-secret' },
      forcePathStyle: true,
    });
    await client.send(new HeadBucketCommand({ Bucket: 'stub-bucket' }));
    expect(hits).toBe(3); // default maxAttempts=3: initial + 2 retries
    recordTranscript(FACET, {
      step: 'transport-level retry policy',
      command: 'S3Client( SAME options as createR2ObjectStorageTransport ).send(HeadBucketCommand) against a local stub answering 500,500,200',
      resource: `local stub 127.0.0.1:${String(port)} (no provider round-trip)`,
      result: '3 HTTP attempts, command resolved — the @aws-sdk/client-s3 default retry strategy (maxAttempts=3) covers transient 5xx at the transport layer',
      classification: 'AUTOMATED-TEST-ONLY',
    });
  });
});

describe('r2 quota-exhaustion posture (AUTOMATED-TEST-ONLY — not safely triggerable live)', () => {
  it('a transport-level quota error surfaces as the typed TRANSPORT_FAILED error (exactly one attempt, no fallback)', async () => {
    let calls = 0;
    const throttledTransport = {
      async probe(): Promise<void> {},
      async headObject(): Promise<null> {
        calls += 1;
        throw new S3ServiceException({
          name: 'SlowDown',
          $fault: 'client',
          message: 'reduce your request rate',
          $metadata: { httpStatusCode: 429 },
        });
      },
      async getObject(): Promise<null> {
        return null;
      },
      async putObject(): Promise<void> {},
      async deleteObject(): Promise<boolean> {
        return false;
      },
    };
    const store = new R2BlobStore({ transport: throttledTransport });
    let caught: unknown;
    try {
      await store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' });
    } catch (error) {
      caught = error;
    }
    expect(calls).toBe(1);
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED);
    recordTranscript(FACET, {
      step: 'quota/throttle error path (429 SlowDown)',
      command: 'R2BlobStore.put(...) over an injected transport throwing S3ServiceException SlowDown/429 on head_object',
      resource: 'in-process transport seam (no network)',
      result: 'typed PERSISTENCE_TRANSPORT_FAILED after exactly 1 attempt — no second destination, no silent paid fallback (none is representable in the taxonomy); the caller fails closed',
      classification: 'AUTOMATED-TEST-ONLY',
    });
  });

  it('the port-level fail-closed exhaustion policy throws PERSISTENCE_CAPACITY_EXHAUSTED', () => {
    expect(CAPACITY_EXHAUSTION_POLICY).toBe('fail-closed'); // the ONLY inhabitant
    const snapshot: CapacitySnapshot = toCapacitySnapshot({
      status: 'EXHAUSTED',
      checkedAt: Date.now(),
      dimensions: [],
      reasons: [{ code: 'quota-exhausted', dimension: 'storage' }],
    });
    expect(snapshot.status).toBe('EXHAUSTED');
    let caught: unknown;
    try {
      assertCapacityUsable(snapshot);
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    expect((caught as { code?: string }).code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED);
    recordTranscript(FACET, {
      step: 'port-level exhaustion gate',
      command: 'assertCapacityUsable(toCapacitySnapshot({status: EXHAUSTED, reasons: [quota-exhausted]}))',
      resource: '@arena/persistence capacity model (in-process)',
      result: `throws PERSISTENCE_CAPACITY_EXHAUSTED; CAPACITY_EXHAUSTION_POLICY === 'fail-closed' is the only representable policy — live quota exhaustion was NOT triggered (filling the shared free-tier allowance or throttling the shared credentials would damage other tenants of this account); usage metering that decides EXHAUSTED lives in the deploy wiring (deploy/src/hosted/quotas.ts — outside P004 surfaces)`,
      classification: 'AUTOMATED-TEST-ONLY',
    });
  });

  it('records the honest classification for live quota exhaustion', () => {
    recordNote(
      FACET,
      'live quota exhaustion NOT demonstrated and NOT claimed: a safe live trigger does not exist for the shared account (10 GiB storage allowance / request throttling shared with other projects). The 429 code path and the port-level fail-closed gate are the AUTOMATED-TEST-ONLY evidence above.',
    );
    expect(true).toBe(true);
  });
});
