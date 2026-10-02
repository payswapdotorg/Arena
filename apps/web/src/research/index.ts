/**
 * The research surface barrel (Work Order B012; issue #87;
 * apps/web/src/research). Presentational re-exports so the route mounts
 * import ONE module (the B010 bodies pattern).
 */

export { ResearchHomeView } from './research-views.js';
export { ResearchAuthRequiredView } from './research-mount-views.js';
export {
  resolveDemoResearchHome,
  resolveResearchExperience,
} from './research-route.js';
export type { ResearchExperience, ResearchHomeViewModel } from './research-route.js';
export { getDemoResearchContext, resetDemoResearchContext } from './runtime.js';
