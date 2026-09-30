/**
 * Alert rules with CLOSED evaluation semantics (Work Order A035).
 *
 * Alerting is a deterministic, closed state machine — never a free-form
 * expression language:
 *
 *   - every rule pins a CLOSED condition kind (error-budget exhausted,
 *     budget burn rate, metric threshold, log-error ratio, health
 *     status, SLO no-data) with kind-specific REQUIRED parameters;
 *   - evaluation is a PURE function of (rule, inputs, prior state,
 *     now): the same inputs always produce the same verdict — no
 *     randomness, no wall clock (time is injected by the caller);
 *   - state transitions are CLOSED (invalid transitions throw
 *     OBS_INVALID_ALERT_TRANSITION);
 *   - FLAP PROTECTION: a rule that resolves may not re-fire until its
 *     cooldown elapsed (OBS_ALERT_COOLDOWN_ACTIVE); 'pending' requires
 *     the condition to hold continuously for forDurationMs before
 *     firing.
 */

import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import {
  isEnumMember,
  isFiniteNonNegativeNumber,
  isNeutralId,
  isStrictRatio,
  isTelemetryId,
} from './shared.js';
import type {
  AlertSeverity,
  NeutralId,
  ObservabilityTimestamp,
  TelemetryId,
} from './shared.js';
import { ALERT_SEVERITIES } from './shared.js';
import type { SloEvaluation, SloVerdict } from './slo.js';
import { isSloVerdict } from './slo.js';

export const ALERT_RULE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed rule vocabulary
// ---------------------------------------------------------------------------

export const ALERT_CONDITION_KINDS = Object.freeze([
  'slo-error-budget-exhausted',
  'slo-burn-rate',
  'metric-above-threshold',
  'metric-below-threshold',
  'log-error-ratio',
  'health-status-degraded',
  'slo-no-data',
] as const);
export type AlertConditionKind = (typeof ALERT_CONDITION_KINDS)[number];

export function isAlertConditionKind(value: unknown): value is AlertConditionKind {
  return isEnumMember(value, ALERT_CONDITION_KINDS);
}

export const ALERT_STATES = Object.freeze(['inactive', 'pending', 'firing', 'resolved'] as const);
export type AlertStateKind = (typeof ALERT_STATES)[number];

export function isAlertStateKind(value: unknown): value is AlertStateKind {
  return isEnumMember(value, ALERT_STATES);
}

/** Closed, structured evaluation reasons (never free text on the wire). */
export const ALERT_REASON_KINDS = Object.freeze([
  'condition-met',
  'condition-not-met',
  'no-data-fail-closed',
  'cooldown-suppressed',
  'duration-not-elapsed',
  'slo-not-registered',
  'insufficient-input',
] as const);
export type AlertReasonKind = (typeof ALERT_REASON_KINDS)[number];

export function isAlertReasonKind(value: unknown): value is AlertReasonKind {
  return isEnumMember(value, ALERT_REASON_KINDS);
}

// ---------------------------------------------------------------------------
// Rule descriptor (frozen record)
// ---------------------------------------------------------------------------

export interface AlertRule {
  readonly ruleVersion: typeof ALERT_RULE_VERSION;
  readonly ruleId: TelemetryId;
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly condition: AlertConditionKind;
  /** SLO the condition evaluates (REQUIRED for all slo-* conditions). */
  readonly sloId: TelemetryId | null;
  /** Metric the condition evaluates (REQUIRED for metric-* conditions). */
  readonly metricName: NeutralId | null;
  /** Numeric threshold (ratio for burn/log conditions, value for metric conditions). */
  readonly threshold: number | null;
  /** Health status that trips 'health-status-degraded' (inclusive and worse). */
  readonly healthStatus: 'degraded' | 'unhealthy' | 'unknown' | null;
  /** The condition must hold continuously for this long before firing. */
  readonly forDurationMs: number;
  /** A resolved rule may not re-fire until this much time has elapsed (flap protection). */
  readonly cooldownMs: number;
  readonly enabled: boolean;
  readonly description: string | null;
}

export function isAlertRule(value: unknown): value is AlertRule {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['ruleVersion'] !== ALERT_RULE_VERSION) return false;
  if (!isTelemetryId(record['ruleId'])) return false;
  if (!isEnumMember(record['severity'], ALERT_SEVERITIES)) return false;
  if (!isAlertConditionKind(record['condition'])) return false;
  if (typeof record['name'] !== 'string' || record['name'].length === 0) return false;
  if (!isFiniteNonNegativeNumber(record['forDurationMs'])) return false;
  if (!isFiniteNonNegativeNumber(record['cooldownMs'])) return false;
  if (typeof record['enabled'] !== 'boolean') return false;
  return true;
}

/** Validate + freeze a raw value into an AlertRule. */
export function toAlertRule(value: unknown): AlertRule {
  if (typeof value !== 'object' || value === null) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'alert rule must be a JSON object',
    });
  }
  const record = value as Record<string, unknown>;
  if (record['ruleVersion'] !== ALERT_RULE_VERSION) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `unsupported alert rule version: ${String(record['ruleVersion'])} (expected ${String(ALERT_RULE_VERSION)})`,
    });
  }
  if (!isTelemetryId(record['ruleId'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `ruleId must be a telemetry id, got ${JSON.stringify(record['ruleId'])}`,
    });
  }
  if (typeof record['name'] !== 'string' || record['name'].length === 0 || record['name'].length > 256) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'alert rule name must be a non-empty string (<= 256 chars)',
    });
  }
  if (!isEnumMember(record['severity'], ALERT_SEVERITIES)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `severity must be one of ${ALERT_SEVERITIES.join(', ')}, got ${String(record['severity'])}`,
    });
  }
  const condition = record['condition'];
  if (!isAlertConditionKind(condition)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `condition must be one of ${ALERT_CONDITION_KINDS.join(', ')}, got ${String(condition)}`,
    });
  }
  const rule = buildRule(record, condition);
  checkConditionShape(rule);
  return rule;
}

function buildRule(record: Record<string, unknown>, condition: AlertConditionKind): AlertRule {
  const sloId = record['sloId'];
  if (sloId !== null && sloId !== undefined && !isTelemetryId(sloId)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `sloId must be a telemetry id or null, got ${JSON.stringify(sloId)}`,
    });
  }
  const metricName = record['metricName'];
  if (metricName !== null && metricName !== undefined && !isNeutralId(metricName)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `metricName must be a neutral id or null, got ${JSON.stringify(metricName)}`,
    });
  }
  const threshold = record['threshold'];
  if (threshold !== null && threshold !== undefined && typeof threshold !== 'number') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'threshold must be a number or null',
    });
  }
  const healthStatus = record['healthStatus'];
  if (
    healthStatus !== null &&
    healthStatus !== undefined &&
    !isEnumMember(healthStatus, ['degraded', 'unhealthy', 'unknown'] as const)
  ) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `healthStatus must be one of degraded, unhealthy, unknown — got ${String(healthStatus)}`,
    });
  }
  const forDurationMs = record['forDurationMs'];
  if (typeof forDurationMs !== 'number' || !Number.isSafeInteger(forDurationMs) || forDurationMs < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `forDurationMs must be a non-negative integer, got ${String(forDurationMs)}`,
    });
  }
  const cooldownMs = record['cooldownMs'];
  if (typeof cooldownMs !== 'number' || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `cooldownMs must be a non-negative integer, got ${String(cooldownMs)}`,
    });
  }
  if (typeof record['enabled'] !== 'boolean') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'enabled must be a boolean',
    });
  }
  const description = record['description'];
  if (description !== null && description !== undefined && typeof description !== 'string') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'description must be a string or null',
    });
  }
  return Object.freeze({
    ruleVersion: ALERT_RULE_VERSION,
    ruleId: record['ruleId'] as TelemetryId,
    name: record['name'] as string,
    severity: record['severity'] as AlertSeverity,
    condition,
    sloId: (sloId ?? null) as TelemetryId | null,
    metricName: (metricName ?? null) as NeutralId | null,
    threshold: (threshold ?? null) as number | null,
    healthStatus: (healthStatus ?? null) as AlertRule['healthStatus'],
    forDurationMs,
    cooldownMs,
    enabled: record['enabled'] as boolean,
    description: (description ?? null) as string | null,
  });
}

/** Kind-specific REQUIRED parameters (closed semantics, fail-closed). */
function checkConditionShape(rule: AlertRule): void {
  const needsSlo = rule.condition.startsWith('slo-');
  if (needsSlo && rule.sloId === null) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `condition ${rule.condition} requires sloId`,
    });
  }
  if (!needsSlo && rule.sloId !== null) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `condition ${rule.condition} must not carry sloId`,
    });
  }
  switch (rule.condition) {
    case 'slo-error-budget-exhausted':
    case 'slo-no-data':
      if (rule.metricName !== null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: `condition ${rule.condition} must not carry metricName`,
        });
      }
      break;
    case 'slo-burn-rate':
      if (rule.threshold === null || rule.threshold <= 0) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'slo-burn-rate requires a positive burn threshold (ratio of budget consumed)',
        });
      }
      if (rule.metricName !== null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'condition slo-burn-rate must not carry metricName',
        });
      }
      break;
    case 'metric-above-threshold':
    case 'metric-below-threshold':
      if (rule.metricName === null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: `condition ${rule.condition} requires metricName`,
        });
      }
      if (rule.threshold === null || !Number.isFinite(rule.threshold)) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: `condition ${rule.condition} requires a finite numeric threshold`,
        });
      }
      break;
    case 'log-error-ratio':
      if (rule.threshold === null || !isStrictRatio(rule.threshold)) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'log-error-ratio requires a threshold strictly within (0, 1)',
        });
      }
      if (rule.metricName !== null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'condition log-error-ratio must not carry metricName',
        });
      }
      break;
    case 'health-status-degraded':
      if (rule.healthStatus === null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'health-status-degraded requires healthStatus (inclusive trip level)',
        });
      }
      if (rule.metricName !== null || rule.threshold !== null) {
        throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
          message: 'condition health-status-degraded carries no metricName/threshold',
        });
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Rule state + deterministic evaluation
// ---------------------------------------------------------------------------

/** The mutable-by-transition-only state of one alert rule. */
export interface AlertRuleState {
  readonly ruleId: TelemetryId;
  readonly state: AlertStateKind;
  /** When the current state was entered (epoch ms). */
  readonly since: ObservabilityTimestamp;
  /** When the rule last resolved (for cooldown), or null if never. */
  readonly lastResolvedAt: ObservabilityTimestamp | null;
}

export function initialAlertRuleState(
  ruleId: string,
  now: number,
): AlertRuleState {
  if (!isTelemetryId(ruleId)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `ruleId must be a telemetry id, got ${JSON.stringify(ruleId)}`,
    });
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `now must be an epoch-ms integer >= 0, got ${String(now)}`,
    });
  }
  return Object.freeze({
    ruleId,
    state: 'inactive' as AlertStateKind,
    since: now as ObservabilityTimestamp,
    lastResolvedAt: null,
  });
}

/** Inputs one evaluation may consume (all optional; closed per condition kind). */
export interface AlertEvaluationInput {
  /** Latest SLO evaluation for the rule's sloId (slo-* conditions). */
  readonly sloEvaluation: SloEvaluation | null;
  /** Latest aggregate health status (health-status-degraded condition). */
  readonly healthStatus: 'degraded' | 'unhealthy' | 'unknown' | null;
  /** Latest value of the rule's metric (metric-* conditions). */
  readonly metricValue: number | null;
  /** Latest observed log-error ratio (log-error-ratio condition). */
  readonly logErrorRatio: number | null;
}

/** The deterministic verdict of one alert-rule evaluation (frozen). */
export interface AlertEvaluation {
  readonly ruleId: TelemetryId;
  readonly severity: AlertSeverity;
  readonly evaluatedAt: ObservabilityTimestamp;
  readonly conditionMet: boolean;
  readonly state: AlertStateKind;
  readonly reason: {
    readonly kind: AlertReasonKind;
    readonly detail: string;
  };
  readonly stateChanged: boolean;
}

export interface EvaluateAlertInput {
  readonly rule: AlertRule;
  readonly priorState: AlertRuleState;
  /** Injected evaluation time (epoch ms). */
  readonly now: number;
  readonly input: AlertEvaluationInput;
}

/**
 * Evaluate one rule DETERMINISTICALLY. Purity: identical (rule, priorState,
 * now, input) → identical verdict. Flap protection: a 'resolved' rule
 * whose cooldown has not elapsed cannot leave 'resolved'
 * (reason 'cooldown-suppressed').
 */
export function evaluateAlertRule(input: EvaluateAlertInput): AlertEvaluation {
  const { rule, priorState, now, input: evaluationInput } = input;
  if (!isAlertRule(rule)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: 'alert evaluation requires a structurally valid rule',
    });
  }
  if (priorState.ruleId !== rule.ruleId) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
      message: `prior state belongs to rule ${priorState.ruleId}, not ${rule.ruleId}`,
    });
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `now must be an epoch-ms integer >= 0, got ${String(now)}`,
    });
  }
  if (priorState.since > now) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `prior state since (${String(priorState.since)}) is in the future relative to now (${String(now)})`,
    });
  }

  const { met, reasonKind, detail } = assessCondition(rule, evaluationInput);

  if (!rule.enabled) {
    return verdict(rule, priorState, now, false, 'inactive', 'condition-not-met', 'rule disabled', false);
  }

  // Cooldown flap guard: resolved rules stay resolved until cooldown elapses.
  if (priorState.state === 'resolved' && priorState.lastResolvedAt !== null) {
    const cooldownElapsed = now - priorState.lastResolvedAt >= rule.cooldownMs;
    if (met && !cooldownElapsed && rule.cooldownMs > 0) {
      return verdict(rule, priorState, now, false, 'resolved', 'cooldown-suppressed', `condition met but cooldown ${String(rule.cooldownMs)}ms has not elapsed since ${String(priorState.lastResolvedAt)} (flap suppressed)`, false);
    }
  }

  switch (priorState.state) {
    case 'inactive':
    case 'resolved': {
      if (!met) {
        return verdict(rule, priorState, now, false, priorState.state === 'resolved' ? 'resolved' : 'inactive', reasonKind, detail, false);
      }
      if (rule.forDurationMs > 0 && now - priorState.since < rule.forDurationMs) {
        return verdict(rule, priorState, now, true, 'pending', 'duration-not-elapsed', `condition holds but forDurationMs ${String(rule.forDurationMs)}ms not yet elapsed (needs to hold continuously)`, true);
      }
      return verdict(rule, priorState, now, true, 'firing', reasonKind, detail, true);
    }
    case 'pending': {
      if (!met) {
        return verdict(rule, priorState, now, false, 'inactive', reasonKind, `condition stopped holding while pending: ${detail}`, true);
      }
      if (now - priorState.since < rule.forDurationMs) {
        return verdict(rule, priorState, now, true, 'pending', 'duration-not-elapsed', `condition holds continuously since ${String(priorState.since)}; forDurationMs ${String(rule.forDurationMs)}ms not yet elapsed`, false);
      }
      return verdict(rule, priorState, now, true, 'firing', reasonKind, `condition held continuously for ${String(now - priorState.since)}ms >= forDurationMs ${String(rule.forDurationMs)}ms`, true);
    }
    case 'firing': {
      if (met) {
        return verdict(rule, priorState, now, true, 'firing', 'condition-met', detail, false);
      }
      return verdict(rule, priorState, now, false, 'resolved', reasonKind, `condition stopped holding after firing: ${detail}`, true);
    }
  }
}

function assessCondition(
  rule: AlertRule,
  input: AlertEvaluationInput,
): { met: boolean; reasonKind: AlertReasonKind; detail: string } {
  switch (rule.condition) {
    case 'slo-error-budget-exhausted': {
      if (input.sloEvaluation === null) {
        return { met: false, reasonKind: 'slo-not-registered', detail: 'no SLO evaluation available for the rule (fail-closed: not met, surfaced as insufficient input)' };
      }
      const exhausted = input.sloEvaluation.errorBudget.exhausted;
      return {
        met: exhausted,
        reasonKind: exhausted ? 'condition-met' : 'condition-not-met',
        detail: `error budget consumed ${input.sloEvaluation.errorBudget.consumedRatio.toFixed(4)} (exhausted: ${String(exhausted)})`,
      };
    }
    case 'slo-burn-rate': {
      if (input.sloEvaluation === null) {
        return { met: false, reasonKind: 'slo-not-registered', detail: 'no SLO evaluation available for the rule' };
      }
      const burn = input.sloEvaluation.errorBudget.consumedRatio;
      const met = burn >= (rule.threshold as number);
      return {
        met,
        reasonKind: met ? 'condition-met' : 'condition-not-met',
        detail: `budget consumption ${burn.toFixed(4)} vs burn threshold ${String(rule.threshold)}`,
      };
    }
    case 'slo-no-data': {
      if (input.sloEvaluation === null) {
        return { met: false, reasonKind: 'slo-not-registered', detail: 'no SLO evaluation available for the rule' };
      }
      const noData = input.sloEvaluation.verdict === 'no-data';
      return {
        met: noData,
        reasonKind: noData ? 'no-data-fail-closed' : 'condition-not-met',
        detail: `SLO verdict ${input.sloEvaluation.verdict} with ${String(input.sloEvaluation.sampleCount)} samples in the window (no-data fails closed)`,
      };
    }
    case 'metric-above-threshold': {
      if (input.metricValue === null) {
        return { met: false, reasonKind: 'insufficient-input', detail: 'no metric value available (fail-closed)' };
      }
      const met = input.metricValue > (rule.threshold as number);
      return {
        met,
        reasonKind: met ? 'condition-met' : 'condition-not-met',
        detail: `metric ${rule.metricName} = ${String(input.metricValue)} vs threshold ${String(rule.threshold)}`,
      };
    }
    case 'metric-below-threshold': {
      if (input.metricValue === null) {
        return { met: false, reasonKind: 'insufficient-input', detail: 'no metric value available (fail-closed)' };
      }
      const met = input.metricValue < (rule.threshold as number);
      return {
        met,
        reasonKind: met ? 'condition-met' : 'condition-not-met',
        detail: `metric ${rule.metricName} = ${String(input.metricValue)} vs threshold ${String(rule.threshold)}`,
      };
    }
    case 'log-error-ratio': {
      if (input.logErrorRatio === null) {
        return { met: false, reasonKind: 'insufficient-input', detail: 'no log-error ratio available (fail-closed)' };
      }
      const met = input.logErrorRatio >= (rule.threshold as number);
      return {
        met,
        reasonKind: met ? 'condition-met' : 'condition-not-met',
        detail: `log-error ratio ${input.logErrorRatio.toFixed(4)} vs threshold ${String(rule.threshold)}`,
      };
    }
    case 'health-status-degraded': {
      if (input.healthStatus === null) {
        return { met: false, reasonKind: 'insufficient-input', detail: 'no health status available (missing component reports as unknown; fail-closed)' };
      }
      const met = healthAtOrBeyond(input.healthStatus, rule.healthStatus as 'degraded' | 'unhealthy' | 'unknown');
      return {
        met,
        reasonKind: met ? 'condition-met' : 'condition-not-met',
        detail: `health ${input.healthStatus} vs trip level ${String(rule.healthStatus)} (inclusive)`,
      };
    }
  }
}

const HEALTH_RANK: Readonly<Record<'degraded' | 'unhealthy' | 'unknown', number>> = {
  degraded: 1,
  unknown: 2,
  unhealthy: 3,
};

function healthAtOrBeyond(
  status: 'degraded' | 'unhealthy' | 'unknown',
  level: 'degraded' | 'unhealthy' | 'unknown',
): boolean {
  return HEALTH_RANK[status] >= HEALTH_RANK[level];
}

function verdict(
  rule: AlertRule,
  priorState: AlertRuleState,
  now: number,
  conditionMet: boolean,
  state: AlertStateKind,
  reasonKind: AlertReasonKind,
  detail: string,
  stateChanged: boolean,
): AlertEvaluation {
  return Object.freeze({
    ruleId: rule.ruleId,
    severity: rule.severity,
    evaluatedAt: now as ObservabilityTimestamp,
    conditionMet,
    state,
    reason: Object.freeze({ kind: reasonKind, detail }),
    stateChanged,
  });
}

/**
 * Derive the next persisted state from an evaluation (the only legal way
 * to advance rule state; invalid transitions throw).
 */
export function alertStateAfter(
  priorState: AlertRuleState,
  evaluation: AlertEvaluation,
): AlertRuleState {
  if (priorState.ruleId !== evaluation.ruleId) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_TRANSITION, {
      message: `evaluation belongs to rule ${evaluation.ruleId}, not ${priorState.ruleId}`,
    });
  }
  const legal: Readonly<Record<AlertStateKind, readonly AlertStateKind[]>> = {
    inactive: ['inactive', 'pending', 'firing'],
    pending: ['pending', 'firing', 'inactive', 'resolved'],
    firing: ['firing', 'resolved'],
    resolved: ['resolved', 'inactive', 'pending', 'firing'],
  };
  const allowed = legal[priorState.state];
  if (!allowed.includes(evaluation.state)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_TRANSITION, {
      message: `alert state ${priorState.state} cannot transition to ${evaluation.state} (allowed: ${allowed.join(', ')})`,
      details: { from: priorState.state, to: evaluation.state },
    });
  }
  const resolvedNow = evaluation.state === 'resolved' && priorState.state === 'firing';
  return Object.freeze({
    ruleId: evaluation.ruleId,
    state: evaluation.state,
    // `since` advances ONLY on real transitions: the "condition held
    // continuously" clock keeps running while the state is unchanged.
    since: evaluation.stateChanged ? evaluation.evaluatedAt : priorState.since,
    lastResolvedAt: resolvedNow ? evaluation.evaluatedAt : priorState.lastResolvedAt,
  });
}

/** Severity ranking for rollups (higher = more severe). */
export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

/** Worst-of rollup over evaluations with a firing state. */
export function worstFiringSeverity(evaluations: readonly AlertEvaluation[]): AlertSeverity | null {
  let worst: AlertSeverity | null = null;
  for (const evaluation of evaluations) {
    if (evaluation.state !== 'firing') continue;
    if (worst === null || SEVERITY_RANK[evaluation.severity] > SEVERITY_RANK[worst]) {
      worst = evaluation.severity;
    }
  }
  return worst;
}

/** Narrow a raw SLO verdict into the alert health vocabulary. */
export function alertHealthFromSloVerdict(verdict: SloVerdict): 'degraded' | 'unhealthy' | 'unknown' {
  if (!isSloVerdict(verdict)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: `unknown SLO verdict: ${String(verdict)}`,
    });
  }
  switch (verdict) {
    case 'met':
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
        message: "verdict 'met' maps to healthy — not part of the alert trip vocabulary",
      });
    case 'at-risk':
      return 'degraded';
    case 'breached':
      return 'unhealthy';
    case 'no-data':
      return 'unknown';
  }
}
