/**
 * The escalation-ops barrel (Work Order C021; apps/web/src/escalation-ops):
 * one import surface for the route mounts, exactly like the
 * developers/human-data/operations barrels.
 */

export {
  EscalationOpsAuthRequiredView,
  EscalationOpsBoardView,
  EscalationOpsErrorView,
  EscalationOpsLoadingView,
} from './views.js';
export { resolveEscalationOpsBoardExperience } from './escalation-ops-route.js';
export type { EscalationOpsRouteExperience } from './escalation-ops-route.js';
export {
  getDemoEscalationOpsContext,
  resetDemoEscalationOpsContext,
  resolveSessionEscalationOps,
} from './runtime.js';
export type { DemoEscalationOpsContext } from './runtime.js';
export {
  SLA_STATE_LABELS,
  formatDwell,
  toAlertRuleRowViewModel,
  toEscalationRowViewModel,
  toEscalationOpsRoleLensView,
  toNetworkHealthBoardViewModel,
  toSlaRecordViewModel,
  toSloRollupRowViewModel,
  toTimelineViewModel,
} from './view-models.js';
export type {
  AlertRuleRowViewModel,
  EscalationOpsRoleLensView,
  EscalationOpsState,
  EscalationRowViewModel,
  NetworkHealthBoardViewModel,
  SlaRecordViewModel,
  SloRollupRowViewModel,
  TimelineStepViewModel,
} from './view-models.js';
export {
  buildDemoEscalationOpsRuntime,
  ESCALATION_OPS_DEMO_EPOCH_MS,
  ESCALATION_OPS_DEMO_TENANT,
} from './fixtures.js';
