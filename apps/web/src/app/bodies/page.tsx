import type { Metadata } from 'next';

import {
  BodiesAuthRequiredView,
  BodyStudioView,
  resolveBodiesExperience,
} from '../../bodies/index.js';

export const metadata: Metadata = {
  title: 'Agent Bodies',
};

export interface BodiesPageProps {
  /** Explicit query state (`?role=` selects the active studio lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/bodies` — the Body Studio (Work Order B010; issue #82; UXM1.0 §Core
 * routes). An async server component: the browser session is probed
 * FIRST through the B004 boundary (fail closed) — an unauthenticated
 * visitor gets the auth-required notice, NEVER an anonymous studio. The
 * authenticated visitor gets the studio for their active role lens
 * (explicit `?role=` query state, resolved against the session's granted
 * roles), read through the B005 read-API boundary.
 */
export default async function BodiesPage({ searchParams }: BodiesPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const experience = await resolveBodiesExperience(
    requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {},
  );
  if (experience.kind === 'auth-required') {
    return <BodiesAuthRequiredView />;
  }
  return <BodyStudioView view={experience.view} />;
}
