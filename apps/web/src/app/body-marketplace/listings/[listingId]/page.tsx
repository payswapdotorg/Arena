import type { Metadata } from 'next';

import { resolveBodyMarketplaceDetailExperience } from '../../../../body-marketplace/index.js';
import { bodyMarketplaceSessionProbe } from '../../_lib/session-probe.js';

export const metadata: Metadata = {
  title: 'Marketplace listing',
};

export interface ListingDetailPageProps {
  /** The dynamic route segment (`/body-marketplace/listings/:listingId`). */
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/body-marketplace/listings/[listingId]` — the listing detail mount
 * (Work Order C014; disposition P005/S-02: nested route under the
 * marketplace surface, exactly the path the feature's own views link
 * to). Lineage, provenance, rights, substrate compatibility and version
 * history; unknown or cross-tenant ids render the honest not-found
 * state, never a fabricated listing.
 */
export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawListingId = resolvedParams?.['listingId'];
  const listingId =
    typeof rawListingId === 'string'
      ? rawListingId
      : Array.isArray(rawListingId)
        ? rawListingId[0]
        : undefined;
  const experience = await resolveBodyMarketplaceDetailExperience({
    probe: bodyMarketplaceSessionProbe(),
    listingId: listingId === undefined ? '' : decodeURIComponent(listingId),
  });
  return experience.view;
}
