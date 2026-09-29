/**
 * Property tests (Work Order A021): seeded-LCG corpora exercising the
 * end-to-end package pipeline (manifest → policy → forge → record)
 * for determinism, content-addressing injectivity, guard totality and
 * append-only supersession — the universal acceptance bar (positive +
 * adversarial properties).
 */

import { describe, expect, it } from 'vitest';
import { isBodyVersion } from '@arena/agent-body';
import {
  BODY_FORGE_ERROR_CODES,
  createBodyManifest,
  createForgePolicy,
  forge,
  forgeBodyVersion,
  isForgeRecord,
  verifyBodyManifest,
} from './index.js';
import type { ManifestOverrides } from './test-support.js';
import { TestLcg, makeManifestInput, makeRecipe, parentRefV1 } from './test-support.js';

const MISSIONS = [
  'Reconcile financial ledgers accurately.',
  'Audit supply-chain invoices end to end.',
  'Triage customer escalations with empathy.',
  'Draft structural load reports.',
];

const RECIPE = makeRecipe();

interface Scenario {
  readonly mission: string;
  readonly skills: number;
  readonly knowledge: number;
  readonly minSkills: number;
  readonly supersede: boolean;
  readonly cite: boolean;
}

describe('property — the full forge pipeline over seeded corpora', () => {
  it('P1 determinism: identical corpora + policies + recipes ⇒ byte-identical proposals and records', async () => {
    const lcg = new TestLcg(0xa021);
    for (let scenario = 0; scenario < 6; scenario += 1) {
      const corpus: Scenario = {
        mission: MISSIONS[lcg.int(MISSIONS.length)] as string,
        skills: lcg.int(4),
        knowledge: lcg.int(3),
        minSkills: lcg.int(2),
        supersede: lcg.bool(),
        cite: lcg.bool(),
      };
      const skillDigests = Array.from(
        { length: Math.max(corpus.skills, 1) },
        (_, index) => new TestLcg(scenario * 31 + index + 1).digest(),
      );
      const overrides: ManifestOverrides = {
        mission: corpus.mission,
        targetVersion: corpus.supersede ? '1.1.0' : '1.0.0',
        skills: Array.from({ length: corpus.skills }, (_, index) => ({
          namespace: 'arena-skills',
          name: `skill-${String(index)}`,
          version: '1.0.0',
          digest: skillDigests[index] as string,
        })),
        knowledge: Array.from({ length: corpus.knowledge }, (_, index) => ({
          namespace: 'arena-knowledge',
          name: `doc-${String(index)}`,
          version: '1.0.0',
          digest: new TestLcg(scenario * 57 + index + 1).digest(),
        })),
        ...(corpus.supersede
          ? {
              lineage: {
                parents: [{ ...parentRefV1(), digest: new TestLcg(scenario * 71 + 1).digest() }],
                supersedes: { ...parentRefV1(), digest: new TestLcg(scenario * 71 + 1).digest() },
              },
            }
          : {}),
        ...(corpus.cite && corpus.skills > 0
          ? {
              provenance: {
                citations: [
                  { kind: 'experiment-record', digest: new TestLcg(scenario * 97 + 1).digest() },
                  {
                    kind: 'skill-draft',
                    digest: new TestLcg(scenario * 13 + 1).digest(),
                    skills: [
                      {
                        namespace: 'arena-skills',
                        name: 'skill-0',
                        version: '1.0.0',
                        digest: skillDigests[0] as string,
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
      };
      const build = async () => {
        const manifest = await createBodyManifest(makeManifestInput(overrides));
        const policy = await createForgePolicy({
          policyId: `policy-p-${String(scenario).padStart(2, '0')}`,
          version: '1.0.0',
          requirements: { minSkills: corpus.minSkills },
        });
        return forge(manifest, policy, RECIPE, { forgeKey: `forge-key-p-${String(scenario)}` });
      };
      const first = await build();
      const second = await build();
      expect(second.bodyVersion.digest).toBe(first.bodyVersion.digest);
      expect(second.record.digest).toBe(first.record.digest);
      expect(isBodyVersion(first.bodyVersion)).toBe(true);
      expect(isForgeRecord(first.record)).toBe(true);
    }
  });

  it('P2 injectivity: different corpus content ⇒ different manifest digests and different version digests', async () => {
    const lcg = new TestLcg(0xb021);
    const seenManifest = new Set<string>();
    const seenVersions = new Set<string>();
    for (let scenario = 0; scenario < 8; scenario += 1) {
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-p-${String(scenario).padStart(2, '0')}`,
          mission: MISSIONS[lcg.int(MISSIONS.length)] as string,
          skills: [
            { namespace: 'arena-skills', name: `skill-${String(scenario)}`, version: '1.0.0', digest: lcg.digest() },
          ],
        }),
      );
      expect(seenManifest.has(manifest.digest as string)).toBe(false);
      seenManifest.add(manifest.digest as string);
      const policy = await createForgePolicy({
        policyId: 'policy-p-inj',
        version: '1.0.0',
      });
      const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
      expect(seenVersions.has(bodyVersion.digest as string)).toBe(false);
      seenVersions.add(bodyVersion.digest as string);
    }
  });

  it('P3 guard totality: every field mutation either fails construction or changes the manifest digest', async () => {
    const base = await createBodyManifest(makeManifestInput());
    const mutations: readonly (() => ManifestOverrides)[] = [
      () => ({ mission: 'A mutated mission.' }),
      () => ({ role: 'a-different-role' }),
      () => ({ targetVersion: '2.0.0' }),
      () => ({ domainScope: ['finance'] }),
      () => ({
        skills: [{ namespace: 'arena-skills', name: 'another-skill', version: '1.0.0', digest: 'a'.repeat(64) }],
      }),
      () => ({ authorityBoundaries: ['a different boundary'] }),
      () => ({
        rights: {
          license: 'Proprietary',
          commercialUse: 'allowed',
          redistribution: 'tenant-only',
          customerData: 'derived',
        },
      }),
    ];
    for (const mutate of mutations) {
      let mutated;
      try {
        mutated = await createBodyManifest(makeManifestInput(mutate()));
      } catch (error) {
        // Rejected at construction: acceptable (guard total).
        expect(error).toBeInstanceOf(Error);
        continue;
      }
      expect(mutated.digest).not.toBe(base.digest);
      expect(await verifyBodyManifest(mutated)).toBe(mutated.digest);
    }
  });

  it('P4 policy gating: a corpus below the policy floor is rejected; at/above it is accepted', async () => {
    const lcg = new TestLcg(0xc021);
    for (let scenario = 0; scenario < 5; scenario += 1) {
      const skillCount = lcg.int(3);
      const minSkills = lcg.int(3);
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-gate-${String(scenario).padStart(2, '0')}`,
          skills: Array.from({ length: skillCount }, (_, index) => ({
            namespace: 'arena-skills',
            name: `skill-${String(index)}`,
            version: '1.0.0',
            digest: new TestLcg(scenario * 17 + index + 1).digest(),
          })),
        }),
      );
      const policy = await createForgePolicy({
        policyId: `policy-gate-${String(scenario).padStart(2, '0')}`,
        version: '1.0.0',
        requirements: { minSkills },
      });
      if (skillCount < minSkills) {
        await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
          code: BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION,
        });
      } else {
        const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
        expect(bodyVersion.skills).toHaveLength(skillCount);
      }
    }
  });

  it('P5 append-only supersession: every superseding corpus carries its parent, and the parent ref survives verbatim', async () => {
    const lcg = new TestLcg(0xd021);
    for (let scenario = 0; scenario < 4; scenario += 1) {
      const parent = {
        ...parentRefV1(),
        digest: lcg.digest(),
      };
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-sup-${String(scenario).padStart(2, '0')}`,
          targetVersion: `${String(scenario + 2)}.0.0`,
          lineage: { parents: [parent], supersedes: parent },
        }),
      );
      expect(manifest.lineage.supersedes?.digest).toBe(parent.digest);
      const policy = await createForgePolicy({ policyId: 'policy-sup', version: '1.0.0' });
      const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
      expect(bodyVersion.lineage.supersedes?.digest).toBe(parent.digest);
      expect(bodyVersion.lineage.parents[0]?.digest).toBe(parent.digest);
      // The parent survives addressable and unchanged (append-only).
      expect(manifest.lineage.parents[0]).toEqual(parent);
    }
  });
});
