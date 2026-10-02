import type { Metadata } from 'next';

import { OperationsHomeView, resolveDemoOperationsHome } from '../../../operations/index.js';

export const metadata: Metadata = {
  title: 'Operations (demo)',
};

/**
 * /demo/operations — the demo-mode operations surface mount (Work Order
 * B014). A mount point, not logic: the composition lives in
 * apps/web/src/operations (resolveDemoOperationsHome). Rendering under
 * the /demo route segment inherits B006's always-on demo labelling
 * banner (apps/web/src/app/demo/layout.tsx), and the surface adds its
 * own demo banner + per-datum DemoDataBadge — demo state is visibly
 * labelled and never mistaken for customer state. Reads compose over
 * the shared B006 demo runtime with the deterministic B014 protocol
 * corpus (REAL A015/A035/A034/B002 objects); two loads are
 * byte-identical.
 */
export default async function DemoOperationsPage() {
  const view = await resolveDemoOperationsHome();
  return <OperationsHomeView view={view} />;
}
