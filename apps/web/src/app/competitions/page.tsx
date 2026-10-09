import type { Metadata } from 'next';

import { resolveCompetitionsHomeExperience } from '../../competitions/index.js';

export const metadata: Metadata = {
  title: 'Expert Arena',
};

/**
 * `/competitions` — the Expert Arena home mount (Work Order C013;
 * disposition P005/S-01: first-class route). A mount point, not logic:
 * the composition lives in apps/web/src/competitions
 * (resolveCompetitionsHomeExperience). Fail closed — an unauthenticated
 * visitor gets the auth-required notice, never an anonymous arena. The
 * reserved demo tenant reads the deterministic, visibly labelled demo
 * corpus; every other session reads its own (possibly empty — honest)
 * state.
 */
export default async function CompetitionsPage() {
  const experience = await resolveCompetitionsHomeExperience();
  return experience.view;
}
