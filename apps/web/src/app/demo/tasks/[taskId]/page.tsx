/**
 * `/demo/tasks/[taskId]` — the demo-mode task view (Work Order B008;
 * issue #80). Mount point, wiring only: the demo composition resolves
 * canonical TaskSpec records (read by id) as PROPOSALS, and narrative
 * tasks embedded in the demo corpus case record as labelled narrative
 * state — never guessed into a canonical shape.
 */

import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@arena/ui-platform';
import { TaskDetailView } from '../../../../capability/index.js';
import { resolveDemoTask } from '../../../../capability/case-routes.js';

export const metadata: Metadata = {
  title: 'Task (demo)',
};

export interface DemoTaskPageProps {
  readonly params?: Promise<Record<string, string | string[] | undefined>>;
  /** Explicit query state (`?role=` selects the active role lens). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

export default async function DemoTaskPage({ params, searchParams }: DemoTaskPageProps) {
  const resolvedParams = params === undefined ? undefined : await params;
  const rawTaskId = firstValue(resolvedParams?.['taskId']);
  const taskId = rawTaskId !== undefined ? decodeURIComponent(rawTaskId) : undefined;
  const resolvedQuery = searchParams === undefined ? undefined : await searchParams;
  const requestedRole = firstValue(resolvedQuery?.['role']);
  if (taskId === undefined || taskId.length === 0) {
    return (
      <div data-arena-route="task" data-arena-mode="demo" data-arena-task-shape="absent">
        <PageHeader title="Task (demo)" description="One task, from the case that motivated it." />
        <EmptyState
          title="No task id in this address"
          hint="Nothing is fabricated to fill the space — open a demo case and enter the task from there."
        />
      </div>
    );
  }
  const view = await resolveDemoTask(
    taskId,
    requestedRole !== undefined && requestedRole.length > 0 ? requestedRole : undefined,
  );
  return <TaskDetailView view={view} />;
}
