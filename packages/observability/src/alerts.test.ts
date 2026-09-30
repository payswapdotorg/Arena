/**
 * Alert-rule evaluation tests (Work Order A035): positive + adversarial
 * (closed semantics, state machine, flap protection, determinism).
 */

import { describe, expect, it } from 'vitest';
import {
  alertStateAfter,
  evaluateAlertRule,
  initialAlertRuleState,
  toAlertRule,
  worstFiringSeverity,
} from './alerts.js';
import type { AlertRule } from './alerts.js';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import { evaluateSlo } from './slo.js';
import type { EvaluationWindow } from './slo.js';
import { alertRule, metricSignal, sloDefinition, windowOf } from './test-support.js';
import type { AlertEvaluation, AlertRuleState } from './alerts.js';

function errorOf(fn: () => unknown): ObservabilityError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ObservabilityError) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

const WINDOW_MS = 3_600_000;
const WINDOW: EvaluationWindow = windowOf(WINDOW_MS);

function sloEvaluationFor(overrides: { bad: number; count: number; target?: number }) {
  const definition = sloDefinition({
    targetRatio: overrides.target ?? 0.99,
    minSampleCount: 1,
    windowMs: WINDOW_MS,
  });
  const samples = [];
  for (let i = 0; i < overrides.count; i++) {
    samples.push(
      metricSignal({
        sequence: i + 1,
        occurredAt: WINDOW.windowStart + i * 1_000,
        value: i < overrides.count - overrides.bad ? 1 : 0,
      }),
    );
  }
  return evaluateSlo({ definition, window: WINDOW, samples });
}

describe('alert rule descriptors', () => {
  it('validates structurally valid rules of every condition kind (positive)', () => {
    for (const condition of [
      'slo-error-budget-exhausted',
      'slo-burn-rate',
      'slo-no-data',
      'metric-above-threshold',
      'metric-below-threshold',
      'log-error-ratio',
      'health-status-degraded',
    ]) {
      const rule = alertRule({ condition });
      const round = toAlertRule(JSON.parse(JSON.stringify(rule)));
      expect(round).toEqual(rule);
      expect(Object.isFrozen(round)).toBe(true);
    }
  });

  it('rejects unknown condition kinds / severities (adversarial)', () => {
    expect(errorOf(() => toAlertRule({ ...alertRule(), condition: 'anomaly-detected' })).code).toBe(
      OBS_ERROR_CODES.INVALID_ALERT_RULE,
    );
    expect(errorOf(() => toAlertRule({ ...alertRule(), severity: 'sev1' })).code).toBe(
      OBS_ERROR_CODES.INVALID_ALERT_RULE,
    );
  });

  it('enforces kind-specific REQUIRED parameters, fail-closed (adversarial)', () => {
    expect(
      errorOf(() => toAlertRule({ ...alertRule(), condition: 'slo-burn-rate', sloId: null })).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() => toAlertRule({ ...alertRule(), condition: 'slo-burn-rate', threshold: null })).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() =>
        toAlertRule({ ...alertRule(), condition: 'metric-above-threshold', metricName: null }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() =>
        toAlertRule({ ...alertRule(), condition: 'metric-above-threshold', threshold: null }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() => toAlertRule({ ...alertRule(), condition: 'log-error-ratio', threshold: 2 })).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() =>
        toAlertRule({ ...alertRule(), condition: 'health-status-degraded', healthStatus: null }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    // Foreign parameters are rejected too:
    expect(
      errorOf(() =>
        toAlertRule({ ...alertRule(), condition: 'slo-no-data', metricName: 'some-metric' }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
    expect(
      errorOf(() =>
        toAlertRule({ ...alertRule({ condition: 'metric-above-threshold' }), sloId: 'slo-x' }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
  });
});

describe('alert evaluation semantics', () => {
  it('fires when the SLO error budget is exhausted (positive)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted' });
    const state = initialAlertRuleState(rule.ruleId, 1_000);
    const evaluation = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: sloEvaluationFor({ count: 100, bad: 5 }), healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('firing');
    expect(evaluation.conditionMet).toBe(true);
    expect(evaluation.reason.kind).toBe('condition-met');
  });

  it('stays inactive while the budget is intact (positive)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted' });
    const state = initialAlertRuleState(rule.ruleId, 1_000);
    const evaluation = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: sloEvaluationFor({ count: 100, bad: 0 }), healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('inactive');
    expect(evaluation.stateChanged).toBe(false);
  });

  it('FAILS CLOSED on no-data SLO verdicts via the dedicated condition (adversarial)', () => {
    const rule = alertRule({ condition: 'slo-no-data' });
    const state = initialAlertRuleState(rule.ruleId, 1_000);
    const noData = sloEvaluationFor({ count: 0, bad: 0 });
    expect(noData.verdict).toBe('no-data');
    const evaluation = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: noData, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('firing');
    expect(evaluation.reason.kind).toBe('no-data-fail-closed');
  });

  it('missing inputs are surfaced as insufficient-input and never fire (adversarial)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted' });
    const state = initialAlertRuleState(rule.ruleId, 1_000);
    const evaluation = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('inactive');
    expect(evaluation.reason.kind).toBe('slo-not-registered');
  });

  it('pending requires the condition to hold for forDurationMs (positive)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted', forDurationMs: 5_000 });
    let state = initialAlertRuleState(rule.ruleId, 1_000);
    const budgetExhausted = sloEvaluationFor({ count: 100, bad: 5 });
    const first = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(first.state).toBe('pending');
    state = alertStateAfter(state, first);
    const second = evaluateAlertRule({
      rule,
      priorState: state,
      now: 6_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(second.state).toBe('pending');
    expect(second.reason.kind).toBe('duration-not-elapsed');
    const third = evaluateAlertRule({
      rule,
      priorState: alertStateAfter(state, second),
      now: 7_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(third.state).toBe('firing');
  });

  it('firing resolves when the condition stops holding (positive)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted' });
    let state = initialAlertRuleState(rule.ruleId, 1_000);
    const firing = evaluateAlertRule({
      rule,
      priorState: state,
      now: 2_000,
      input: { sloEvaluation: sloEvaluationFor({ count: 100, bad: 5 }), healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    state = alertStateAfter(state, firing);
    expect(state.state).toBe('firing');
    const resolved = evaluateAlertRule({
      rule,
      priorState: state,
      now: 3_000,
      input: { sloEvaluation: sloEvaluationFor({ count: 100, bad: 0 }), healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(resolved.state).toBe('resolved');
    const after = alertStateAfter(state, resolved);
    expect(after.state).toBe('resolved');
    expect(after.lastResolvedAt).toBe(3_000);
  });

  it('FLAP PROTECTION: a resolved rule cannot re-fire within cooldownMs (adversarial)', () => {
    const rule = alertRule({ condition: 'slo-error-budget-exhausted', cooldownMs: 10_000 });
    let state = initialAlertRuleState(rule.ruleId, 1_000);
    const budgetExhausted = sloEvaluationFor({ count: 100, bad: 5 });
    // fire
    const firing = evaluateAlertRule({
      rule, priorState: state, now: 2_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    state = alertStateAfter(state, firing);
    // resolve
    const resolved = evaluateAlertRule({
      rule, priorState: state, now: 3_000,
      input: { sloEvaluation: sloEvaluationFor({ count: 100, bad: 0 }), healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    state = alertStateAfter(state, resolved);
    // condition returns IMMEDIATELY (flap attempt)
    const flap = evaluateAlertRule({
      rule, priorState: state, now: 4_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(flap.state).toBe('resolved');
    expect(flap.reason.kind).toBe('cooldown-suppressed');
    expect(flap.conditionMet).toBe(false);
    // after cooldown elapses the rule may fire again
    const refire = evaluateAlertRule({
      rule, priorState: alertStateAfter(state, flap), now: 13_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    expect(refire.state).toBe('firing');
  });

  it('metric/log/health conditions evaluate against their inputs (positive)', () => {
    const metricRule = alertRule({ condition: 'metric-above-threshold', threshold: 10 });
    let evaluation = evaluateAlertRule({
      rule: metricRule,
      priorState: initialAlertRuleState(metricRule.ruleId, 1_000),
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: null, metricValue: 11, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('firing');
    evaluation = evaluateAlertRule({
      rule: metricRule,
      priorState: initialAlertRuleState(metricRule.ruleId, 1_000),
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: null, metricValue: 10, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('inactive');

    const logRule = alertRule({ condition: 'log-error-ratio', threshold: 0.05 });
    evaluation = evaluateAlertRule({
      rule: logRule,
      priorState: initialAlertRuleState(logRule.ruleId, 1_000),
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: null, metricValue: null, logErrorRatio: 0.06 },
    });
    expect(evaluation.state).toBe('firing');

    const healthRule = alertRule({ condition: 'health-status-degraded', healthStatus: 'degraded' });
    evaluation = evaluateAlertRule({
      rule: healthRule,
      priorState: initialAlertRuleState(healthRule.ruleId, 1_000),
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: 'unhealthy', metricValue: null, logErrorRatio: null },
    });
    expect(evaluation.state).toBe('firing');
    evaluation = evaluateAlertRule({
      rule: healthRule,
      priorState: initialAlertRuleState(healthRule.ruleId, 1_000),
      now: 2_000,
      input: { sloEvaluation: null, healthStatus: null, metricValue: null, logErrorRatio: null },
    });
    // 'healthy' is not part of the alert trip vocabulary — a healthy
    // status is expressed as a null trip status via the service layer.
    expect(evaluation.state).toBe('inactive');
  });

  it('DETERMINISM: identical inputs produce identical verdicts (positive property)', () => {
    const rule = alertRule({ condition: 'slo-burn-rate', threshold: 0.5, forDurationMs: 100 });
    const budgetExhausted = sloEvaluationFor({ count: 200, bad: 2 }); // burn 1.0
    const state = initialAlertRuleState(rule.ruleId, 1_000);
    const inputs = {
      rule,
      priorState: state,
      now: 5_000,
      input: { sloEvaluation: budgetExhausted, healthStatus: null, metricValue: null, logErrorRatio: null },
    };
    expect(evaluateAlertRule(inputs)).toEqual(evaluateAlertRule(inputs));
  });

  it('rejects future prior-states and mismatched rule ids (adversarial)', () => {
    const rule = alertRule({});
    const future = {
      ruleId: rule.ruleId,
      state: 'inactive' as const,
      since: 9_000 as Parameters<typeof evaluateAlertRule>[0]['priorState']['since'],
      lastResolvedAt: null,
    };
    expect(
      errorOf(() =>
        evaluateAlertRule({ rule, priorState: future, now: 2_000, input: { sloEvaluation: null, healthStatus: null, metricValue: null, logErrorRatio: null } }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_TIMESTAMP);
    const foreign = initialAlertRuleState('other-rule', 1_000);
    expect(
      errorOf(() =>
        evaluateAlertRule({ rule, priorState: foreign, now: 2_000, input: { sloEvaluation: null, healthStatus: null, metricValue: null, logErrorRatio: null } }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_ALERT_RULE);
  });
});

describe('alert state transitions', () => {
  it('rejects illegal transitions (adversarial)', () => {
    const rule: AlertRule = alertRule({});
    const firing = {
      ruleId: rule.ruleId,
      state: 'firing' as const,
      since: 1_000 as AlertRuleState['since'],
      lastResolvedAt: null,
    };
    // firing -> pending is illegal
    const pendingVerdict: AlertEvaluation = {
      ruleId: rule.ruleId,
      severity: rule.severity,
      evaluatedAt: 2_000 as AlertEvaluation['evaluatedAt'],
      conditionMet: true,
      state: 'pending',
      reason: { kind: 'condition-met', detail: 'x' },
      stateChanged: true,
    };
    expect(errorOf(() => alertStateAfter(firing, pendingVerdict)).code).toBe(
      OBS_ERROR_CODES.INVALID_ALERT_TRANSITION,
    );
  });

  it('rolls up the worst firing severity (positive)', () => {
    const critical = alertRule({ severity: 'critical' });
    const low = alertRule({ severity: 'low' });
    const firingCritical = {
      ruleId: critical.ruleId, severity: critical.severity, evaluatedAt: 1 as AlertEvaluation['evaluatedAt'],
      conditionMet: true, state: 'firing' as const, reason: { kind: 'condition-met' as const, detail: '' }, stateChanged: true,
    };
    const resolvedLow = {
      ruleId: low.ruleId, severity: low.severity, evaluatedAt: 1 as AlertEvaluation['evaluatedAt'],
      conditionMet: false, state: 'resolved' as const, reason: { kind: 'condition-not-met' as const, detail: '' }, stateChanged: true,
    };
    expect(worstFiringSeverity([resolvedLow, firingCritical])).toBe('critical');
    expect(worstFiringSeverity([resolvedLow])).toBe(null);
  });
});
