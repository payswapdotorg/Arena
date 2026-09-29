/**
 * Property tests (Work Order A014) — seeded-LCG randomized invariants
 * (the house property-test pattern; no Math.random anywhere):
 *
 *   - manifest construction is deterministic and verifiable;
 *   - any single-field mutation of a manifest is detected (tamper);
 *   - entries checksums are order-independent;
 *   - bundle resolution is deterministic and fail-closed on missing entries;
 *   - registry pins are conflict-free only for distinct (identity, digest)
 *     pairs — re-pinning the same identity to a different digest ALWAYS fails.
 */

import { describe, expect, it } from 'vitest';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import { DATASET_ENTRY_ROLES, compareDatasetEntries, datasetEntryKey } from './entry.js';
import { createDatasetManifest, verifyDatasetManifest } from './manifest.js';
import type { DatasetManifest } from './manifest.js';
import { resolveDatasetBundle } from './bundle.js';
import { DatasetVersionRegistry, toDatasetVersion } from './versioning.js';
import { TestLcg, makeArtifact, makeManifestInput, refOf, TENANT_A } from './test-support.js';

const ROUNDS = 40;

async function randomManifest(lcg: TestLcg): Promise<{
  manifest: DatasetManifest;
  artifacts: MaterialArtifact<unknown>[];
  roles: string[];
}> {
  const count = 1 + lcg.nextInt(4);
  const artifacts: MaterialArtifact<unknown>[] = [];
  const entries: { role: string; artifact: { namespace: string; name: string; version: string; digest: string } }[] = [];
  for (let i = 0; i < count; i += 1) {
    const artifact = await makeArtifact(lcg.nextInt(10000), {
      namespace: lcg.nextInt(4) === 0 ? 'public' : TENANT_A,
    });
    artifacts.push(artifact);
    entries.push({ role: lcg.pick([...DATASET_ENTRY_ROLES]), artifact: refOf(artifact) });
  }
  const manifest = await createDatasetManifest(
    makeManifestInput(entries, { name: `property-ds-${lcg.nextInt(1000)}` }),
  );
  return { manifest, artifacts, roles: entries.map((e) => e.role) };
}

describe('property: manifests (seeded LCG)', () => {
  it('construction is deterministic: same input twice ⇒ same digest', async () => {
    const lcg = new TestLcg(0x5eed0001);
    for (let round = 0; round < ROUNDS; round += 1) {
      const { manifest, artifacts } = await randomManifest(lcg);
      const entries = manifest.entries.map((entry) => ({
        role: entry.role as string,
        artifact: {
          namespace: entry.artifact.namespace,
          name: entry.artifact.name,
          version: entry.artifact.version,
          digest: entry.artifact.digest,
        },
      }));
      const again = await createDatasetManifest(
        makeManifestInput(entries, { name: manifest.identity.name }),
      );
      expect(again.digest).toBe(manifest.digest);
      expect(artifacts.length).toBeGreaterThan(0);
    }
  });

  it('freshly created manifests always verify (digest chain holds)', async () => {
    const lcg = new TestLcg(0x5eed0002);
    for (let round = 0; round < ROUNDS; round += 1) {
      const { manifest } = await randomManifest(lcg);
      await expect(verifyDatasetManifest(manifest)).resolves.toBe(manifest.digest);
    }
  });

  it('any mutated entry digest is detected as tampering', async () => {
    const lcg = new TestLcg(0x5eed0003);
    for (let round = 0; round < 15; round += 1) {
      const { manifest } = await randomManifest(lcg);
      const clone = structuredClone(
        JSON.parse(JSON.stringify(manifest)),
      ) as unknown as DatasetManifest;
      const entries = clone.entries as unknown as {
        artifact: { digest: string };
      }[];
      const target = entries[round % entries.length];
      if (target === undefined) continue;
      target.artifact.digest = `${(round + 1).toString(16).padStart(64, '0').slice(-64)}`;
      let failed = false;
      try {
        await verifyDatasetManifest(clone);
      } catch (error) {
        failed = (error as DatasetError).code === DATASET_ERROR_CODES.TAMPERED;
      }
      expect(failed).toBe(true);
    }
  });

  it('entries checksums are order-independent over random entry sets', async () => {
    const lcg = new TestLcg(0x5eed0004);
    for (let round = 0; round < 15; round += 1) {
      const { manifest } = await randomManifest(lcg);
      const reversed = [...manifest.entries].reverse();
      const entries = reversed.map((entry) => ({
        role: entry.role as string,
        artifact: {
          namespace: entry.artifact.namespace,
          name: entry.artifact.name,
          version: entry.artifact.version,
          digest: entry.artifact.digest,
        },
      }));
      const shuffledManifest = await createDatasetManifest(
        makeManifestInput(entries, { name: manifest.identity.name }),
      );
      expect(shuffledManifest.entriesChecksum).toBe(manifest.entriesChecksum);
    }
  });

  it('canonical entry ordering is total and consistent', async () => {
    const lcg = new TestLcg(0x5eed0005);
    for (let round = 0; round < 15; round += 1) {
      const { manifest } = await randomManifest(lcg);
      const entries = [...manifest.entries];
      const shuffled = [...entries]
        .sort((a, b) => (datasetEntryKey(b) < datasetEntryKey(a) ? 1 : -1))
        .reverse();
      const sorted = [...shuffled].sort(compareDatasetEntries);
      const keySorted = sorted.map((entry) => datasetEntryKey(entry));
      const expected = [...keySorted].sort();
      expect(keySorted).toEqual(expected);
    }
  });
});

describe('property: bundles (seeded LCG)', () => {
  it('resolution is deterministic and reproducible', async () => {
    const lcg = new TestLcg(0x5eed0006);
    for (let round = 0; round < 15; round += 1) {
      const { manifest, artifacts } = await randomManifest(lcg);
      const map = new Map<string, MaterialArtifact<unknown>>(
        artifacts.map((artifact) => [artifact.digest, artifact]),
      );
      const resolver = async (ref: { digest: string }) => map.get(ref.digest) ?? null;
      const first = await resolveDatasetBundle(manifest, resolver);
      const second = await resolveDatasetBundle(manifest, resolver);
      expect(first.bundleDigest).toBe(second.bundleDigest);
      expect(first.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('removing any single artifact from the resolver fails closed', async () => {
    const lcg = new TestLcg(0x5eed0007);
    for (let round = 0; round < 15; round += 1) {
      const { manifest, artifacts } = await randomManifest(lcg);
      if (artifacts.length < 2) continue;
      const dropIndex = lcg.nextInt(artifacts.length);
      const kept = artifacts.filter((_, index) => index !== dropIndex);
      const map = new Map<string, MaterialArtifact<unknown>>(
        kept.map((artifact) => [artifact.digest, artifact]),
      );
      const resolver = async (ref: { digest: string }) => map.get(ref.digest) ?? null;
      let failed = false;
      try {
        await resolveDatasetBundle(manifest, resolver);
      } catch (error) {
        failed = (error as DatasetError).code === DATASET_ERROR_CODES.UNRESOLVED_ENTRY;
      }
      expect(failed).toBe(true);
    }
  });
});

describe('property: version pins (seeded LCG)', () => {
  it('conflicting re-pins ALWAYS fail; identical re-pins ALWAYS succeed', async () => {
    const lcg = new TestLcg(0x5eed0008);
    const registry = new DatasetVersionRegistry();
    const usedIdentities = new Set<string>();
    for (let round = 0; round < 20; round += 1) {
      const name = `pin-ds-${lcg.nextInt(100000)}`;
      const version = `1.${lcg.nextInt(50)}.0`;
      const identityKey = `${TENANT_A}/${name}@${version}`;
      const { manifest, artifacts } = await randomManifest(lcg);
      const artifact = artifacts[0];
      if (artifact === undefined) continue;
      const otherManifest = await createDatasetManifest(
        makeManifestInput([{ role: 'input', artifact: refOf(artifact) }], {
          name: `other-${name}`,
        }),
      );
      const identity = { namespace: TENANT_A, name, version };
      const pin = toDatasetVersion({ identity, manifestDigest: manifest.digest });

      if (usedIdentities.has(identityKey)) {
        // This identity was pinned earlier in the loop — but to a
        // different manifest digest with overwhelming probability, so a
        // conflicting re-pin must fail. (Identical digest ⇒ the loop's
        // randomManifest would need a collision; 64-bit-ish space makes
        // that impossible in 20 rounds.)
        let conflict = false;
        try {
          await registry.pin(pin);
        } catch (error) {
          conflict = (error as DatasetError).code === DATASET_ERROR_CODES.IDENTITY_CONFLICT;
        }
        expect(conflict).toBe(true);
      } else {
        await registry.pin(pin);
        usedIdentities.add(identityKey);
        // Identical re-pin is idempotent.
        await expect(registry.pin(pin)).resolves.toBeTruthy();
        // Different digest, same identity: conflict.
        const conflicting = toDatasetVersion({
          identity,
          manifestDigest: otherManifest.digest,
        });
        await expect(registry.pin(conflicting)).rejects.toThrow(DatasetError);
      }
    }
  });
});
