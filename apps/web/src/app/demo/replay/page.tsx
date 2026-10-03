import type { Metadata } from 'next';

import {
  ReplayAuthRequiredView,
  ReplayHomeView,
  ReplayInvalidContinuationView,
  resolveDemoReplayHome,
} from '../../../replay/index.js';

export const metadata: Metadata = {
  title: 'Run replay (demo)',
};

/**
 * /demo/replay — the demo-mode replay viewer run list (Work Order B011;
 * issue #86). A mount point, not logic: the composition lives in
 * apps/web/src/replay (resolveDemoReplayHome) over the shared B006 demo
 * runtime plus the deterministic B011 replay corpus. Rendering under
 * the /demo route segment inherits B006's always-on demo labelling
 * banner, and the surface adds its own demo banner + per-datum
 * DemoDataBadge — demo state is visibly labelled and never mistaken
 * for customer state. Two loads are byte-identical.
 */

export interface DemoReplayPageProps {
  /** Explicit query state (`?role=` lens, `?after=` continuation). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoReplayPage({ searchParams }: DemoReplayPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstQueryValue(resolved?.['role']);
  const continuation = firstQueryValue(resolved?.['after']);
  const experience = await resolveDemoReplayHome(
    requestedRole !== undefined
      ? { requestedRoleId: requestedRole, ...(continuation !== undefined ? { continuation } : {}) }
      : continuation !== undefined
        ? { continuation }
        : {},
  );
  switch (experience.kind) {
    case 'auth-required':
      // Unreachable in the demo posture (zero credentials), kept for
      // the typed union — fail closed, never an anonymous surface.
      return <ReplayAuthRequiredView />;
    case 'invalid-continuation':
      return (
        <ReplayInvalidContinuationView
          code={experience.code}
          message={experience.message}
          mode="demo"
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
