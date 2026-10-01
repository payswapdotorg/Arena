import { AssignedCasesView, ExpertDeniedView } from '../../../expert/index.js';
import { buildAssignedCasesView, resolveExpertSession } from '../../../expert/index.js';

/**
 * `/expert/cases` — the assigned-cases list (UXM1.0 `/cases` expert lens
 * row: "assigned cases"). A mount point, not logic: the composition lives
 * in apps/web/src/expert (buildAssignedCasesView). Fail closed on the
 * session probe; reads through the B005 read-API boundary.
 */
export default async function ExpertCasesPage() {
  const outcome = await resolveExpertSession();
  if (outcome.status === 'unauthenticated') {
    return <ExpertDeniedView code={outcome.code} mode="session" />;
  }
  const view = await buildAssignedCasesView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
  });
  return <AssignedCasesView view={view} />;
}
