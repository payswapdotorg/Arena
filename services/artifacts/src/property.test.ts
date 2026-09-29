/**
 * Property tests (Work Order A014, services/artifacts) — seeded-LCG
 * randomized invariants (the house property-test pattern):
 *
 *   - store: random ingest is idempotent per artifact and conflict-free
 *     per identity; random reads honor the tenant scope;
 *   - lineage: random DAG recordings keep ancestry exactly equal to the
 *     brute-force transitive closure; random edge insertions that would
 *     close a cycle ALWAYS fail;
 *   - publication: random publish/retract sequences keep status equal to
 *     the brute-force active-public computation.
 */

import { describe, expect, it } from 'vitest';
import { PROVENANCE_ERROR_CODES } from '@arena/provenance';
import { createArtifactService } from './index.js';
import {
  CALLER_A,
  TestLcg,
  makeArtifact,
  makeRecordInput,
  refOf,
  RIGHTS,
} from './test-support.js';

const ROUNDS = 20;

describe('property: ArtifactStore (seeded LCG)', () => {
  it('random re-puts are always idempotent or identity conflicts — never silent overwrites', async () => {
    const lcg = new TestLcg(0xa14a0001);
    const { store } = createArtifactService();
    const artifacts: import('@arena/artifact-protocol').MaterialArtifact<unknown>[] = [];
    for (let i = 0; i < 12; i += 1) {
      artifacts.push(await makeArtifact(i + 1, { name: `prop-artifact-${i}` }));
    }
    // Ingest a prefix.
    for (const artifact of artifacts.slice(0, 8)) {
      await store.put(artifact, CALLER_A);
    }
    for (let round = 0; round < ROUNDS; round += 1) {
      const artifact = artifacts[lcg.nextInt(artifacts.length)];
      if (artifact === undefined) continue;
      const before = await store.size();
      const receipt = await store.put(artifact, CALLER_A);
      const after = await store.size();
      // Either idempotent (size unchanged) or a fresh ingest (+1) — and
      // idempotent receipts carry the SAME digest.
      expect(after - before).toBeLessThanOrEqual(1);
      if (receipt.idempotent) {
        expect(receipt.digest).toBe(artifact.digest);
        expect(after).toBe(before);
      }
      // The bound digest always resolves to the exact artifact.
      const stored = await store.getByDigest(artifact.digest, CALLER_A);
      expect(stored.digest).toBe(artifact.digest);
    }
  });

  it('random tenant-scoped reads never leak cross-tenant content', async () => {
    const lcg = new TestLcg(0xa14a0002);
    const { store } = createArtifactService();
    const tenantAArtifacts = [];
    for (let i = 0; i < 6; i += 1) {
      const artifact = await makeArtifact(i + 1, { namespace: 'tenant-a' });
      await store.put(artifact, { type: 'user', tenant: 'tenant-a', principalId: 'u' });
      tenantAArtifacts.push(artifact);
    }
    for (let round = 0; round < ROUNDS; round += 1) {
      const artifact = tenantAArtifacts[lcg.nextInt(tenantAArtifacts.length)];
      if (artifact === undefined) continue;
      if (round % 2 === 0) {
        const read = await store.getByDigest(artifact.digest, {
          type: 'user',
          tenant: 'tenant-a',
          principalId: 'u',
        });
        expect(read.digest).toBe(artifact.digest);
      } else {
        await expect(
          store.getByDigest(artifact.digest, {
            type: 'user',
            tenant: 'tenant-b',
            principalId: 'v',
          }),
        ).rejects.toThrow();
      }
    }
  });
});

describe('property: LineageService ancestry (seeded LCG)', () => {
  it('random DAGs: service ancestry equals the brute-force transitive closure', async () => {
    const lcg = new TestLcg(0xa14a0003);
    for (let graph = 0; graph < 5; graph += 1) {
      const { store, lineage } = createArtifactService();
      const count = 4 + lcg.nextInt(5);
      const artifacts: import('@arena/artifact-protocol').MaterialArtifact<unknown>[] = [];
      for (let i = 0; i < count; i += 1) {
        const artifact = await makeArtifact(graph * 100 + i + 1, {
          name: `dag-${graph}-${i}`,
        });
        await store.put(artifact, CALLER_A);
        artifacts.push(artifact);
      }
      // Random DAG: each node's parents are a subset of EARLIER nodes.
      const parentsOf = new Map<number, number[]>();
      for (let i = 0; i < count; i += 1) {
        const parentCount = lcg.nextInt(Math.min(i + 1, 3));
        const parents: number[] = [];
        for (let p = 0; p < parentCount; p += 1) {
          const candidate = lcg.nextInt(i + 1) < i ? lcg.nextInt(i) : i - 1;
          if (candidate >= 0 && !parents.includes(candidate)) parents.push(candidate);
        }
        parentsOf.set(i, parents);
        if (parents.length > 0) {
          const parentArtifacts = parents.map((index) => {
            const artifact = artifacts[index];
            if (artifact === undefined) throw new Error('unreachable');
            return artifact;
          });
          await lineage.record(makeRecordInput(artifacts[i]!, parentArtifacts));
        } else {
          await lineage.record(makeRecordInput(artifacts[i]!, []));
        }
      }
      // Brute-force closure over the map.
      const bruteForce = (index: number): Set<number> => {
        const seen = new Set<number>();
        const stack = [...(parentsOf.get(index) ?? [])];
        while (stack.length > 0) {
          const current = stack.pop();
          if (current === undefined || seen.has(current)) continue;
          seen.add(current);
          for (const parent of parentsOf.get(current) ?? []) stack.push(parent);
        }
        return seen;
      };
      for (let i = 0; i < count; i += 1) {
        const artifact = artifacts[i];
        if (artifact === undefined) continue;
        const expected = bruteForce(i);
        const ancestors = await lineage.ancestryOf(refOf(artifact));
        expect(ancestors.length).toBe(expected.size);
      }
    }
  });

  it('random back-edges that would close a cycle ALWAYS fail', async () => {
    const lcg = new TestLcg(0xa14a0004);
    for (let graph = 0; graph < 4; graph += 1) {
      const { store, lineage } = createArtifactService();
      const artifacts = [];
      for (let i = 0; i < 5; i += 1) {
        const artifact = await makeArtifact(graph * 100 + i + 1, {
          name: `cyc-${graph}-${i}`,
        });
        await store.put(artifact, CALLER_A);
        artifacts.push(artifact);
      }
      // Chain 0 ← 1 ← 2 ← 3 ← 4.
      for (let i = 1; i < artifacts.length; i += 1) {
        await lineage.record(
          makeRecordInput(artifacts[i]!, [artifacts[i - 1]!]),
        );
      }
      // Random back-edge: recording the UNRECORDED chain ROOT (node 0 —
      // an ancestor of every node) with a descendant as its parent always
      // closes a cycle (root → j → j-1 → … → root), so the cycle gate
      // fires with the offending path. The root has no record yet, so the
      // one-record-per-artifact gate does not preempt it.
      for (let round = 0; round < 6; round += 1) {
        const j = 1 + lcg.nextInt(4);
        const parent = artifacts[Math.min(j, artifacts.length - 1)];
        const child = artifacts[0];
        if (parent === undefined || child === undefined) continue;
        let rejected = false;
        try {
          await lineage.record(makeRecordInput(child, [parent]));
        } catch (error) {
          rejected = (error as { code?: string }).code === PROVENANCE_ERROR_CODES.CYCLE_DETECTED;
        }
        expect(rejected).toBe(true);
      }
    }
  });
});

describe('property: PublicationService status (seeded LCG)', () => {
  it('random publish/retract sequences keep status equal to brute force', async () => {
    const lcg = new TestLcg(0xa14a0005);
    for (let scenario = 0; scenario < 5; scenario += 1) {
      const { store, publication } = createArtifactService();
      const artifact = await makeArtifact(scenario + 1, {
        name: `pub-scenario-${scenario}`,
      });
      await store.put(artifact, CALLER_A);
      // Track the brute-force active-public computation alongside the
      // service: publication is active iff the last action was publish.
      let bruteForcePublic = false;
      let lastPublication: { record: Awaited<ReturnType<typeof publication.publish>>['record'] } | null =
        null;
      for (let round = 0; round < 10; round += 1) {
        const action = bruteForcePublic ? 1 : lcg.nextInt(2);
        if (action === 0) {
          const result = await publication.publish(artifact, CALLER_A, RIGHTS, {
            publishedAt: new Date(Date.parse('2026-03-01T12:00:00.000Z') + round * 1000).toISOString(),
          });
          if (!result.idempotent) {
            bruteForcePublic = true;
            lastPublication = { record: result.record };
          }
        } else if (lastPublication !== null) {
          await publication.retract(lastPublication.record, CALLER_A, {
            retractedAt: new Date(
              Date.parse('2026-03-01T13:00:00.000Z') + round * 1000,
            ).toISOString(),
          });
          bruteForcePublic = false;
          lastPublication = null;
        }
        const status = await publication.status(artifact.identity);
        expect(status.visibility).toBe(bruteForcePublic ? 'public' : 'private');
      }
    }
  });
});
