import type { Metadata } from 'next';

import {
  MarketplaceAuthRequiredView,
  MarketplaceEntitlementsView,
  resolveMarketplaceEntitlementsExperience,
} from '../../../marketplace/index.js';

export const metadata: Metadata = {
  title: 'Marketplace entitlements',
};

/**
 * `/marketplace/entitlements` — the entitlement screen (Work Order B013):
 * every marketplace entitlement state renders explicitly (granted /
 * revoked / expired / pending) over the A032 grant ledger and the A033
 * feature grants — never implied by listing ownership or a purchase.
 */
export default async function MarketplaceEntitlementsPage() {
  const experience = await resolveMarketplaceEntitlementsExperience();
  if (experience.kind === 'auth-required') {
    return <MarketplaceAuthRequiredView code={experience.code} />;
  }
  return <MarketplaceEntitlementsView view={experience.view} />;
}
