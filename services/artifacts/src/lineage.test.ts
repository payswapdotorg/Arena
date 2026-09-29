/**
 * LineageService tests (Work Order A014): append-only edge recording,
 * closed-world parent validation, cycle rejection WITH the offending
 * path, deep lineage queries, provenance re-validation and idempotent /
 * conflicting record handling.
 */

import { describe, expect, it } from 'vitest';
import { ARTIFACT_ERROR_CODES } from '@arena/artifact-protocol';
import { PROVENANCE_ERROR_CODES } from '@arena/provenance';
import { ArtifactStore } from './store.js';
import { ARTIFACTS_ERROR_CODES, ArtifactsError } from './errors.js';
import { createArtifactService } from './index.js';
import {
  CALLER_A,
  T0,
  makeArtifact,
  makeRecordInput,
  refOf,
} from './test-support.js';

type Artifact = import('@arena/artifact-protocol').MaterialArtifact<unknown>;

async function putChainImpl(store: ArtifactStore, count: number): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  for (let i = 0; i < count; i += 1) {
    const artifact = await makeArtifact(i + 1, {
      name: `chain-artifact-${String(i + 1).padStart(2, '0')}`,
    });
    await store.put(artifact, CALLER_A);
    artifacts.push(artifact);
  }
  return artifacts;
}

/** putChain with tuple overloads: destructured elements are never undefined. */
async function putChain(store: ArtifactStore, count: 1): Promise<[Artifact]>;
async function putChain(store: ArtifactStore, count: 2): Promise<[Artifact, Artifact]>;
async function putChain(
  store: ArtifactStore,
  count: 3,
): Promise<[Artifact, Artifact, Artifact]>;
async function putChain(
  store: ArtifactStore,
  count: 4,
): Promise<[Artifact, Artifact, Artifact, Artifact]>;
async function putChain(store: ArtifactStore, count: number): Promise<Artifact[]> {
  return putChainImpl(store, count);
}

describe('LineageService record (positive)', () => {
  it('records provenance with resolvable, digest-verified parents', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    const record = await lineage.record(makeRecordInput(child, [root]));
    expect(record.artifact.digest).toBe(child.digest);
    expect(record.parents).toHaveLength(1);
    expect(record.parents[0]?.parent.digest).toBe(root.digest);
    expect(record.parents[0]?.relation).toBe('derived-from');
    expect(await (await lineage.listRecords()).length).toBe(1);
  });

  it('records evaluation and verification refs through the closed kind vocabulary', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child, evalRecord, verifyRecord] = await putChain(store, 4);
    const record = await lineage.record(
      makeRecordInput(child, [root], {
        verification: [
          { kind: 'evaluation', evidence: refOf(evalRecord) },
          { kind: 'verification', evidence: refOf(verifyRecord) },
        ],
      }),
    );
    expect(record.verification.map((ref) => ref.kind)).toEqual([
      'evaluation',
      'verification',
    ]);
    // The refs are recorded verbatim (open-world evidence refs).
    expect(record.verification[0]?.evidence.digest).toBe(evalRecord.digest);
    expect(record.verification[1]?.evidence.digest).toBe(verifyRecord.digest);
  });

  it('a root artifact (no parents) records fine', async () => {
    const { store, lineage } = createArtifactService();
    const [root] = await putChain(store, 1);
    const record = await lineage.record(makeRecordInput(root, []));
    expect(record.parents).toHaveLength(0);
  });

  it('re-recording a bit-identical record is idempotent', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    const input = makeRecordInput(child, [root]);
    await lineage.record(input);
    await lineage.record(input);
    expect((await lineage.listRecords()).length).toBe(1);
  });
});

describe('LineageService record (negative/adversarial, fail-closed)', () => {
  it('rejects a CONTRADICTORY record for the same artifact', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    await lineage.record(makeRecordInput(child, [root]));
    // Same artifact, different createdAt ⇒ a different record.
    await expect(
      lineage.record(makeRecordInput(child, [root], { createdAt: T0.replace('12:00:00', '12:00:05') })),
    ).rejects.toThrow();
  });

  it('rejects UNRESOLVABLE parent refs (closed-world provenance)', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    // `root` is NOT stored yet for this record — simulate by using a fresh
    // child against a stored artifact recorded as parent of an unstored ref.
    const ghost = await makeArtifact(99, { name: 'ghost-artifact' });
    await expect(
      lineage.record(makeRecordInput(child, [root, ghost])),
    ).rejects.toThrow();
    try {
      await lineage.record(makeRecordInput(child, [root, ghost]));
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_ERROR_CODES.UNRESOLVED_REF);
      expect((error as { message?: string }).message).toContain('closed-world');
    }
  });

  it('rejects cross-tenant parent refs (unresolvable in the artifact scope)', async () => {
    const { store, lineage } = createArtifactService();
    const child = await makeArtifact(1);
    const foreign = await makeArtifact(2, { namespace: 'tenant-b' });
    await store.put(child, CALLER_A);
    await store.put(foreign, { type: 'user', tenant: 'tenant-b', principalId: 'user-7' });
    await expect(lineage.record(makeRecordInput(child, [foreign]))).rejects.toThrow();
  });

  it('rejects a parent ref whose digest does not match the stored artifact', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child, other] = await putChain(store, 3);
    // Lying parent ref: root's identity but other's digest.
    const lyingRef = { ...refOf(root), digest: other.digest };
    await expect(
      lineage.record({
        ...makeRecordInput(child, [root]),
        parents: [{ parent: lyingRef, relation: 'derived-from' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects cycles WITH THE OFFENDING PATH (append-time gate)', async () => {
    const { store, lineage } = createArtifactService();
    const [a, b, c] = await putChain(store, 3);
    // a ← b ← c (c's parent is b, b's parent is a)
    await lineage.record(makeRecordInput(b, [a]));
    await lineage.record(makeRecordInput(c, [b]));
    // Now try to close the loop: a's parent = c.
    await expect(lineage.record(makeRecordInput(a, [c]))).rejects.toThrow();
    try {
      await lineage.record(makeRecordInput(a, [c]));
    } catch (error) {
      expect((error as { code?: string }).code).toBe(PROVENANCE_ERROR_CODES.CYCLE_DETECTED);
      const details = (error as { details?: { path?: string[] } }).details;
      expect(details?.path).toBeDefined();
      // The offending path is the full loop, in edge order.
      expect(details?.path?.[0]).toBe(refOf(a).namespace
        ? `${a.identity.namespace}/${a.identity.name}@${a.identity.version}#${a.digest}`
        : undefined);
      expect(details?.path?.[details.path.length - 1]).toBe(
        `${a.identity.namespace}/${a.identity.name}@${a.identity.version}#${a.digest}`,
      );
      // The path walks the actual edges: a → c → b → a.
      expect(details?.path).toEqual([
        `${a.identity.namespace}/${a.identity.name}@${a.identity.version}#${a.digest}`,
        `${c.identity.namespace}/${c.identity.name}@${c.identity.version}#${c.digest}`,
        `${b.identity.namespace}/${b.identity.name}@${b.identity.version}#${b.digest}`,
        `${a.identity.namespace}/${a.identity.name}@${a.identity.version}#${a.digest}`,
      ]);
    }
  });

  it('structural provenance validation propagates from the A002 constructor', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    // Self-parent is rejected by the provenance constructor.
    await expect(
      lineage.record(makeRecordInput(child, [child])),
    ).rejects.toThrow();
    // Unknown lineage relation is rejected.
    await expect(
      lineage.record({
        ...makeRecordInput(child, [root]),
        parents: [{ parent: refOf(root), relation: 'forked-from' }],
      }),
    ).rejects.toThrow();
    // Missing rights metadata is rejected.
    await expect(
      lineage.record({
        ...makeRecordInput(child, [root]),
        rights: undefined,
      } as unknown as Parameters<typeof lineage.record>[0]),
    ).rejects.toThrow();
  });
});

describe('LineageService deep queries', () => {
  it('ancestryOf walks the full transitive parent set (deterministic order)', async () => {
    const { store, lineage } = createArtifactService();
    // Diamond: d ← b, d ← c, b ← a, c ← a.
    const [a, b, c, d] = await putChain(store, 4);
    await lineage.record(makeRecordInput(b, [a]));
    await lineage.record(makeRecordInput(c, [a]));
    await lineage.record(makeRecordInput(d, [b, c]));
    const ancestors = await lineage.ancestryOf(refOf(d));
    const keys = ancestors.map(
      (ref) => `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`,
    );
    // The shared grandparent `a` appears exactly once (diamond ≠ cycle).
    expect(keys).toEqual(
      [
        `${a.identity.namespace}/${a.identity.name}@${a.identity.version}#${a.digest}`,
        `${b.identity.namespace}/${b.identity.name}@${b.identity.version}#${b.digest}`,
        `${c.identity.namespace}/${c.identity.name}@${c.identity.version}#${c.digest}`,
      ].sort(),
    );
  });

  it('descendantsOf and isAncestorOf answer the reverse direction', async () => {
    const { store, lineage } = createArtifactService();
    const [a, b, c] = await putChain(store, 3);
    await lineage.record(makeRecordInput(b, [a]));
    await lineage.record(makeRecordInput(c, [b]));
    const descendants = await lineage.descendantsOf(refOf(a));
    expect(descendants).toHaveLength(2);
    expect(await lineage.isAncestorOf(refOf(a), refOf(c))).toBe(true);
    expect(await lineage.isAncestorOf(refOf(c), refOf(a))).toBe(false);
    expect(await lineage.isAncestorOf(refOf(a), refOf(a))).toBe(false);
  });

  it('unknown refs have no ancestry (open world)', async () => {
    const { lineage } = createArtifactService();
    const ghost = await makeArtifact(50);
    await expect(lineage.ancestryOf(refOf(ghost))).resolves.toHaveLength(0);
  });

  it('getRecord returns the record and undefined for unknown refs', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    const record = await lineage.record(makeRecordInput(child, [root]));
    const fetched = await lineage.getRecord(refOf(child));
    expect(fetched?.artifact.digest).toBe(record.artifact.digest);
    const ghost = await makeArtifact(51);
    await expect(lineage.getRecord(refOf(ghost))).resolves.toBeUndefined();
  });
});

describe('LineageService provenance re-validation', () => {
  it('validateProvenance re-verifies every parent (happy path)', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    await lineage.record(makeRecordInput(child, [root]));
    const result = await lineage.validateProvenance(refOf(child));
    expect(result.parentsVerified).toBe(1);
    expect(result.ref).toBe(
      `${child.identity.namespace}/${child.identity.name}@${child.identity.version}#${child.digest}`,
    );
  });

  it('validateProvenance fails closed for unrecorded refs', async () => {
    const { lineage } = createArtifactService();
    const ghost = await makeArtifact(52);
    await expect(lineage.validateProvenance(refOf(ghost))).rejects.toThrow(ArtifactsError);
    try {
      await lineage.validateProvenance(refOf(ghost));
    } catch (error) {
      expect((error as ArtifactsError).code).toBe(ARTIFACTS_ERROR_CODES.NOT_FOUND);
    }
  });

  it('validateProvenance fails closed when a parent becomes corrupted', async () => {
    const { store, lineage } = createArtifactService();
    const [root, child] = await putChain(store, 2);
    await lineage.record(makeRecordInput(child, [root]));
    // Corrupt the stored parent — the re-validation must fail closed.
    const internals = store as unknown as {
      byDigest: Map<string, import('@arena/artifact-protocol').MaterialArtifact<unknown>>;
    };
    const corrupted = structuredClone(
      JSON.parse(JSON.stringify(root)),
    ) as unknown as import('@arena/artifact-protocol').MaterialArtifact<unknown>;
    (
      (corrupted as unknown as { content: { payload: string } }).content
    ).payload = 'corrupted parent';
    internals.byDigest.set(root.digest, corrupted);
    await expect(lineage.validateProvenance(refOf(child))).rejects.toThrow();
  });
});

describe('LineageService append-only ledger surface', () => {
  it('listRecords returns insertion order, frozen', async () => {
    const { store, lineage } = createArtifactService();
    const [a, b, c] = await putChain(store, 3);
    await lineage.record(makeRecordInput(b, [a]));
    await lineage.record(makeRecordInput(c, [b]));
    const records = await lineage.listRecords();
    expect(records.map((record) => record.artifact.digest)).toEqual([
      b.digest,
      c.digest,
    ]);
    expect(Object.isFrozen(records)).toBe(true);
  });
});
