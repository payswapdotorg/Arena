import { AssignedWorkView, ExpertDeniedView } from '../../expert/index.js';
import { buildAssignedWorkView, resolveExpertSession } from '../../expert/index.js';

/**
 * `/expert` — the Expert Workbench landing: assigned work (UXM1.0 `/`
 * expert lens row, mounted at the expert-nested route this work order
 * owns; the cockpit home keeps routing the expert lens at `/`).
 *
 * An async server component: the browser session is probed FIRST through
 * the B004 boundary (fail closed — an unauthenticated visitor gets the
 * denied state, NEVER an anonymous workbench). The authenticated expert
 * gets their assigned work: qualifications (scoped judgment domains) +
 * task-level assignment rows, read through the B005 read-API boundary.
 */
export default async function ExpertPage() {
  const outcome = await resolveExpertSession();
  if (outcome.status === 'unauthenticated') {
    return <ExpertDeniedView code={outcome.code} mode="session" />;
  }
  const view = await buildAssignedWorkView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
  });
  return <AssignedWorkView view={view} />;
}
