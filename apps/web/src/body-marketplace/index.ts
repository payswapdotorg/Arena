/**
 * The body-marketplace surface barrel (Work Order C014;
 * apps/web/src/body-marketplace): one import surface for the route
 * mounts, exactly like the developers/marketplace barrels.
 */

export {
  BodyMarketplaceAuthRequiredView,
  BodyMarketplaceBrowseView,
  BodyMarketplaceDetailView,
  BodyMarketplaceErrorView,
  BodyMarketplaceLoadingView,
  BodyMarketplaceMyListingsView,
  BodyMarketplaceRequestPretrainingView,
} from './views.js';
export {
  resolveBodyMarketplaceBrowseExperience,
  resolveBodyMarketplaceDetailExperience,
  resolveBodyMarketplaceMyListingsExperience,
  resolveBodyMarketplaceRequestPretrainingExperience,
  resolveBrowseView,
  resolveListingDetailView,
  resolveMyListingsView,
  resolveRequestPretrainingView,
} from './body-marketplace-route.js';
export type { BodyMarketplaceRouteExperience } from './body-marketplace-route.js';
export {
  buildDemoBodyMarketplaceCorpus,
  getDemoBodyMarketplaceContext,
  projectBodyMarketplace,
  resetDemoBodyMarketplaceContext,
  resolveBodyMarketplaceSession,
  DEMO_TENANT,
} from './runtime.js';
export type {
  BodyMarketplaceProjection,
  BodyMarketplaceSessionProbe,
  SessionFacts,
  SessionOutcome,
} from './runtime.js';
export {
  BODY_MARKETPLACE_ROLE_LENSES,
  BODY_MARKETPLACE_ROUTE_STATES,
  browseView,
  listingDetail,
  listingRow,
  myListingsView,
  toRoleLens,
} from './view-models.js';
export type {
  BrowseViewModel,
  ListingDetailOutcome,
  ListingDetailViewModel,
  ListingRowViewModel,
  MyListingsViewModel,
  PretrainingRunRowViewModel,
  RoleLens,
} from './view-models.js';
