import type { Metadata } from 'next';

import {
  ReplayAuthRequiredView,
  ReplayHomeView,
  ReplayInvalidContinuationView,
  resolveReplayHome,
} from '../../replay/index.js';

export const metadata: Metadata = {
  title: 'Run replay',
};

/**
 * `/replay` — the replay viewer run list (Work Order B011; issue #86).
 * An async session-aware server component: the browser session is
 * probed FIRST through the B004 boundary (fail closed — a typed AUTH_*
 * outcome renders the auth-required notice, never an anonymous replay
 * surface). The run list scrolls with bounded pages + opaque
 * continuation tokens (`?after=`), and explicit `?role=` query state
 * selects the lens (a lens, never an authorization). In the local
 * session posture no runs are recorded yet — the honest empty state.
 */

export interface ReplayPageProps {
  /** Explicit query state (`?role=` lens, `?after=` continuation). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReplayPage({ searchParams }: ReplayPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstQueryValue(resolved?.['role']);
  const continuation = firstQueryValue(resolved?.['after']);
  const experience = await resolveReplayHome(
    requestedRole !== undefined
      ? { requestedRoleId: requestedRole, ...(continuation !== undefined ? { continuation } : {}) }
      : continuation !== undefined
        ? { continuation }
        : {},
  );
  switch (experience.kind) {
    case 'auth-required':
      return <ReplayAuthRequiredView />;
    case 'invalid-continuation':
      return (
        <ReplayInvalidContinuationView
          code={experience.code}
          message={experience.message}
          mode="session"
        />
      );
    case 'home':
      return <ReplayHomeView view={experience.view} />;
  }
}

/** First value of a query param (string or string[] forms). */
function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  }
  return undefined;
}
