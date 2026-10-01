import { TaskWorkView } from '../../../../../expert/index.js';
import { buildTaskWorkView, getDemoExpertContext } from '../../../../../expert/index.js';

/**
 * /demo/expert/tasks/:id?case=<recordId> — the demo task execute/review
 * surface (UXM1.0 `/tasks/:id` expert row under the demo posture). A mount
 * point, not logic: the composition lives in apps/web/src/expert.
 * Rendering under /demo inherits B006's always-on labelling banner; the
 * canonical case record the `case` query parameter addresses is read
 * through the canonical read path over the deterministic demo corpus.
 */

export interface DemoExpertTaskPageProps {
  readonly params?: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function DemoExpertTaskPage({ params, searchParams }: DemoExpertTaskPageProps) {
  const resolvedParams = params === undefined ? { id: '' } : await params;
  const taskId = decodeURIComponent(resolvedParams.id);
  const resolvedQuery =
    searchParams === undefined ? {} : Object.fromEntries(
      Object.entries(await searchParams).map(([key, value]) => [key, firstValue(value)]),
    );
  const caseRecordId = resolvedQuery['case'] ?? '';
  const context = await getDemoExpertContext();
  const view = await buildTaskWorkView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    taskId,
    caseRecordId,
    corpusHash: context.corpusHash,
  });
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
