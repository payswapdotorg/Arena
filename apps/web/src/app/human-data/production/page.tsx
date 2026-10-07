import type { Metadata } from 'next';

import { resolveHumanDataProductionExperience } from '../../../human-data/index.js';

export const metadata: Metadata = {
  title: 'Human-data production',
};

/**
 * /human-data/production — the studio's production dashboard mount
 * (Work Order C012): the live C001 escalation projections feeding the
 * commission. A mount point, not logic.
 */
export default async function HumanDataProductionPage() {
  const experience = await resolveHumanDataProductionExperience();
  return experience.view;
}
