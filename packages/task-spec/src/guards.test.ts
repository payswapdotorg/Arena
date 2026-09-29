/**
 * Guards suite (Work Order A008) — the adversarial cross-field battery.
 * Every guard family gets a positive and a negative case.
 */

import { describe, expect, it } from 'vitest';
import { createFixtureSpec, validSpecInput, qualityFixture, DIGESTS } from './test-support.js';
import { createTaskSpec } from './spec.js';
import { guardTaskSpecView } from './guards.js';
import { TASK_SPEC_ERROR_CODES } from './errors.js';
import { TASK_QUALITY_DIMENSIONS } from './quality.js';

async function rejects(
  input: Parameters<typeof createTaskSpec>[0],
  code: string,
): Promise<void> {
  await expect(createTaskSpec(input)).rejects.toMatchObject({ code });
}

describe('field completeness (TS1.0 structure)', () => {
  it('the fixture passes the guard', () => {
    expect(() => guardTaskSpecView(validSpecInput())).not.toThrow();
  });

  it('a missing required field is a typed INVALID_SPEC error', async () => {
    const input = validSpecInput() as unknown as Record<string, unknown>;
    delete input['instructions'];
    await rejects(input as never, TASK_SPEC_ERROR_CODES.INVALID_SPEC);
  });

  it('an unknown field is rejected (closed shape)', async () => {
    const input = { ...validSpecInput(), secretSauce: 'nope' } as never;
    await rejects(input, TASK_SPEC_ERROR_CODES.INVALID_SPEC);
  });

  it('an unsupported record version is rejected', async () => {
    const input = { ...validSpecInput(), recordVersion: 2 } as never;
    await rejects(input, TASK_SPEC_ERROR_CODES.UNSUPPORTED_RECORD_VERSION);
  });
});

describe('closed vocabularies', () => {
  it('an unknown task class is rejected', async () => {
    await rejects(
      validSpecInput({ taskClass: 'vibes' }),
      TASK_SPEC_ERROR_CODES.INVALID_CLASS,
    );
  });

  it('an unknown difficulty scale is rejected', async () => {
    await rejects(
      validSpecInput({ difficulty: { scale: 'arena:difficulty@9', class: 'standard' } }),
      TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY,
    );
  });

  it('an unknown difficulty class is rejected', async () => {
    await rejects(
      validSpecInput({ difficulty: { scale: 'arena:task-difficulty@1', class: 'hard' } }),
      TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY,
    );
  });

  it('an unknown data-rights classification is rejected', async () => {
    await rejects(
      validSpecInput({
        dataRights: {
          classification: 'open-bar',
          tenantScope: 'tenant-alpha',
          crossTenantReuse: false,
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS,
    );
  });

  it('an invalid capability label is rejected', async () => {
    await rejects(
      validSpecInput({ capabilityLabels: ['Not A Label'] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });

  it('duplicate capability labels are rejected', async () => {
    await rejects(
      validSpecInput({ capabilityLabels: ['code-review', 'code-review'] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });

  it('empty capability labels are rejected', async () => {
    await rejects(
      validSpecInput({ capabilityLabels: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });
});

describe('long-horizon cross-field consistency', () => {
  it('long-horizon-execution WITHOUT evidence is rejected', async () => {
    await rejects(
      validSpecInput({ taskClass: 'long-horizon-execution' }),
      TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY,
    );
  });

  it('long-horizon-execution WITH evidence is accepted', async () => {
    const spec = await createTaskSpec(
      validSpecInput({
        taskClass: 'long-horizon-execution',
        longHorizonEvidence: {
          intermediateStateEvidence: ['checkpoint after each stage'],
          recoveryCriteria: ['resume from checkpoint after interruption'],
        },
      }),
    );
    expect(spec.longHorizonEvidence?.intermediateStateEvidence).toHaveLength(1);
  });

  it('an unrelated class carrying long-horizon evidence is rejected', async () => {
    await rejects(
      validSpecInput({
        taskClass: 'diagnosis',
        longHorizonEvidence: {
          intermediateStateEvidence: ['checkpoint'],
          recoveryCriteria: ['resume'],
        },
      }),
      TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY,
    );
  });

  it('recovery-failure MAY carry long-horizon evidence', async () => {
    const spec = await createTaskSpec(
      validSpecInput({
        taskClass: 'recovery-failure',
        longHorizonEvidence: {
          intermediateStateEvidence: ['state snapshot before failure injection'],
          recoveryCriteria: ['a recovery attempt is recorded'],
        },
      }),
    );
    expect(spec.longHorizonEvidence).not.toBeNull();
  });

  it('long-horizon evidence with empty intermediate-state criteria is rejected', async () => {
    await rejects(
      validSpecInput({
        taskClass: 'long-horizon-execution',
        longHorizonEvidence: { intermediateStateEvidence: [], recoveryCriteria: ['resume'] },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });
});

describe('binding digests (A012/A013 shapes)', () => {
  it('a malformed evaluator binding digest is rejected', async () => {
    await rejects(
      validSpecInput({
        evaluatorBindings: [
          { evaluatorId: 'guard-evaluator', version: '1.0.0', descriptorDigest: 'not-a-digest' },
        ],
      }),
      TASK_SPEC_ERROR_CODES.INVALID_BINDING,
    );
  });

  it('an empty evaluator binding list is rejected (rule 7)', async () => {
    await rejects(
      validSpecInput({ evaluatorBindings: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_BINDING,
    );
  });

  it('an empty verifier binding list is rejected (rule 7)', async () => {
    await rejects(
      validSpecInput({ verifierBindings: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_BINDING,
    );
  });

  it('a non-neutral verifier id is rejected', async () => {
    await rejects(
      validSpecInput({
        verifierBindings: [
          { verifierId: 'Guard_Verifier', version: '1.0.0', descriptorDigest: DIGESTS.verifier },
        ],
      }),
      TASK_SPEC_ERROR_CODES.INVALID_BINDING,
    );
  });
});

describe('initial state / environment consistency', () => {
  it('an initial-state environment outside the requirements is rejected', async () => {
    await rejects(
      validSpecInput({
        initialState: {
          environment: {
            namespace: 'tenant-alpha',
            name: 'unrelated-env',
            version: '1.0.0',
            digest: DIGESTS.envB,
          },
          seed: null,
          note: null,
        },
      }),
      TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY,
    );
  });

  it('an initial-state environment among the requirements is accepted', async () => {
    const spec = await createTaskSpec(
      validSpecInput({
        environmentRequirements: {
          environments: [
            {
              namespace: 'tenant-alpha',
              name: 'review-workspace',
              version: '1.0.0',
              digest: DIGESTS.envA,
            },
            {
              namespace: 'tenant-alpha',
              name: 'review-workspace-ci',
              version: '1.1.0',
              digest: DIGESTS.envB,
            },
          ],
          constraints: [],
        },
      }),
    );
    expect(spec.environmentRequirements.environments).toHaveLength(2);
  });
});

describe('quality declaration completeness', () => {
  it('a missing dimension is rejected', async () => {
    const quality = qualityFixture().filter(
      (entry) => entry.dimension !== 'low-leakage',
    );
    await rejects(
      validSpecInput({ quality }),
      TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
    );
  });

  it('a duplicated dimension is rejected', async () => {
    const quality = [
      ...qualityFixture(),
      qualityFixture({ dimension: 'low-leakage' })[0] as never,
    ];
    await rejects(
      validSpecInput({ quality }),
      TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
    );
  });

  it('all seven dimensions are required', async () => {
    const spec = await createFixtureSpec();
    expect(spec.quality.map((entry) => entry.dimension)).toEqual([
      ...TASK_QUALITY_DIMENSIONS,
    ]);
  });

  it('a declaration without provenance is rejected', async () => {
    const quality = qualityFixture().map((entry) => ({ ...entry, provenance: null }));
    await rejects(
      validSpecInput({ quality: quality as never }),
      TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
    );
  });

  it('satisfied: false is VALID (declared limitations are honest, not errors)', async () => {
    const spec = await createTaskSpec(
      validSpecInput({
        quality: qualityFixture({
          dimension: 'low-leakage',
          satisfied: false,
          justification: 'the statement leaks the answer shape; known gap',
        }),
      }),
    );
    const lowLeakage = spec.quality.find(
      (entry) => entry.dimension === 'low-leakage',
    );
    expect(lowLeakage?.satisfied).toBe(false);
  });
});

describe('data rights (R24 posture)', () => {
  it('private-tenant + crossTenantReuse is rejected', async () => {
    await rejects(
      validSpecInput({
        dataRights: {
          classification: 'private-tenant',
          tenantScope: 'tenant-alpha',
          crossTenantReuse: true,
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS,
    );
  });

  it('a tenant scope different from the identity tenant is rejected (rule 11)', async () => {
    await rejects(
      validSpecInput({
        dataRights: {
          classification: 'private-tenant',
          tenantScope: 'tenant-beta',
          crossTenantReuse: false,
        },
      }),
      TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY,
    );
  });

  it('tenant-shareable classification is accepted', async () => {
    const spec = await createTaskSpec(
      validSpecInput({
        dataRights: {
          classification: 'tenant-shareable',
          tenantScope: 'tenant-alpha',
          crossTenantReuse: true,
          licensing: 'tenant-shared under NDA',
          privacyNotes: null,
        },
      }),
    );
    expect(spec.dataRights.classification).toBe('tenant-shareable');
  });
});

describe('supersession guards', () => {
  it('a superseding version with LOWER semver precedence is rejected', async () => {
    const first = await createFixtureSpec();
    await rejects(
      validSpecInput({
        version: '0.9.0',
        supersedes: {
          tenant: 'tenant-alpha',
          taskId: 'task-case-001',
          version: '1.0.0',
          digest: first.digest,
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION,
    );
  });

  it('supersession across logical tasks is rejected', async () => {
    const first = await createFixtureSpec();
    await rejects(
      validSpecInput({
        version: '1.1.0',
        supersedes: {
          tenant: 'tenant-alpha',
          taskId: 'task-other',
          version: '1.0.0',
          digest: first.digest,
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_SUPERSESSION,
    );
  });
});

describe('requirement lists', () => {
  it('empty objectives are rejected', async () => {
    await rejects(validSpecInput({ objectives: [] }), TASK_SPEC_ERROR_CODES.INVALID_SPEC);
  });

  it('empty completion criteria are rejected', async () => {
    await rejects(
      validSpecInput({ completionCriteria: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });

  it('empty evidence criteria are rejected', async () => {
    await rejects(
      validSpecInput({ evidenceCriteria: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });

  it('empty expected outputs are rejected', async () => {
    await rejects(
      validSpecInput({ expectedOutputs: [] }),
      TASK_SPEC_ERROR_CODES.INVALID_SPEC,
    );
  });

  it('expert qualification requirements need >= 1 competency', async () => {
    await rejects(
      validSpecInput({
        expertQualificationRequirements: {
          competencies: [],
          qualificationPolicy: null,
          expectations: ['qualified somehow'],
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_REQUIREMENTS,
    );
  });

  it('a domain node with a non-domain kind is rejected', async () => {
    await rejects(
      validSpecInput({
        domain: { kind: 'capability', id: 'wrong-kind', version: '1.0.0', digest: DIGESTS.domain },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_REF,
    );
  });

  it('an invalid derivation case ref is rejected', async () => {
    await rejects(
      validSpecInput({
        derivedFrom: {
          caseRef: { tenant: 'tenant-alpha', caseId: 'case-001', version: 'not-semver', digest: DIGESTS.caseRef },
          policyRef: { policyId: 'fixture-policy', version: '1.0.0', digest: DIGESTS.policy },
        },
      }),
      TASK_SPEC_ERROR_CODES.INVALID_REF,
    );
  });
});
