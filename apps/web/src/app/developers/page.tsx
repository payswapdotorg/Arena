import type { Metadata } from 'next';

import { resolveDevelopersHomeExperience } from '../../developers/index.js';

export const metadata: Metadata = {
  title: 'Developers',
};

/**
 * /developers — the developer portal overview mount (Work Order C017).
 * A mount point, not logic: the composition lives in
 * apps/web/src/developers (resolveDevelopersHomeExperience). Fail
 * closed — an unauthenticated visitor gets the auth-required notice,
 * never an anonymous surface.
 */
export default async function DevelopersPage() {
  const experience = await resolveDevelopersHomeExperience();
  return experience.view;
}
