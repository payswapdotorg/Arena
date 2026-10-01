import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * /demo/cases + /demo/tasks route tests (Work Order B008) — the house
 * style (B007 /demo/cockpit precedent): the async pages compose the view
 * through the real demo runtime; the presentational component is rendered
 * to static markup for labelling + determinism assertions.
 */

import DemoCasesPage from './page.js';
import { CaseListView } from '../../../capability/index.js';
import { TaskDetailView } from '../../../capability/index.js';
import { resolveDemoCaseList, resolveDemoTask } from '../../../capability/case-routes.js';

describe('demo cases route mount (B008: the case surfaces under the B006 demo posture)', () => {
  it('composes through the real demo runtime and renders the labelled case list', async () => {
    const view = await resolveDemoCaseList('expert');
    const html = renderToStaticMarkup(<CaseListView view={view} />);
    expect(html).toContain('data-arena-route="cases"');
    expect(html).toContain('data-arena-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-active-role="expert"');
  });

  it('the async page is a thin mount over the capability composition', async () => {
    const page = DemoCasesPage({ searchParams: Promise.resolve({ role: 'operator' }) });
    await expect(page).resolves.toBeDefined();
  });

  it('renders an embedded demo task through the labelled task view', async () => {
    const view = await resolveDemoTask('task-review', 'expert');
    const html = renderToStaticMarkup(<TaskDetailView view={view} />);
    expect(html).toContain('data-arena-route="task"');
    expect(html).toContain('data-arena-mode="demo"');
    expect(html).toContain('data-arena-active-role="expert"');
    expect(html).toContain('data-arena-demo-banner="true"');
  });
});
