/**
 * The replay surface barrel (Work Order B011; issue #86;
 * apps/web/src/replay). Presentational re-exports so the route mounts
 * import ONE module (the B010 bodies / B012 evaluation pattern).
 */

export {
  Maybe,
  ReplayDemoBanner,
  ReplayHomeView,
  ReplayObservationalBanner,
  ReplayRoleBar,
  ReplayTruthLegend,
  ReplayTruthMark,
  ReplaySurfaceFactsAside,
} from './replay-home-view.js';
export { ReplayRunView } from './replay-run-view.js';
export {
  ReplayAuthRequiredView,
  ReplayInvalidContinuationView,
  ReplayRunNotFoundView,
} from './replay-mount-views.js';
export {
  DEMO_REPLAY_PAGE_SIZE,
  replayContinuationHref,
  replayStepHref,
  resolveDemoReplayHome,
  resolveDemoReplayRun,
  resolveReplayHome,
  resolveReplayRun,
} from './replay-route.js';
export type {
  ReplayHomeExperience,
  ReplayHomeViewModel,
  ReplayRoleSwitchModel,
  ReplayRunExperience,
  ReplayRunScreenModel,
  ReplaySurfaceFacts,
} from './replay-route.js';
export { getDemoReplayContext, resetDemoReplayContext } from './runtime.js';
export type { DemoReplayContext } from './runtime.js';
export {
  isReplayBadgeTreatment,
  replayTruthClassTreatment,
  replayTruthLabel,
  REPLAY_DISTINCTION_NOTE,
  REPLAY_ROLE_LENS_NOTE,
  REPLAY_TRUTH_CLASS_TREATMENT,
} from './state-mark.js';
