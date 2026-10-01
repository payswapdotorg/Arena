import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * /demo route tests (Work Order B006; issue #73) — the house style:
 * render through react-dom/server in a plain node environment. The
 * async page composition is exercised by building the view model through
 * the real demo runtime; the presentational component is rendered to
 * static markup for labelling + determinism assertions.
 */

import DemoPage from './page.js';
import DemoLayout from './layout.js';
import { DemoLandingView } from '../../demo/demo-landing-view.js';
import { buildDemoLandingView } from '../../demo/narrative-view.js';
import { getDemoRuntime } from '../../demo/runtime.js';
import {
  DEMO_BANNER_TEXT,
  DEMO_LABELLING,
  DEMO_RESET_LABEL,
} from '@arena/demo';

async function renderDemo(variantId: string): Promise<string> {
  const runtime = await getDemoRuntime();
  const view = await buildDemoLandingView({
    variantId,
    read: (recordId) => runtime.reads.read(recordId),
    inventory: () => runtime.reads.inventory(),
    corpusHash: runtime.corpusHash,
  });
  return renderToStaticMarkup(<DemoLandingView view={view} />);
}

describe('demo landing (B006: visibly labelled, deterministic, resettable)', () => {
  it('renders the demo banner text from the labelling contract', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain(DEMO_LABELLING.bannerTitle);
    expect(html).toContain(DEMO_BANNER_TEXT);
  });

  it('badges every demo-rendered datum (demo data badge + product-truth badge)', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-truth="demo"');
    expect((html.match(/data-arena-state="demo"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    // Distinct product-truth semantics: multiple different truth kinds render.
    for (const kind of ['verified', 'simulation', 'evaluation', 'suggestion']) {
      expect(html).toContain(`data-arena-truth="${kind}"`);
    }
  });

  it('renders the guided narrative steps in order with their titles', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-demo-steps="true"');
    expect(html).toContain('Welcome to a demo workspace');
    expect(html).toContain('An Agent Body, as data');
    expect(html).toContain('The Epoch learning loop, in one breath');
    expect(html).toContain('Explore by role');
  });

  it('renders the reset affordance from the labelling contract', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-demo-reset="true"');
    expect(html).toContain(DEMO_RESET_LABEL);
    expect(html).toContain('action="/demo/reset"');
    expect(html).toContain('method="post"');
  });

  it('stamps the corpus hash (the visible determinism proof)', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-corpus-hash="true"');
  });

  it('renders the canonical read references (kind + record id chips)', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('demo.agent-body.software-engineer');
    expect(html).toContain('demo.capability-case.payments-reliability');
    expect(html).toContain('canonical read:');
  });

  it('is byte-identical across two loads of the same lens', async () => {
    expect(await renderDemo('expert')).toBe(await renderDemo('expert'));
    expect(await renderDemo('owner')).toBe(await renderDemo('owner'));
  });

  it('role lenses are explicit query-driven links (no implicit state)', async () => {
    const html = await renderDemo('owner');
    expect(html).toContain('data-arena-demo-lenses="true"');
    expect(html).toContain('href="/demo?role=owner"');
    expect(html).toContain('href="/demo?role=agent-builder"');
    expect(html).toContain('href="/demo?role=expert"');
  });
});

describe('demo route tree', () => {
  it('the layout wraps children in the always-on demo banner', () => {
    const html = renderToStaticMarkup(
      <DemoLayout>
        <p>Stage</p>
      </DemoLayout>,
    );
    expect(html).toContain('data-arena-demo-route="true"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain(DEMO_LABELLING.bannerText);
  });

  it('the async page composes the view through the real demo runtime', async () => {
    const runtime = await getDemoRuntime();
    const view = await buildDemoLandingView({
      variantId: 'owner',
      read: (recordId) => runtime.reads.read(recordId),
      inventory: () => runtime.reads.inventory(),
      corpusHash: runtime.corpusHash,
    });
    expect(view.steps.length).toBe(9);
    // The page itself is a thin async wrapper over this composition.
    const page = DemoPage({ searchParams: Promise.resolve({ role: 'expert' }) });
    await expect(page).resolves.toBeDefined();
  });
});
