import { ExpertDeniedView, TaskWorkView } from '../../../../expert/index.js';
import { buildTaskWorkView, resolveExpertSession } from '../../../../expert/index.js';

/**
 * `/expert/tasks/:id?case=<recordId>` — the task execute/review surface
 * (UXM1.0 `/tasks/:id` expert row, mounted at the expert-nested route this
 * work order owns). An async server component: fail closed on the B004
 * session probe; the task renders from the CANONICAL case record the
 * `case` query parameter addresses (never guessed), with the recorded
 * run/trajectory states, the evaluation/verification the work received,
 * the evidence ledger, and the submission form.
 */

export interface ExpertTaskPageProps {
  readonly params?: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function ExpertTaskPage({ params, searchParams }: ExpertTaskPageProps) {
  const resolvedParams = params === undefined ? { id: '' } : await params;
  const taskId = decodeURIComponent(resolvedParams.id);
  const resolvedQuery =
    searchParams === undefined ? {} : Object.fromEntries(
      Object.entries(await searchParams).map(([key, value]) => [key, firstValue(value)]),
    );
  const caseRecordId = resolvedQuery['case'] ?? '';
  const outcome = await resolveExpertSession();
  if (outcome.status === 'unauthenticated') {
    return <ExpertDeniedView code={outcome.code} mode="session" />;
  }
  const view = await buildTaskWorkView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    taskId,
    caseRecordId,
  });
  // The honest post-submission outcome note (redirected back by the
  // evidence route with the append result or the typed failure code).
  const appended = resolvedQuery['evidence'];
  const errorCode = resolvedQuery['evidence-error'];
  const evidenceOutcome =
    appended !== undefined
      ? { kind: 'appended' as const, detail: `sequence ${appended}` }
      : errorCode !== undefined
        ? { kind: 'error' as const, detail: errorCode }
        : undefined;
  return (
    <TaskWorkView
      view={view}
      {...(evidenceOutcome !== undefined ? { evidenceOutcome } : {})}
    />
  );
}
