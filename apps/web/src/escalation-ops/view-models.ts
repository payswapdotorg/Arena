/**
 * Escalation-ops view models (Work Order C021; apps/web/src/escalation-ops).
 * Pure projection layer — no React, no I/O: the same canonical service
 * views rendered for the Operator/Admin lenses (the B014 role-lens
 * pattern — a lens frames, it never authorizes).
 */

import type {
  EscalationSummaryView,
  EscalationTimelineProjection,
  MatchingLatencySignal,
  MeasuredSlaRecord,
  ProjectedAlertRule,
  QueueDepthSignal,
  ReplacementRateSignal,
  SloRollupView,
  ValidationBacklogSignal,
  AvailabilityCoverageSignal,
} from '../../../../packages/escalation-observability/src/index.js';

/** The state vocabulary of the route (shared semantics, honest marks). */
export type EscalationOpsState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'permission-denied'
  | 'demo-data'
  | 'success';

/** SLA state render labels (met / pending / at-risk / breached vocabulary). */
export const SLA_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  met: 'met',
  pending: 'pending (on-track)',
  'at-risk': 'at-risk (last quarter of window)',
  breached: 'breached',
});

/** The role-lens view (Operator/Admin lenses frame, never authorize). */
export interface EscalationOpsRoleLensView {
  readonly grantedRoleIds: readonly string[];
  readonly operatorLens: boolean;
  readonly administratorLens: boolean;
  readonly lensNote: string;
}

export const ESCALATION_OPS_LENS_NOTE =
  'Role context is a lens, not authorization: the operator lens frames queue health, matching latency and SLA/SLO states; the administrator lens frames aggregate scope. Authorization itself is decided server-side by the permission policy — never by this view.';

/** Project granted role ids into the escalation-ops lens view. */
export function toEscalationOpsRoleLensView(
  grantedRoleIds: readonly string[],
): EscalationOpsRoleLensView {
  const granted = Object.freeze([...new Set(grantedRoleIds)]);
  return Object.freeze({
    grantedRoleIds: granted,
    operatorLens: granted.includes('operator'),
    administratorLens: granted.includes('administrator'),
    lensNote: ESCALATION_OPS_LENS_NOTE,
  });
}

/** One escalation row of the ops list. */
export interface EscalationRowViewModel {
  readonly requestId: string;
  readonly currentState: string;
  readonly terminal: boolean;
  readonly urgency: string | null;
  readonly clientAppId: string | null;
  readonly capabilityNeed: string | null;
  readonly replacementCount: number;
  readonly observedDwellMs: number;
  readonly validationVerdictCount: number;
  readonly paymentStateCount: number;
}

export function toEscalationRowViewModel(summary: EscalationSummaryView): EscalationRowViewModel {
  return Object.freeze({
    requestId: summary.requestId,
    currentState: summary.currentState ?? 'unknown',
    terminal: summary.terminal,
    urgency: summary.urgency,
    clientAppId: summary.clientAppId,
    capabilityNeed: summary.capabilityNeed,
    replacementCount: summary.replacementCount,
    observedDwellMs: summary.observedDwellMs,
    validationVerdictCount: summary.validationVerdictCount,
    paymentStateCount: summary.paymentStateCount,
  });
}

/** One timeline step row (state dwell + refs). */
export interface TimelineStepViewModel {
  readonly sequence: number;
  readonly eventType: string;
  readonly state: string;
  readonly occurredAt: string;
  readonly dwellMs: number | null;
}

export function toTimelineViewModel(
  timeline: EscalationTimelineProjection,
): readonly TimelineStepViewModel[] {
  return Object.freeze(
    timeline.steps.map((step) =>
      Object.freeze({
        sequence: step.sequence,
        eventType: step.eventType,
        state: step.state ?? '(out-of-band update)',
        occurredAt: step.occurredAt,
        dwellMs: step.dwellMs,
      }),
    ),
  );
}

/** One measured SLA record row. */
export interface SlaRecordViewModel {
  readonly requestId: string;
  readonly clock: string;
  readonly stateLabel: string;
  readonly dueAt: string;
  readonly milestoneAt: string | null;
  readonly reasons: readonly string[];
  readonly supersedes: string | null;
  readonly evidenceCount: number;
}

export function toSlaRecordViewModel(record: MeasuredSlaRecord): SlaRecordViewModel {
  return Object.freeze({
    requestId: record.requestId,
    clock: record.clock,
    stateLabel: SLA_STATE_LABELS[record.state] ?? record.state,
    dueAt: record.dueAt,
    milestoneAt: record.milestoneAt,
    reasons: Object.freeze([...record.reasons]),
    supersedes: record.supersedes,
    evidenceCount: record.evidenceEventIds.length,
  });
}

/** One SLO rollup row (disclosed formula + sample size). */
export interface SloRollupRowViewModel {
  readonly key: string;
  readonly verdict: string;
  readonly sampleCount: number;
  readonly goodCount: number;
  readonly achievedRatio: string;
  readonly targetRatio: string;
  readonly smallSample: boolean;
  readonly formula: string;
}

export function toSloRollupRowViewModel(rollup: SloRollupView): SloRollupRowViewModel {
  return Object.freeze({
    key: rollup.key,
    verdict: rollup.evaluation.verdict,
    sampleCount: rollup.evaluation.sampleCount,
    goodCount: rollup.evaluation.goodCount,
    achievedRatio: `${(rollup.evaluation.achievedRatio * 100).toFixed(1)}%`,
    targetRatio: `${(rollup.evaluation.targetRatio * 100).toFixed(1)}%`,
    smallSample: rollup.smallSample,
    formula: rollup.formula.statement,
  });
}

/** The network-health board view model. */
export interface NetworkHealthBoardViewModel {
  readonly matchingLatencyMedianMs: number | null;
  readonly matchingLatencyP95Ms: number | null;
  readonly queueDepth: number;
  readonly validationBacklog: number;
  readonly replacementRate: string;
  readonly availabilityCoverage: string | null;
}

export function toNetworkHealthBoardViewModel(health: {
  readonly matchingLatency: MatchingLatencySignal;
  readonly queueDepth: QueueDepthSignal;
  readonly validationBacklog: ValidationBacklogSignal;
  readonly replacementRate: ReplacementRateSignal;
  readonly availabilityCoverage: AvailabilityCoverageSignal | null;
}): NetworkHealthBoardViewModel {
  return Object.freeze({
    matchingLatencyMedianMs: health.matchingLatency.medianMs,
    matchingLatencyP95Ms: health.matchingLatency.p95Ms,
    queueDepth: health.queueDepth.queuedCount,
    validationBacklog: health.validationBacklog.backlogCount,
    replacementRate: `${(health.replacementRate.replacementRate * 100).toFixed(1)}%`,
    availabilityCoverage:
      health.availabilityCoverage === null
        ? null
        : `${(health.availabilityCoverage.coverageRatio * 100).toFixed(1)}%`,
  });
}

/** One alert-rule projection row (catalog ancestry cited). */
export interface AlertRuleRowViewModel {
  readonly ruleId: string;
  readonly conditionKind: string;
  readonly escalationCondition: string;
  readonly severity: string;
  readonly catalogAncestry: string;
}

export function toAlertRuleRowViewModel(rule: ProjectedAlertRule): AlertRuleRowViewModel {
  return Object.freeze({
    ruleId: rule.ruleId,
    conditionKind: rule.conditionKind,
    escalationCondition: rule.escalationCondition,
    severity: rule.severity,
    catalogAncestry: rule.catalogAncestry,
  });
}

/** Human-readable dwell (deterministic formatting). */
export function formatDwell(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
