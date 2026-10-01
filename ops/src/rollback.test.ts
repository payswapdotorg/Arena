/**
 * OPS1.0 rollback tests: positive + adversarial (A035 error-budget
 * trigger semantics, zero-budget freeze rule).
 */

import { describe, expect, it } from 'vitest';
import type { SloEvaluation, SloVerdict } from '@arena/observability';
import { toTelemetryId } from '@arena/observability';
import { evaluateRollbackTrigger, isRollbackPolicy } from './rollback.js';
import { buildReferenceRollbackPolicy, rollbackPolicyDigest } from './reference.js';
import type { RollbackPolicy } from './rollback.js';

function evaluationFor(
  sloId: string,
  verdict: SloVerdict,
  overrides: { badCount?: number; exhausted?: boolean; achieved?: number } = {},
): SloEvaluation {
  const bad = overrides.badCount ?? 0;
  const total = 120;
  return {
    sloId: toTelemetryId(sloId),
    windowStart: 0 as never,
    windowEnd: 86_400_000 as never,
    sampleCount: total,
    goodCount: total - bad,
    badCount: bad,
    achievedRatio: (total - bad) / total,
    targetRatio: 0.9999,
    errorBudget: {
      allowedBadRatio: 0.0001,
      observedBadRatio: bad / total,
      consumedRatio: overrides.exhausted === true ? 1 : bad / total / 0.0001 > 1 ? 1 : bad / total / 0.0001,
      remainingRatio: 0,
      exhausted: overrides.exhausted ?? false,
    },
    verdict,
  };
}

const BASE_POLICY: RollbackPolicy = {
  policyVersion: 1,
  policyId: 'rollback-test',
  zeroBudgetSloIds: ['slo-environment-isolation'],
  targetTopologyId: 'arena-v1-production',
  steps: ['freeze', 'page', 'restore'],
};

describe('OPS1.0 rollback — positive', () => {
  it('no rollback required when all SLOs are met with clean budgets', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-environment-isolation', 'met'),
      evaluationFor('slo-job-completion', 'met'),
    ]);
    expect(decision.required).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('the reference rollback policy is valid, deterministic and cites the A035 freeze SLOs', async () => {
    const policy = await buildReferenceRollbackPolicy();
    expect(isRollbackPolicy(policy)).toBe(true);
    expect(policy.zeroBudgetSloIds).toContain('slo-environment-isolation');
    expect(policy.steps.length).toBeGreaterThanOrEqual(5);
    expect(await rollbackPolicyDigest()).toBe(await rollbackPolicyDigest());
  });
});

describe('OPS1.0 rollback — adversarial (A035 policy triggers)', () => {
  it('breached SLO forces rollback', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-job-completion', 'breached', { achieved: 0.9 }),
    ]);
    expect(decision.required).toBe(true);
    expect(decision.reasons.join(' ')).toContain('breached');
  });

  it('no-data forces rollback (missing telemetry is an incident)', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-job-completion', 'no-data'),
    ]);
    expect(decision.required).toBe(true);
    expect(decision.reasons.join(' ')).toContain('no-data');
  });

  it('exhausted error budget forces rollback', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-job-completion', 'at-risk', { exhausted: true }),
    ]);
    expect(decision.required).toBe(true);
    expect(decision.reasons.join(' ')).toContain('exhausted');
  });

  it('zero-budget SLO: a single bad event triggers the freeze rule', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-environment-isolation', 'at-risk', { badCount: 1 }),
    ]);
    expect(decision.required).toBe(true);
    expect(decision.reasons.join(' ')).toContain('freeze rule');
  });

  it('zero-budget SLO with NO evaluation triggers fail-closed', () => {
    const decision = evaluateRollbackTrigger(BASE_POLICY, [
      evaluationFor('slo-job-completion', 'met'),
    ]);
    expect(decision.required).toBe(true);
    expect(decision.reasons.join(' ')).toContain('NO evaluation');
  });

  it('a structurally invalid policy is rejected', () => {
    expect(
      isRollbackPolicy({ ...BASE_POLICY, policyVersion: 2 }),
    ).toBe(false);
  });
});
