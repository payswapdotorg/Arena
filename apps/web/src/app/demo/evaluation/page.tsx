import type { Metadata } from 'next';

import {
  EvaluationHomeView,
  resolveDemoEvaluationHome,
} from '../../../evaluation/index.js';

export const metadata: Metadata = {
  title: 'Evaluation (demo)',
};

/**
 * /demo/evaluation — the demo-mode evaluation surface mount (Work Order
 * B012; issue #87). A mount point, not logic: the composition lives in
 * apps/web/src/evaluation (resolveDemoEvaluationHome). Rendering under
 * the /demo route segment inherits B006's always-on demo labelling
 * banner (apps/web/src/app/demo/layout.tsx), and the surface adds its
 * own demo banner + per-datum DemoDataBadge — demo state is visibly
 * labelled and never mistaken for customer state. Reads go through the
 * canonical read path over the deterministic demo corpus plus the
 * deterministic B012 protocol corpus; two loads are byte-identical.
 */
export default async function DemoEvaluationPage() {
  const view = await resolveDemoEvaluationHome();
  return <EvaluationHomeView view={view} />;
}
