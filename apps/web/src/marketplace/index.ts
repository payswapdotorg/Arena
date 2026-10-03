/**
 * The marketplace surface barrel (Work Order B013; issue #88;
 * apps/web/src/marketplace). SERVER-ONLY surface.
 *
 * Public surface: the corpus builder, the runtime compositions (session +
 * demo), the view-model builders, the SYNC presentational views, and the
 * route compositions the app route mounts call. Nothing here may be
 * imported from a client component — the session probe reads cookies and
 * the corpus composes the domain packages server-side only.
 */

export {
  buildMarketplaceCorpus,
  MARKETPLACE_CORPUS_VERSION,
  SEED_DATASET_OFFER_ID,
  SEED_ENGAGEMENT_ID,
  SEED_ENVIRONMENT_OFFER_ID,
  SEED_EXPERT_ID,
  SEED_EXPERT_LISTING_ID,
  SEED_SUITE_OFFER_ID,
} from './corpus.js';
export type {
  BuildMarketplaceCorpusInput,
  MarketplaceCorpus,
  MarketplaceMode,
} from './corpus.js';

export {
  createReadApiPort,
  DEMO_MARKETPLACE_WORKSPACE_ID,
  getDemoMarketplaceContext,
  getDemoMarketplaceCorpus,
  getSessionMarketplaceCorpus,
  getSessionMarketplaceReadRepository,
  marketplaceSessionFacts,
  MarketplaceReadError,
  resetDemoMarketplaceCorpus,
  resetSessionMarketplaceCorpus,
  resetSessionMarketplaceReadRepository,
  resolveMarketplaceSession,
} from './runtime.js';
export type {
  DemoMarketplaceContext,
  MarketplaceReadPort,
  MarketplaceSessionFacts,
  MarketplaceSessionProbe,
  SessionMarketplaceOutcome,
} from './runtime.js';

export {
  buildMarketplaceDetailOutcome,
  buildMarketplaceEntitlementsView,
  buildMarketplaceHomeView,
  MARKETPLACE_VIEW_VERSION,
  scrollCertificationPresences,
} from './marketplace-view.js';
export type {
  MarketplaceDemoStamp,
  MarketplaceDetailOutcome,
  MarketplaceEntitlementsViewModel,
  MarketplaceHomeViewModel,
  MarketplaceViewInput,
} from './marketplace-view.js';

export {
  resolveDemoMarketplaceDetailOutcome,
  resolveDemoMarketplaceEntitlementsView,
  resolveDemoMarketplaceHomeView,
  resolveMarketplaceDetailExperience,
  resolveMarketplaceEntitlementsExperience,
  resolveMarketplaceExperience,
} from './marketplace-route.js';
export type {
  MarketplaceDetailExperience,
  MarketplaceEntitlementsExperience,
  MarketplaceExperience,
  ResolveMarketplaceExperienceOptions,
} from './marketplace-route.js';

export { MarketplaceHomeView } from './marketplace-home-view.js';
export { MarketplaceDetailView } from './marketplace-detail-view.js';
export { MarketplaceEntitlementsView } from './marketplace-entitlements-view.js';
export { MarketplaceAuthRequiredView } from './marketplace-mount-views.js';
