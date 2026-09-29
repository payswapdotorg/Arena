/**
 * The compose-from-learning demo path tests (Work Order A021 item 8):
 * a REAL A020 ExperimentRunRecord + a REAL A019 SkillDraft cited as
 * explicit provenance → a new manifest → a new BodyVersion proposal.
 * The learning→forge boundary is PROPOSAL-only; history is never
 * rewritten (lock rule 6) — the source records stay bit-identical,
 * and the proposal is accepted by the REAL A003 registry.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { createAgentBody, isBodyVersion, registerBodyVersion } from '@arena/agent-body';
import {
  BODY_FORGE_ERROR_CODES,
  createForgePolicy,
  defaultForgePolicyInput,
} from '@arena/body-forge';
import { ForgeService } from './fabric.js';
import { composeFromLearning, skillRefOfDraft } from './learning-demo.js';
import {
  FORGE_KEY,
  makeExperimentRunRecord,
  makeManifest,
  makePolicy,
  makeRecipe,
  makeSkillDraft,
  parentRefV1,
} from './test-support.js';

const RECIPE = makeRecipe();

describe('composeFromLearning (the A020→A019→A021 bridge)', () => {
  it('cites the experiment record and skill draft as EXPLICIT provenance and composes a new version', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const baseManifest = await makeManifest();
    const policy = await makePolicy();

    const result = await composeFromLearning(experimentRecord, skillDraft, {
      baseManifest,
      policy,
      targetVersion: '1.1.0',
      supersedes: parentRefV1(),
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
      notes: 'compose-from-learning demo',
    });

    expect(isBodyVersion(result.bodyVersion)).toBe(true);
    expect(result.bodyVersion.version).toBe('1.1.0');
    // The draft's skill node entered the composition...
    const skillRef = skillRefOfDraft(skillDraft);
    expect(result.bodyVersion.skills).toContainEqual(skillRef);
    // ...and the derived manifest cites BOTH learning records explicitly.
    expect(result.manifest.provenance.citations).toContainEqual({
      kind: 'experiment-record',
      digest: experimentRecord.digest,
    });
    expect(result.manifest.provenance.citations).toContainEqual({
      kind: 'skill-draft',
      digest: skillDraft.digest,
      skills: [skillRef],
    });
    expect(result.record.manifestDigest).toBe(result.manifest.digest);
    expect(result.record.provenance.notes).toBe('compose-from-learning demo');
    // Append-only supersession: the new version carries its parent.
    expect(result.bodyVersion.lineage.supersedes?.version).toBe('1.0.0');
    expect(result.bodyVersion.lineage.parents[0]?.version).toBe('1.0.0');
    // The forged version cites the derived manifest in provenance.records.
    expect(result.bodyVersion.provenance.records[0]?.digest).toBe(result.manifest.digest);
  });

  it('the emitted proposal is accepted by the REAL A003 registry (learning proposes, the forge composes, A003 appends)', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const baseManifest = await makeManifest();
    const policy = await makePolicy();

    // Register the ORIGINAL base version first (its content is the 1.0.0).
    const baseService = new ForgeService();
    const baseResult = await baseService.submit(baseManifest, policy, {
      forgeKey: 'forge-key-base-v1',
      recipe: RECIPE,
    });

    const result = await composeFromLearning(experimentRecord, skillDraft, {
      baseManifest,
      policy,
      targetVersion: '1.1.0',
      supersedes: parentRefV1(),
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
    });

    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'ledger-reconciler' },
      createdAt: '2026-06-01T11:00:00.000Z',
      creator: { type: 'user', tenant: 'tenant-a', principalId: 'author-01' },
      rights: baseManifest.rights,
    });
    let updated = await registerBodyVersion(body, baseResult.bodyVersion);
    updated = await registerBodyVersion(updated, result.bodyVersion);
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]?.version).toBe('1.0.0');
    expect(updated.versions[1]?.version).toBe('1.1.0');
  });

  it('the learning records stay bit-identical and frozen (lock rule 6 — history is never rewritten)', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const before = [canonicalJson(experimentRecord), canonicalJson(skillDraft)];
    const baseManifest = await makeManifest();
    const policy = await makePolicy();
    await composeFromLearning(experimentRecord, skillDraft, {
      baseManifest,
      policy,
      targetVersion: '2.0.0',
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
    });
    const after = [canonicalJson(experimentRecord), canonicalJson(skillDraft)];
    expect(after).toEqual(before);
    expect(Object.isFrozen(experimentRecord)).toBe(true);
    expect(Object.isFrozen(skillDraft)).toBe(true);
    expect(Object.isFrozen(skillDraft.skillNode)).toBe(true);
  });

  it('a STRICT policy (no uncited skills) accepts the demo manifest because every skill is cited', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const baseManifest = await makeManifest({ skills: [] });
    const policy = await createForgePolicy({
      ...defaultForgePolicyInput(),
      learningAdmission: { uncitedSkillsAllowed: false, requireExperimentForSkillDraft: true },
    });
    const result = await composeFromLearning(experimentRecord, skillDraft, {
      baseManifest,
      policy,
      targetVersion: '1.0.0',
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
    });
    expect(result.bodyVersion.skills).toHaveLength(1);
  });

  it('REJECTS malformed learning records (REAL guards, never bypassed)', async () => {
    const baseManifest = await makeManifest();
    const policy = await makePolicy();
    const skillDraft = await makeSkillDraft();
    await expect(
      composeFromLearning({ not: 'an-experiment' } as never, skillDraft, {
        baseManifest,
        policy,
        targetVersion: '1.1.0',
        forgeKey: FORGE_KEY,
        recipe: RECIPE,
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
    const experimentRecord = await makeExperimentRunRecord();
    await expect(
      composeFromLearning(experimentRecord, { not: 'a-draft' } as never, {
        baseManifest,
        policy,
        targetVersion: '1.1.0',
        forgeKey: FORGE_KEY,
        recipe: RECIPE,
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE });
  });

  it('REJECTS an invalid forge key and a policy that does not admit the citations', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const baseManifest = await makeManifest();
    const policy = await makePolicy();
    await expect(
      composeFromLearning(experimentRecord, skillDraft, {
        baseManifest,
        policy,
        targetVersion: '1.1.0',
        forgeKey: 'not valid!',
        recipe: RECIPE,
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECORD });

    const noExperiments = await createForgePolicy({
      ...defaultForgePolicyInput(),
      learningAdmission: { allowExperimentRecordCitations: false },
    });
    await expect(
      composeFromLearning(experimentRecord, skillDraft, {
        baseManifest,
        policy: noExperiments,
        targetVersion: '1.1.0',
        forgeKey: FORGE_KEY,
        recipe: RECIPE,
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED });
  });

  it('re-running the same forge key on a SHARED fabric replays the stored result (idempotent demo path)', async () => {
    const experimentRecord = await makeExperimentRunRecord();
    const skillDraft = await makeSkillDraft();
    const baseManifest = await makeManifest();
    const policy = await makePolicy();
    const service = new ForgeService();
    const options = {
      baseManifest,
      policy,
      targetVersion: '1.1.0',
      supersedes: parentRefV1(),
      forgeKey: FORGE_KEY,
      recipe: RECIPE,
      service,
    } as const;
    const first = await composeFromLearning(experimentRecord, skillDraft, options);
    const replay = await composeFromLearning(experimentRecord, skillDraft, options);
    // The STORED proposal and record are returned byte-identically (the
    // wrapper is rebuilt, its payload is the stored result).
    expect(replay.bodyVersion).toBe(first.bodyVersion);
    expect(replay.record).toBe(first.record);
    expect(replay.manifest.digest).toBe(first.manifest.digest);
    expect(service.listRecords()).toHaveLength(1);
  });
});
