import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import * as artifactModule from './artifact.js';
import {
  type ArtifactRef,
  type MaterialArtifact,
  artifactContentView,
  artifactRefKey,
  computeArtifactDigest,
  createMaterialArtifact,
  isArtifactRef,
  isMaterialArtifact,
  isSameArtifactRef,
  toArtifactRef,
  verifyArtifact,
  verifyArtifactTree,
} from './artifact.js';
import { ARTIFACT_ERROR_CODES, ArtifactError, isArtifactError } from './errors.js';
import { toContentDigest } from './content-digest.js';

const IDENTITY = { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' };

async function sampleArtifact(
  content: unknown,
  refs: readonly { namespace: string; name: string; version: string; digest: string }[] = [],
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({ identity: IDENTITY, content, refs });
}

describe('MaterialArtifact (positive — content addressing)', () => {
  it('computes the digest over the canonical JSON of the digest-free view', async () => {
    const artifact = await sampleArtifact({ rows: 3, tags: ['a', 'b'] }, []);
    const view = artifactContentView(artifact);
    const expected = await digestCanonical({
      identity: view.identity,
      refs: [...view.refs],
      content: view.content,
    });
    expect(artifact.digest).toBe(expected);
    expect(artifact.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same view → same digest', async () => {
    const a = await sampleArtifact({ rows: 3 }, []);
    const b = await sampleArtifact({ rows: 3 }, []);
    expect(a.digest).toBe(b.digest);
  });

  it('verifies its own digest', async () => {
    const artifact = await sampleArtifact({ rows: 3 }, []);
    await expect(verifyArtifact(artifact)).resolves.toBe(artifact.digest);
  });

  it('carries embedded refs and verifies them through a resolver', async () => {
    const parent = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'source-corpus', version: '2.0.0' },
      content: { rows: 100 },
    });
    const child = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'reference-dataset', version: '1.4.2' },
      refs: [
        {
          namespace: parent.identity.namespace,
          name: parent.identity.name,
          version: parent.identity.version,
          digest: parent.digest,
        },
      ],
      content: { rows: 3 },
    });
    expect(child.refs).toHaveLength(1);
    const resolver = (ref: ArtifactRef): MaterialArtifact<unknown> | null =>
      isSameArtifactRef(ref, child.refs[0] as ArtifactRef) ? parent : null;
    await expect(verifyArtifactTree(child, resolver)).resolves.toBeUndefined();
  });
});

describe('MaterialArtifact (immutability)', () => {
  it('deep-freezes the artifact: in-place mutation throws', async () => {
    const artifact = await sampleArtifact({ rows: 3, nested: { deep: true } }, []);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.identity)).toBe(true);
    expect(Object.isFrozen(artifact.content)).toBe(true);
    expect(Object.isFrozen((artifact.content as { nested: object }).nested)).toBe(true);
    expect(() => {
      (artifact as { digest: string }).digest = '0'.repeat(64);
    }).toThrow(TypeError);
    expect(() => {
      (artifact.content as { rows: number }).rows = 999;
    }).toThrow(TypeError);
  });

  it('exposes NO mutation API on its module surface', async () => {
    const forbidden = /^(set|update|mutate|rename|edit|replace|revoke|delete|remove|with)[A-Z_]/;
    const exported = Object.keys(artifactModule).filter((name) => forbidden.test(name));
    expect(exported, `mutation-like exports must not exist: ${exported.join(', ')}`).toEqual([]);
  });

  it('same identity + different content ⇒ different digest (identity binds content)', async () => {
    const a1 = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 3 } });
    const a2 = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 4 } });
    expect(a1.identity).toEqual(a2.identity);
    expect(a1.digest).not.toBe(a2.digest);
  });

  it('a forged artifact (same identity, stale digest) is rejected by the guard', async () => {
    const a1 = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 3 } });
    const a2 = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 4 } });
    // "Edited" artifact claiming the original digest: same identity, different content.
    const forged: MaterialArtifact<unknown> = {
      identity: a2.identity,
      refs: a2.refs,
      content: a2.content,
      digest: a1.digest,
    };
    expect(isMaterialArtifact(forged)).toBe(true); // shape is fine…
    await expect(verifyArtifact(forged)).rejects.toSatisfy((error: unknown) => {
      expect(isArtifactError(error)).toBe(true);
      expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.TAMPERED);
      return true;
    });
    // …but the explicit expected-digest check fails closed too.
    await expect(verifyArtifact(a2, a1.digest)).rejects.toThrow(ArtifactError);
  });
});

describe('MaterialArtifact (negative — tamper detection fails closed)', () => {
  it('rejects a structurally invalid artifact', async () => {
    await expect(verifyArtifact({ nope: true } as unknown as MaterialArtifact)).rejects.toThrow(
      ArtifactError,
    );
    expect(isMaterialArtifact({ identity: IDENTITY, content: {}, digest: 'a'.repeat(64) })).toBe(
      false,
    );
  });

  it('detects content tampering via digest mismatch', async () => {
    const artifact = await sampleArtifact({ rows: 3 }, []);
    const tampered = await (async () => {
      // Rebuild with different content but keep the original digest claim.
      const other = await createMaterialArtifact({ identity: IDENTITY, content: { rows: 999 } });
      return { ...other, digest: artifact.digest } as MaterialArtifact<unknown>;
    })();
    await expect(verifyArtifact(tampered)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.TAMPERED,
    });
  });

  it('detects identity tampering (mutated identity, same content)', async () => {
    const artifact = await sampleArtifact({ rows: 3 }, []);
    const other = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'reference-dataset', version: '1.4.3' },
      content: { rows: 3 },
    });
    const tampered: MaterialArtifact<unknown> = { ...other, digest: artifact.digest };
    await expect(verifyArtifact(tampered)).rejects.toThrow(/digest mismatch/);
  });

  it('fails closed on unresolvable nested refs', async () => {
    const child = await createMaterialArtifact({
      identity: IDENTITY,
      refs: [{ namespace: 'acme', name: 'missing-parent', version: '1.0.0', digest: 'c'.repeat(64) }],
      content: {},
    });
    await expect(verifyArtifactTree(child, () => null)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.UNRESOLVED_REF,
    });
  });

  it('fails closed when a nested ref resolves to a digest-mismatched artifact', async () => {
    const parentV1 = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'source-corpus', version: '2.0.0' },
      content: { rows: 100 },
    });
    const parentV2 = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'source-corpus', version: '2.0.0' },
      content: { rows: 200 }, // same identity, tampered content → different digest
    });
    const child = await createMaterialArtifact({
      identity: IDENTITY,
      refs: [
        {
          namespace: 'acme',
          name: 'source-corpus',
          version: '2.0.0',
          digest: parentV1.digest,
        },
      ],
      content: {},
    });
    // Resolver returns the tampered parent (digest mismatch vs the ref).
    await expect(verifyArtifactTree(child, () => parentV2)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.TAMPERED,
    });
  });

  it('fails closed when a nested ref resolves under a different identity', async () => {
    const decoy = await createMaterialArtifact({
      identity: { namespace: 'other-tenant', name: 'source-corpus', version: '2.0.0' },
      content: { rows: 100 },
    });
    const child = await createMaterialArtifact({
      identity: IDENTITY,
      refs: [
        {
          namespace: 'acme',
          name: 'source-corpus',
          version: '2.0.0',
          digest: decoy.digest,
        },
      ],
      content: {},
    });
    await expect(verifyArtifactTree(child, () => decoy)).rejects.toThrow(
      /identity does not match the reference/,
    );
  });

  it('verifies diamond-shaped reference graphs (visited set dedupes shared ancestors)', async () => {
    // Shared grandparent, referenced by two parents and the child.
    const grandparent = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'grandparent', version: '1.0.0' },
      content: { rows: 1 },
    });
    const gpRef = {
      namespace: 'acme',
      name: 'grandparent',
      version: '1.0.0',
      digest: grandparent.digest,
    };
    const parent1 = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'parent-1', version: '1.0.0' },
      refs: [gpRef],
      content: { rows: 2 },
    });
    const parent2 = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'parent-2', version: '1.0.0' },
      refs: [gpRef],
      content: { rows: 3 },
    });
    const child = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'child', version: '1.0.0' },
      refs: [
        {
          namespace: 'acme',
          name: 'parent-1',
          version: '1.0.0',
          digest: parent1.digest,
        },
        {
          namespace: 'acme',
          name: 'parent-2',
          version: '1.0.0',
          digest: parent2.digest,
        },
        gpRef,
      ],
      content: { rows: 4 },
    });
    const byRef = new Map<string, MaterialArtifact<unknown>>([
      [artifactRefKey(gpRef), grandparent],
      [
        artifactRefKey({
          namespace: 'acme',
          name: 'parent-1',
          version: '1.0.0',
          digest: parent1.digest,
        }),
        parent1,
      ],
      [
        artifactRefKey({
          namespace: 'acme',
          name: 'parent-2',
          version: '1.0.0',
          digest: parent2.digest,
        }),
        parent2,
      ],
    ]);
    await expect(
      verifyArtifactTree(child, (ref) => byRef.get(artifactRefKey(ref)) ?? null),
    ).resolves.toBeUndefined();
  });

  it('cycle guard: a fully-verifying reference cycle is cryptographically impossible', async () => {
    // Every embedded ref commits to the child's CONTENT DIGEST, so a cycle of
    // self-verifying artifacts would require a sha256 fixed point. The
    // visited-set cycle guard in verifyArtifactTree is therefore pure
    // defense-in-depth (it fires only if an earlier integrity check is ever
    // relaxed). What CAN be constructed — a forged resolver returning an
    // object whose claimed digest matches the ref but whose CONTENT does not
    // verify — is rejected by the self-verification step:
    const parentV1 = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'parent', version: '1.0.0' },
      content: { rows: 1 },
    });
    const forgedChildOfParent = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'parent', version: '1.0.0' },
      content: { rows: 999 }, // same identity as parentV1, different content
    });
    const child = await createMaterialArtifact({
      identity: { namespace: 'acme', name: 'child', version: '1.0.0' },
      refs: [
        { namespace: 'acme', name: 'parent', version: '1.0.0', digest: parentV1.digest },
      ],
      content: {},
    });
    // Resolver hands back the "same identity, different content" object whose
    // digest field does not match the reference: rejected, never traversed.
    await expect(verifyArtifactTree(child, () => forgedChildOfParent)).rejects.toMatchObject({
      code: ARTIFACT_ERROR_CODES.TAMPERED,
    });
  });
});

describe('ArtifactRef', () => {
  it('validates and freezes refs', () => {
    const ref = toArtifactRef({
      namespace: 'acme',
      name: 'dataset',
      version: '1.0.0',
      digest: 'a'.repeat(64),
    });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isArtifactRef(ref)).toBe(true);
    expect(artifactRefKey(ref)).toBe(`acme/dataset@1.0.0#${'a'.repeat(64)}`);
  });

  it('rejects malformed refs (negative)', () => {
    for (const bad of [
      { namespace: 'acme', name: 'dataset', version: '1.0', digest: 'a'.repeat(64) },
      { namespace: 'ACME', name: 'dataset', version: '1.0.0', digest: 'a'.repeat(64) },
      { namespace: 'acme', name: 'dataset', version: '1.0.0', digest: 'nothex' },
      { namespace: 'acme', name: 'dataset', version: '1.0.0' },
    ]) {
      expect(() => toArtifactRef(bad as Parameters<typeof toArtifactRef>[0])).toThrow(
        ArtifactError,
      );
      expect(isArtifactRef(bad)).toBe(false);
    }
  });

  it('computeArtifactDigest equals the artifact digest for the same view', async () => {
    const artifact = await sampleArtifact({ x: 1 }, []);
    const digest = await computeArtifactDigest(artifactContentView(artifact));
    expect(digest).toBe(artifact.digest);
    expect(() => toContentDigest('upper'.repeat(12))).toThrow(ArtifactError);
  });
});
