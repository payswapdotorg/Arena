import type { Metadata } from 'next';

import { resolveDevelopersKeysExperience } from '../../../developers/index.js';

export const metadata: Metadata = {
  title: 'API keys',
};

/**
 * /developers/keys — API keys with consequence exposure and the
 * shown-once secret moment (Work Order C017). Fail closed.
 */
export default async function DevelopersKeysPage() {
  const experience = await resolveDevelopersKeysExperience();
  return experience.view;
}
