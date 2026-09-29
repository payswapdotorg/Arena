/**
 * PublicationService tests (Work Order A014): the A002 PublicationLedger
 * semantics wrapped as service operations — publish (explicit, immutable),
 * retract (appends a NEW record), status/listPublic/listPrivate per scope,
 * tenant guards and the never-silently-changes-visibility invariant.
 */

import { describe, expect, it } from 'vitest';
import { ARTIFACT_ERROR_CODES } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { PublicationService } from './publication.js';
import { ArtifactStore } from './store.js';
import { ARTIFACTS_ERROR_CODES, ArtifactsError } from './errors.js';
import { createArtifactService } from './index.js';
import { CALLER_A, CALLER_B, RIGHTS, TENANT_A, makeArtifact } from './test-support.js';

describe('PublicationService publish (positive)', () => {
  it('publishes a stored artifact and flips its status to public', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const result = await publication.publish(artifact, CALLER_A, RIGHTS);
    expect(result.record.action).toBe('publish');
    expect(result.record.artifact.digest).toBe(artifact.digest);
    expect(result.idempotent).toBe(false);
    const status = await publication.status(artifact.identity);
    expect(status.visibility).toBe('public');
    expect(status.visibility === 'public' && status.publication.artifact.digest).toBe(
      artifact.digest,
    );
  });

  it('re-publishing the identical record is idempotent', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const first = await publication.publish(artifact, CALLER_A, RIGHTS, {
      publishedAt: '2026-03-01T12:00:00.000Z',
    });
    const second = await publication.publish(artifact, CALLER_A, RIGHTS, {
      publishedAt: '2026-03-01T12:00:00.000Z',
    });
    expect(second.idempotent).toBe(true);
    expect(publication.ledger().records).toHaveLength(1);
    expect(first.record).toEqual(second.record);
  });

  it('listPublic returns active records, optionally scoped by namespace', async () => {
    const { store, publication } = createArtifactService();
    const a = await makeArtifact(1, { name: 'pub-artifact-a' });
    const b = await makeArtifact(2, { name: 'pub-artifact-b' });
    const shared = await makeArtifact(3, { namespace: 'public', name: 'pub-shared' });
    await store.put(a, CALLER_A);
    await store.put(b, CALLER_A);
    await store.put(shared, CALLER_B);
    await publication.publish(a, CALLER_A, RIGHTS);
    await publication.publish(shared, CALLER_B, RIGHTS);
    const all = await publication.listPublic();
    expect(all).toHaveLength(2);
    const scoped = await publication.listPublic({ namespace: TENANT_A });
    expect(scoped.map((record) => record.artifact.name)).toEqual(['pub-artifact-a']);
    const publicScoped = await publication.listPublic({ namespace: 'public' });
    expect(publicScoped.map((record) => record.artifact.name)).toEqual(['pub-shared']);
  });
});

describe('PublicationService publish (negative/adversarial, fail-closed)', () => {
  it('rejects publishing an UNSTORED artifact (you publish what the service holds)', async () => {
    const { publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await expect(publication.publish(artifact, CALLER_A, RIGHTS)).rejects.toThrow(
      ArtifactsError,
    );
    try {
      await publication.publish(artifact, CALLER_A, RIGHTS);
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.NOT_FOUND);
    }
  });

  it('rejects CROSS-TENANT publication through the store read guard', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await expect(publication.publish(artifact, CALLER_B, RIGHTS)).rejects.toThrow(
      ArtifactsError,
    );
    try {
      await publication.publish(artifact, CALLER_B, RIGHTS);
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN);
    }
    // The artifact stays private — no ledger record was created.
    expect(await publication.status(artifact.identity)).toMatchObject({
      visibility: 'private',
    });
    expect(publication.ledger().records).toHaveLength(0);
  });

  it('rejects a TAMPERED artifact clone at publication (A002 fail-closed)', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const tampered = structuredClone(
      JSON.parse(JSON.stringify(artifact)),
    ) as unknown as MaterialArtifact<unknown>;
    (
      (tampered as unknown as { content: { payload: string } }).content
    ).payload = 'tampered payload';
    await expect(publication.publish(tampered, CALLER_A, RIGHTS)).rejects.toThrow();
    try {
      await publication.publish(tampered, CALLER_A, RIGHTS);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.TAMPERED);
    }
  });

  it('rejects malformed rights through the reused A002 guard', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await expect(
      publication.publish(artifact, CALLER_A, { license: 'MIT' }),
    ).rejects.toThrow();
  });
});

describe('PublicationService retract (append-only)', () => {
  it('retraction appends a NEW record; the original is never edited', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const published = await publication.publish(artifact, CALLER_A, RIGHTS, {
      publishedAt: '2026-03-01T12:00:00.000Z',
    });
    const retracted = await publication.retract(published.record, CALLER_A, {
      retractedAt: '2026-03-01T13:00:00.000Z',
    });
    expect(retracted.record.action).toBe('retract');
    expect(retracted.record.supersedes).toBe(
      await publication.recordDigest(published.record),
    );
    const records = publication.ledger().records;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(published.record); // the original survives verbatim
    expect(records[0]?.action).toBe('publish');
    expect(records[1]?.action).toBe('retract');
  });

  it('after retraction the artifact is PRIVATE again (status resolution)', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const published = await publication.publish(artifact, CALLER_A, RIGHTS);
    await publication.retract(published.record, CALLER_A);
    expect(await publication.status(artifact.identity)).toMatchObject({
      visibility: 'private',
    });
    // And listPublic no longer carries it.
    expect(await publication.listPublic()).toHaveLength(0);
  });

  it('re-publication after retraction is possible (append-only history)', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const first = await publication.publish(artifact, CALLER_A, RIGHTS, {
      publishedAt: '2026-03-01T12:00:00.000Z',
    });
    await publication.retract(first.record, CALLER_A, {
      retractedAt: '2026-03-01T13:00:00.000Z',
    });
    const second = await publication.publish(artifact, CALLER_A, RIGHTS, {
      publishedAt: '2026-03-01T14:00:00.000Z',
    });
    expect(second.idempotent).toBe(false);
    expect(publication.ledger().records).toHaveLength(3);
    expect(await publication.status(artifact.identity)).toMatchObject({
      visibility: 'public',
    });
  });

  it('rejects retracting a retraction and double retraction (A002 invariants)', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const published = await publication.publish(artifact, CALLER_A, RIGHTS);
    const retraction = await publication.retract(published.record, CALLER_A);
    // A retraction cannot be retracted.
    await expect(publication.retract(retraction.record, CALLER_A)).rejects.toThrow();
    // A publication cannot be retracted twice.
    await expect(publication.retract(published.record, CALLER_A)).rejects.toThrow();
  });

  it('rejects cross-tenant retraction', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const published = await publication.publish(artifact, CALLER_A, RIGHTS);
    await expect(publication.retract(published.record, CALLER_B)).rejects.toThrow(
      ArtifactsError,
    );
  });
});

describe('PublicationService listPrivate (tenant view)', () => {
  it('lists stored artifacts of the namespace without an active publication', async () => {
    const { store, publication } = createArtifactService();
    const privateOne = await makeArtifact(1, { name: 'private-one' });
    const privateTwo = await makeArtifact(2, { name: 'private-two' });
    const publishedOne = await makeArtifact(3, { name: 'published-one' });
    await store.put(privateOne, CALLER_A);
    await store.put(privateTwo, CALLER_A);
    await store.put(publishedOne, CALLER_A);
    await publication.publish(publishedOne, CALLER_A, RIGHTS);
    const privateArtifacts = await publication.listPrivate(CALLER_A);
    expect(privateArtifacts.map((artifact) => artifact.identity.name).sort()).toEqual([
      'private-one',
      'private-two',
    ]);
  });

  it('defaults to the caller tenant namespace and rejects cross-tenant listing', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const ownView = await publication.listPrivate(CALLER_A);
    expect(ownView).toHaveLength(1);
    // tenant-b listing its OWN (empty) namespace is legal — the rejection
    // is for tenant-a asking to see tenant-b's namespace.
    await expect(publication.listPrivate(CALLER_B)).resolves.toHaveLength(0);
    await expect(
      publication.listPrivate(CALLER_A, { namespace: 'tenant-b' }),
    ).rejects.toThrow(ArtifactsError);
    try {
      await publication.listPrivate(CALLER_A, { namespace: 'tenant-b' });
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.TENANT_FORBIDDEN);
    }
  });

  it('a retracted publication returns the artifact to the private view', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    const published = await publication.publish(artifact, CALLER_A, RIGHTS);
    expect(await publication.listPrivate(CALLER_A)).toHaveLength(0);
    await publication.retract(published.record, CALLER_A);
    expect(await publication.listPrivate(CALLER_A)).toHaveLength(1);
  });
});

describe('PublicationService never-silent-visibility invariant', () => {
  it('publication does NOT change the store tenant-scope isolation', async () => {
    const { store, publication } = createArtifactService();
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await publication.publish(artifact, CALLER_A, RIGHTS);
    // Published — but the STORE read scope is unchanged: tenant-b reads of
    // the tenant-a namespace are still rejected. Visibility is a LEDGER
    // concept (listPublic/status), never a silent namespace mutation.
    await expect(store.getByDigest(artifact.digest, CALLER_B)).rejects.toThrow(
      ArtifactsError,
    );
    expect((await store.listByNamespace(TENANT_A, CALLER_A)).length).toBe(1);
    expect(artifact.identity.namespace).toBe(TENANT_A);
  });

  it('the standalone service composes over an explicit store', async () => {
    const store = new ArtifactStore();
    const publication = new PublicationService(store);
    const artifact = await makeArtifact(1);
    await store.put(artifact, CALLER_A);
    await publication.publish(artifact, CALLER_A, RIGHTS);
    expect((await publication.listPublic()).length).toBe(1);
  });
});
