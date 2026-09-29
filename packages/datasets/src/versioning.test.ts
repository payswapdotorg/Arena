/**
 * DatasetVersioning tests (Work Order A014): version pins, binding
 * permanence in the registry, and split/subset derivations as
 * lineage-recorded transformations (child manifests carrying parent refs).
 */

import { describe, expect, it } from 'vitest';
import {
  DatasetVersionRegistry,
  datasetManifestRef,
  datasetManifestRefKey,
  datasetVersionKey,
  deriveDatasetManifest,
  isDatasetVersion,
  toDatasetVersion,
} from './versioning.js';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import { createDatasetManifest, verifyDatasetManifest } from './manifest.js';
import { makeArtifact, makeManifestInput, refOf, RIGHTS, T1, TENANT_A, TENANT_B } from './test-support.js';

describe('dataset version pins', () => {
  it('validates and freezes a version pin', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const pin = toDatasetVersion({
      identity: { namespace: TENANT_A, name: 'quarterly-reports', version: '1.0.0' },
      manifestDigest: manifest.digest,
    });
    expect(isDatasetVersion(pin)).toBe(true);
    expect(Object.isFrozen(pin)).toBe(true);
    expect(datasetVersionKey(pin)).toBe('tenant-a/quarterly-reports@1.0.0');
    expect(() =>
      toDatasetVersion({
        identity: { namespace: TENANT_A, name: 'x', version: 'not-semver' },
        manifestDigest: manifest.digest,
      }),
    ).toThrow();
    expect(() =>
      toDatasetVersion({
        identity: { namespace: TENANT_A, name: 'x', version: '1.0.0' },
        manifestDigest: 'short',
      }),
    ).toThrow();
  });

  it('isDatasetVersion rejects malformed pins', () => {
    expect(isDatasetVersion(null)).toBe(false);
    expect(isDatasetVersion({ identity: null, manifestDigest: '0'.repeat(64) })).toBe(false);
    expect(isDatasetVersion({ identity: {}, manifestDigest: '0'.repeat(64) })).toBe(false);
  });
});

describe('DatasetVersionRegistry (binding permanence)', () => {
  it('pins idempotently and rejects re-pinning a bound version to a different manifest', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const m1 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const m2 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(b) }]),
    );
    const registry = new DatasetVersionRegistry();
    const identity = { namespace: TENANT_A, name: 'pinned-dataset', version: '2.1.0' };
    const pin1 = toDatasetVersion({ identity, manifestDigest: m1.digest });

    await registry.pin(pin1);
    const again = await registry.pin(pin1);
    expect(again.manifestDigest).toBe(m1.digest);

    const pin2 = toDatasetVersion({ identity, manifestDigest: m2.digest });
    await expect(registry.pin(pin2)).rejects.toThrow(DatasetError);
    try {
      await registry.pin(pin2);
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.IDENTITY_CONFLICT);
      expect((error as DatasetError).details).toMatchObject({
        pinned: m1.digest,
        attempted: m2.digest,
      });
    }
  });

  it('a NEW version = a NEW manifest pin (no in-place mutation)', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const m1 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], { version: '1.0.0' }),
    );
    const m2 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(b) }], { version: '1.1.0' }),
    );
    const registry = new DatasetVersionRegistry();
    await registry.pin(
      toDatasetVersion({
        identity: { namespace: TENANT_A, name: 'evolving', version: '1.0.0' },
        manifestDigest: m1.digest,
      }),
    );
    await registry.pin(
      toDatasetVersion({
        identity: { namespace: TENANT_A, name: 'evolving', version: '1.1.0' },
        manifestDigest: m2.digest,
      }),
    );
    const resolved = await registry.resolve({
      namespace: TENANT_A,
      name: 'evolving',
      version: '1.1.0',
    });
    expect(resolved?.manifestDigest).toBe(m2.digest);
  });

  it('resolve returns undefined for unknown identities', async () => {
    const registry = new DatasetVersionRegistry();
    await expect(
      registry.resolve({ namespace: TENANT_A, name: 'nope', version: '1.0.0' }),
    ).resolves.toBeUndefined();
  });

  it('listVersions orders by semver precedence', async () => {
    const a = await makeArtifact(1);
    const registry = new DatasetVersionRegistry();
    const versions = ['1.2.0', '1.10.0', '1.0.0', '0.9.0'];
    for (const version of versions) {
      const manifest = await createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], { version }),
      );
      await registry.pin(
        toDatasetVersion({
          identity: { namespace: TENANT_A, name: 'ordered', version },
          manifestDigest: manifest.digest,
        }),
      );
    }
    const listed = await registry.listVersions(TENANT_A, 'ordered');
    expect(listed.map((pin) => pin.identity.version)).toEqual([
      '0.9.0',
      '1.0.0',
      '1.2.0',
      '1.10.0',
    ]);
  });

  it('list returns every pin deterministically', async () => {
    const a = await makeArtifact(1);
    const registry = new DatasetVersionRegistry();
    for (const [name, version] of [
      ['zeta', '1.0.0'],
      ['alpha', '1.0.0'],
    ] as const) {
      const manifest = await createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], { name, version }),
      );
      await registry.pin(
        toDatasetVersion({
          identity: { namespace: TENANT_A, name, version },
          manifestDigest: manifest.digest,
        }),
      );
    }
    const all = await registry.list();
    expect(all.map((pin) => pin.identity.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('split/subset derivations (lineage-recorded transformations)', () => {
  it('derives a child manifest carrying the parent manifest ref', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const parent = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ], { name: 'full-dataset' }),
    );
    const child = await deriveDatasetManifest({
      parent,
      identity: { namespace: TENANT_A, name: 'full-dataset-split', version: '1.0.0' },
      entries: [{ role: 'split', artifact: refOf(a) }],
      provenance: { creator: { type: 'user', tenant: TENANT_A, principalId: 'user-42' }, createdAt: T1, rights: RIGHTS },
    });
    expect(child.provenance.parents).toHaveLength(1);
    const edge = child.provenance.parents[0];
    expect(edge?.relation).toBe('extracted-from');
    expect(edge?.parent.digest).toBe(parent.digest);
    expect(edge?.parent.namespace).toBe(parent.identity.namespace);
    expect(edge?.parent.name).toBe(parent.identity.name);
    expect(edge?.parent.version).toBe(parent.identity.version);
    await expect(verifyDatasetManifest(child)).resolves.toBe(child.digest);
    expect(datasetManifestRefKey(parent)).toBe(
      `${parent.identity.namespace}/${parent.identity.name}@${parent.identity.version}#${parent.digest}`,
    );
    expect(datasetManifestRef(parent).digest).toBe(parent.digest);
  });

  it('supports the derivation relation vocabulary and rejects unknown relations', async () => {
    const a = await makeArtifact(1);
    const parent = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], { name: 'parent-ds' }),
    );
    for (const relation of ['derived-from', 'extracted-from', 'composed-of']) {
      const child = await deriveDatasetManifest({
        parent,
        identity: { namespace: TENANT_A, name: 'child-ds', version: '1.0.0' },
        entries: [{ role: 'input', artifact: refOf(a) }],
        provenance: { creator: { type: 'user', tenant: TENANT_A, principalId: 'user-42' }, createdAt: T1, rights: RIGHTS },
        relation,
      });
      expect(child.provenance.parents[0]?.relation).toBe(relation);
    }
    await expect(
      deriveDatasetManifest({
        parent,
        identity: { namespace: TENANT_A, name: 'child-ds', version: '1.0.0' },
        entries: [{ role: 'input', artifact: refOf(a) }],
        provenance: { creator: { type: 'user', tenant: TENANT_A, principalId: 'user-42' }, createdAt: T1, rights: RIGHTS },
        relation: 'adapted-from',
      }),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects cross-tenant derivations (R24)', async () => {
    const a = await makeArtifact(1);
    const parent = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], { name: 'parent-ds' }),
    );
    await expect(
      deriveDatasetManifest({
        parent,
        identity: { namespace: TENANT_B, name: 'stolen-split', version: '1.0.0' },
        entries: [{ role: 'split', artifact: refOf(a) }],
        provenance: { creator: { type: 'user', tenant: TENANT_B, principalId: 'user-1' }, createdAt: T1, rights: RIGHTS },
      }),
    ).rejects.toThrow(DatasetError);
    try {
      await deriveDatasetManifest({
        parent,
        identity: { namespace: TENANT_B, name: 'stolen-split', version: '1.0.0' },
        entries: [{ role: 'split', artifact: refOf(a) }],
        provenance: { creator: { type: 'user', tenant: TENANT_B, principalId: 'user-1' }, createdAt: T1, rights: RIGHTS },
      });
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.INVALID_IDENTITY);
    }
  });

  it('a chain of derivations records the full lineage path', async () => {
    const a = await makeArtifact(1);
    const root = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], { name: 'root-ds', version: '1.0.0' }),
    );
    const mid = await deriveDatasetManifest({
      parent: root,
      identity: { namespace: TENANT_A, name: 'root-ds', version: '2.0.0' },
      entries: [{ role: 'input', artifact: refOf(a) }],
      provenance: { creator: { type: 'user', tenant: TENANT_A, principalId: 'user-42' }, createdAt: T1, rights: RIGHTS },
      relation: 'derived-from',
    });
    const leaf = await deriveDatasetManifest({
      parent: mid,
      identity: { namespace: TENANT_A, name: 'root-ds', version: '2.1.0' },
      entries: [{ role: 'split', artifact: refOf(a) }],
      provenance: { creator: { type: 'user', tenant: TENANT_A, principalId: 'user-42' }, createdAt: T1, rights: RIGHTS },
    });
    // The leaf's DIRECT parent is mid; the root is reachable through the
    // manifest chain (each child carries its parent's content-addressed ref).
    expect(leaf.provenance.parents[0]?.parent.digest).toBe(mid.digest);
    expect(mid.provenance.parents[0]?.parent.digest).toBe(root.digest);
    expect(leaf.digest).not.toBe(mid.digest);
    expect(mid.digest).not.toBe(root.digest);
  });
});
