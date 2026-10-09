/**
 * Route test for `/tasks` (P005, the L-007 UX finding): the address
 * previously fell through to the generic not-found shell — a document
 * title identical to `/` and no tasks-specific heading (G003 audit,
 * docs/evidence/ux/README.md). The route matrix (UXM1.0 §Core routes)
 * defines exactly one tasks surface — `/tasks/:id` — and no task LIST
 * route, so this index renders that truth as a distinct, labelled
 * signpost: honest empty state, no fabricated queue, one way into the
 * case flow where tasks live.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TasksPage, { metadata } from './page.js';
import TaskDetailPage from './[taskId]/page.js';

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe('the /tasks index (L-007: a distinct tasks surface, not the generic shell)', () => {
  it('renders a distinct route marker and heading (the audit finding, fixed)', () => {
    const html = render(<TasksPage />);
    expect(html).toContain('data-arena-route="tasks"');
    expect(html).toContain('<h1 class="arena-page-header__title">Tasks</h1>');
  });

  it('carries a distinct metadata title — no longer identical to the landing', () => {
    expect(metadata.title).toBe('Tasks');
  });

  it('renders the standard honest empty state — no fabricated task queue', () => {
    const html = render(<TasksPage />);
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('Tasks open from their case');
    expect(html).not.toContain('data-arena-list');
  });

  it('routes the visitor into the case flow where tasks are created and entered', () => {
    const html = render(<TasksPage />);
    expect(html).toContain('href="/cases"');
    expect(html).toContain('/tasks/&lt;taskId&gt;');
  });
});

describe('the /tasks/[taskId] detail mount (unchanged by P005 — the matrix route)', () => {
  it('stays the session-aware async server component it already was', () => {
    // The task DETAIL view (UXM1.0 `/tasks/:id`) was already mounted and
    // feature-tested (B008); P005 adds only the missing index above it.
    expect(TaskDetailPage.constructor.name).toBe('AsyncFunction');
  });
});
