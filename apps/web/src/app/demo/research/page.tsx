import type { Metadata } from 'next';

import {
  ResearchHomeView,
  resolveDemoResearchHome,
} from '../../../research/index.js';

export const metadata: Metadata = {
  title: 'Research (demo)',
};

/**
 * /demo/research — the demo-mode research surface mount (Work Order
 * B012; issue #87). A mount point, not logic: the composition lives in
 * apps/web/src/research (resolveDemoResearchHome). Rendering under the
 * /demo route segment inherits B006's always-on demo labelling banner,
 * and the surface adds its own demo banner + per-datum DemoDataBadge —
 * demo state is visibly labelled and never mistaken for customer state.
 * The deterministic corpus carries REAL A014 dataset manifests and
 * composition-scoped benchmark runs whose evidence chain binds the REAL
 * A012/A013/A023 digests; two loads are byte-identical.
 */
export default async function DemoResearchPage() {
  const view = await resolveDemoResearchHome();
  return <ResearchHomeView view={view} />;
}
