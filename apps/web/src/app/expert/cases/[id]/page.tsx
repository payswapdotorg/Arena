import { CaseWorkView, ExpertDeniedView } from '../../../../expert/index.js';
import { buildCaseWorkView, resolveExpertSession } from '../../../../expert/index.js';

/**
 * `/expert/cases/:id` — the case work lens (UXM1.0 `/cases/:id` expert
 * row, mounted at the expert-nested route this work order owns). An async
 * server component: the session is probed FIRST through the B004 boundary
 * (fail closed), then the case record is read through the B005 read-API
 * boundary and rendered with its truthful lifecycle/task/run/trajectory
 * states and the evidence the work produced. A case the canonical record
 * does not carry renders the honest not-found state.
 */

export interface ExpertCasePageProps {
  readonly params?: Promise<{ readonly id: string }>;
}

export default async function ExpertCasePage({ params }: ExpertCasePageProps) {
  const resolved = params === undefined ? { id: '' } : await params;
  const caseRecordId = decodeURIComponent(resolved.id);
  const outcome = await resolveExpertSession();
  if (outcome.status === 'unauthenticated') {
    return <ExpertDeniedView code={outcome.code} mode="session" />;
  }
  const view = await buildCaseWorkView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    caseRecordId,
  });
  return <CaseWorkView view={view} />;
}
