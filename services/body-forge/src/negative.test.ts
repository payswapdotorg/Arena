/**
 * Negative/adversarial tests for the fabric (Work Order A021):
 * tampered inputs, idempotency conflicts, version conflicts, invalid
 * keys, malformed recipes and the strict learning-admission posture
 * through the service.
 */

import { describe, expect, it } from 'vitest';
import {
  BODY_FORGE_ERROR_CODES,
  createForgePolicy,
  defaultForgePolicyInput,
} from '@arena/body-forge';
import { ForgeService } from './fabric.js';
import {
  FORGE_KEY,
  makeManifest,
  makePolicy,
  makeRecipe,
  parentRefV1,
} from './test-support.js';

const RECIPE = makeRecipe();

describe('input contracts through the service', () => {
  it('REFUSES an empty forge key and a malformed correlation id in the recipe', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const policy = await makePolicy();
    await expect(
      service.submit(manifest, policy, { forgeKey: '', recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });
    await expect(
      service.submit(manifest, policy, {
        forgeKey: FORGE_KEY,
        recipe: { ...RECIPE, correlationId: 'no pe' },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECIPE });
    await expect(
      service.submit(manifest, policy, {
        forgeKey: FORGE_KEY,
        recipe: { ...RECIPE, forgedAt: 'whenever' },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_TIMESTAMP });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('REFUSES tampered manifests and policies, recording NOTHING', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    const manifest = await makeManifest();
    const tamperedManifest = { ...manifest, mission: 'A tampered mission.' } as typeof manifest;
    await expect(
      service.submit(tamperedManifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.TAMPERED });
    const tamperedPolicy = {
      ...policy,
      requirements: { ...policy.requirements, minSkills: 7 },
    } as typeof policy;
    await expect(
      service.submit(manifest, tamperedPolicy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.TAMPERED });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('IDEMPOTENCY_CONFLICT: same key, different manifest or different policy', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest();
    const otherManifest = await makeManifest({ mission: 'A different mission.' });
    const policy = await makePolicy();
    const otherPolicy = await createForgePolicy({
      ...defaultForgePolicyInput(),
      requirements: { minSkills: 1 },
    });
    await service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE });
    await expect(
      service.submit(otherManifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.IDEMPOTENCY_CONFLICT });
    await expect(
      service.submit(manifest, otherPolicy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.IDEMPOTENCY_CONFLICT });
    expect(service.listRecords()).toHaveLength(1);
  });
});

describe('the version-conflict mirror (lock rule 5 through the fabric)', () => {
  it('VERSION_CONFLICT: the same (body, version) with different content, under a NEW key', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    await service.submit(await makeManifest(), policy, { forgeKey: 'forge-key-neg-1', recipe: RECIPE });
    const conflicting = await makeManifest({ mission: 'A conflicting mission for the same version.' });
    await expect(
      service.submit(conflicting, policy, { forgeKey: 'forge-key-neg-2', recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.VERSION_CONFLICT });
    // Nothing was recorded for the conflicting attempt.
    expect(service.listRecords()).toHaveLength(1);
    expect(service.listRecordsByBody('tenant-a', 'ledger-reconciler')).toHaveLength(1);
  });

  it('identical content under a new key is NOT a conflict (same digest, new execution)', async () => {
    const service = new ForgeService();
    const policy = await makePolicy();
    const manifest = await makeManifest();
    const first = await service.submit(manifest, policy, { forgeKey: 'forge-key-same-1', recipe: RECIPE });
    const second = await service.submit(manifest, policy, { forgeKey: 'forge-key-same-2', recipe: RECIPE });
    expect(second.bodyVersion.digest).toBe(first.bodyVersion.digest);
    expect(service.listRecords()).toHaveLength(2);
  });
});

describe('policy rules through the service (adversarial)', () => {
  it('REQUIREMENT_VIOLATION through submit', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest({ skills: [] });
    const policy = await createForgePolicy({
      ...defaultForgePolicyInput(),
      requirements: { minSkills: 1 },
    });
    await expect(
      service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('LEARNING_PROVENANCE_REJECTED through submit (silently embedded un-provenanced skills)', async () => {
    const service = new ForgeService();
    const manifest = await makeManifest(); // has one uncited skill
    const policy = await createForgePolicy({
      ...defaultForgePolicyInput(),
      learningAdmission: { uncitedSkillsAllowed: false },
    });
    await expect(
      service.submit(manifest, policy, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('LINEAGE_VIOLATION through submit (parents required / supersession forbidden)', async () => {
    const service = new ForgeService();
    const noParents = await createForgePolicy({
      ...defaultForgePolicyInput(),
      lineage: { requireParents: true },
    });
    await expect(
      service.submit(await makeManifest(), noParents, { forgeKey: FORGE_KEY, recipe: RECIPE }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });

    const noSupersession = await createForgePolicy({
      ...defaultForgePolicyInput(),
      lineage: { allowSupersession: false },
    });
    await expect(
      service.submit(
        await makeManifest({
          targetVersion: '1.1.0',
          parents: [parentRefV1()],
          supersedes: parentRefV1(),
        }),
        noSupersession,
        { forgeKey: FORGE_KEY, recipe: RECIPE },
      ),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });
    expect(service.listRecords()).toHaveLength(0);
  });

  it('the HARD manifest rules cannot be bypassed through the service (supersedes without parent)', async () => {
    const service = new ForgeService();
    // The manifest constructor itself refuses this shape — the service
    // cannot even receive such a manifest.
    await expect(
      makeManifest({ targetVersion: '1.1.0', parents: [], supersedes: parentRefV1() }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION });
    expect(service.listRecords()).toHaveLength(0);
  });
});
