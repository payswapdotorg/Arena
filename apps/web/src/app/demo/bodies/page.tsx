/**
 * /demo/bodies — the demo-mode Body Studio mount (Work Order B010; issue
 * #82). A mount point, not logic: the composition lives in
 * apps/web/src/bodies (resolveDemoBodiesStudioView). Rendering under the
 * /demo route segment inherits B006's always-on demo labelling banner
 * (apps/web/src/app/demo/layout.tsx), and the studio view adds its own
 * demo banner + per-datum DemoDataBadge — demo state is visibly labelled
 * and never mistaken for customer state. Reads go through the canonical
 * read path over the deterministic demo corpus; two loads with the same
 * query are byte-identical.
 */

import { BodyStudioView, resolveDemoBodiesStudioView } from '../../../bodies/index.js';

export interface DemoBodiesPageProps {
  /** Explicit query state (`?role=` selects the active studio lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemoBodiesPage({ searchParams }: DemoBodiesPageProps) {
  const resolved = searchParams === undefined ? undefined : await searchParams;
  const requested = resolved?.['role'];
  const requestedRole =
    typeof requested === 'string'
      ? requested
      : Array.isArray(requested)
        ? requested[0]
        : undefined;
  const view = await resolveDemoBodiesStudioView(
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  return <BodyStudioView view={view} />;
}
