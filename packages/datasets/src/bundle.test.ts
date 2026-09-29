/**
 * DatasetBundle tests (Work Order A014): resolution + verification
 * (positive), fail-closed behavior on missing/unverifiable entries
 * (negative/adversarial) and deterministic re-bundle (same manifest ⇒
 * same bundle digest).
 */

import { describe, expect, it } from 'vitest';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { ARTIFACT_ERROR_CODES } from '@arena/artifact-protocol';
import {
  computeDatasetBundleDigest,
  datasetBundleView,
  isDatasetBundle,
  resolveDatasetBundle,
  verifyDatasetBundle,
} from './bundle.js';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import { createDatasetManifest } from './manifest.js';
import { makeArtifact, makeManifestInput, refOf } from './test-support.js';

function resolverFrom(
  artifacts: readonly MaterialArtifact<unknown>[],
): (
  ref: { digest: string },
) => Promise<MaterialArtifact<unknown> | null> {
  const byDigest = new Map<string, MaterialArtifact<unknown>>(
    artifacts.map((artifact) => [artifact.digest, artifact]),
  );
  return async (ref) => byDigest.get(ref.digest) ?? null;
}

describe('dataset bundle resolution (positive)', () => {
  it('resolves a manifest into a frozen, verified bundle', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    const bundle = await resolveDatasetBundle(manifest, resolverFrom([a, b]));
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.manifest.digest).toBe(manifest.digest);
    expect(bundle.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(isDatasetBundle(bundle)).toBe(true);
  });

  it('the bundle view is the digest-covered projection', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const bundle = await resolveDatasetBundle(manifest, resolverFrom([a]));
    const view = datasetBundleView(bundle);
    expect(view.manifestDigest).toBe(manifest.digest);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.role).toBe('input');
    expect(await computeDatasetBundleDigest(view)).toBe(bundle.bundleDigest);
  });

  it('accepts public-namespace entries from any resolver', async () => {
    const shared = await makeArtifact(1, { namespace: 'public' });
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(shared) }]),
    );
    const bundle = await resolveDatasetBundle(manifest, resolverFrom([shared]));
    expect(bundle.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('dataset bundle resolution (negative/adversarial, fail-closed)', () => {
  it('fails closed on a MISSING entry (resolver returns null)', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
      ]),
    );
    // Resolver only knows `a` — `b` is missing.
    await expect(
      resolveDatasetBundle(manifest, resolverFrom([a])),
    ).rejects.toThrow(DatasetError);
    try {
      await resolveDatasetBundle(manifest, resolverFrom([a]));
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.UNRESOLVED_ENTRY);
      expect((error as DatasetError).message).toContain('fail-closed');
    }
  });

  it('fails closed on a tampered manifest (digest chain first)', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const tampered = structuredClone(
      JSON.parse(JSON.stringify(manifest)),
    ) as typeof manifest;
    (tampered as unknown as { digest: string }).digest = '0'.repeat(64);
    await expect(
      resolveDatasetBundle(tampered, resolverFrom([a])),
    ).rejects.toThrow(DatasetError);
  });

  it('fails closed when the resolved artifact has a different digest', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2); // same identity shape, different content
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    // Resolver returns `b` for `a`'s digest — a lying resolver.
    const lying = async (): Promise<MaterialArtifact<unknown>> => b;
    await expect(resolveDatasetBundle(manifest, lying)).rejects.toThrow(DatasetError);
    try {
      await resolveDatasetBundle(manifest, lying);
    } catch (error) {
      expect((error as DatasetError).code).toBe(DATASET_ERROR_CODES.TAMPERED);
    }
  });

  it('fails closed when the resolved artifact identity does not match the entry', async () => {
    const a = await makeArtifact(1);
    const other = await makeArtifact(2, { name: 'different-name' });
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const lying = async (): Promise<MaterialArtifact<unknown>> => other;
    await expect(resolveDatasetBundle(manifest, lying)).rejects.toThrow(DatasetError);
  });

  it('fails closed on a tampered stored artifact (A002 ARTIFACT_TAMPERED propagates)', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    // A "stored artifact" whose claimed digest does not match its content.
    const corrupted = structuredClone(
      JSON.parse(JSON.stringify(a)),
    ) as unknown as MaterialArtifact<unknown>;
    (
      (corrupted as unknown as { content: { payload: string } }).content
    ).payload = 'tampered payload';
    const resolver = async (): Promise<MaterialArtifact<unknown>> => corrupted;
    await expect(resolveDatasetBundle(manifest, resolver)).rejects.toThrow();
    try {
      await resolveDatasetBundle(manifest, resolver);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.TAMPERED);
    }
  });

  it('verifyDatasetBundle fails closed on a mutated bundle digest', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const bundle = await resolveDatasetBundle(manifest, resolverFrom([a]));
    const tampered = structuredClone(
      JSON.parse(JSON.stringify(bundle)),
    ) as typeof bundle;
    (tampered as unknown as { bundleDigest: string }).bundleDigest = '0'.repeat(64);
    await expect(
      verifyDatasetBundle(tampered, resolverFrom([a])),
    ).rejects.toThrow(DatasetError);
  });

  it('verifyDatasetBundle fails closed when an entry becomes unresolvable', async () => {
    const a = await makeArtifact(1);
    const manifest = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const bundle = await resolveDatasetBundle(manifest, resolverFrom([a]));
    const emptyResolver = async (): Promise<MaterialArtifact<unknown> | null> => null;
    await expect(
      verifyDatasetBundle(bundle, emptyResolver),
    ).rejects.toThrow(DatasetError);
  });

  it('rejects non-bundle objects', () => {
    expect(isDatasetBundle({ bundleVersion: 2 })).toBe(false);
    expect(isDatasetBundle(null)).toBe(false);
    expect(isDatasetBundle('bundle')).toBe(false);
  });
});

describe('dataset bundle determinism (same manifest ⇒ same bundle digest)', () => {
  it('two resolutions of the same manifest produce the same bundle digest', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'eval', artifact: refOf(b) },
      ]),
    );
    const first = await resolveDatasetBundle(manifest, resolverFrom([a, b]));
    const second = await resolveDatasetBundle(manifest, resolverFrom([a, b]));
    expect(first.bundleDigest).toBe(second.bundleDigest);
  });

  it('resolver iteration order does not affect the bundle digest', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const c = await makeArtifact(3);
    const manifest = await createDatasetManifest(
      makeManifestInput([
        { role: 'input', artifact: refOf(a) },
        { role: 'output', artifact: refOf(b) },
        { role: 'eval', artifact: refOf(c) },
      ]),
    );
    const forward = resolverFrom([a, b, c]);
    // Reverse-order resolver: resolution order must not leak into the digest.
    const reverse: (
      ref: { digest: string },
    ) => Promise<MaterialArtifact<unknown> | null> = async (ref) => {
      await Promise.resolve();
      const map = new Map<string, MaterialArtifact<unknown>>([
        [c.digest, c],
        [b.digest, b],
        [a.digest, a],
      ]);
      return map.get(ref.digest) ?? null;
    };
    const first = await resolveDatasetBundle(manifest, forward);
    const second = await resolveDatasetBundle(manifest, reverse);
    expect(first.bundleDigest).toBe(second.bundleDigest);
  });

  it('different manifests produce different bundle digests', async () => {
    const a = await makeArtifact(1);
    const b = await makeArtifact(2);
    const m1 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(a) }]),
    );
    const m2 = await createDatasetManifest(
      makeManifestInput([{ role: 'input', artifact: refOf(b) }]),
    );
    const b1 = await resolveDatasetBundle(m1, resolverFrom([a]));
    const b2 = await resolveDatasetBundle(m2, resolverFrom([b]));
    expect(b1.bundleDigest).not.toBe(b2.bundleDigest);
  });
});
