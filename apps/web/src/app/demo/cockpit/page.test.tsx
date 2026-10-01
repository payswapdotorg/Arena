import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * /demo/cockpit route tests (Work Order B007; issue #78) — the house
 * style (B006 /demo precedent): the async page composes the view through
 * the real demo runtime; the presentational component is rendered to
 * static markup for labelling + determinism assertions.
 */

import DemoCockpitPage from './page.js';
import { CockpitHomeView } from '../../../cockpit/cockpit-home-view.js';
import { resolveDemoCockpitView } from '../../../cockpit/home-route.js';

describe('demo cockpit route mount (B007: the cockpit under the B006 demo posture)', () => {
  it('composes through the real demo runtime and renders the labelled cockpit', async () => {
    const view = await resolveDemoCockpitView('expert');
    const html = renderToStaticMarkup(<CockpitHomeView view={view} />);
    expect(html).toContain('data-arena-route="cockpit"');
    expect(html).toContain('data-arena-cockpit-mode="demo"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-active-role="expert"');
  });

  it('the async page is a thin mount over the cockpit composition', async () => {
    const page = DemoCockpitPage({ searchParams: Promise.resolve({ role: 'operator' }) });
    await expect(page).resolves.toBeDefined();
  });

  it('is byte-identical across two compositions of the same lens', async () => {
    expect(
      renderToStaticMarkup(<CockpitHomeView view={await resolveDemoCockpitView('owner')} />),
    ).toBe(
      renderToStaticMarkup(<CockpitHomeView view={await resolveDemoCockpitView('owner')} />),
    );
  });
});
