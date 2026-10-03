import type { Metadata } from 'next';

import {
  MarketplaceAuthRequiredView,
  MarketplaceDetailView,
  resolveMarketplaceDetailExperience,
} from '../../../../marketplace/index.js';

export const metadata: Metadata = {
  title: 'Marketplace listing',
};

export interface MarketplaceDetailPageProps {
  readonly params: Promise<{ readonly family: string; readonly id: string }>;
}

/**
 * `/marketplace/[family]/[id]` — the listing detail screen (Work Order
 * B013): the full provenance chain, licence terms, verification evidence
 * addresses, entitlement history, certification presence and the
 * fail-closed purchase action panel. Family + id address the listing
 * (`experts/<listingId>` or `artifacts/<offerId>`); unknown ids render the
 * honest not-found state, never a fabricated listing.
 */
export default async function MarketplaceDetailPage({ params }: MarketplaceDetailPageProps) {
  const resolved = await params;
  const family = decodeURIComponent(resolved.family);
  const listingId = decodeURIComponent(resolved.id);
  const experience = await resolveMarketplaceDetailExperience(family, listingId);
  if (experience.kind === 'auth-required') {
    return <MarketplaceAuthRequiredView code={experience.code} />;
  }
  return <MarketplaceDetailView outcome={experience} />;
}
