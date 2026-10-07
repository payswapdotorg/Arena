import type { Metadata } from 'next';

import { resolveHumanDataHomeExperience } from '../../human-data/index.js';

export const metadata: Metadata = {
  title: 'Human-data studio',
};

/**
 * /human-data — the studio's commission builder mount (Work Order C012).
 * A mount point, not logic: the composition lives in
 * apps/web/src/human-data (resolveHumanDataHomeExperience). Fail
 * closed — an unauthenticated visitor gets the auth-required notice,
 * never an anonymous surface.
 */
export default async function HumanDataPage() {
  const experience = await resolveHumanDataHomeExperience();
  return experience.view;
}
