/**
 * OPS1.0 promotion tests: positive + adversarial (tier discipline,
 * fail-closed gates, approvals).
 */

import { describe, expect, it } from 'vitest';
import { OPS_ERROR_CODES, OpsError } from './shared.js';
import type { HealthGateEvaluation } from '@arena/deploy';
import { evaluatePromotion, isPromotionPlan } from './promotion.js';
import type { PromotionPlan } from './promotion.js';
import type { ChecklistEvaluation } from './checklist.js';

const DIGEST = 'a'.repeat(64);

function planFor(overrides: Partial<PromotionPlan> = {}): PromotionPlan {
  return {
    planVersion: 1,
    planId: 'plan-test',
    fromTier: 'staging',
    toTier: 'production',
    checklistDigest: DIGEST,
    approvals: ['tech-lead'],
    createdAt: 1_791_232_000_000,
    ...overrides,
  };
}

const GO_CHECKLIST: ChecklistEvaluation = {
  checklistId: 'arena-v1-release-checklist',
  verdict: 'go',
  failedRequiredItems: [],
  advisoryNotes: [],
};

const PASSING_GATES: readonly HealthGateEvaluation[] = [
  {
    gateId: 'gate-console-slo-console-availability',
    sloId: 'slo-console-availability',
    serviceId: 'console',
    requiredVerdict: 'met',
    observedVerdict: 'met',
    passed: true,
  },
];

function failingGate(): readonly HealthGateEvaluation[] {
  return [
    {
      gateId: 'gate-job-orchestrator-slo-job-completion',
      sloId: 'slo-job-completion',
      serviceId: 'job-orchestrator',
      requiredVerdict: 'met',
      observedVerdict: 'breached',
      passed: false,
    },
  ];
}

describe('OPS1.0 promotion — positive', () => {
  it('approves a complete staging→production promotion', () => {
    const decision = evaluatePromotion({
      plan: planFor(),
      checklistEvaluation: GO_CHECKLIST,
      gateEvaluations: PASSING_GATES,
      securityVerdict: 'pass',
    });
    expect(decision.approved).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('accepts a structurally valid plan (isPromotionPlan)', () => {
    expect(isPromotionPlan(planFor())).toBe(true);
  });
});

describe('OPS1.0 promotion — adversarial (fail-closed)', () => {
  it('rejects tier skips (dev→production) with a typed error', () => {
    const plan = planFor({ fromTier: 'dev', toTier: 'production' });
    try {
      evaluatePromotion({
        plan,
        checklistEvaluation: GO_CHECKLIST,
        gateEvaluations: PASSING_GATES,
        securityVerdict: 'pass',
      });
      expect.unreachable('tier skip must throw');
    } catch (error) {
      expect((error as OpsError).code).toBe(OPS_ERROR_CODES.TIER_SKIP);
    }
  });

  it('rejects backward and same-tier promotions (typed error)', () => {
    for (const [from, to] of [
      ['production', 'staging'],
      ['staging', 'staging'],
    ] as const) {
      const plan = planFor({ fromTier: from, toTier: to });
      expect(() =>
        evaluatePromotion({ plan, checklistEvaluation: null, gateEvaluations: null, securityVerdict: null }),
      ).toThrow(OpsError);
    }
  });

  it('rejects an SLO-violating release (breached gate blocks promotion)', () => {
    const decision = evaluatePromotion({
      plan: planFor(),
      checklistEvaluation: GO_CHECKLIST,
      gateEvaluations: failingGate(),
      securityVerdict: 'pass',
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('breached');
  });

  it('fails closed on missing inputs: no checklist / no gates / no security verdict / no approvals', () => {
    const decision = evaluatePromotion({
      plan: planFor({ approvals: [] }),
      checklistEvaluation: null,
      gateEvaluations: null,
      securityVerdict: null,
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons).toHaveLength(4);
  });

  it('no-data gates block: empty gate list is not a pass', () => {
    const decision = evaluatePromotion({
      plan: planFor(),
      checklistEvaluation: GO_CHECKLIST,
      gateEvaluations: [],
      securityVerdict: 'pass',
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('no health-gate evaluations');
  });

  it('no-go checklist blocks promotion', () => {
    const decision = evaluatePromotion({
      plan: planFor(),
      checklistEvaluation: { ...GO_CHECKLIST, verdict: 'no-go', failedRequiredItems: ['performance-suite-green'] },
      gateEvaluations: PASSING_GATES,
      securityVerdict: 'pass',
    });
    expect(decision.approved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('no-go');
  });

  it('unsigned plan (invalid checklist digest) is structurally rejected', () => {
    expect(isPromotionPlan(planFor({ checklistDigest: 'not-a-digest' }))).toBe(false);
  });
});
