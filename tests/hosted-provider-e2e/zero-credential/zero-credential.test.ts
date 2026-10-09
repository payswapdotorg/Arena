/**
 * P004 — demo-with-zero-credentials check (the fail-closed contract).
 *
 * Part 1 (always runs, zero credentials by construction): with NO provider
 * configuration the hosted adapters are DISABLED — every port operation
 * throws the typed capacity error (PERSISTENCE_CAPACITY_DISABLED) BEFORE
 * any network call (no client/transport is constructed at all), and the
 * capacity probes report DISABLED with the structured reason
 * `configuration-missing`. Partial configurations are also DISABLED (a
 * half-configured adapter must never half-run). A SANITIZED copy of the
 * CURRENT environment (every provider credential name removed) lands in
 * the same posture — proving sanitization, not absence, is what the
 * adapters respond to.
 *
 * Part 2 (app boot, needs `pnpm build`): the built app boots and serves
 * the demo with a fully sanitized environment — NO provider credentials
 * set (see zero-credential-app-boot.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  isPersistenceError,
  PERSISTENCE_ERROR_CODES,
  toBlobKey,
  toCoordinationKey,
  type BlobStore,
  type CoordinationStore,
} from '@arena/persistence';
import { toIdempotencyKey } from '@arena/protocol-core';
import { R2BlobStore, R2_ENV_VARS } from '@arena/hosted-r2-object-store';
import { UpstashCoordinationStore, UPSTASH_ENV_VARS } from '@arena/hosted-upstash-redis';
import { removedProviderEnvNames, sanitizedEnv } from '../support/sanitize.js';
import { recordTranscript } from '../support/transcript.js';

const FACET = 'zero-credential';

const ABSENT_BLOB_KEY = toBlobKey(
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
);
const COORDINATION_KEY = toCoordinationKey('p004-zero-credential-probe');
const IDEMPOTENCY_KEY = toIdempotencyKey('p004-zero-credential-idem-probe');

/** Every port operation of the blob store (each must fail closed). */
const BLOB_OPS: readonly {
  readonly name: string;
  readonly run: (store: BlobStore) => Promise<unknown>;
}[] = [
  {
    name: 'put',
    run: (store) =>
      store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' }),
  },
  { name: 'get', run: (store) => store.get(ABSENT_BLOB_KEY) },
  { name: 'exists', run: (store) => store.exists(ABSENT_BLOB_KEY) },
  { name: 'delete', run: (store) => store.delete(ABSENT_BLOB_KEY) },
];

/** Representative port operations of the coordination store. */
const COORD_OPS: readonly {
  readonly name: string;
  readonly run: (store: CoordinationStore) => Promise<unknown>;
}[] = [
  { name: 'cacheSet', run: (store) => store.cacheSet(COORDINATION_KEY, 'value', 60_000) },
  { name: 'cacheGet', run: (store) => store.cacheGet(COORDINATION_KEY) },
  {
    name: 'openIdempotencyWindow',
    run: (store) => store.openIdempotencyWindow(IDEMPOTENCY_KEY, '0'.repeat(32), 60_000),
  },
  { name: 'hitRateLimit', run: (store) => store.hitRateLimit(COORDINATION_KEY, 1_000, 1) },
  { name: 'acquireLease', run: (store) => store.acquireLease(COORDINATION_KEY, 'holder-a', 60_000) },
];

describe('zero-credential posture: adapters fail closed BEFORE any network call', () => {
  it('R2BlobStore with an empty env is DISABLED: no transport is constructed and every operation throws the typed capacity error', async () => {
    const store = new R2BlobStore({ env: {} });
    expect(store.enabled).toBe(false); // no S3 client was ever constructed
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);

    for (const op of BLOB_OPS) {
      let caught: unknown;
      try {
        await op.run(store);
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceError(caught), `op ${op.name}`).toBe(true);
      const typed = caught as { code?: string; details?: Record<string, unknown> };
      expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED);
      const missing = typed.details?.['missingEnvVarNames'] as readonly string[] | undefined;
      expect([...(missing ?? [])].sort()).toEqual([...R2_ENV_VARS].sort());
    }
    recordTranscript(FACET, {
      step: 'R2 zero-credential posture',
      command: 'new R2BlobStore({ env: {} }) → capacityProbe() + put/get/exists/delete',
      resource: 'in-process (no network — the gate fires before any transport exists)',
      result: `enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames (the env-var NAMES, never values)`,
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('UpstashCoordinationStore with an empty env is DISABLED: every operation throws the typed capacity error', async () => {
    const store = new UpstashCoordinationStore({ env: {} });
    expect(store.enabled).toBe(false);
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);

    for (const op of COORD_OPS) {
      let caught: unknown;
      try {
        await op.run(store);
      } catch (error) {
        caught = error;
      }
      expect(isPersistenceError(caught), `op ${op.name}`).toBe(true);
      const typed = caught as { code?: string; details?: Record<string, unknown> };
      expect(typed.code).toBe(PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED);
      expect(typed.details?.['missingEnvVarNames']).toEqual([...UPSTASH_ENV_VARS]);
    }
    recordTranscript(FACET, {
      step: 'Upstash zero-credential posture',
      command: 'new UpstashCoordinationStore({ env: {} }) → capacityProbe() + cacheSet/cacheGet/openIdempotencyWindow/hitRateLimit/acquireLease',
      resource: 'in-process (no network — the gate fires before any transport exists)',
      result: 'enabled=false; probe=DISABLED reasons=[configuration-missing]; every operation → typed PERSISTENCE_CAPACITY_DISABLED with missingEnvVarNames [UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN]',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('PARTIAL configurations are also DISABLED (a half-configured adapter never half-runs)', async () => {
    const r2Partial = new R2BlobStore({
      env: { R2_ACCESS_KEY_ID: 'only-the-key-id', R2_S3_ENDPOINT: 'https://example.invalid' },
    });
    expect(r2Partial.enabled).toBe(false);
    const r2Snapshot = await r2Partial.capacityProbe();
    expect(r2Snapshot.status).toBe('DISABLED');

    const upstashPartial = new UpstashCoordinationStore({
      env: { UPSTASH_REDIS_REST_URL: 'https://example.invalid' }, // token missing
    });
    expect(upstashPartial.enabled).toBe(false);
    const upstashSnapshot = await upstashPartial.capacityProbe();
    expect(upstashSnapshot.status).toBe('DISABLED');
    recordTranscript(FACET, {
      step: 'partial-configuration posture',
      command: 'R2BlobStore({R2_ACCESS_KEY_ID only}); UpstashCoordinationStore({URL only})',
      resource: 'in-process',
      result: 'both DISABLED reasons=[configuration-missing] — partial credentials never produce a half-live adapter',
      classification: 'DEMONSTRATED-LIVE',
    });
  });

  it('a SANITIZED copy of the current environment lands in the zero-credential posture', async () => {
    const sanitized = sanitizedEnv();
    const removed = removedProviderEnvNames();
    const r2 = new R2BlobStore({ env: sanitized });
    const upstash = new UpstashCoordinationStore({ env: sanitized });
    expect(r2.enabled).toBe(false);
    expect(upstash.enabled).toBe(false);
    expect((await r2.capacityProbe()).status).toBe('DISABLED');
    expect((await upstash.capacityProbe()).status).toBe('DISABLED');
    recordTranscript(FACET, {
      step: 'sanitized-environment posture',
      command: `sanitizedEnv(process.env) — removed ${String(removed.length)} provider env names: ${removed.join(', ')} (NAMES only)`,
      resource: 'in-process',
      result: 'both adapters DISABLED — sanitization (not mere absence) yields the zero-credential fail-closed posture',
      classification: 'DEMONSTRATED-LIVE',
    });
  });
});
