import type { Metadata } from 'next';

import { resolveDevelopersQuickstartExperience } from '../../../developers/index.js';

export const metadata: Metadata = {
  title: 'Quickstart',
};

/**
 * /developers/quickstart — SDK quickstart snippets generated from the
 * live ES1.0 contract vocabulary (Work Order C017). Fail closed.
 */
export default async function DevelopersQuickstartPage() {
  const experience = await resolveDevelopersQuickstartExperience();
  return experience.view;
}
