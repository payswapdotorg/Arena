import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Cockpit presentational tests (Work Order B007) — the house style:
 * render through react-dom/server in a plain node environment; the async
 * composition is exercised through the real demo runtime, and the
 * session-mode rendering through an injected empty port.
 */

import { CockpitHomeView } from './cockpit-home-view.js';
import { buildCockpitHomeView } from './cockpit-view.js';
import { getDemoCockpitContext } from './runtime.js';
import type { CockpitReadPort, CockpitSessionFacts } from './runtime.js';
import { DEMO_LABELLING } from '@arena/demo';
import type { CanonicalRead, KindInventory, ReadPage } from '../../../../packages/read-model/src/index.js';

async function renderDemo(requestedRoleId?: string): Promise<string> {
  const context = await getDemoCockpitContext();
  const view = await buildCockpitHomeView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
    corpusHash: context.corpusHash,
  });
  return renderToStaticMarkup(<CockpitHomeView view={view} />);
}

const SESSION_FACTS: CockpitSessionFacts = Object.freeze({
  tenantId: 'tenant-alpha',
  workspaceId: 'tenant-alpha-ws',
  principalLabel: 'worker-one',
  grantedRoleIds: Object.freeze(['operator', 'owner'] as const),
});

function sessionPort(withRecords: boolean): CockpitReadPort {
  return {
    async read(): Promise<CanonicalRead> {
      throw new Error('unexpected read');
    },
    async scroll(kind: string): Promise<ReadPage> {
      const records: CanonicalRead[] = withRecords
        ? [
            {
              recordVersion: 1,
              recordId: `unknown-${kind}`,
              tenantId: 'tenant-alpha',
              kind,
              sourceVersion: 1,
              sourceRevision: 1,
              data: { title: `${kind} with no canonical state field` },
              provenance: { createdAt: 1000, updatedAt: 1000 },
              readAt: 1000,
            } as CanonicalRead,
          ]
        : [];
      return {
        recordVersion: 1,
        kind: 'by-kind',
        recordKind: kind as ReadPage['recordKind'],
        records,
        readAt: 1000,
      } as ReadPage;
    },
    async inventory(): Promise<KindInventory> {
      return {
        recordVersion: 1,
        kinds: withRecords
          ? [{ kind: 'capability-case' as const, count: 1 }]
          : [],
      };
    },
  };
}

async function renderSession(requestedRoleId?: string, withRecords = false): Promise<string> {
  const view = await buildCockpitHomeView({
    mode: 'session',
    facts: SESSION_FACTS,
    port: sessionPort(withRecords),
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
    defaultRoleId: 'owner',
  });
  return renderToStaticMarkup(<CockpitHomeView view={view} />);
}

describe('cockpit home (B007: shared shell, role lens, truthful data)', () => {
  it('renders the cockpit route marker with the active role and mode', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-route="cockpit"');
    expect(html).toContain('data-arena-cockpit-mode="demo"');
    expect(html).toContain('data-arena-active-role="owner"');
  });

  it('wires the five shared-shell regions (UXM1.0 shared shell)', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-cockpit-bar="true"');
    for (const region of ['workspace', 'role', 'search', 'jobs', 'profile']) {
      expect(html).toContain(`data-arena-cockpit-region="${region}"`);
    }
    expect(html).toContain('Workspace: <strong>demo-workspace</strong>');
    expect(html).toContain('demo-visitor');
    expect(html).toContain('tenant <code>arena-demo</code>');
  });

  it('makes the role switcher explicit query-driven links over granted roles', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-role-switcher="true"');
    expect(html).toContain('href="/demo/cockpit?role=owner"');
    expect(html).toContain('href="/demo/cockpit?role=expert"');
    expect(html).toContain('href="/demo/cockpit?role=administrator"');
    expect(html).toContain('aria-current="page"');
  });

  it('states unmistakably that role context is a lens, not authorization', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-role-lens-note="true"');
    expect(html).toContain('Role context is a lens');
    expect(html).toContain('never what you are authorized to do');
    expect(html).toContain('data-arena-inspector-authorization="server-side"');
    expect(html).toContain('Unchanged by role switching');
  });

  it('offers exactly one hero action per lens', async () => {
    const html = await renderDemo();
    expect((html.match(/data-arena-primary/g) ?? []).length).toBe(1);
    expect(html).toContain('Find what your agent can\u2019t do yet');
  });

  it('labels demo mode on the banner and every demo datum (never customer state)', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain(DEMO_LABELLING.bannerTitle);
    expect(html).toContain(DEMO_LABELLING.bannerText);
    expect((html.match(/data-arena-state="demo"/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('data-arena-corpus-hash="true"');
  });

  it('renders distinct product-truth treatments — never one generic badge', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-truth="certification"');
    expect(html).toContain('data-arena-truth="simulation"');
    const expertHtml = await renderDemo('expert');
    expect(expertHtml).toContain('data-arena-truth="expert-judgment"');
    expect(expertHtml).toContain('data-arena-truth="simulation"');
    expect(expertHtml).not.toContain('data-arena-truth="certification"');
  });

  it('renders canonical read references on every datum', async () => {
    const html = await renderDemo();
    expect(html).toContain('canonical read:');
    expect(html).toContain('demo.capability-case.payments-reliability');
    expect(html).toContain('demo.agent-body.software-engineer');
  });

  it('renders the what-can-I-do-next actions and emphasized contextual navigation', async () => {
    const html = await renderDemo();
    expect(html).toContain('What can I do next?');
    expect(html).toContain('data-arena-next-actions="true"');
    expect(html).toContain('data-arena-cockpit-nav="true"');
    expect(html).toContain('data-arena-nav-emphasis="true"');
    for (const label of ['Home', 'Cases', 'Bodies', 'Research', 'Marketplace', 'Operations', 'Settings']) {
      expect(html).toContain(`>${label}`);
    }
  });

  it('renders the honest command menu and read-model activity indicator', async () => {
    const html = await renderDemo();
    expect(html).toContain('data-arena-command-menu="true"');
    expect(html).toContain('Go to cases (role focus)');
    expect(html).toContain('data-arena-activity="true"');
    expect(html).toContain('Read-model activity: 5 records');
  });

  it('is byte-identical across two renders of the same lens (determinism)', async () => {
    expect(await renderDemo('expert')).toBe(await renderDemo('expert'));
  });

  it('changes the rendered landing per role lens', async () => {
    expect(await renderDemo('operator')).toContain('Health summary');
    expect(await renderDemo('researcher')).toContain('Research queue');
    expect(await renderDemo('marketplace-participant')).toContain('Discovery');
  });
});

describe('cockpit home — session mode (no demo labelling; truthful empty + denial)', () => {
  it('renders no demo labelling on customer-session data', async () => {
    const html = await renderSession();
    expect(html).toContain('data-arena-cockpit-mode="session"');
    expect(html).not.toContain('data-arena-demo-banner="true"');
    expect(html).not.toContain('data-arena-state="demo"');
  });

  it('renders honest empty states for kinds with no records (nothing fabricated)', async () => {
    const html = await renderSession();
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No capability-case records yet');
    expect(html).toContain('Nothing is fabricated to fill the space.');
  });

  it('renders a truthful denial for a requested-but-not-granted role', async () => {
    const html = await renderSession('expert');
    expect(html).toContain('data-arena-role-denied="true"');
    expect(html).toContain('data-arena-state="denied"');
    expect(html).toContain('is not granted to you in this workspace');
    expect(html).toContain('granted role: expert');
    expect(html).toContain('data-arena-active-role="owner"');
  });

  it('renders unknown as unknown — never a guessed badge (unclassifiable session data)', async () => {
    const html = await renderSession(undefined, true);
    expect(html).toContain('data-arena-datum="unknown-capability-case"');
    expect(html).toContain('data-arena-truth="unknown"');
    expect(html).toContain('Unknown</span>');
    expect(html).not.toContain('data-arena-truth="certification"');
    expect(html).not.toContain('data-arena-state="demo"');
  });

  it('keeps every core route reachable (routes are capabilities of the shell)', async () => {
    const html = await renderSession('operator');
    for (const href of ['/', '/cases', '/bodies', '/research', '/marketplace', '/operations', '/settings']) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
