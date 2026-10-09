import type { Metadata } from 'next';

import { resolveBodyMarketplaceMyListingsExperience } from '../../../body-marketplace/index.js';
import { bodyMarketplaceSessionProbe } from '../_lib/session-probe.js';

export const metadata: Metadata = {
  title: 'My listings',
};

/**
 * `/body-marketplace/my-listings` — the publish/my-listings mount
 * (Work Order C014; disposition P005/S-02: nested route under the
 * marketplace surface, exactly the path the feature's own route
 * composition names). An honest empty state for a tenant with no
 * listings or pretraining runs yet — nothing fabricated.
 */
export default async function MyListingsPage() {
  const experience = await resolveBodyMarketplaceMyListingsExperience({
    probe: bodyMarketplaceSessionProbe(),
  });
  return experience.view;
}
