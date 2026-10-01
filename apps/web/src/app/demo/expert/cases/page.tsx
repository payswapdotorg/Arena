import { AssignedCasesView } from '../../../../expert/index.js';
import { buildAssignedCasesView, getDemoExpertContext } from '../../../../expert/index.js';

/**
 * /demo/expert/cases — the demo assigned-cases list (UXM1.0 `/cases`
 * expert lens row under the demo posture). A mount point, not logic:
 * the composition lives in apps/web/src/expert. Rendering under /demo
 * inherits the always-on B006 demo labelling banner.
 */
export default async function DemoExpertCasesPage() {
  const context = await getDemoExpertContext();
  const view = await buildAssignedCasesView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    corpusHash: context.corpusHash,
  });
  return <AssignedCasesView view={view} />;
}
