/**
 * ArtifactStore tests (Work Order A014): PUT/GET by digest + identity,
 * identity↔digest binding permanence, tenant-scope isolation, content
 * verification on read (fail-closed tamper detection) and the absence of
 * any mutation surface.
 */

import { describe, expect, it } from 'vitest';
import { ARTIFACT_ERROR_CODES } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { ArtifactStore } from './store.js';
import { ARTIFACTS_ERROR_CODES, ArtifactsError } from './errors.js';
import { CALLER_A, CALLER_B, TENANT_A, makeArtifact, refOf } from './test-support.js';

describe('ArtifactStore put (positive)', () => {
  it('puts a verified artifact and indexes it by digest + identity', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    const receipt = await store.put(artifact, CALLER_A);
    expect(receipt.idempotent).toBe(false);
    expect(receipt.digest).toBe(artifact.digest);
    expect(await store.size()).toBe(1);
  });

  it('re-putting the bit-identical artifact is idempotent', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const again = await store.put(artifact, CALLER_A);
    expect(again.idempotent).toBe(true);
    expect(again.digest).toBe(artifact.digest);
    expect(await store.size()).toBe(1);
  });

  it('puts into the reserved public namespace from any tenant caller', async () => {
    const store = new ArtifactStore();
    const shared = await makeArtifact(1, { namespace: 'public' });
    await expect(store.put(shared, CALLER_B)).resolves.toBeTruthy();
    expect(await store.size()).toBe(1);
  });
});

describe('ArtifactStore put (negative/adversarial)', () => {
  it('rejects cross-tenant ingest (R24 tenant scoping)', async () => {
    const store = new ArtifactStore();
    const foreign = await makeArtifact(1, { namespace: 'tenant-b' });
    await expect(store.put(foreign, CALLER_A)).rejects.toThrow(ArtifactsError);
    try {
      await store.put(foreign, CALLER_A);
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN);
    }
  });

  it('REJECTS a second artifact under a bound identity+version (never overwrites)', async () => {
    const store = new ArtifactStore();
    const first = await makeArtifact(1, { name: 'same-identity' });
    await store.put(first, CALLER_A);
    // Same identity, DIFFERENT content ⇒ different digest.
    const second = await makeArtifact(2, {
      name: 'same-identity',
      content: { kind: 'fixture', index: 2, payload: 'different content' },
    });
    await expect(store.put(second, CALLER_A)).rejects.toThrow();
    try {
      await store.put(second, CALLER_A);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.IDENTITY_CONFLICT);
      expect((error as { details?: Record<string, unknown> }).details).toMatchObject({
        bound: first.digest,
        attempted: second.digest,
      });
    }
    // The binding is unchanged: the original digest still resolves.
    const stored = await store.getByDigest(first.digest, CALLER_A);
    expect(stored.digest).toBe(first.digest);
  });

  it('different VERSIONS of the same name are distinct identities', async () => {
    const store = new ArtifactStore();
    const v1 = await makeArtifact(1, { name: 'versioned', version: '1.0.0' });
    const v2 = await makeArtifact(2, { name: 'versioned', version: '2.0.0' });
    await store.put(v1, CALLER_A);
    await store.put(v2, CALLER_A);
    expect(await store.size()).toBe(2);
  });

  it('never trusts caller-side digests: a digest-mismatched artifact fails at put', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    // An in-process adversary clones the artifact and forges the digest.
    const forged = structuredClone(JSON.parse(JSON.stringify(artifact))) as unknown as MaterialArtifact<unknown>;
    (forged as unknown as { digest: string }).digest = '0'.repeat(64);
    await expect(store.put(forged, CALLER_A)).rejects.toThrow();
    try {
      await store.put(forged, CALLER_A);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.TAMPERED);
    }
    expect(await store.size()).toBe(0);
  });

  it('rejects malformed caller principals through the reused A002 guard', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await expect(
      store.put(artifact, { type: 'robot', tenant: TENANT_A, principalId: 'x' }),
    ).rejects.toThrow();
  });
});

describe('ArtifactStore get (positive)', () => {
  it('gets by digest and by identity, verifying content on read', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const byDigest = await store.getByDigest(artifact.digest, CALLER_A);
    expect(byDigest.digest).toBe(artifact.digest);
    const byIdentity = await store.getByIdentity(artifact.identity, CALLER_A);
    expect(byIdentity.digest).toBe(artifact.digest);
    expect(await store.hasIdentity(artifact.identity)).toBe(true);
  });

  it('public-namespace artifacts are readable by every tenant', async () => {
    const store = new ArtifactStore();
    const shared = await makeArtifact(1, { namespace: 'public' });
    await store.put(shared, CALLER_A);
    const fromB = await store.getByDigest(shared.digest, CALLER_B);
    expect(fromB.digest).toBe(shared.digest);
  });

  it('listByNamespace lists the tenant scope deterministically', async () => {
    const store = new ArtifactStore();
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    await store.put(a, CALLER_A);
    await store.put(b, CALLER_A);
    const listed = await store.listByNamespace(TENANT_A, CALLER_A);
    expect(listed.map((entry) => entry.digest).sort()).toEqual([a.digest, b.digest].sort());
  });
});

describe('ArtifactStore get (negative/adversarial, tenant-scope isolation)', () => {
  it('cross-tenant reads are REJECTED with a typed error', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await expect(store.getByDigest(artifact.digest, CALLER_B)).rejects.toThrow(ArtifactsError);
    await expect(store.getByIdentity(artifact.identity, CALLER_B)).rejects.toThrow(ArtifactsError);
    try {
      await store.getByDigest(artifact.digest, CALLER_B);
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN);
      expect((error as ArtifactsError).details).toMatchObject({
        callerTenant: 'tenant-b',
        artifactNamespace: 'tenant-a',
      });
    }
  });

  it('unknown digests and identities throw NOT_FOUND', async () => {
    const store = new ArtifactStore();
    await expect(store.getByDigest('0'.repeat(64), CALLER_A)).rejects.toThrow(ArtifactsError);
    try {
      await store.getByDigest('0'.repeat(64), CALLER_A);
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.NOT_FOUND);
    }
    await expect(
      store.getByIdentity({ namespace: TENANT_A, name: 'missing', version: '1.0.0' }, CALLER_A),
    ).rejects.toThrow(ArtifactsError);
  });

  it('cross-tenant listing is rejected', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await expect(store.listByNamespace(TENANT_A, CALLER_B)).rejects.toThrow(ArtifactsError);
  });

  it('content verification ON READ detects a corrupted stored entry (fail-closed)', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    // An in-process adversary reaches into the store's private index and
    // replaces the entry with a mutated clone carrying the SAME claimed
    // digest. The read must fail closed with ARTIFACT_TAMPERED.
    const internals = store as unknown as {
      byDigest: Map<string, MaterialArtifact<unknown>>;
    };
    const corrupted = structuredClone(
      JSON.parse(JSON.stringify(artifact)),
    ) as unknown as MaterialArtifact<unknown>;
    (
      (corrupted as unknown as { content: { payload: string } }).content
    ).payload = 'corrupted in-process';
    internals.byDigest.set(artifact.digest, corrupted);
    await expect(store.getByDigest(artifact.digest, CALLER_A)).rejects.toThrow();
    try {
      await store.getByDigest(artifact.digest, CALLER_A);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.TAMPERED);
    }
  });

  it('the resolver honors the caller read scope (cross-tenant refs resolve to null)', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const resolverA = store.resolverFor(CALLER_A);
    await expect(resolverA(refOf(artifact))).resolves.toBeTruthy();
    const resolverB = store.resolverFor(CALLER_B);
    // Same digest, cross-tenant scope: unresolvable (null), so tree
    // verification reports unresolved refs instead of leaking content.
    await expect(resolverB(refOf(artifact))).resolves.toBeNull();
  });

  it('there is NO update/delete mutation surface', async () => {
    const store = new ArtifactStore();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(store),
    ).filter((name) => name !== 'constructor');
    for (const forbidden of ['update', 'delete', 'remove', 'set', 'overwrite', 'mutate']) {
      expect(methodNames, `mutation method ${forbidden} must not exist`).not.toContain(forbidden);
    }
    // Artifacts themselves stay frozen.
    expect(() => {
      (artifact as unknown as { digest: string }).digest = '0'.repeat(64);
    }).toThrow();
  });
});
