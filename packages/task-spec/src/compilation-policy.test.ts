/**
 * CompilationPolicy suite (Work Order A008) — policy validation: positive,
 * negative/adversarial, determinism.
 */

import { describe, expect, it } from 'vitest';
import { createFixturePolicy, validPolicyInput } from './test-support.js';
import {
  createCompilationPolicy,
  compilationPolicyIdentityKey,
  compilationPolicyView,
  recomputeCompilationPolicyDigest,
  selectableClasses,
} from './compilation-policy.js';
import { TASK_SPEC_ERROR_CODES } from './errors.js';
import { TASK_QUALITY_DIMENSIONS } from './quality.js';

async function rejectsPolicy(
  input: Parameters<typeof createCompilationPolicy>[0],
  code: string,
): Promise<void> {
  await expect(createCompilationPolicy(input)).rejects.toMatchObject({ code });
}

describe('CompilationPolicy construction (positive)', () => {
  it('creates the fixture policy with a valid digest', async () => {
    const policy = await createFixturePolicy();
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(policy.policyId).toBe('fixture-policy');
    expect(policy.eligibility.compilableStatuses).toEqual(['triaged', 'active']);
  });

  it('is deterministic: same rules ⇒ same digest', async () => {
    const a = await createCompilationPolicy(validPolicyInput());
    const b = await createCompilationPolicy(validPolicyInput());
    expect(a.digest).toBe(b.digest);
  });

  it('is deep-frozen', async () => {
    const policy = await createFixturePolicy();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.classSelection.rules)).toBe(true);
  });

  it('verify: recomputeCompilationPolicyDigest accepts pristine content', async () => {
    const policy = await createFixturePolicy();
    await expect(recomputeCompilationPolicyDigest(policy)).resolves.toBe(policy.digest);
  });

  it('quality declarations carry the policy identity as provenance', async () => {
    const policy = await createFixturePolicy();
    for (const declaration of policy.quality) {
      expect(declaration.provenance).toEqual({
        source: 'compilation-policy',
        ref: 'fixture-policy@1.0.0',
      });
    }
    expect(policy.quality.map((d) => d.dimension)).toEqual([...TASK_QUALITY_DIMENSIONS]);
  });

  it('selectableClasses computes the reachable class set', async () => {
    const policy = await createFixturePolicy();
    expect([...selectableClasses(policy.classSelection.rules)].sort()).toEqual([
      'adversarial',
      'benchmark',
      'correction',
      'environment-exploration',
      'tool-use',
    ]);
  });

  it('identity key + view', async () => {
    const policy = await createFixturePolicy();
    expect(compilationPolicyIdentityKey(policy)).toBe('fixture-policy@1.0.0');
    expect('digest' in compilationPolicyView(policy)).toBe(false);
  });
});

describe('CompilationPolicy validation (negative/adversarial)', () => {
  it('compilableStatuses outside {triaged, active} are rejected (narrow-only)', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        eligibility: { compilableStatuses: ['draft'], minimumEvidenceCount: 1 },
      },
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    );
  });

  it('an empty compilableStatuses list is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        eligibility: { compilableStatuses: [], minimumEvidenceCount: 1 },
      },
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    );
  });

  it('a zero minimumEvidenceCount is rejected (sufficient evidence required)', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        eligibility: { compilableStatuses: ['active'], minimumEvidenceCount: 0 },
      },
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    );
  });

  it('a non-total class selection (last rule not always) is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        classSelection: [
          { matcher: 'tools-present', class: 'tool-use' },
          { matcher: 'difficulty-is', class: 'diagnosis', difficulty: 'standard' },
        ],
      },
      TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION,
    );
  });

  it("an 'always' rule before the last is rejected (unreachable rules)", async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        classSelection: [
          { matcher: 'always', class: 'benchmark' },
          { matcher: 'tools-present', class: 'tool-use' },
        ],
      },
      TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION,
    );
  });

  it('an unknown matcher kind is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        classSelection: [
          { matcher: 'vibes-based', class: 'benchmark' },
          { matcher: 'always', class: 'correction' },
        ],
      },
      TASK_SPEC_ERROR_CODES.INVALID_CLASS_SELECTION,
    );
  });

  it("rules that can select long-horizon-execution REQUIRE declared longHorizon evidence", async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        classSelection: [{ matcher: 'always', class: 'long-horizon-execution' }],
      },
      TASK_SPEC_ERROR_CODES.CROSS_FIELD_CONSISTENCY,
    );
  });

  it("long-horizon-execution with declared evidence is accepted", async () => {
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      classSelection: [{ matcher: 'always', class: 'long-horizon-execution' }],
      longHorizon: {
        intermediateStateEvidence: ['checkpoint after each stage'],
        recoveryCriteria: ['resume from the last checkpoint'],
      },
    });
    expect(policy.longHorizon?.recoveryCriteria).toHaveLength(1);
  });

  it('an unknown instruction placeholder is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        fieldMapping: {
          ...validPolicyInput().fieldMapping,
          instructions: { mode: 'template', template: 'do {whatever} you want' },
        },
      },
      TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    );
  });

  it('the known placeholders are all accepted', async () => {
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      fieldMapping: {
        ...validPolicyInput().fieldMapping,
        instructions: {
          mode: 'template',
          template:
            'case {caseId} domain {domain} capability {capability} objectives {objectives} difficulty {difficulty} evidence {evidenceCount}',
        },
      },
    });
    expect(policy.fieldMapping.instructions.template).toContain('{evidenceCount}');
  });

  it('difficulty declared mode without declaredClass is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        difficulty: { mode: 'declared', scale: 'arena:task-difficulty@1' },
      },
      TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY,
    );
  });

  it('an unknown objectives mapping mode is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        fieldMapping: {
          ...validPolicyInput().fieldMapping,
          objectives: { mode: 'reverse' },
        },
      },
      TASK_SPEC_ERROR_CODES.INVALID_FIELD_MAPPING,
    );
  });

  it('expertQualification declare mode without declared requirements is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        expertQualification: { mode: 'declare' },
      },
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    );
  });

  it('from-target-capability mode without expectations is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        expertQualification: { mode: 'from-target-capability' },
      },
      TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    );
  });

  it('an incomplete quality posture (missing dimension) is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        quality: validPolicyInput().quality.filter(
          (entry) => entry.dimension !== 'low-leakage',
        ),
      },
      TASK_SPEC_ERROR_CODES.INVALID_QUALITY,
    );
  });

  it('a tampered policy fails digest recomputation', async () => {
    const policy = await createFixturePolicy();
    const tampered = {
      ...policy,
      description: 'silently rewritten',
    } as typeof policy;
    await expect(recomputeCompilationPolicyDigest(tampered)).rejects.toMatchObject({
      code: TASK_SPEC_ERROR_CODES.TAMPERED,
    });
  });

  it('a bad taskIdPrefix is rejected', async () => {
    await rejectsPolicy(
      {
        ...validPolicyInput(),
        identity: { taskIdPrefix: 'Bad_Prefix', initialVersion: '1.0.0' },
      },
      TASK_SPEC_ERROR_CODES.INVALID_IDENTITY,
    );
  });
});
