/**
 * B017 M2 — UX conformance: route reachability.
 *
 * Every navigation affordance the shell renders must lead to a REAL,
 * rendering surface — no dead links, no orphan routes. Two layers:
 *
 *   1. COMPOSITION layer (always runs): the shell's core nav items are
 *      read from the REAL nav module; every demo surface composes and
 *      renders with its data-arena-route marker; the first-run landing
 *      and the fail-closed session gates render; unknown routes render
 *      the standard empty state.
 *   2. SERVED layer (runs under the runner; self-skips otherwise):
 *      HTTP GET of every core route on the real server answers 200 with
 *      its route marker; unknown routes answer 404.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CORE_NAV_ITEMS } from '../../apps/web/src/app/_lib/nav.js';
import RootLayout from '../../apps/web/src/app/layout.js';
import { LandingView } from '../../apps/web/src/app/_lib/landing-view.js';
import Loading from '../../apps/web/src/app/loading.js';
import ErrorPage from '../../apps/web/src/app/error.js';
import NotFound from '../../apps/web/src/app/not-found.js';
import { resolveDemoCockpitView } from '../../apps/web/src/cockpit/home-route.js';
import { CockpitHomeView } from '../../apps/web/src/cockpit/cockpit-home-view.js';
import type { CockpitHomeViewModel } from '../../apps/web/src/cockpit/cockpit-view.js';
import { resetDemoApp } from '../product-e2e/driver/demo-boot.js';

const BASE = process.env.ARENA_UX_BASE_URL;

/** The demo surfaces the shell can reach, with their route markers. */
const DEMO_SURFACE_RESOLVERS: ReadonlyArray<{
  readonly href: string;
  readonly routeMarker: string;
  readonly resolve: () => Promise<CockpitHomeViewModel>;
  readonly element: (view: CockpitHomeViewModel) => ReturnType<typeof createElement>;
}> = [
  {
    href: '/demo/cockpit',
    routeMarker: 'cockpit',
    resolve: () => resolveDemoCockpitView('owner'),
    element: (view) => createElement(CockpitHomeView, { view }),
  },
];

describe('B017 M2 — route reachability (composition layer)', () => {
  it('the shell renders a nav link for every core route (no orphan affordances)', () => {
    const html = renderToStaticMarkup(
      createElement(RootLayout, { children: createElement('p', undefined, 'Stage') }),
    );
    expect(html).toContain('data-arena-shell="true"');
    for (const item of CORE_NAV_ITEMS) {
      expect(html, `shell links to ${item.href}`).toContain(`href="${item.href}"`);
    }
  });

  it('every core nav href is a REAL route this battery can name (the route census)', () => {
    // The route census mirrors the app router's route tree; a nav entry
    // without a census row is a dead link by definition.
    const census = new Set([
      '/',
      '/cases',
      '/bodies',
      '/research',
      '/marketplace',
      '/operations',
      '/settings',
    ]);
    for (const item of CORE_NAV_ITEMS) {
      expect(census.has(item.href), `nav href ${item.href} is a real route`).toBe(true);
    }
    expect(CORE_NAV_ITEMS.length).toBeGreaterThanOrEqual(7);
  });

  it('the first-run landing renders with exactly ONE primary action into /cases', () => {
    const html = renderToStaticMarkup(createElement(LandingView));
    expect(html).toContain('data-arena-route="landing"');
    expect(html.match(/data-arena-primary/g)?.length).toBe(1);
    expect(html).toContain('href="/cases"');
  });

  it('the quality-gate routes render truthful states (loading/error/not-found)', () => {
    const loading = renderToStaticMarkup(createElement(Loading));
    expect(loading).toContain('data-arena-state="loading"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    const error = renderToStaticMarkup(
      createElement(ErrorPage, { error: new Error('read model unreachable'), reset: () => undefined }),
    );
    expect(error).toContain('data-arena-state="error"');
    expect(error).toContain('role="alert"');
    expect(error).toContain('Try again');
    const notFound = renderToStaticMarkup(createElement(NotFound));
    expect(notFound).toContain('data-arena-state="empty"');
    expect(notFound).toContain('Page not found');
  });

  it('the demo cockpit composes and renders its route marker', async () => {
    for (const surface of DEMO_SURFACE_RESOLVERS) {
      const view = await surface.resolve();
      const html = renderToStaticMarkup(surface.element(view));
      expect(html, `${surface.href} renders`).toContain(
        `data-arena-route="${surface.routeMarker}"`,
      );
    }
    await resetDemoApp();
  });
});

describe.skipIf(BASE === undefined)('B017 M2 — route reachability (served layer)', () => {
  const ROUTES: ReadonlyArray<{ readonly href: string; readonly marker: string }> = [
    { href: '/', marker: 'data-arena-route="landing"' },
    { href: '/cases', marker: 'data-arena-route="capability-gate"' },
    // The remaining session surfaces fail CLOSED without a session: they
    // render the denied state (never anonymous data).
    { href: '/bodies', marker: 'data-arena-state="denied"' },
    { href: '/research', marker: 'data-arena-state="denied"' },
    { href: '/evaluation', marker: 'data-arena-state="denied"' },
    { href: '/operations', marker: 'data-arena-state="denied"' },
    { href: '/marketplace', marker: 'data-arena-route="marketplace"' },
    { href: '/settings', marker: 'data-arena-route="settings"' },
    { href: '/demo', marker: 'data-arena-demo-banner="true"' },
    { href: '/demo/cockpit', marker: 'data-arena-route="cockpit"' },
    { href: '/demo/cases', marker: 'data-arena-case-shape="narrative"' },
    { href: '/demo/bodies', marker: 'data-arena-studio-mode="demo"' },
    { href: '/demo/research', marker: 'data-arena-research-distinction="true"' },
    { href: '/demo/evaluation', marker: 'data-arena-demo-banner="true"' },
    { href: '/demo/operations', marker: 'data-arena-route="operations"' },
    { href: '/demo/operations/jobs', marker: 'data-arena-route="operations-jobs"' },
    { href: '/demo/operations/audit', marker: 'data-arena-route="operations-audit"' },
    { href: '/demo/operations/capacity', marker: 'data-arena-route="operations-capacity"' },
  ];

  it('every core and demo route answers 200 with its route marker', async () => {
    for (const route of ROUTES) {
      const response = await fetch(`${BASE}${route.href}`, { redirect: 'follow' });
      expect(response.status, `GET ${route.href}`).toBe(200);
      const body = await response.text();
      expect(body, `${route.href} carries ${route.marker}`).toContain(route.marker);
    }
  });

  it('unknown routes answer 404 with the standard empty state', async () => {
    const response = await fetch(`${BASE}/no-such-route`, { redirect: 'follow' });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('data-arena-state="empty"');
  });
});
