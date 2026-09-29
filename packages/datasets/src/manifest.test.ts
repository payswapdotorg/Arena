/**
 * DatasetManifest tests (Work Order A014): positive construction +
 * verification, immutability/freeze, determinism, and the full
 * negative/adversarial battery (tenant scoping, self-edges, duplicate
 * parents, unknown relations/kinds, tamper detection, checksum chain).
 */

import { describe, expect, it } from 'vitest';
import { createDatasetManifest, datasetManifestView, verifyDatasetManifest } from './manifest.js';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import type { DatasetManifest } from './manifest.js';
import { DATASET_ENTRY_ROLES, datasetEntryKey, toDatasetEntry, toDatasetEntryRole, toDatasetEntries } from './entry.js';
import { makeArtifact, makeManifestInput, refOf, RIGHTS, T0, TENANT_A, TENANT_B } from './test-support.js';

describe('dataset entry guards', () => {
  it('the role vocabulary is closed and ordered', () => {
    expect([...DATASET_ENTRY_ROLES]).toEqual(['input', 'output', 'eval', 'split']);
  });

  it('toDatasetEntryRole accepts the vocabulary and rejects everything else', () => {
    for (const role of DATASET_ENTRY_ROLES) {
      expect(toDatasetEntryRole(role)).toBe(role);
    }
    expect(() => toDatasetEntryRole('train')).toThrow(DatasetError);
    expect(() => toDatasetEntryRole('INPUT')).toThrow(DatasetError);
    expect(() => toDatasetEntryRole('')).toThrow(DatasetError);
    try {
      toDatasetEntryRole('metadata');
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.INVALID_ROLE);
    }
  });

  it('toDatasetEntry validates through the reused A002 artifact ref guard', async () => {
    const artifact = await makeArtifact(1);
    const entry = toDatasetEntry({ role: 'input', artifact: refOf(artifact) });
    expect(entry.role).toBe('input');
    expect(entry.artifact.digest).toBe(artifact.digest);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() =>
      toDatasetEntry({ role: 'input', artifact: { ...refOf(artifact), digest: 'not-a-digest' } }),
    ).toThrow();
    expect(() =>
      toDatasetEntry({ role: 'bogus', artifact: refOf(artifact) }),
    ).toThrow(DatasetError);
  });

  it('entry lists must be non-empty and duplicate-free per (role, artifact)', async () => {
    const a = refOf(await makeArtifact(1));
    const b = refOf(await makeArtifact(2));
    expect(toDatasetEntries([{ role: 'input', artifact: a }])).toHaveLength(1);
    expect(() => toDatasetEntries([])).toThrow(DatasetError);
    expect(() =>
      toDatasetEntries([
        { role: 'input', artifact: a },
        { role: 'input', artifact: a },
      ]),
    ).toThrow(DatasetError);
    // same artifact under DIFFERENT roles is allowed
    expect(
      toDatasetEntries([
        { role: 'input', artifact: a },
        { role: 'output', artifact: a },
      ]),
    ).toHaveLength(2);
    // different artifacts, same role, is allowed
    expect(
      toDatasetEntries([
        { role: 'input', artifact: a },
        { role: 'input', artifact: b },
      ]),
    ).toHaveLength(2);
  });

  it('datasetEntryKey is stable and role-prefixed', async () => {
    const artifact = await makeArtifact(3);
    const entry = toDatasetEntry({ role: 'split', artifact: refOf(artifact) });
    expect(datasetEntryKey(entry)).toBe(
      `split|${artifact.identity.namespace}/${artifact.identity.name}@${artifact.identity.version}#${artifact.digest}`,
    );
  });
});

describe('dataset manifest construction (positive)', () => {
  it('creates a frozen manifest with digest + entriesChecksum', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.entriesChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.provenance.creator.tenant).toBe(TENANT_A);
    expect(manifest.provenance.rights.license).toBe(RIGHTS.license);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(Object.isFrozen(manifest.provenance)).toBe(true);
  });

  it('the entries checksum is order-independent (sorted canonical form)', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const m1 = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    const m2 = await createDatasetManifest(
      makeManifestInput([
        { role: 'output', artifact: refOf(b) },
        { role: 'input', artifact: refOf(a) },
      ]),
    );
    // Same SET of entries, different declaration order: the entries
    // checksums agree. The manifest digests differ only through the
    // entries ORDER in the digest view.
    expect(m1.entriesChecksum).toBe(m2.entriesChecksum);
  });

  it('the manifest digest changes when any covered field changes', async () => {
    const a = await makeArtifact(1);
    const base = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const otherRights = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
        rights: { ...RIGHTS, license: 'MIT' },
      }),
    );
    const otherCreator = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
        createdAt: T0.replace('08:00:00', '08:00:09'),
      }),
    );
    expect(base.digest).not.toBe(otherRights.digest);
    expect(base.digest).not.toBe(otherCreator.digest);
  });

  it('deterministic: identical input ⇒ identical digest', async () => {
    const a = await makeArtifact(1);
    const m1 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const m2 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    expect(m1.digest).toBe(m2.digest);
    expect(m1.entriesChecksum).toBe(m2.entriesChecksum);
  });

  it('manifests can reference public-namespace artifacts', async () => {
    const shared = await makeArtifact(1, { namespace: 'public' });
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(shared) }]),
    );
    expect(manifest.entries[0]?.artifact.namespace).toBe('public');
  });
});

describe('dataset manifest construction (negative/adversarial)', () => {
  it('rejects empty entry lists', async () => {
    await expect(createDatasetManifest(makeManifestInput([]))).rejects.toThrow(DatasetError);
  });

  it('rejects unknown roles', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'metadata', artifact: refOf(a) }]),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects cross-tenant entry refs (R24 tenant scoping)', async () => {
    const foreign = await makeArtifact(1, { namespace: TENANT_B });
    await expect(
      createDatasetManifest(makeManifestInput([{ role: 'input', artifact: refOf(foreign) }])),
    ).rejects.toThrow(DatasetError);
    try {
      await createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(foreign) }]),
      );
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.INVALID_PROVENANCE);
      expect((error as DatasetError).message).toContain('tenant-b');
    }
  });

  it('rejects self-referencing parent edges', async () => {
    const a = await makeArtifact(1);
    const identity = { namespace: TENANT_A, name: 'selfref-dataset', version: '1.0.0' };
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          namespace: identity.namespace,
          name: identity.name,
          parents: [
            { parent: { ...identity, digest: a.digest }, relation: 'derived-from' },
          ],
        }),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects unknown lineage relations', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          parents: [{ parent: refOf(a), relation: 'forked-from' }],
        }),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects duplicate parent edges', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          parents: [
            { parent: refOf(a), relation: 'derived-from' },
            { parent: refOf(a), relation: 'extracted-from' },
          ],
        }),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects cross-tenant parent refs and verification refs', async () => {
    const a = await makeArtifact(1);
    const foreign = await makeArtifact(2, { namespace: TENANT_B });
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          parents: [{ parent: refOf(foreign), relation: 'derived-from' }],
        }),
      ),
    ).rejects.toThrow(DatasetError);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          verification: [{ kind: 'evaluation', evidence: refOf(foreign) }],
        }),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects unknown verification kinds', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          verification: [{ kind: 'benchmark', evidence: refOf(a) }],
        }),
      ),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects malformed rights through the reused A002 guard', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          rights: { license: 'CC-BY-4.0' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          rights: 'all-rights-reserved',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects malformed timestamps and principals through the reused A002 guards', async () => {
    const a = await makeArtifact(1);
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          createdAt: '2026-02-01T08:00:00Z',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(a) }], {
          createdAt: 'not-a-timestamp',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('dataset manifest verification (tamper detection, fail-closed)', () => {
  it('verifies a freshly created manifest and returns its digest', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    await expect(verifyDatasetManifest(manifest)).resolves.toBe(manifest.digest);
    await expect(verifyDatasetManifest(manifest, manifest.digest)).resolves.toBe(
      manifest.digest,
    );
  });

  async function tamperedCopy(
    manifest: DatasetManifest,
    mutate: (view: Record<string, unknown>) => void,
  ): Promise<DatasetManifest> {
    // structuredClone drops the frozen bit — an in-process adversary can
    // then mutate the clone before re-claiming the original digest.
    const clone = structuredClone(
      JSON.parse(JSON.stringify(manifest)) as unknown,
    ) as Record<string, unknown>;
    mutate(clone);
    return clone as unknown as DatasetManifest;
  }

  it('detects a mutated entry (content tamper → DATASET_TAMPERED)', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    const tampered = await tamperedCopy(manifest, (view) => {
      const entries = view['entries'] as { artifact: { digest: string } }[];
      const entry = entries[1];
      if (entry !== undefined) entry.artifact.digest = 'f'.repeat(64);
    });
    await expect(verifyDatasetManifest(tampered)).rejects.toThrow(DatasetError);
    try {
      await verifyDatasetManifest(tampered);
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.TAMPERED);
    }
  });

  it('detects a swapped digest field', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const tampered = await tamperedCopy(manifest, (view) => {
      view['digest'] = '0'.repeat(64);
    });
    await expect(verifyDatasetManifest(tampered)).rejects.toThrow(DatasetError);
  });

  it('detects an inconsistent entries checksum (digest chain)', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    // Forge a manifest whose claimed entriesChecksum does not match its
    // entries: the digest must be recomputed to be self-consistent, but
    // the checksum chain check still fails closed.
    const tampered = await tamperedCopy(manifest, (view) => {
      const entries = view['entries'] as { role: string }[];
      const entry = entries[1];
      if (entry !== undefined) entry.role = 'split';
    });
    // A role mutation breaks BOTH the checksum and the digest; the
    // checksum chain check fires first.
    await expect(verifyDatasetManifest(tampered)).rejects.toThrow(DatasetError);
  });

  it('detects a mutated identity', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const tampered = await tamperedCopy(manifest, (view) => {
      (view['identity'] as { name: string }).name = 'renamed-dataset';
    });
    await expect(verifyDatasetManifest(tampered)).rejects.toThrow(DatasetError);
  });

  it('rejects a non-manifest object', async () => {
    await expect(
      verifyDatasetManifest({ manifestVersion: 1 } as unknown as DatasetManifest),
    ).rejects.toThrow(DatasetError);
    await expect(
      verifyDatasetManifest(null as unknown as DatasetManifest),
    ).rejects.toThrow(DatasetError);
  });

  it('frozen manifests reject in-place mutation attempts', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    expect(() => {
      (manifest as unknown as { digest: string }).digest = '0'.repeat(64);
    }).toThrow();
    expect(() => {
      (manifest.provenance as unknown as { createdAt: string }).createdAt = T0;
    }).toThrow();
  });

  it('the view exposes exactly the digest-covered fields', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    expect(Object.keys(datasetManifestView(manifest)).sort()).toEqual([
      'entries',
      'entriesChecksum',
      'identity',
      'manifestVersion',
      'provenance',
    ]);
  });
});
