import { AssignedWorkView } from '../../../expert/index.js';
import { buildAssignedWorkView, getDemoExpertContext } from '../../../expert/index.js';

/**
 * /demo/expert — the demo-mode Expert Workbench landing (Work Order B009;
 * issue #81).
 *
 * A mount point, not logic: the composition lives in
 * apps/web/src/expert (getDemoExpertContext → buildAssignedWorkView).
 * Rendering under the /demo route segment inherits B006's always-on demo
 * labelling banner (apps/web/src/app/demo/layout.tsx), and the expert
 * surface adds its own demo banner + per-datum DemoDataBadge — demo state
 * is visibly labelled and never mistaken for customer state. Reads go
 * through the canonical read path over the deterministic demo corpus; two
 * loads with the same query (and the same appended-evidence state) are
 * byte-identical.
 */
export default async function DemoExpertPage() {
  const context = await getDemoExpertContext();
  const view = await buildAssignedWorkView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    corpusHash: context.corpusHash,
  });
  return <AssignedWorkView view={view} />;
}
