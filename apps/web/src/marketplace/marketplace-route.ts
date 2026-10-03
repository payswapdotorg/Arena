/**
 * Marketplace route composition (Work Order B013; issue #88;
 * apps/web/src/marketplace). SERVER-ONLY.
 *
 * The thin composition the route mounts call: session experiences probe
 * the B004 boundary FIRST (fail closed — the routes render the denied
 * state, never an anonymous marketplace) and demo experiences compose over
 * the B006 demo runtime with the demo labelling stamp. Every view model is
 * built through the marketplace-ui builders (see marketplace-view.ts).
 */

import {
  getDemoMarketplaceContext,
  resolveMarketplaceSession,
} from './runtime.js';
import type { MarketplaceSessionProbe } from './runtime.js';
import type { MarketplaceCorpus } from './corpus.js';
import {
  buildMarketplaceDetailOutcome,
  buildMarketplaceEntitlementsView,
  buildMarketplaceHomeView,
  scrollCertificationPresences,
} from './marketplace-view.js';
import type {
  MarketplaceDetailOutcome,
  MarketplaceEntitlementsViewModel,
  MarketplaceHomeViewModel,
} from './marketplace-view.js';

/** The home (browse) experience: authenticated, or fail-closed denied. */
export type MarketplaceExperience =
  | { readonly kind: 'auth-required'; readonly code: string }
  | { readonly kind: 'home'; readonly view: MarketplaceHomeViewModel };

export interface ResolveMarketplaceExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: MarketplaceSessionProbe;
  /** Corpus override (composition seam); default: the process-local seed. */
  readonly corpus?: MarketplaceCorpus;
}

/** Resolve the SESSION marketplace home (fail closed on typed AUTH_*). */
export async function resolveMarketplaceExperience(
  options: ResolveMarketplaceExperienceOptions = {},
): Promise<MarketplaceExperience> {
  const outcome = await resolveMarketplaceSession(options);
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required', code: outcome.code };
  }
  const certifications = await scrollCertificationPresences(outcome.port);
  const view = buildMarketplaceHomeView({
    mode: 'session',
    corpus: outcome.corpus,
    readingTenant: outcome.facts.tenantId,
    workspaceId: outcome.facts.workspaceId,
    principalLabel: outcome.facts.principalLabel,
    certifications,
    demo: { isDemo: false, corpusHash: undefined },
  });
  return { kind: 'home', view };
}

/** Resolve the DEMO marketplace home (B006 labelling; not customer state). */
export async function resolveDemoMarketplaceHomeView(): Promise<MarketplaceHomeViewModel> {
  const context = await getDemoMarketplaceContext();
  const certifications = await scrollCertificationPresences(context.port);
  return buildMarketplaceHomeView({
    mode: 'demo',
    corpus: context.corpus,
    readingTenant: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    certifications,
    demo: { isDemo: true, corpusHash: context.marketplaceCorpusHash },
  });
}

/** The detail experience: authenticated, denied, or an honest detail outcome. */
export type MarketplaceDetailExperience =
  | { readonly kind: 'auth-required'; readonly code: string }
  | MarketplaceDetailOutcome;

/** Resolve the SESSION listing detail (fail closed on typed AUTH_*). */
export async function resolveMarketplaceDetailExperience(
  family: string,
  listingId: string,
  options: ResolveMarketplaceExperienceOptions = {},
): Promise<MarketplaceDetailExperience> {
  const outcome = await resolveMarketplaceSession(options);
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required', code: outcome.code };
  }
  const certifications = await scrollCertificationPresences(outcome.port);
  const detail = buildMarketplaceDetailOutcome({
    mode: 'session',
    corpus: outcome.corpus,
    readingTenant: outcome.facts.tenantId,
    family,
    listingId,
    certifications,
    demo: { isDemo: false, corpusHash: undefined },
  });
  return detail;
}

/** Resolve the DEMO listing detail (B006 labelling; not customer state). */
export async function resolveDemoMarketplaceDetailOutcome(
  family: string,
  listingId: string,
): Promise<MarketplaceDetailOutcome> {
  const context = await getDemoMarketplaceContext();
  const certifications = await scrollCertificationPresences(context.port);
  return buildMarketplaceDetailOutcome({
    mode: 'demo',
    corpus: context.corpus,
    readingTenant: context.facts.tenantId,
    family,
    listingId,
    certifications,
    demo: { isDemo: true, corpusHash: context.marketplaceCorpusHash },
  });
}

/** The entitlements experience: authenticated, or fail-closed denied. */
export type MarketplaceEntitlementsExperience =
  | { readonly kind: 'auth-required'; readonly code: string }
  | { readonly kind: 'entitlements'; readonly view: MarketplaceEntitlementsViewModel };

/** Resolve the SESSION entitlements view (fail closed on typed AUTH_*). */
export async function resolveMarketplaceEntitlementsExperience(
  options: ResolveMarketplaceExperienceOptions = {},
): Promise<MarketplaceEntitlementsExperience> {
  const outcome = await resolveMarketplaceSession(options);
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required', code: outcome.code };
  }
  const certifications = await scrollCertificationPresences(outcome.port);
  const view = buildMarketplaceEntitlementsView({
    mode: 'session',
    corpus: outcome.corpus,
    readingTenant: outcome.facts.tenantId,
    workspaceId: outcome.facts.workspaceId,
    principalLabel: outcome.facts.principalLabel,
    certifications,
    demo: { isDemo: false, corpusHash: undefined },
  });
  return { kind: 'entitlements', view };
}

/** Resolve the DEMO entitlements view (B006 labelling; not customer state). */
export async function resolveDemoMarketplaceEntitlementsView(): Promise<MarketplaceEntitlementsViewModel> {
  const context = await getDemoMarketplaceContext();
  const certifications = await scrollCertificationPresences(context.port);
  return buildMarketplaceEntitlementsView({
    mode: 'demo',
    corpus: context.corpus,
    readingTenant: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    certifications,
    demo: { isDemo: true, corpusHash: context.marketplaceCorpusHash },
  });
}
