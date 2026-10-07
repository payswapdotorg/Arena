/**
 * Validation-plan derivation tests (Work Order C009): determinism,
 * the typed closed plan-derivable / under-specified-with-reasons
 * outcome, and the EV1.0 stage selection per condition kind.
 */

import { describe, expect, it } from 'vitest';
import { createEscalationRequest } from '@arena/escalation';
import {
  createDeclaredValidationCondition,
  deriveValidationPlan,
  isValidationPlan,
  primaryFabricOf,
} from './plan.js';
import type { DeclaredValidationCondition } from './plan.js';
import { validValidationConditionInput, validEscalationRequestInput } from './test-support.js';
import { EscalationValidationError } from './errors.js';

const NOW = '2026-10-07T11:00:00.000Z';

async function fixture() {
  const request = await createEscalationRequest(validEscalationRequestInput());
  const condition = createDeclaredValidationCondition(validValidationConditionInput());
  return { request, condition };
}

describe('createDeclaredValidationCondition (strict, fail-closed)', () => {
  it('accepts a valid condition and freezes it', () => {
    const condition = createDeclaredValidationCondition(validValidationConditionInput());
    expect(condition.conditionVersion).toBe(1);
    expect(condition.kind).toBe('criteria-threshold');
    expect(Object.isFrozen(condition)).toBe(true);
    expect(Object.isFrozen(condition.criteriaRefs)).toBe(true);
  });

  it('rejects an unknown condition kind (closed vocabulary)', () => {
    expect(() =>
      createDeclaredValidationCondition(validValidationConditionInput({ kind: 'rubber-stamp' })),
    ).toThrow(EscalationValidationError);
  });

  it('rejects a smuggled authority-shaped field (exact-field discipline)', () => {
    const input = {
      ...validValidationConditionInput(),
      authorization: 'granted',
    } as unknown as Parameters<typeof createDeclaredValidationCondition>[0];
    expect(() => createDeclaredValidationCondition(input)).toThrow(/unknown field/u);
  });

  it('rejects non-parallel evidence kinds/claims', () => {
    expect(() =>
      createDeclaredValidationCondition(
        validValidationConditionInput({ requiredEvidenceClaims: ['only-one'] }),
      ),
    ).toThrow(/parallel/u);
  });

  it('rejects judgment criteria on a non-judgment kind', () => {
    expect(() =>
      createDeclaredValidationCondition(
        validValidationConditionInput({ kind: 'deterministic-check' }),
      ),
    ).toThrow(/carries no judgment criteria/u);
  });
});

describe('deriveValidationPlan (deterministic, typed closed outcome)', () => {
  it('derives a plan-derivable outcome with a content-addressed plan id', async () => {
    const { request, condition } = await fixture();
    const result = await deriveValidationPlan(request, condition, NOW);
    expect(result.outcome).toBe('plan-derivable');
    if (result.outcome !== 'plan-derivable') throw new Error('unreachable');
    expect(result.plan.planId).toMatch(/^vp_[0-9a-f]{32}$/u);
    expect(result.plan.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.plan.requestId).toBe(request.requestId);
    expect(result.plan.evaluationStage.evaluatorKind).toBe('rubric');
    expect(result.plan.verificationStage.verifierMethod).toBe('evidence_provenance_validation');
    expect(result.plan.revisionPolicy.maxRevisionAttempts).toBe(2);
    expect(result.plan.derivation.source).toBe('declared-validation-condition');
    expect(isValidationPlan(result.plan)).toBe(true);
  });

  it('is DETERMINISTIC: identical inputs yield a byte-identical plan', async () => {
    const { request, condition } = await fixture();
    const first = await deriveValidationPlan(request, condition, NOW);
    const second = await deriveValidationPlan(request, condition, NOW);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('never invents a default: an undeclared condition is under-specified', async () => {
    const { request } = await fixture();
    const result = await deriveValidationPlan(request, undefined, NOW);
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') throw new Error('unreachable');
    expect(result.reasons).toEqual(['condition-not-declared']);
  });

  it('reports under-specification with reasons (never a bare boolean)', async () => {
    const { request } = await fixture();
    const broken: DeclaredValidationCondition = {
      conditionVersion: 1,
      kind: 'criteria-threshold',
      requiredEvidenceKinds: [],
      requiredEvidenceClaims: [],
      maxRevisionAttempts: 0,
      revisionWindowMs: 0,
    };
    const result = await deriveValidationPlan(request, broken, NOW);
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') throw new Error('unreachable');
    expect(result.reasons).toContain('missing-criteria-refs');
    expect(result.reasons).toContain('invalid-criteria-threshold');
    expect(result.reasons).toContain('missing-required-evidence');
    expect(result.reasons).toContain('missing-revision-policy');
  });

  it('selects the EV1.0 stage pair per condition kind', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const cases = [
      {
        kind: 'expert-review-approval',
        evaluator: 'expert',
        verifier: 'expert_review',
        fabric: 'evaluation-fabric',
      },
      {
        kind: 'deterministic-check',
        evaluator: 'deterministic-test',
        verifier: 'deterministic_formal_check',
        fabric: 'verification-fabric',
      },
      {
        kind: 'evidence-attestation',
        evaluator: 'deterministic-test',
        verifier: 'evidence_provenance_validation',
        fabric: 'verification-fabric',
      },
    ] as const;
    for (const testCase of cases) {
      const judgment = testCase.kind === 'expert-review-approval';
      const condition = createDeclaredValidationCondition({
        kind: testCase.kind,
        ...(judgment
          ? { criteriaRefs: ['boq-estimation.quantity-takeoff.completeness'], criteriaThreshold: 0.8 }
          : {}),
        requiredEvidenceKinds: ['artifact-ref'],
        requiredEvidenceClaims: ['the claim'],
        maxRevisionAttempts: 2,
        revisionWindowMs: 3_600_000,
      });
      const result = await deriveValidationPlan(request, condition, NOW);
      expect(result.outcome).toBe('plan-derivable');
      if (result.outcome !== 'plan-derivable') throw new Error('unreachable');
      expect(result.plan.evaluationStage.evaluatorKind).toBe(testCase.evaluator);
      expect(result.plan.verificationStage.verifierMethod).toBe(testCase.verifier);
      expect(primaryFabricOf(result.plan)).toBe(testCase.fabric);
    }
  });

  it('carries the EV1.0 mandatory pass/fail/unknown semantics on the verification stage', async () => {
    const { request, condition } = await fixture();
    const result = await deriveValidationPlan(request, condition, NOW);
    if (result.outcome !== 'plan-derivable') throw new Error('unreachable');
    expect(result.plan.verificationStage.passSemantics.length).toBeGreaterThan(0);
    expect(result.plan.verificationStage.failSemantics.length).toBeGreaterThan(0);
    expect(result.plan.verificationStage.unknownSemantics.length).toBeGreaterThan(0);
    expect(result.plan.verificationStage.requiredEvidence).toHaveLength(2);
  });

  it('rejects an invalid derivation timestamp (fail-closed)', async () => {
    const { request, condition } = await fixture();
    await expect(deriveValidationPlan(request, condition, 'not-a-time')).rejects.toThrow(
      /invalid derivation timestamp/u,
    );
  });
});
