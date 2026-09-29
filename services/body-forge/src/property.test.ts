/**
 * Property tests for the fabric (Work Order A021): seeded-LCG corpora
 * exercising the service pipeline (manifest → submit → registry) for
 * determinism, replay stability, registry growth and conflict
 * behavior — the universal acceptance bar (positive + adversarial
 * properties).
 */

import { describe, expect, it } from 'vitest';
import { isBodyVersion } from '@arena/agent-body';
import { createBodyManifest, createForgePolicy, isForgeRecord } from '@arena/body-forge';
import { ForgeService } from './fabric.js';
import { TestLcg, makeManifestInput, makeRecipe } from './test-support.js';

const MISSIONS = [
  'Reconcile financial ledgers accurately.',
  'Audit supply-chain invoices end to end.',
  'Triage customer escalations with empathy.',
  'Draft structural load reports.',
];

describe('property — the fabric pipeline over seeded corpora', () => {
  it('P1 determinism + replay: identical submissions ⇒ byte-identical stored results; registries never duplicate', async () => {
    const lcg = new TestLcg(0xf021);
    for (let scenario = 0; scenario < 5; scenario += 1) {
      const service = new ForgeService();
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-fp-${String(scenario).padStart(2, '0')}`,
          mission: MISSIONS[lcg.int(MISSIONS.length)] as string,
          skills: [
            {
              namespace: 'arena-skills',
              name: `skill-${String(scenario)}`,
              version: '1.0.0',
              digest: new TestLcg(scenario * 23 + 1).digest(),
            },
          ],
        }),
      );
      const policy = await createForgePolicy({
        policyId: `policy-fp-${String(scenario).padStart(2, '0')}`,
        version: '1.0.0',
        requirements: { minSkills: lcg.int(2) },
      });
      const recipe = makeRecipe();
      const first = await service.submit(manifest, policy, {
        forgeKey: `forge-key-fp-${String(scenario)}`,
        recipe,
      });
      const replay = await service.submit(manifest, policy, {
        forgeKey: `forge-key-fp-${String(scenario)}`,
        recipe,
      });
      expect(replay).toBe(first);
      expect(isBodyVersion(first.bodyVersion)).toBe(true);
      expect(isForgeRecord(first.record)).toBe(true);
      expect(service.listRecords()).toHaveLength(1);
      // A second key + same tuple ⇒ same version digest, new record.
      const second = await service.submit(manifest, policy, {
        forgeKey: `forge-key-fp2-${String(scenario)}`,
        recipe,
      });
      expect(second.bodyVersion.digest).toBe(first.bodyVersion.digest);
      expect(service.listRecords()).toHaveLength(2);
    }
  });

  it('P2 injectivity through the registry: distinct corpora produce distinct recorded version digests', async () => {
    const lcg = new TestLcg(0xe021);
    const service = new ForgeService();
    const seen = new Set<string>();
    for (let scenario = 0; scenario < 6; scenario += 1) {
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-fi-${String(scenario).padStart(2, '0')}`,
          mission: MISSIONS[lcg.int(MISSIONS.length)] as string,
          targetVersion: `${String(scenario + 1)}.0.0`,
        }),
      );
      const policy = await createForgePolicy({ policyId: 'policy-fi', version: '1.0.0' });
      const result = await service.submit(manifest, policy, {
        forgeKey: `forge-key-fi-${String(scenario)}`,
        recipe: makeRecipe(),
      });
      expect(seen.has(result.bodyVersion.digest as string)).toBe(false);
      seen.add(result.bodyVersion.digest as string);
    }
    expect(service.listRecords()).toHaveLength(6);
  });

  it('P3 conflict totality: mutated corpora either fail construction or conflict at the fabric', async () => {
    const lcg = new TestLcg(0x1021);
    const service = new ForgeService();
    const policy = await createForgePolicy({ policyId: 'policy-fc', version: '1.0.0' });
    const base = await createBodyManifest(makeManifestInput());
    await service.submit(base, policy, { forgeKey: 'forge-key-fc-base', recipe: makeRecipe() });
    for (let scenario = 0; scenario < 4; scenario += 1) {
      let mutated;
      try {
        mutated = await createBodyManifest(
          makeManifestInput({
            mission: `${MISSIONS[lcg.int(MISSIONS.length)]} (variant ${String(scenario)})`,
            // SAME target version 1.0.0 as the base, different content.
          }),
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        continue;
      }
      await expect(
        service.submit(mutated, policy, {
          forgeKey: `forge-key-fc-${String(scenario)}`,
          recipe: makeRecipe(),
        }),
      ).rejects.toMatchObject({ code: 'BODY_FORGE_VERSION_CONFLICT' });
    }
    // Only the base execution is recorded.
    expect(service.listRecords()).toHaveLength(1);
  });

  it('P4 append-only growth: supersession corpora grow the registry without rewriting history', async () => {
    const service = new ForgeService();
    const policy = await createForgePolicy({ policyId: 'policy-growth', version: '1.0.0' });
    let parent = { tenant: 'tenant-a', name: 'ledger-reconciler', version: '0.9.0', digest: new TestLcg(1).digest() };
    for (let scenario = 0; scenario < 4; scenario += 1) {
      const version = `1.${String(scenario)}.0`;
      const manifest = await createBodyManifest(
        makeManifestInput({
          manifestId: `manifest-growth-${String(scenario).padStart(2, '0')}`,
          targetVersion: version,
          parents: [parent],
          supersedes: parent,
        }),
      );
      const result = await service.submit(manifest, policy, {
        forgeKey: `forge-key-growth-${String(scenario)}`,
        recipe: makeRecipe(),
      });
      expect(result.bodyVersion.lineage.parents[0]?.digest).toBe(parent.digest);
      // History is never rewritten: all prior records stay addressable.
      expect(service.listRecords()).toHaveLength(scenario + 1);
      parent = {
        tenant: 'tenant-a',
        name: 'ledger-reconciler',
        version,
        digest: result.bodyVersion.digest as string,
      };
    }
    expect(service.listRecordsByBody('tenant-a', 'ledger-reconciler')).toHaveLength(4);
  });
});
