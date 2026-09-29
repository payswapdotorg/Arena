/**
 * Compiler suite (Work Order A008) — the PURE engine: determinism, field
 * mapping, class selection, eligibility, tamper rejection.
 */

import { describe, expect, it } from 'vitest';
import {
  activeCase,
  createReferencePolicy,
  multiEnvTriagedCase,
  triagedCase,
  validCaseInput,
  validPolicyInput,
  T1,
} from './test-support.js';
import { compileTarget, selectTaskClass, renderInstructions } from './compiler.js';
import {
  deriveCompilationTarget,
  createCapabilityCase,
  submitCase,
  triageCase,
} from '@arena/capability-case';
import {
  createCompilationPolicy,
  TASK_SPEC_ERROR_CODES,
  verifyTaskSpec,
} from '@arena/task-spec';

async function targetOf(caseRecord: Awaited<ReturnType<typeof triagedCase>>) {
  return deriveCompilationTarget(caseRecord, { derivedAt: T1 });
}

describe('compileTarget (positive)', () => {
  it('compiles a triaged case into one spec (first-env selection)', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const specs = await compileTarget(target, policy);
    expect(specs).toHaveLength(1);
    const spec = specs[0] as (typeof specs)[number];
    expect(spec.identity).toEqual({ tenant: 'tenant-alpha', taskId: 'task-case-review-invoices' });
    expect(spec.version).toBe('1.0.0');
    expect(spec.taskClass).toBe('tool-use'); // tools-present is the first matching rule
    expect(await verifyTaskSpec(spec)).toBe(spec.digest);
  });

  it('maps every case requirement surface into task fields', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const spec = (await compileTarget(target, policy))[0] as never as Record<string, never>;
    expect(spec['objectives']).toEqual([
      'Reconcile credit notes against partially paid invoices',
    ]);
    expect(spec['constraints']).toEqual([
      'Use only the ERP export snapshot',
      'attempt must be reproducible',
    ]);
    expect(spec['prohibitedShortcuts']).toEqual([
      'Assume full settlement without checking credit notes',
      'no skipping the environment',
    ]);
    expect(spec['permittedTools']).toEqual([
      { namespace: 'tenant-alpha', name: 'erp-export-reader', version: '1.0.0', digest: expect.any(String) },
    ]);
    expect(spec['expectedOutputs']).toEqual([
      'Netted total matches the ERP expected balance',
    ]);
    expect(spec['completionCriteria']).toEqual([
      'Netted total matches the ERP expected balance',
    ]);
    expect(spec['evidenceCriteria']).toEqual([
      'Annotated trajectory with the netting decision',
    ]);
  });

  it('binds evaluators/verifiers as A012/A013 descriptor-digest triples', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const spec = (await compileTarget(target, policy))[0] as never as Record<string, never>;
    expect(spec['evaluatorBindings']).toEqual([
      { evaluatorId: 'reconciliation-accuracy', version: '1.0.0', descriptorDigest: expect.any(String) },
    ]);
    expect(spec['verifierBindings']).toEqual([
      { verifierId: 'erp-balance-check', version: '1.0.0', descriptorDigest: expect.any(String) },
    ]);
  });

  it('emits private-tenant data rights with crossTenantReuse: false (R24)', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const spec = (await compileTarget(target, policy))[0] as never as {
      dataRights: Record<string, unknown>;
    };
    expect(spec.dataRights['classification']).toBe('private-tenant');
    expect(spec.dataRights['crossTenantReuse']).toBe(false);
    expect(spec.dataRights['tenantScope']).toBe('tenant-alpha');
  });

  it('derives expert-qualification requirements from the target capability', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const spec = (await compileTarget(target, policy))[0] as never as {
      expertQualificationRequirements: {
        competencies: { id: string }[];
        qualificationPolicy: { policyId: string } | null;
      };
    };
    expect(spec.expertQualificationRequirements.competencies[0]?.id).toBe(
      'invoice-reconciliation',
    );
    expect(spec.expertQualificationRequirements.qualificationPolicy?.policyId).toBe(
      'reference-qualification-policy',
    );
  });

  it('renders instructions from the policy template', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const spec = (await compileTarget(target, policy))[0] as never as {
      instructions: string;
    };
    expect(spec.instructions).toBe(
      'Work the case case-review-invoices for capability invoice-reconciliation in domain accounts-payable (difficulty standard); objectives: Reconcile credit notes against partially paid invoices.',
    );
  });

  it("selection 'each' emits ONE SPEC PER environment with distinct task ids", async () => {
    const target = await deriveCompilationTarget(await multiEnvTriagedCase(), {
      derivedAt: T1,
    });
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      environment: { selection: 'each', seed: null, note: null },
    });
    const specs = await compileTarget(target, policy);
    expect(specs).toHaveLength(2);
    expect(specs.map((spec) => spec.identity.taskId)).toEqual([
      'task-case-multi-env-e0',
      'task-case-multi-env-e1',
    ]);
    const envs = specs.map(
      (spec) => spec.initialState.environment,
    );
    expect(envs[0]?.name).toBe('erp-close-sandbox');
    expect(envs[1]?.name).toBe('erp-ci-sandbox');
    // Each spec's initial state is pinned to a DISTINCT required env:
    for (const spec of specs) {
      expect(spec.environmentRequirements.environments).toHaveLength(2);
    }
  });

  it('class selection is first-match-wins over the ordered rules', async () => {
    const target = await targetOf(await triagedCase());
    // The fixture case: difficulty standard, tools present, shortcuts
    // present, 1 evidence — rules order: difficulty-is(exploratory) →
    // tools-present → shortcuts-present → evidence-at-least(3) → always.
    expect(selectTaskClass(target, await createReferencePolicy())).toBe('tool-use');
    // Reordering the rules changes the outcome (order matters):
    const reordered = await createCompilationPolicy({
      ...validPolicyInput(),
      classSelection: [
        { matcher: 'shortcuts-present', class: 'adversarial' },
        { matcher: 'tools-present', class: 'tool-use' },
        { matcher: 'always', class: 'correction' },
      ],
    });
    expect(selectTaskClass(target, reordered)).toBe('adversarial');
  });

  it('evidence-at-least counts the target evidence set', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      classSelection: [
        { matcher: 'evidence-at-least', class: 'benchmark', count: 1 },
        { matcher: 'always', class: 'correction' },
      ],
    });
    expect(selectTaskClass(target, policy)).toBe('benchmark');
  });

  it('long-horizon selection injects the policy long-horizon evidence', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      classSelection: [{ matcher: 'always', class: 'long-horizon-execution' }],
      longHorizon: {
        intermediateStateEvidence: ['checkpoint after each stage'],
        recoveryCriteria: ['resume from the last checkpoint'],
      },
    });
    const spec = (await compileTarget(target, policy))[0] as never as {
      longHorizonEvidence: { intermediateStateEvidence: string[] } | null;
    };
    expect(spec.longHorizonEvidence?.intermediateStateEvidence).toEqual([
      'checkpoint after each stage',
    ]);
  });

  it('active cases compile identically through the same path', async () => {
    const target = await deriveCompilationTarget(await activeCase(), { derivedAt: T1 });
    const policy = await createReferencePolicy();
    const specs = await compileTarget(target, policy);
    expect(specs).toHaveLength(1);
  });
});

describe('compileTarget (determinism + purity)', () => {
  it('same target + policy ⇒ byte-identical specs', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const a = await compileTarget(target, policy);
    const b = await compileTarget(target, policy);
    expect(a.map((spec) => spec.digest)).toEqual(b.map((spec) => spec.digest));
  });

  it('DIFFERENT derivedAt (different target digest) ⇒ SAME specs', async () => {
    const caseRecord = await triagedCase();
    const policy = await createReferencePolicy();
    const t1 = await deriveCompilationTarget(caseRecord, { derivedAt: T1 });
    const t2 = await deriveCompilationTarget(caseRecord, {
      derivedAt: '2026-06-01T09:30:00.000Z',
    });
    expect(t1.digest).not.toBe(t2.digest); // transport digests differ...
    const a = await compileTarget(t1, policy);
    const b = await compileTarget(t2, policy);
    expect(a.map((spec) => spec.digest)).toEqual(b.map((spec) => spec.digest)); // ...specs do not
  });

  it('compilation never mutates the case or the policy', async () => {
    const caseRecord = await triagedCase();
    const target = await targetOf(caseRecord);
    const policy = await createReferencePolicy();
    const caseBefore = JSON.stringify(caseRecord);
    const policyBefore = JSON.stringify(policy);
    const targetBefore = JSON.stringify(target);
    await compileTarget(target, policy);
    expect(JSON.stringify(caseRecord)).toBe(caseBefore);
    expect(JSON.stringify(policy)).toBe(policyBefore);
    expect(JSON.stringify(target)).toBe(targetBefore);
  });
});

describe('compileTarget (negative/adversarial)', () => {
  it('a tampered target is rejected (fail-closed)', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const tampered = {
      ...target,
      evidence: [
        ...target.evidence,
        { digest: 'f'.repeat(64), description: 'smuggled evidence' },
      ],
    } as typeof target;
    await expect(compileTarget(tampered, policy)).rejects.toMatchObject({
      code: 'CAPABILITY_CASE_TAMPERED',
    });
  });

  it('a tampered policy is rejected (fail-closed)', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createReferencePolicy();
    const tampered = {
      ...policy,
      eligibility: { ...policy.eligibility, minimumEvidenceCount: 99 },
    } as typeof policy;
    await expect(compileTarget(target, tampered)).rejects.toMatchObject({
      code: 'TASK_SPEC_TAMPERED',
    });
  });

  it('insufficient evidence under the policy is rejected', async () => {
    const target = await targetOf(await triagedCase());
    const policy = await createCompilationPolicy({
      ...validPolicyInput(),
      eligibility: { compilableStatuses: ['triaged', 'active'], minimumEvidenceCount: 2 },
    });
    await expect(compileTarget(target, policy)).rejects.toMatchObject({
      code: TASK_SPEC_ERROR_CODES.INVALID_POLICY,
    });
  });

  it('a DRAFT case cannot even derive a target (A005 gate surfaces here)', async () => {
    const draft = await createCapabilityCase(validCaseInput());
    const submitted = await submitCase(draft, {
      at: T1,
      actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    });
    await expect(deriveCompilationTarget(draft, { derivedAt: T1 })).rejects.toMatchObject({
      code: 'CAPABILITY_CASE_INVALID_COMPILATION_TARGET',
    });
    await expect(deriveCompilationTarget(submitted, { derivedAt: T1 })).rejects.toMatchObject({
      code: 'CAPABILITY_CASE_INVALID_COMPILATION_TARGET',
    });
    // ...while triaged works:
    const triaged = await triageCase(submitted, {
      at: T1,
      actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
      note: 'unlocked',
    });
    await expect(deriveCompilationTarget(triaged, { derivedAt: T1 })).resolves.toBeTruthy();
  });
});

describe('renderInstructions (closed placeholder vocabulary)', () => {
  it('substitutes every known placeholder', async () => {
    const target = await targetOf(await triagedCase());
    const rendered = renderInstructions(
      'case {caseId} dom {domain} cap {capability} diff {difficulty} ev {evidenceCount}',
      target,
      'standard',
      ['objective one', 'objective two'],
    );
    expect(rendered).toBe(
      'case case-review-invoices dom accounts-payable cap invoice-reconciliation diff standard ev 1',
    );
  });
});
