/**
 * `/demo/cases` — the demo-mode case list (Work Order B008; issue #80).
 * Mount point, wiring only (the B007 /demo/cockpit precedent): the
 * composition lives in apps/web/src/capability (resolveDemoCaseList).
 * Rendering under the /demo route segment inherits B006's always-on demo
 * labelling banner (apps/web/src/app/demo/layout.tsx); the view adds its
 * own demo banner + per-datum demo marks — demo state is visibly
 * labelled and never mistaken for customer state. Reads go through the
 * canonical read path over the deterministic demo corpus; guided start
 * actions write through the demo store's own repository port under the
 * reserved demo tenant.
 */

import type { Metadata } from 'next';

import { CaseListView } from '../../../capability/index.js';
import { resolveDemoCaseList } from '../../../capability/case-routes.js';

export const metadata: Metadata = {
  title: 'Capability cases (demo)',
};

export interface DemoCasesPageProps {
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoCasesPage({ searchParams }: DemoCasesPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const view = await resolveDemoCaseList(
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  return <CaseListView view={view} />;
}
