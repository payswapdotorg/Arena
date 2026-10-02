/**
 * The operations surface barrel (Work Order B014;
 * apps/web/src/operations): one import surface for the route mounts,
 * exactly like the evaluation/research barrels.
 */

export { Maybe, OperationsHomeView, OperationsTruthMark } from './operations-home-view.js';
export {
  AuditStreamScreenView,
  CapacityPanelView,
  JobDetailView,
  JobsListView,
} from './operations-screens.js';
export { OperationsAuthRequiredView, OperationsNotFoundView } from './operations-mount-views.js';
export {
  resolveDemoOperationsAudit,
  resolveDemoOperationsCapacity,
  resolveDemoOperationsHome,
  resolveDemoOperationsJobExperience,
  resolveDemoOperationsJobs,
  resolveOperationsAuditExperience,
  resolveOperationsCapacityExperience,
  resolveOperationsExperience,
  resolveOperationsJobExperience,
  resolveOperationsJobsExperience,
} from './operations-route.js';
export type {
  AuditScreenExperience,
  AuditScreenViewModel,
  CapacityScreenExperience,
  CapacityScreenViewModel,
  JobDetailExperience,
  JobDetailScreenViewModel,
  JobsListViewModel,
  JobsScreenExperience,
  OperationsExperience,
  OperationsHomeViewModel,
  ResolveJobDetailOptions,
  ResolveOperationsOptions,
} from './operations-route.js';
export {
  getDemoOperationsContext,
  resetDemoOperationsContext,
  resolveSessionOperations,
} from './runtime.js';
export type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
  SessionProbe,
} from './runtime.js';
