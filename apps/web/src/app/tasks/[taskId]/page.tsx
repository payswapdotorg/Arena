/**
 * `/tasks/[taskId]` — the task view (Work Order B008; issue #80;
 * UXM1.0 §Core routes `/tasks/:id`). Async session-aware server
 * component: fail-closed session probe → the role-lensed task view.
 * Canonical TaskSpec records (the compose-task step's stored proposals)
 * render as PROPOSALS — a proposal is not an execution, a result, or a
 * verification claim; unknown ids render as unknown, never guessed.
 */

import { EmptyState, PageHeader } from '@arena/ui-platform';
import { TaskDetailView } from '../../../capability/index.js';
import { CapabilitySignInGate } from '../../../capability/gate.js';
import { resolveSessionTask } from '../../../capability/case-routes.js';

export interface TaskPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function TaskPage({ params, searchParams }: TaskPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawTaskId = firstValue(resolvedParams?.['taskId']);
  const taskId = rawTaskId !== undefined ? decodeURIComponent(rawTaskId) : undefined;
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstValue(resolvedQuery?.['role']);
  if (taskId === undefined || taskId.length === 0) {
    return (
      <div data-arena-route="task" data-arena-task-shape="absent">
        <PageHeader title="Task" description="One task, from the case that motivated it." />
        <EmptyState
          title="No task id in this address"
          hint="Nothing is fabricated to fill the space — open a case and enter the task from there."
        />
      </div>
    );
  }
  const experience = await resolveSessionTask(
    taskId,
    requestedRole !== undefined && requestedRole.length > 0
      ? { requestedRoleId: requestedRole }
      : {},
  );
  if (experience.kind === 'gate') {
    return <CapabilitySignInGate code={experience.code} surface="task view" />;
  }
  return <TaskDetailView view={experience.view} />;
}
