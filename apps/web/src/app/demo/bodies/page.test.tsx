import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * /demo/bodies route tests (Work Order B010; issue #82) — the house style
 * (B006/B007 precedent): the async page composes the view through the real
 * demo runtime; the presentational component is rendered to static markup
 * for labelling + determinism assertions.
 */

import DemoBodiesPage from './page.js';
import DemoBodyDetailPage from './[id]/page.js';
import { BodyStudioView } from '../../../bodies/bodies-home-view.js';
import { BodyDetailView } from '../../../bodies/bodies-detail-view.js';
import {
  resolveDemoBodiesStudioView,
  resolveDemoBodyDetailExperience,
} from '../../../bodies/bodies-route.js';

describe('demo body studio route mount (B010: the studio under the B006 demo posture)', () => {
  it('composes through the real demo runtime and renders the labelled studio', async () => {
    const view = await resolveDemoBodiesStudioView('researcher');
    const html = renderToStaticMarkup(<BodyStudioView view={view} />);
    expect(html).toContain('data-arena-route="bodies"');
    expect(html).toContain('data-arena-studio-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-active-role="researcher"');
    expect(html).toContain('data-arena-body-distinction="true"');
  });

  it('the async page is a thin mount over the studio composition', async () => {
    const page = DemoBodiesPage({ searchParams: Promise.resolve({ role: 'owner' }) });
    await expect(page).resolves.toBeDefined();
  });

  it('is byte-identical across two compositions of the same lens', async () => {
    expect(
      renderToStaticMarkup(
        <BodyStudioView view={await resolveDemoBodiesStudioView('agent-builder')} />,
      ),
    ).toBe(
      renderToStaticMarkup(
        <BodyStudioView view={await resolveDemoBodiesStudioView('agent-builder')} />,
      ),
    );
  });
});

describe('demo body detail route mount (B010)', () => {
  it('composes the detail view through the real demo runtime', async () => {
    const outcome = await resolveDemoBodyDetailExperience(
      'demo.agent-body.software-engineer',
      'evaluator',
    );
    expect(outcome.status).toBe('body');
    if (outcome.status !== 'body') return;
    const html = renderToStaticMarkup(<BodyDetailView view={outcome.view} />);
    expect(html).toContain('data-arena-route="bodies-detail"');
    expect(html).toContain('data-arena-version-current="1.1.0"');
    expect(html).toContain('data-arena-body-distinction="true"');
  });

  it('the async detail page is a thin mount over the detail composition', async () => {
    const page = DemoBodyDetailPage({
      params: Promise.resolve({ id: 'demo.agent-body.software-engineer' }),
      searchParams: Promise.resolve({ role: 'researcher' }),
    });
    await expect(page).resolves.toBeDefined();
  });

  it('renders the honest not-found mount for an unknown body id', async () => {
    const page = await DemoBodyDetailPage({
      params: Promise.resolve({ id: 'demo.agent-body.nope' }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('data-arena-detail-status="not-found"');
    expect(html).toContain('No such body');
  });

  it('renders the honest wrong-kind mount for a non-body record id', async () => {
    const page = await DemoBodyDetailPage({
      params: Promise.resolve({ id: 'demo.certification.software-engineer-v1-1-0' }),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('data-arena-detail-status="wrong-kind"');
    expect(html).toContain('certification');
  });
});
