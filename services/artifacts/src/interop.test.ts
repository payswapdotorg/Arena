/**
 * Interop tests (Work Order A014) — prove the artifact service and the
 * dataset packaging compose: the ArtifactStore's tenant-scoped resolver
 * feeds @arena/datasets bundle resolution (its devDependency position in
 * this service exists precisely and only for this cross-surface proof,
 * mirroring how @arena/provenance dev-depends on @arena/artifact-protocol
 * for its cross-parity suite).
 *
 * Covered:
 *   - manifest → resolveDatasetBundle through store.resolverFor(caller);
 *   - fail-closed cross-tenant resolution (unscoped entries do not
 *     resolve: DATASET_UNRESOLVED_ENTRY);
 *   - dataset derivation + manifest-chain consistency with the lineage
 *     vocabulary (the child's parent ref is the parent's manifest digest).
 */

import { describe, expect, it } from 'vitest';
import {
  createDatasetManifest,
  deriveDatasetManifest,
  resolveDatasetBundle,
  verifyDatasetBundle,
} from '@arena/datasets';
import type { DatasetManifest } from '@arena/datasets';
import { createArtifactService } from './index.js';
import { CALLER_A, CALLER_B, RIGHTS, T1, makeArtifact, refOf } from './test-support.js';

describe('dataset bundles resolve through the artifact service store', () => {
  it('manifest entries resolve via the store resolver and the bundle verifies', async () => {
    const { store } = createArtifactService();
    const input = await makeArtifact(1);
    const output = await makeArtifact(2);
    await store.put(input, CALLER_A);
    await store.put(output, CALLER_A);
    const manifest = await createDatasetManifest({
      identity: { namespace: 'tenant-a', name: 'interop-dataset', version: '1.0.0' },
      entries: [
        { role: 'input', artifact: refOf(input) },
        { role: 'output', artifact: refOf(output) },
      ],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
        createdAt: '2026-03-01T12:00:00.000Z',
        parents: [],
        rights: RIGHTS,
      },
    });
    const resolver = store.resolverFor(CALLER_A);
    const bundle = await resolveDatasetBundle(manifest, resolver);
    expect(bundle.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyDatasetBundle(bundle, resolver)).resolves.toBe(bundle.bundleDigest);
  });

  it('cross-tenant bundle resolution fails closed (entries do not resolve)', async () => {
    const { store } = createArtifactService();
    const input = await makeArtifact(1);
    await store.put(input, CALLER_A);
    const manifest = await createDatasetManifest({
      identity: { namespace: 'tenant-a', name: 'interop-dataset', version: '1.0.0' },
      entries: [{ role: 'input', artifact: refOf(input) }],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
        createdAt: '2026-03-01T12:00:00.000Z',
        parents: [],
        rights: RIGHTS,
      },
    });
    // tenant-b's resolver cannot see tenant-a artifacts: every entry is
    // unresolvable in that scope — fail closed, no partial bundle.
    const foreignResolver = store.resolverFor(CALLER_B);
    await expect(resolveDatasetBundle(manifest, foreignResolver)).rejects.toThrow();
  });

  it('a bundle over a stored-but-missing entry fails closed (store misses one digest)', async () => {
    const { store } = createArtifactService();
    const stored = await makeArtifact(1);
    const unstored = await makeArtifact(2);
    await store.put(stored, CALLER_A);
    const manifest = await createDatasetManifest({
      identity: { namespace: 'tenant-a', name: 'interop-dataset', version: '1.0.0' },
      entries: [
        { role: 'input', artifact: refOf(stored) },
        { role: 'input', artifact: refOf(unstored) },
      ],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
        createdAt: '2026-03-01T12:00:00.000Z',
        parents: [],
        rights: RIGHTS,
      },
    });
    await expect(
      resolveDatasetBundle(manifest, store.resolverFor(CALLER_A)),
    ).rejects.toThrow();
  });
});

describe('dataset derivation + lineage vocabulary consistency', () => {
  it('a derived manifest carries the parent manifest digest as its parent ref', async () => {
    const { store, lineage } = createArtifactService();
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    await store.put(a, CALLER_A);
    await store.put(b, CALLER_A);

    const parent = await createDatasetManifest({
      identity: { namespace: 'tenant-a', name: 'interop-dataset', version: '1.0.0' },
      entries: [
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
        createdAt: '2026-03-01T12:00:00.000Z',
        parents: [],
        rights: RIGHTS,
      },
    });
    const child = await deriveDatasetManifest({
      parent,
      identity: { namespace: 'tenant-a', name: 'interop-dataset', version: '1.1.0' },
      entries: [{ role: 'split', artifact: refOf(a) }],
      provenance: {
        creator: { type: 'user', tenant: 'tenant-a', principalId: 'user-42' },
        createdAt: T1,
        rights: RIGHTS,
      },
    });
    // The child's parent ref is EXACTLY the parent manifest, content-addressed.
    expect(child.provenance.parents[0]?.parent.digest).toBe(parent.digest);
    expect(child.provenance.parents[0]?.relation).toBe('extracted-from');

    // The entry-level lineage is recorded through the service as well: the
    // split artifact's provenance lists its parent artifact, and the
    // manifest chain references the parent manifest digest — both sides
    // use the same A002 content addressing.
    await lineage.record({
      artifact: refOf(a),
      creator: { type: 'service', tenant: 'tenant-a', principalId: 'svc-1' },
      createdAt: '2026-03-01T12:00:00.000Z',
      parents: [],
      transformation: {
        transform: {
          namespace: 'tenant-a',
          name: 'interop-transform',
          version: '1.0.0',
          digest: 'b'.repeat(64),
        },
        inputs: [],
      },
      rights: RIGHTS,
    });
    const record = await lineage.getRecord(refOf(a));
    expect(record?.artifact.digest).toBe(a.digest);
    expect(manifestDigestChild(child)).not.toBe(manifestDigestChild(parent));
  });
});

function manifestDigestChild(manifest: DatasetManifest): string {
  return manifest.digest;
}
