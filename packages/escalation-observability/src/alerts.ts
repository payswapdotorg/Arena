/**
 * Alert-rule PROJECTIONS (Work Order C021; issue #127).
 *
 * A MAPPING SURFACE — the alert catalog itself is A035-owned and NOT
 * editable here (docs/operations/alert-catalog.md). This file maps
 * escalation breach / at-risk conditions onto the catalog's CLOSED
 * condition vocabulary so the A035 engine can evaluate them:
 *
 *   - an SLA breach maps to `metric-above-threshold` on the projected
 *     `escalation-sla-breached-count` metric (severity by urgency
 *     class — critical urgency maps high);
 *   - an SLO no-data verdict maps to `slo-no-data` on the projected
 *     escalation SLO ids (missing telemetry is an incident, not a pass
 *     — the docs/operations/slo-targets.md posture);
 *   - validation backlog maps to `metric-above-threshold` on the
 *     projected `escalation-validation-backlog` metric.
 *
 * Every projected rule carries its catalog ancestry (the condition
 * kind + semantics it maps onto) and DETERMINISTIC evaluation inputs —
 * identical health/SLA/SLO inputs project identical rules.
 */

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';
import { deepFreeze, isEnumMember, toProjectionTimestamp, toTenantScope } from './shared.js';
import type { MeasuredSlaState } from './sla.js';

/** Wire version of the alert-rule projection shapes. */
export const ALERT_PROJECTION_VERSION = 1 as const;

/**
 * The closed condition vocabulary of the A035 catalog this surface maps
 * onto (docs/operations/alert-catalog.md — cited, never edited).
 */
export const CATALOG_CONDITION_KINDS = Object.freeze([
  'slo-error-budget-exhausted',
  'slo-burn-rate',
  'metric-above-threshold',
  'metric-below-threshold',
  'log-error-ratio',
  'health-status-degraded',
  'slo-no-data',
] as const);
export type CatalogConditionKind = (typeof CATALOG_CONDITION_KINDS)[number];

/** The closed severity vocabulary (A035). */
export const ALERT_SEVERITIES = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
] as const);
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export function isAlertSeverity(value: unknown): value is AlertSeverity {
  return isEnumMember(value, ALERT_SEVERITIES);
}

/** A projected alert rule (a MAPPING record, not a firing alert). */
export interface ProjectedAlertRule {
  readonly projectionVersion: typeof ALERT_PROJECTION_VERSION;
  readonly ruleId: string;
  readonly tenant: string;
  /** The catalog condition kind this escalation condition maps onto. */
  readonly conditionKind: CatalogConditionKind;
  /** The projected metric / SLO the condition evaluates over. */
  readonly metricName: string | null;
  readonly sloId: string | null;
  readonly threshold: number | null;
  readonly severity: AlertSeverity;
  /** The escalation condition that produced this mapping (machine-readable). */
  readonly escalationCondition:
    | 'sla-clock-breached'
    | 'sla-clocks-at-risk'
    | 'slo-no-data'
    | 'validation-backlog-above-threshold';
  /** Catalog ancestry (cited, rendered verbatim). */
  readonly catalogAncestry: string;
  readonly projectedAt: string;
}

/** The closed escalation-condition vocabulary. */
export const ESCALATION_ALERT_CONDITIONS = Object.freeze([
  'sla-clock-breached',
  'sla-clocks-at-risk',
  'slo-no-data',
  'validation-backlog-above-threshold',
] as const);
export type EscalationAlertCondition = (typeof ESCALATION_ALERT_CONDITIONS)[number];

const SEVERITY_BY_URGENCY: Readonly<Record<string, AlertSeverity>> = Object.freeze({
  routine: 'medium',
  priority: 'medium',
  urgent: 'high',
  critical: 'high',
});

export interface ProjectSlaAlertRulesInput {
  readonly tenant: string;
  /** Measured SLA states per (requestId, clock). */
  readonly measuredStates: readonly {
    readonly requestId: string;
    readonly clock: string;
    readonly urgency: string;
    readonly state: MeasuredSlaState;
  }[];
  readonly at: number | string | Date;
}

/**
 * Project alert rules from measured SLA states. Breached clocks map to
 * `metric-above-threshold` on the projected breached-count metric; a
 * sufficient at-risk mass maps to the same metric at a lower threshold.
 */
export function projectSlaAlertRules(
  input: ProjectSlaAlertRulesInput,
): readonly ProjectedAlertRule[] {
  const tenant = toTenantScope(input.tenant, 'tenant');
  const projectedAt = toProjectionTimestamp(input.at, 'at');
  const rules: ProjectedAlertRule[] = [];
  const breached = input.measuredStates.filter((entry) => entry.state === 'breached');
  const atRisk = input.measuredStates.filter((entry) => entry.state === 'at-risk');
  if (breached.length > 0) {
    const worstSeverity = breached.reduce<AlertSeverity>((worst, entry) => {
      const severity = SEVERITY_BY_URGENCY[entry.urgency] ?? 'medium';
      return ALERT_SEVERITIES.indexOf(severity) > ALERT_SEVERITIES.indexOf(worst)
        ? severity
        : worst;
    }, 'medium');
    rules.push(
      deepFreeze({
        projectionVersion: ALERT_PROJECTION_VERSION,
        ruleId: `rule-escalation-sla-breached-${tenant}`,
        tenant,
        conditionKind: 'metric-above-threshold',
        metricName: 'escalation-sla-breached-count',
        sloId: null,
        threshold: 0,
        severity: worstSeverity,
        escalationCondition: 'sla-clock-breached',
        catalogAncestry:
          'maps onto the alert-catalog metric-above-threshold semantics (docs/operations/alert-catalog.md): fires when the projected escalation-sla-breached-count metric exceeds the threshold; the catalog itself is A035-owned',
        projectedAt,
      } satisfies ProjectedAlertRule),
    );
  }
  if (atRisk.length >= Math.max(1, breached.length)) {
    rules.push(
      deepFreeze({
        projectionVersion: ALERT_PROJECTION_VERSION,
        ruleId: `rule-escalation-sla-at-risk-${tenant}`,
        tenant,
        conditionKind: 'metric-above-threshold',
        metricName: 'escalation-sla-at-risk-count',
        sloId: null,
        threshold: 0,
        severity: 'medium',
        escalationCondition: 'sla-clocks-at-risk',
        catalogAncestry:
          'maps onto the alert-catalog metric-above-threshold semantics (docs/operations/alert-catalog.md); at-risk mass is a ticketing condition, breached is the paging condition',
        projectedAt,
      } satisfies ProjectedAlertRule),
    );
  }
  return Object.freeze(rules);
}

export interface ProjectSloAlertRulesInput {
  readonly tenant: string;
  /** The projected SLO rollup verdicts (A035 vocabulary). */
  readonly sloVerdicts: readonly { readonly sloId: string; readonly verdict: string }[];
  readonly at: number | string | Date;
}

/** Project alert rules from SLO rollup verdicts (no-data trips fail-closed). */
export function projectSloAlertRules(
  input: ProjectSloAlertRulesInput,
): readonly ProjectedAlertRule[] {
  const tenant = toTenantScope(input.tenant, 'tenant');
  const projectedAt = toProjectionTimestamp(input.at, 'at');
  const rules: ProjectedAlertRule[] = [];
  for (const entry of input.sloVerdicts) {
    if (entry.verdict === 'no-data') {
      rules.push(
        deepFreeze({
          projectionVersion: ALERT_PROJECTION_VERSION,
          ruleId: `rule-escalation-slo-no-data-${entry.sloId}`,
          tenant,
          conditionKind: 'slo-no-data',
          metricName: null,
          sloId: entry.sloId,
          threshold: null,
          severity: 'high',
          escalationCondition: 'slo-no-data',
          catalogAncestry:
            'maps onto the alert-catalog slo-no-data semantics (docs/operations/alert-catalog.md): missing telemetry is an incident, not a pass (docs/operations/slo-targets.md §3)',
          projectedAt,
        } satisfies ProjectedAlertRule),
      );
    }
  }
  return Object.freeze(rules);
}

export interface ProjectBacklogAlertRuleInput {
  readonly tenant: string;
  readonly backlogCount: number;
  /** Breach threshold (the rule fires strictly above it). */
  readonly threshold: number;
  readonly at: number | string | Date;
}

/** Project the validation-backlog rule (metric-above-threshold). */
export function projectBacklogAlertRule(
  input: ProjectBacklogAlertRuleInput,
): ProjectedAlertRule | null {
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (
    typeof input.threshold !== 'number' ||
    !Number.isSafeInteger(input.threshold) ||
    input.threshold < 0 ||
    typeof input.backlogCount !== 'number' ||
    input.backlogCount < 0
  ) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SIGNAL,
      {
        message: 'backlog alert inputs must be non-negative integers',
        details: { backlogCount: input.backlogCount, threshold: input.threshold },
      },
    );
  }
  if (input.backlogCount <= input.threshold) return null;
  const projectedAt = toProjectionTimestamp(input.at, 'at');
  return deepFreeze({
    projectionVersion: ALERT_PROJECTION_VERSION,
    ruleId: `rule-escalation-validation-backlog-${tenant}`,
    tenant,
    conditionKind: 'metric-above-threshold',
    metricName: 'escalation-validation-backlog',
    sloId: null,
    threshold: input.threshold,
    severity: 'medium',
    escalationCondition: 'validation-backlog-above-threshold',
    catalogAncestry:
      'maps onto the alert-catalog metric-above-threshold semantics (docs/operations/alert-catalog.md) — the rule-queue-depth lineage',
    projectedAt,
  } satisfies ProjectedAlertRule);
}
