import type { Metadata } from 'next';

import {
  MarketplaceAuthRequiredView,
  MarketplaceHomeView,
  resolveMarketplaceExperience,
} from '../../marketplace/index.js';

export const metadata: Metadata = {
  title: 'Marketplace',
};

/**
 * `/marketplace` — the marketplace browse screen (Work Order B013; issue
 * #88; UXM1.0 §Core routes). An async server component: the browser session
 * is probed FIRST through the B004 boundary (fail closed) — an
 * unauthenticated visitor gets the auth-required notice, NEVER an anonymous
 * marketplace. The authenticated visitor gets the expert-service and
 * artifact listings scoped to their tenant, with provenance, rights,
 * verification, certification presence and explicit entitlement states —
 * purchase is never certification.
 */
export default async function MarketplacePage() {
  const experience = await resolveMarketplaceExperience();
  if (experience.kind === 'auth-required') {
    return <MarketplaceAuthRequiredView code={experience.code} />;
  }
  return <MarketplaceHomeView view={experience.view} />;
}
