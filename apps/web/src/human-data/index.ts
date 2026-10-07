/**
 * The human-data studio barrel (Work Order C012; apps/web/src/human-data):
 * one import surface for the route mounts, exactly like the
 * developers/operations/replay barrels.
 */

export {
  HumanDataAuthRequiredView,
  HumanDataDatasetsView,
  HumanDataErrorView,
  HumanDataHomeView,
  HumanDataLoadingView,
  HumanDataProductionView,
} from './views.js';
export {
  resolveHumanDataDatasetsExperience,
  resolveHumanDataHomeExperience,
  resolveHumanDataProductionExperience,
} from './human-data-route.js';
export type { HumanDataRouteExperience } from './human-data-route.js';
export {
  createHumanDataRuntime,
  getDemoHumanDataContext,
  resetDemoHumanDataContext,
  resolveSessionHumanData,
} from './runtime.js';
export type { HumanDataRuntime, DemoHumanDataContext } from './runtime.js';
export {
  commissionBuilderViewModel,
  datasetDeliveryViewModel,
  productionDashboardViewModel,
} from './view-models.js';
export type {
  CommissionBuilderViewModel,
  DatasetDeliveryViewModel,
  ProductionDashboardViewModel,
  ProductionRowViewModel,
} from './view-models.js';
export { buildDemoHumanDataCorpus } from './fixtures.js';
export type { DemoHumanDataCorpus } from './fixtures.js';
