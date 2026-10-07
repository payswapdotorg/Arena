import type { Metadata } from 'next';

import { resolveHumanDataDatasetsExperience } from '../../../human-data/index.js';

export const metadata: Metadata = {
  title: 'Human-data datasets',
};

/**
 * /human-data/datasets — the studio's dataset delivery mount
 * (Work Order C012): the delivered bundle manifest, the rights/lineage
 * view and the download gate (redistribution policy decides). A mount
 * point, not logic.
 */
export default async function HumanDataDatasetsPage() {
  const experience = await resolveHumanDataDatasetsExperience();
  return experience.view;
}
