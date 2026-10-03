import { existsSync, readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RootLayout from './layout.js';
import HomePage from './page.js';
import { LandingView } from './_lib/landing-view.js';
import CasesPage from './cases/page.js';
import BodiesPage from './bodies/page.js';
import ResearchPage from './research/page.js';
import EvaluationPage from './evaluation/page.js';
import ReplayPage from './replay/page.js';
import MarketplacePage from './marketplace/page.js';
import OperationsPage from './operations/page.js';
import SettingsPage from './settings/page.js';
import Loading from './loading.js';
import ErrorPage from './error.js';
import NotFound from './not-found.js';

const render = (element: React.ReactElement): string =>
  renderToStaticMarkup(element);

describe('product shell (root layout, UX1.0 Level 1)', () => {
  const html = render(
    <RootLayout>
      <p>Stage</p>
    </RootLayout>,
  );

  it('wraps every route in the responsive workspace shell (positive)', () => {
    expect(html).toContain('data-arena-shell="true"');
    expect(html).toContain('data-arena-zone="topbar"');
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('data-arena-zone="rail"');
    expect(html).toContain('data-arena-zone="bottom-nav"');
    expect(html).toContain('<html lang="en"');
  });

  it('carries all five persistent shell slot placeholders (positive)', () => {
    for (const region of ['workspace', 'role', 'search', 'jobs', 'profile']) {
      expect(html).toContain(`data-arena-slot="${region}"`);
    }
  });

  it('navigates to every core route from the shell (positive)', () => {
    for (const href of [
      '/',
      '/cases',
      '/bodies',
      '/research',
      '/marketplace',
      '/operations',
      '/settings',
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('keeps the legacy engineering console out of the product shell (negative)', () => {
    expect(html).not.toContain('8787');
    expect(html).not.toContain('8788');
    expect(html).not.toContain('/console');
    expect(html).not.toContain('diagnostics');
  });
});

describe('first-run landing (UX1.0 Level 0) — the DEFAULT unauthenticated experience', () => {
  // B007: `/` is the authenticated capability cockpit; without a session it
  // renders this landing (fail closed — never an anonymous cockpit). The
  // async session-aware route composition is covered by the cockpit suites
  // (src/cockpit/home-route.test.tsx) through injected session probes.
  const html = render(<LandingView />);

  it('introduces Arena in the calm three steps (positive)', () => {
    expect(html).toContain('What Arena is');
    expect(html).toContain('What an Agent Body is');
    expect(html).toContain('Start with a guided scenario');
    expect(html).toContain('data-arena-route="landing"');
  });

  it('teaches body != model without claiming certification (positive)', () => {
    expect(html).toContain('a body is never just a model');
    expect(html).toContain('certification covers the tested composition');
  });

  it('offers exactly ONE primary action — Explore a capability (positive)', () => {
    expect(html).toContain('Explore a capability');
    expect(html).toContain('href="/cases"');
    expect(html.match(/data-arena-primary/g)?.length).toBe(1);
  });

  it('does not surface a second primary action or console entry (negative)', () => {
    const landing = render(<LandingView />);
    expect(landing.match(/arena-primary-action/g)?.length).toBe(1);
    expect(landing).not.toContain('Diagnostics');
    expect(landing).not.toContain('8787');
  });

  it('honours a custom CTA destination (positive)', () => {
    expect(render(<LandingView ctaHref="/marketplace" />)).toContain(
      'href="/marketplace"',
    );
  });

  it('mounts the home route as an async session-aware server component (B007)', () => {
    // The mount delegates to resolveHomeExperience (probe -> landing |
    // cockpit); calling it outside a request scope would misread the
    // session, so the mount is asserted structurally here.
    expect(HomePage.constructor.name).toBe('AsyncFunction');
  });

  it('mounts /cases as an async session-aware server component (B008)', () => {
    // Same posture as the B007 home: the mount delegates to
    // resolveSessionCaseList (probe -> gate | case list); the session-aware
    // composition is covered by the capability suites (src/capability) through
    // injected session probes.
    expect(CasesPage.constructor.name).toBe('AsyncFunction');
  });
});

describe('core route matrix stubs (UXM1.0)', () => {
  // B008 + B010 + B012 + B014: `/cases`, `/bodies`, `/research` and
  // `/operations` are upgraded from B001 stubs to session-aware server
  // components (asserted structurally below like the B007 home); the
  // remaining core routes stay stubs until their work orders fill them.
  const routes: ReadonlyArray<[string, React.ReactElement]> = [
    ['marketplace', <MarketplacePage key="marketplace" />],
    ['settings', <SettingsPage key="settings" />],
  ];

  it('renders one stub per remaining core route, each with a route header (positive)', () => {
    expect(routes).toHaveLength(2);
    for (const [route, element] of routes) {
      const html = render(element);
      expect(html).toContain(`data-arena-route="${route}"`);
      expect(html).toContain('<h1 class="arena-page-header__title">');
      expect(html).toContain('arena-page-header__description');
    }
  });

  it('renders the standard design-system empty state on every stub (positive)', () => {
    for (const [, element] of routes) {
      expect(render(element)).toContain('data-arena-state="empty"');
    }
  });

  it('keeps stubs quiet — no fabricated data, no primary action (negative)', () => {
    for (const [, element] of routes) {
      const html = render(element);
      expect(html).not.toContain('data-arena-primary');
      expect(html).not.toContain('role="alert"');
    }
  });

  it('mounts the bodies route as an async session-aware server component (B010)', () => {
    // The mount delegates to resolveBodiesExperience (probe ->
    // auth-required | studio); calling it outside a request scope would
    // misread the session, so the mount is asserted structurally here
    // (the B007 home precedent). The composition is covered by the
    // bodies suites (src/bodies/*) through injected session probes.
    expect(BodiesPage.constructor.name).toBe('AsyncFunction');
  });

  it('mounts /research as an async session-aware server component (B012)', () => {
    // The mount delegates to resolveResearchExperience (probe ->
    // auth-required | research home); calling it outside a request scope
    // would misread the session, so the mount is asserted structurally
    // here. The composition is covered by the research suites
    // (src/research/*) through injected session probes.
    expect(ResearchPage.constructor.name).toBe('AsyncFunction');
  });

  it('mounts /evaluation as an async session-aware server component (B012)', () => {
    // The mount delegates to resolveEvaluationExperience (probe ->
    // auth-required | evaluation home); same structural posture as the
    // B007 home / B010 bodies. The composition is covered by the
    // evaluation suites (src/evaluation/*) through injected session
    // probes.
    expect(EvaluationPage.constructor.name).toBe('AsyncFunction');
  });

  it('mounts /operations as an async session-aware server component (B014)', () => {
    // The mount delegates to resolveOperationsExperience (probe ->
    // auth-required | operations home); same structural posture as the
    // B007 home / B012 evaluation. The composition is covered by the
    // operations suites (src/operations/*) through injected session
    // probes.
    expect(OperationsPage.constructor.name).toBe('AsyncFunction');
  });

  it('mounts /replay as an async session-aware server component (B011)', () => {
    // The mount delegates to resolveReplayHome (probe -> auth-required |
    // the replay run list); same structural posture as the B007 home /
    // B012 evaluation. The composition is covered by the replay suites
    // (src/replay/*) through injected session probes.
    expect(ReplayPage.constructor.name).toBe('AsyncFunction');
  });
});

describe('route quality gates: loading, error, not-found', () => {
  it('loading renders the design-system loading state (positive)', () => {
    const html = render(<Loading />);
    expect(html).toContain('data-arena-state="loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('error renders the design-system error state with a retry (positive)', () => {
    const html = render(
      <ErrorPage error={new Error('read model unreachable')} reset={() => undefined} />,
    );
    expect(html).toContain('data-arena-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('read model unreachable');
    expect(html).toContain('Try again');
  });

  it('unknown routes render the standard empty state (positive)', () => {
    expect(render(<NotFound />)).toContain('data-arena-state="empty"');
    expect(render(<NotFound />)).toContain('Page not found');
  });
});

describe('web runtime contract (Next.js host + legacy console reachability)', () => {
  const read = (path: string): string =>
    readFileSync(new URL(path, import.meta.url), 'utf-8');

  it('builds and serves the product through Next.js, not the console (positive)', () => {
    const manifest = JSON.parse(read('../../package.json')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['dev']).toBe('next dev');
    expect(manifest.scripts['build']).toBe('next build');
    expect(manifest.scripts['start']).toBe('next start');
    expect(manifest.scripts['typecheck']).toBe('tsc --noEmit');
    expect(manifest.scripts['lint']).toBe('eslint .');
    expect(manifest.scripts['test']).toBe('vitest run');
  });

  it('keeps the legacy console, workbench and marketplace reachable (positive)', () => {
    const manifest = JSON.parse(read('../../package.json')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['start:console']).toContain(
      'src/console/main.mjs',
    );
    expect(manifest.scripts['start:workbench']).toContain(
      'src/workbench/main.mjs',
    );
    expect(manifest.scripts['start:marketplace']).toContain(
      'src/marketplace/artifacts/main.mjs',
    );
    expect(manifest.scripts['selfcheck']).toContain('src/main.ts');
    for (const legacy of [
      '../../src/main.ts',
      '../../src/console/main.mjs',
      '../../src/workbench/main.mjs',
      '../../src/marketplace/artifacts/main.mjs',
      '../../src/marketplace/experts/main.mjs',
    ]) {
      expect(read(legacy).length).toBeGreaterThan(0);
    }
  });

  it('pins the Next.js runtime exactly (frozen dependency policy, positive)', () => {
    const manifest = JSON.parse(read('../../package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.dependencies['next']).toBe('15.5.4');
    expect(manifest.dependencies['react']).toBe('19.1.1');
    expect(manifest.dependencies['react-dom']).toBe('19.1.1');
    expect(manifest.dependencies['@arena/ui-platform']).toBe('workspace:*');
    expect(manifest.devDependencies['@types/react']).toBe('19.1.13');
    expect(manifest.devDependencies['@types/react-dom']).toBe('19.1.9');
  });

  it('configures TypeScript the way next build expects (positive)', () => {
    const tsconfig = read('../../tsconfig.json');
    expect(tsconfig).toContain('"jsx": "preserve"');
    expect(tsconfig).toContain('"moduleResolution": "bundler"');
    expect(tsconfig).toContain('"module": "esnext"');
    expect(tsconfig).toContain('"types": ["node"]');
  });

  it('ships a Next.js config that transpiles the design system (positive)', () => {
    const config = read('../../next.config.ts');
    expect(config).toContain("transpilePackages: ['@arena/ui-platform']");
    expect(read('../../next-env.d.ts')).toContain('types="next"');
  });
});

// `next build` artifacts, when present (the battery runs test before build on
// a fresh checkout, so this suite skips until a build has produced .next).
// B007: `/` is the session-aware cockpit home — a DYNAMIC route (it reads
// the session cookie through the B004 boundary), so it compiles to
// server-rendered artifacts (page.js) rather than a prerendered index.html.
// The stub routes stay static and must still prerender with the shell,
// the standard empty state and no diagnostics.
const buildDir = new URL('../../.next/server/app/', import.meta.url);

describe.skipIf(!existsSync(buildDir))('next build output (product host)', () => {
  const readBuilt = (route: string): string =>
    readFileSync(new URL(route, buildDir), 'utf-8');

  it('compiles the session-aware home as a dynamic route (B007: cockpit reads the session)', () => {
    expect(existsSync(new URL('page.js', buildDir))).toBe(true);
    // The home is no longer prerendered as anonymous static content: it
    // decides landing-vs-cockpit per request (fail closed, no anonymous cockpit).
    expect(existsSync(new URL('index.html', buildDir))).toBe(false);
  });

  it('compiles the session-aware bodies studio as a dynamic route (B010)', () => {
    // `/bodies` reads the session cookie through the B004 boundary, so it
    // compiles to server-rendered artifacts (bodies/page.js) rather than a
    // prerendered bodies.html — no anonymous studio is prerendered either.
    expect(existsSync(new URL('bodies/page.js', buildDir))).toBe(true);
    expect(existsSync(new URL('bodies.html', buildDir))).toBe(false);
  });

  it('prerenders every remaining core route stub with the standard empty state (positive)', () => {
    // B008 + B010 + B012 + B014: `/cases`, `/bodies`, `/research` and
    // `/operations` are session-aware dynamic routes (asserted above and
    // below); only the untouched core-route stubs prerender.
    for (const route of [
      'marketplace',
      'settings',
    ] as const) {
      const html = readBuilt(`${route}.html`);
      expect(html).toContain(`data-arena-route="${route}"`);
      expect(html).toContain('data-arena-state="empty"');
      expect(html).toContain('data-arena-shell="true"');
    }
  });

  it('compiles the session-aware research and evaluation routes as dynamic routes (B012)', () => {
    // /research and /evaluation read the session cookie through the B004
    // boundary, so they compile to server-rendered artifacts (page.js)
    // rather than prerendered html — no anonymous surface is prerendered.
    for (const route of ['research', 'evaluation'] as const) {
      expect(existsSync(new URL(`${route}/page.js`, buildDir))).toBe(true);
      expect(existsSync(new URL(`${route}.html`, buildDir))).toBe(false);
    }
  });

  it('compiles the session-aware operations route as a dynamic route (B014)', () => {
    // /operations reads the session cookie through the B004 boundary, so
    // it compiles to server-rendered artifacts (page.js) rather than a
    // prerendered operations.html — no anonymous operations surface is
    // prerendered (fail closed: capacity and SLO state never prerender as
    // anonymous content).
    expect(existsSync(new URL('operations/page.js', buildDir))).toBe(true);
    expect(existsSync(new URL('operations.html', buildDir))).toBe(false);
  });

  it('compiles /cases as a session-aware dynamic route (B008: the case list reads the session)', () => {
    // Like the B007 home: /cases decides gate-vs-cases per request (fail
    // closed, no anonymous case list), so it is never prerendered as
    // anonymous static content.
    expect(existsSync(new URL('cases.html', buildDir))).toBe(false);
  });

  it('never prerenders diagnostics as the default experience (negative)', () => {
    const html = readBuilt('settings.html');
    expect(html).not.toContain('Arena Control Console');
    expect(html).not.toContain(':8787');
  });
});
