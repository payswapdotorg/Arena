/**
 * ForgePolicy unit tests (Work Order A021): construction, defaults,
 * A003 floor enforcement, content-addressing, tamper detection.
 */

import { describe, expect, it } from 'vitest';
import {
  A003_INPUT_FLOORS,
  DEFAULT_LEARNING_ADMISSION,
  DEFAULT_LINEAGE_RULES,
  FORGE_POLICY_FIELDS,
  FORGE_POLICY_VERSION,
  FORGE_REQUIREMENTS_FIELDS,
  LEARNING_ADMISSION_FIELDS,
  LINEAGE_RULES_FIELDS,
  BODY_FORGE_ERROR_CODES,
  createForgePolicy,
  defaultForgePolicyInput,
  forgePolicyArtifactRef,
  forgePolicyKey,
  forgePolicyView,
  isForgePolicy,
  isForgePolicyView,
  verifyForgePolicy,
} from './index.js';

describe('ForgePolicy construction (positive)', () => {
  it('creates the default policy (permissive-with-structure floors)', async () => {
    const policy = await createForgePolicy(defaultForgePolicyInput());
    expect(isForgePolicy(policy)).toBe(true);
    expect(isForgePolicyView(forgePolicyView(policy))).toBe(true);
    expect(policy.recordVersion).toBe(FORGE_POLICY_VERSION);
    expect(policy.policyId).toBe('policy-body-forge-default');
    expect(policy.requirements).toEqual({ ...A003_INPUT_FLOORS });
    expect(policy.learningAdmission).toEqual(DEFAULT_LEARNING_ADMISSION);
    expect(policy.lineage).toEqual(DEFAULT_LINEAGE_RULES);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.requirements)).toBe(true);
  });

  it('falls back to documented defaults for unspecified sections', async () => {
    const policy = await createForgePolicy({ policyId: 'policy-minimal', version: '1.0.0' });
    expect(policy.requirements.minSkills).toBe(0);
    expect(policy.requirements.minCapabilities).toBe(1);
    expect(policy.learningAdmission.uncitedSkillsAllowed).toBe(true);
    expect(policy.lineage.requireParents).toBe(false);
  });

  it('a policy may only strengthen: values above the floors are accepted', async () => {
    const policy = await createForgePolicy({
      policyId: 'policy-strict',
      version: '2.1.0',
      requirements: { minSkills: 2, minKnowledge: 1 },
      learningAdmission: { uncitedSkillsAllowed: false },
      lineage: { requireParents: true },
    });
    expect(policy.requirements.minSkills).toBe(2);
    expect(policy.requirements.minTools).toBe(0);
    expect(policy.learningAdmission.uncitedSkillsAllowed).toBe(false);
    expect(policy.learningAdmission.allowSkillDraftCitations).toBe(true);
    expect(policy.lineage.requireParents).toBe(true);
    expect(policy.lineage.allowSupersession).toBe(true);
  });

  it('content-addresses: identical inputs ⇒ identical digests; different content ⇒ different digests', async () => {
    const a = await createForgePolicy(defaultForgePolicyInput());
    const b = await createForgePolicy(defaultForgePolicyInput());
    expect(a.digest).toBe(b.digest);
    const c = await createForgePolicy({
      policyId: 'policy-body-forge-default',
      version: '1.0.0',
      requirements: { minSkills: 1 },
    });
    expect(c.digest).not.toBe(a.digest);
  });

  it('exposes stable keys and a content-addressed artifact ref', async () => {
    const policy = await createForgePolicy(defaultForgePolicyInput());
    expect(forgePolicyKey(policy)).toBe(`policy-body-forge-default@1.0.0#${policy.digest}`);
    expect(forgePolicyArtifactRef(policy)).toEqual({
      namespace: 'body-forge',
      name: 'policy-body-forge-default',
      version: '1.0.0',
      digest: policy.digest,
    });
  });

  it('mirrors the stable field lists', () => {
    expect(FORGE_POLICY_FIELDS).toEqual([
      'recordVersion',
      'policyId',
      'version',
      'requirements',
      'learningAdmission',
      'lineage',
    ]);
    expect([...FORGE_REQUIREMENTS_FIELDS].sort()).toEqual(
      [...Object.keys(A003_INPUT_FLOORS)].sort(),
    );
    expect(LEARNING_ADMISSION_FIELDS).toHaveLength(4);
    expect(LINEAGE_RULES_FIELDS).toHaveLength(2);
  });
});

describe('ForgePolicy validation (negative)', () => {
  it('rejects requirements below the A003 floors (a policy may only strengthen)', async () => {
    for (const [field, floor] of [
      ['minCapabilities', 1],
      ['minEvaluationSuites', 1],
      ['minVerificationSuites', 1],
      ['minEnvironmentRequirements', 1],
    ] as const) {
      await expect(
        createForgePolicy({
          policyId: 'policy-bad',
          version: '1.0.0',
          requirements: { [field]: floor - 1 },
        }),
      ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
    }
    await expect(
      createForgePolicy({ policyId: 'policy-bad', version: '1.0.0', requirements: { minSkills: -1 } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
    await expect(
      createForgePolicy({ policyId: 'policy-bad', version: '1.0.0', requirements: { minSkills: 1.5 } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
  });

  it('rejects non-boolean admission/lineage flags', async () => {
    await expect(
      createForgePolicy({
        policyId: 'policy-bad',
        version: '1.0.0',
        learningAdmission: { allowSkillDraftCitations: 'yes' as never },
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
    await expect(
      createForgePolicy({ policyId: 'policy-bad', version: '1.0.0', lineage: { requireParents: 1 as never } }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_POLICY });
  });

  it('rejects malformed policy ids and versions', async () => {
    await expect(createForgePolicy({ policyId: 'Bad Id', version: '1.0.0' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_IDENTITY,
    });
    await expect(createForgePolicy({ policyId: 'ok-id', version: '1.0' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_IDENTITY,
    });
    await expect(createForgePolicy({ version: '1.0.0' } as never)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    });
  });
});

describe('tamper detection', () => {
  it('verifyForgePolicy fails closed with BODY_FORGE_TAMPERED on a mutated copy', async () => {
    const policy = await createForgePolicy(defaultForgePolicyInput());
    expect(await verifyForgePolicy(policy)).toBe(policy.digest);
    const tampered = {
      ...policy,
      requirements: { ...policy.requirements, minSkills: 99 },
    } as typeof policy;
    await expect(verifyForgePolicy(tampered)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects a non-policy object outright', async () => {
    await expect(verifyForgePolicy({ nope: true } as never)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    });
  });
});
