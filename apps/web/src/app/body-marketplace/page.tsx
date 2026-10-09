import type { Metadata } from 'next';

import { resolveBodyMarketplaceBrowseExperience } from '../../body-marketplace/index.js';
import { bodyMarketplaceSessionProbe } from './_lib/session-probe.js';

export const metadata: Metadata = {
  title: 'Capability-body marketplace',
};

export interface BodyMarketplacePageProps {
  /** Explicit query state (`?lens=` selects the active role lens; NOT a permission). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/body-marketplace` — the capability-body marketplace browse mount
 * (Work Order C014; disposition P005/S-02: first-class route). A mount
 * point, not logic: the composition lives in apps/web/src/
 * body-marketplace (resolveBodyMarketplaceBrowseExperience). Fail
 * closed — the session is probed through the REAL B004 boundary (the
 * feature's default probe is deliberately unauthenticated); an
 * unauthenticated visitor gets the auth-required notice, never an
 * anonymous marketplace. The reserved demo tenant reads the
 * deterministic, visibly labelled demo corpus; every other session
 * reads its own (possibly empty — honest) state.
 */
export default async function BodyMarketplacePage({ searchParams }: BodyMarketplacePageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const rawLens = resolved?.['lens'];
  const lens =
    typeof rawLens === 'string'
      ? rawLens
      : Array.isArray(rawLens)
        ? rawLens[0]
        : undefined;
  const experience = await resolveBodyMarketplaceBrowseExperience({
    probe: bodyMarketplaceSessionProbe(),
    ...(lens !== undefined && lens.length > 0 ? { lens } : {}),
  });
  return experience.view;
}
