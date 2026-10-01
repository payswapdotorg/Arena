import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BREAKPOINTS } from '../tokens/tokens.js';

import { ContextualNavigation } from './ContextualNavigation.js';
import { PageHeader } from './PageHeader.js';
import { PrimaryAction } from './PrimaryAction.js';
import { ShellBottomNav } from './ShellBottomNav.js';
import { Surface } from './Surface.js';
import { WorkspaceShell } from './WorkspaceShell.js';

const render = (element: React.ReactElement): string =>
  renderToStaticMarkup(element);

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/cases', label: 'Cases' },
  { href: '/bodies', label: 'Bodies' },
] as const;

describe('Surface', () => {
  it('renders a flat padded panel by default (positive)', () => {
    const html = render(<Surface>Content</Surface>);
    expect(html).toContain('class="arena-surface arena-surface--flat"');
    expect(html).toContain('data-arena-elevation="flat"');
    expect(html).toContain('Content');
  });

  it('supports elevation levels and flush padding (positive)', () => {
    expect(render(<Surface elevation="mid">X</Surface>)).toContain(
      'arena-surface--mid',
    );
    expect(render(<Surface flush>X</Surface>)).toContain(
      'arena-surface--flush',
    );
  });
});

describe('PageHeader', () => {
  it('renders the h1, description and actions (positive)', () => {
    const html = render(
      <PageHeader
        title="Capability cases"
        description="Outcome-first case triage."
        actions={<PrimaryAction href="/cases/new">Open a case</PrimaryAction>}
      />,
    );
    expect(html).toContain('<h1 class="arena-page-header__title">Capability cases</h1>');
    expect(html).toContain('Outcome-first case triage.');
    expect(html).toContain('href="/cases/new"');
  });

  it('omits optional sections entirely when not provided (positive)', () => {
    const html = render(<PageHeader title="Bodies" />);
    expect(html).not.toContain('arena-page-header__description');
    expect(html).not.toContain('arena-page-header__actions');
  });
});

describe('PrimaryAction', () => {
  it('renders navigation as an anchor (positive)', () => {
    const html = render(<PrimaryAction href="/cases">Explore a capability</PrimaryAction>);
    expect(html).toContain('<a ');
    expect(html).toContain('href="/cases"');
    expect(html).toContain('data-arena-primary="true"');
    expect(html).toContain('Explore a capability');
  });

  it('renders in-page actions as a button (positive)', () => {
    const html = render(<PrimaryAction>Try again</PrimaryAction>);
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain('<a ');
    expect(html).toContain('Try again');
  });
});

describe('ContextualNavigation', () => {
  it('renders an ordered labelled nav list (positive)', () => {
    const html = render(<ContextualNavigation items={NAV_ITEMS} />);
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="Context navigation"');
    expect(html).toContain('data-arena-zone="context-nav"');
    for (const item of NAV_ITEMS) {
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain(item.label);
    }
    expect(html).not.toContain('aria-current');
  });

  it('marks exactly the current item (positive)', () => {
    const html = render(
      <ContextualNavigation items={NAV_ITEMS} currentPath="/cases" />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current/g)?.length).toBe(1);
    expect(html).toContain('arena-context-nav__link--current');
  });
});

describe('ShellBottomNav', () => {
  it('renders a primary nav for narrow screens (positive)', () => {
    const html = render(<ShellBottomNav items={NAV_ITEMS} />);
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('data-arena-zone="bottom-nav"');
    expect(html).toContain('href="/cases"');
  });
});

describe('WorkspaceShell', () => {
  it('renders the skip link first, then the top bar, then the main landmark (positive)', () => {
    const html = render(
      <WorkspaceShell>
        <p>Stage</p>
      </WorkspaceShell>,
    );
    const skip = html.indexOf('class="arena-skip-link"');
    const topbar = html.indexOf('arena-shell__topbar');
    const main = html.indexOf('<main id="main-content"');
    expect(skip).toBeGreaterThanOrEqual(0);
    expect(topbar).toBeGreaterThan(skip);
    expect(main).toBeGreaterThan(topbar);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<p>Stage</p>');
  });

  it('renders the brand mark and all five default slot placeholders (positive)', () => {
    const html = render(
      <WorkspaceShell>
        <p>Stage</p>
      </WorkspaceShell>,
    );
    expect(html).toContain('data-arena-brand="true"');
    expect(html).toContain('>Arena</span>');
    for (const region of ['workspace', 'role', 'search', 'jobs', 'profile']) {
      expect(html).toContain(`data-arena-slot-region="${region}"`);
      expect(html).toContain(`data-arena-slot="${region}"`);
    }
  });

  it('lets the host override any persistent slot (positive)', () => {
    const html = render(
      <WorkspaceShell headerSlots={{ search: <span>custom-search</span> }}>
        <p>Stage</p>
      </WorkspaceShell>,
    );
    expect(html).toContain('custom-search');
    expect(html).not.toContain('data-arena-slot="search"');
    // Non-overridden slots still render their placeholders.
    expect(html).toContain('data-arena-slot="workspace"');
  });

  it('declares rail/inspector presence and renders both zones (positive)', () => {
    const html = render(
      <WorkspaceShell
        rail={<ContextualNavigation items={NAV_ITEMS} />}
        inspector={<p>Inspector content</p>}
        bottomNav={<ShellBottomNav items={NAV_ITEMS} />}
      >
        <p>Stage</p>
      </WorkspaceShell>,
    );
    expect(html).toContain('data-arena-rail="true"');
    expect(html).toContain('data-arena-inspector="true"');
    expect(html).toContain('<aside');
    expect(html).toContain('aria-label="Context rail"');
    expect(html).toContain('<details class="arena-shell__rail-details" open="">');
    expect(html).toContain('<summary class="arena-shell__rail-summary">Context</summary>');
    expect(html).toContain('data-arena-zone="inspector"');
    expect(html).toContain('Inspector content');
    expect(html).toContain('data-arena-zone="bottom-nav"');
  });

  it('omits absent zones instead of rendering empty ones (positive)', () => {
    const html = render(
      <WorkspaceShell>
        <p>Stage</p>
      </WorkspaceShell>,
    );
    expect(html).toContain('data-arena-rail="false"');
    expect(html).toContain('data-arena-inspector="false"');
    expect(html).not.toContain('<aside');
    expect(html).not.toContain('data-arena-zone="inspector"');
    expect(html).not.toContain('data-arena-zone="bottom-nav"');
  });

  it('honours a custom main landmark id (positive)', () => {
    const html = render(
      <WorkspaceShell mainId="stage">
        <p>Stage</p>
      </WorkspaceShell>,
    );
    expect(html).toContain('<main id="stage"');
    expect(html).toContain('href="#stage"');
  });
});

describe('responsive strategy (UXM1.0 §Responsive rule)', () => {
  const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf-8');

  it('switches zone layouts at the tablet and desktop breakpoints (positive)', () => {
    expect(css).toContain(`@media (min-width: ${BREAKPOINTS.desktop})`);
    expect(css).toContain(`@media (min-width: ${BREAKPOINTS.tablet})`);
    expect(css).toContain('@media (max-width: 767.98px)');
  });

  it('implements the desktop three-zone grid and its no-inspector variant (positive)', () => {
    expect(css).toContain('grid-template-columns: 16rem minmax(0, 1fr) minmax(0, 22rem)');
    expect(css).toContain(`[data-arena-inspector='false']`);
  });

  it('turns the inspector into a sheet on tablet and mobile (positive)', () => {
    expect(css).toMatch(/\.arena-shell__inspector\s*\{\s*[^}]*position: fixed/s);
  });

  it('keeps the rail collapsible on tablet and hidden on mobile (positive)', () => {
    expect(css).toContain('.arena-shell__rail-summary');
    expect(css).toContain('display: none');
  });

  it('collapses all motion under prefers-reduced-motion (positive)', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/animation: none !important/);
  });
});
