import { LandingView } from './_lib/landing-view.js';
import { CockpitHomeView, resolveHomeExperience } from '../cockpit/index.js';

/**
 * `/` — the role-aware Home / Capability Cockpit (Work Order B007; issue
 * #78; UXM1.0 §Core routes).
 *
 * An async server component: the browser session is probed FIRST through
 * the B004 boundary (fail closed). An authenticated visitor gets the
 * cockpit for their active role lens (explicit `?role=` query state,
 * resolved against the session's granted roles); everyone else gets the
 * B001 Level 0 first-run landing — NEVER an anonymous cockpit.
 */

export interface HomePageProps {
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const experience = await resolveHomeExperience(
    requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {},
  );
  if (experience.kind === 'landing') {
    return <LandingView />;
  }
  return <CockpitHomeView view={experience.view} />;
}
