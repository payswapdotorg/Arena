import type { Metadata } from 'next';

import { resolveBodyMarketplaceRequestPretrainingExperience } from '../../../body-marketplace/index.js';
import { bodyMarketplaceSessionProbe } from '../_lib/session-probe.js';

export const metadata: Metadata = {
  title: 'Request pretraining',
};

/**
 * `/body-marketplace/request-pretraining` — the pretraining request
 * mount (Work Order C014; disposition P005/S-02: nested route under the
 * marketplace surface, exactly the path the feature's own route
 * composition names). Consequence exposure: the rights declaration law
 * and the BLOCKED run reasons render visibly — declaring forbidden or
 * unspecified training use BLOCKS the run.
 */
export default async function RequestPretrainingPage() {
  const experience = await resolveBodyMarketplaceRequestPretrainingExperience({
    probe: bodyMarketplaceSessionProbe(),
  });
  return experience.view;
}
