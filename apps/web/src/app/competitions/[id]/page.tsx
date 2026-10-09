import type { Metadata } from 'next';

import { resolveCompetitionDetailExperience } from '../../../competitions/index.js';

export const metadata: Metadata = {
  title: 'Competition',
};

export interface CompetitionDetailPageProps {
  /** The dynamic route segment (`/competitions/:id`). */
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/competitions/[id]` — the competition detail mount (Work Order C013;
 * disposition P005/S-01: nested route under the arena surface). The
 * feature's resolvers indicate exactly two routes — home + detail — and
 * the detail resolver exists for this mount. Fail closed; unknown ids
 * render the honest error state (no fabricated competition).
 */
export default async function CompetitionDetailPage({ params }: CompetitionDetailPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawId = resolvedParams?.['id'];
  const competitionId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? rawId[0]
        : undefined;
  if (competitionId === undefined || competitionId.length === 0) {
    const experience = await resolveCompetitionDetailExperience('');
    return experience.view;
  }
  const experience = await resolveCompetitionDetailExperience(decodeURIComponent(competitionId));
  return experience.view;
}
