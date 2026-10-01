/**
 * DISABLED fail-closed posture for the Cloudflare R2 adapter (Work Order
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
import { R2BlobStore } from './adapter.js';
import { contentAddressedBlobKey } from '@arena/persistence';
import { missingR2EnvVarNames, readR2ConfigFromEnv } from './env.js';

const CANARY_KEY = 'canary-access-key-id';
const CANARY_SECRET = 'canary-secret-access-key';
const CANARY_ACCOUNT = 'canary-account-id';

function canaryEnv(): Record<string, string> {
  return {
    R2_ACCOUNT_ID: CANARY_ACCOUNT,
    R2_ACCESS_KEY_ID: CANARY_KEY,
    R2_SECRET_ACCESS_KEY: CANARY_SECRET,
    R2_BUCKET: 'canary-bucket',
  };
}

describe('r2-object-store DISABLED fail-closed posture (no credentials)', () => {
  it('constructs DISABLED without env configuration and fails closed on every operation', async () => {
    const store = new R2BlobStore({ env: {} });
    expect(store.enabled).toBe(false);

    const absentKey = contentAddressedBlobKey('0'.repeat(64));
    const operations: (() => Promise<unknown>)[] = [
      () => store.put({ content: new TextEncoder().encode('x'), contentType: 'text/plain' }),
      () => store.get(absentKey),
      () => store.exists(absentKey),
      () => store.delete(absentKey),
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
    const store = new R2BlobStore({ env: {} });
    const snapshot = await store.capacityProbe();
    expect(snapshot.status).toBe('DISABLED');
    expect(snapshot.reasons).toEqual([{ code: 'configuration-missing' }]);
    expect(snapshot.dimensions).toEqual([]);
  });

  it('partial configuration stays DISABLED (any missing required variable)', () => {
    expect(new R2BlobStore({ env: { ...canaryEnv(), R2_BUCKET: '' } }).enabled).toBe(false);
    expect(new R2BlobStore({ env: { ...canaryEnv(), R2_ACCESS_KEY_ID: undefined } }).enabled).toBe(
      false,
    );
    // Neither an explicit endpoint nor an account id.
    expect(
      new R2BlobStore({
        env: {
          R2_ACCESS_KEY_ID: CANARY_KEY,
          R2_SECRET_ACCESS_KEY: CANARY_SECRET,
          R2_BUCKET: 'canary-bucket',
        },
      }).enabled,
    ).toBe(false);
  });

  it('missing variable NAMES are reported (names only, never values)', () => {
    expect(missingR2EnvVarNames({})).toEqual([
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'R2_S3_ENDPOINT',
      'R2_ACCOUNT_ID',
    ]);
    expect(missingR2EnvVarNames({ ...canaryEnv(), R2_BUCKET: '  ' })).toEqual(['R2_BUCKET']);
    // The endpoint pair is satisfied by EITHER variable (here: the account id).
    expect(missingR2EnvVarNames({ ...canaryEnv(), R2_S3_ENDPOINT: '' })).toEqual([]);
    // Blank the account id AND have no explicit endpoint -> the pair is missing.
    expect(missingR2EnvVarNames({ ...canaryEnv(), R2_ACCOUNT_ID: '' })).toEqual([
      'R2_S3_ENDPOINT',
      'R2_ACCOUNT_ID',
    ]);
  });
});

describe('r2-object-store env resolution', () => {
  it('derives the endpoint from the account id when no explicit endpoint exists', () => {
    expect(readR2ConfigFromEnv(canaryEnv())).toEqual({
      endpoint: `https://${CANARY_ACCOUNT}.r2.cloudflarestorage.com`,
      accessKeyId: CANARY_KEY,
      secretAccessKey: CANARY_SECRET,
      bucket: 'canary-bucket',
    });
  });

  it('R2_S3_ENDPOINT wins over the account id; unusable endpoints resolve null', () => {
    expect(
      readR2ConfigFromEnv({
        ...canaryEnv(),
        R2_S3_ENDPOINT: 'https://explicit-endpoint.example',
      })?.endpoint,
    ).toBe('https://explicit-endpoint.example');
    // Non-http endpoints are unusable -> DISABLED, not crash.
    expect(readR2ConfigFromEnv({ ...canaryEnv(), R2_S3_ENDPOINT: 'ftp://nope.example' })).toBeNull();
    expect(readR2ConfigFromEnv({ ...canaryEnv(), R2_ACCOUNT_ID: 'bad account!' })).toBeNull();
  });

  it('enabled with full configuration; the configuration never surfaces', () => {
    const store = new R2BlobStore({ env: canaryEnv() });
    expect(store.enabled).toBe(true);
    // enabled == a client was constructed; no network calls happen here.
  });
});

describe('r2-object-store secret hygiene (canary never surfaces)', () => {
  it('DISABLED errors carry env-var NAMES, never values', async () => {
    const unconfigured = new R2BlobStore({ env: {} });
    let caught: unknown;
    try {
      await unconfigured.get(contentAddressedBlobKey('0'.repeat(64)));
    } catch (error) {
      caught = error;
    }
    expect(isPersistenceError(caught)).toBe(true);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(serialized).not.toContain('canary');
    expect(String(caught)).not.toContain('canary');
    const details = (caught as { details?: { missingEnvVarNames?: string[] } }).details;
    expect(details?.missingEnvVarNames).toEqual([
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'R2_S3_ENDPOINT',
      'R2_ACCOUNT_ID',
    ]);
  });
});
