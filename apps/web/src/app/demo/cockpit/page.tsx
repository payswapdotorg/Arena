/**
 * /demo/cockpit — the demo-mode cockpit mount (Work Order B007; issue #78).
 *
 * A mount point, not logic: the composition lives in
 * apps/web/src/cockpit (resolveDemoCockpitView). Rendering under the
 * /demo route segment inherits B006's always-on demo labelling banner
 * (apps/web/src/app/demo/layout.tsx), and the cockpit view adds its own
 * demo banner + per-datum DemoDataBadge — demo state is visibly labelled
 * and never mistaken for customer state. Reads go through the canonical
 * read path over the deterministic demo corpus; two loads with the same
 * query are byte-identical.
 */

import { CockpitHomeView, resolveDemoCockpitView } from '../../../cockpit/index.js';

export interface DemoCockpitPageProps {
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoCockpitPage({ searchParams }: DemoCockpitPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const view = await resolveDemoCockpitView(
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  return <CockpitHomeView view={view} />;
}
