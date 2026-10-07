/**
 * The competitions surface barrel (Work Order C013; apps/web/src/
 * competitions): one import surface for the route mounts, exactly like
 * the developers/operations barrels.
 */

export {
  CompetitionDetailView,
  CompetitionsAuthRequiredView,
  CompetitionsErrorView,
  CompetitionsHomeView,
  CompetitionsLoadingView,
} from './views.js';
export {
  resolveCompetitionsHomeExperience,
  resolveCompetitionDetailExperience,
} from './competitions-route.js';
export type { CompetitionsRouteExperience } from './competitions-route.js';
export {
  competitionDetailViewModel,
  competitionSummaryViewModel,
  discoverySignalViewModel,
} from './view-models.js';
export type {
  CompetitionDetailViewModel,
  CompetitionSummaryViewModel,
  DiscoverySignalViewModel,
  EvidenceLinkViewModel,
  JudgmentViewModel,
  SolutionViewModel,
} from './view-models.js';
export { buildDemoCompetitionsCorpus, DEMO_COMPETITION_IDS } from './fixtures.js';
export type { DemoCompetitionCorpus } from './fixtures.js';
