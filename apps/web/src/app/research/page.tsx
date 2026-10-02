import type { Metadata } from 'next';

import {
  ResearchAuthRequiredView,
  ResearchHomeView,
  resolveResearchExperience,
} from '../../research/index.js';

export const metadata: Metadata = {
  title: 'Research',
};

/**
 * /research — the session-aware research/benchmark surface mount (Work
 * Order B012; issue #87 — upgraded from the B001 structural stub). A
 * mount point, not logic: the composition lives in apps/web/src/research
 * (resolveResearchExperience). Fail closed — an unauthenticated visitor
 * gets the auth-required notice, never an anonymous research surface.
 */
export default async function ResearchPage() {
  const experience = await resolveResearchExperience();
  if (experience.kind === 'auth-required') {
    return <ResearchAuthRequiredView />;
  }
  return <ResearchHomeView view={experience.view} />;
}
