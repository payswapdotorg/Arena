import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '@arena/ui-platform';

export const metadata: Metadata = {
  title: 'Tasks',
};

/**
 * `/tasks` — the tasks index (P005, the L-007 UX finding: this address
 * previously fell through to the generic not-found shell — a title
 * identical to `/` and no tasks-specific heading). The route matrix
 * (UXM1.0 §Core routes) defines exactly ONE tasks surface —
 * `/tasks/:id`, the task detail view opened from its case — and no task
 * LIST route; this index renders that truth honestly instead of a
 * fabricated queue: a distinct, labelled signpost into the case flow
 * where tasks are created and entered. Nothing is fabricated to fill
 * the space.
 */
export default function TasksPage() {
  return (
    <div className="route-stub" data-arena-route="tasks">
      <PageHeader
        title="Tasks"
        description="One task, from the case that motivated it — opened in context, never as a bare queue."
      />
      <EmptyState
        title="Tasks open from their case"
        hint="There is no standalone task list in Arena: a task is created inside a capability case and entered from there. Open a case to see its tasks — nothing is fabricated to fill this space."
      />
      <p className="route-stub__hint">
        <a href="/cases">Open the capability cases surface</a> — task detail
        views live at <code>{'/tasks/<taskId>'}</code>.
      </p>
    </div>
  );
}
