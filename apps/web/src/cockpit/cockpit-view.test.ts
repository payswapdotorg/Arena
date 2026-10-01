import { describe, expect, it } from 'vitest';

/**
 * Cockpit view-model tests (Work Order B007) — the house style: build the
 * view through the REAL demo runtime (deterministic corpus, canonical
 * read path) and through an injected session-mode port, then assert the
 * lens/truth/denial/determinism contracts on the resulting view models.
 */

import { buildCockpitHomeView, roleSwitchHref } from './cockpit-view.js';
import type { CockpitReadPort } from './runtime.js';
import { getDemoCockpitContext } from './runtime.js';
import type { CockpitSessionFacts } from './runtime.js';
import type { CanonicalRead, KindInventory, ReadPage } from '../../../../packages/read-model/src/index.js';
import { CORE_NAV_ITEMS } from '../app/_lib/nav.js';

async function demoView(requestedRoleId?: string) {
  const context = await getDemoCockpitContext();
  return buildCockpitHomeView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
    corpusHash: context.corpusHash,
  });
}

const SESSION_FACTS: CockpitSessionFacts = Object.freeze({
  tenantId: 'tenant-alpha',
  workspaceId: 'tenant-alpha-ws',
  principalLabel: 'worker-one',
  grantedRoleIds: Object.freeze(['operator', 'owner'] as const),
});

function emptyReadPort(): CockpitReadPort & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  const port: CockpitReadPort = {
    async read(recordId: string): Promise<CanonicalRead> {
      calls.push(`read:${recordId}`);
      throw new Error(`unexpected read ${recordId}`);
    },
    async scroll(kind: string): Promise<ReadPage> {
      calls.push(`scroll:${kind}`);
      return {
        recordVersion: 1,
        kind: 'by-kind',
        recordKind: kind as ReadPage['recordKind'],
        records: [],
        readAt: 1000,
      } as ReadPage;
    },
    async inventory(): Promise<KindInventory> {
      calls.push('inventory');
      return { recordVersion: 1, kinds: [] };
    },
  };
  return Object.assign(port, { calls });
}

describe('buildCockpitHomeView — demo mode (the B006 posture)', () => {
  it('defaults to the owner lens and answers "what am I doing" from canonical reads', async () => {
    const view = await demoView();
    expect(view.mode).toBe('demo');
    expect(view.roleSwitch.activeRoleId).toBe('owner');
    expect(view.roleSwitch.denied).toBe(false);
    expect(view.lens.landingTitle).toBe('Capability cockpit');
    expect(view.doing.cards.length).toBeGreaterThan(0);
    const caseCard = view.doing.cards.find(
      (card) => card.recordId === 'demo.capability-case.payments-reliability',
    );
    expect(caseCard).toBeDefined();
    expect(caseCard?.stateKind).toBe('simulation-replay');
    expect(caseCard?.demo).toBe(true);
    expect(caseCard?.treatment).toBe('simulation');
  });

  it('classifies every surfaced datum truthfully (certification is certification; judgment is judgment)', async () => {
    const view = await demoView('agent-builder');
    const cert = view.doing.cards.find(
      (card) => card.recordId === 'demo.certification.software-engineer-v1-1-0',
    );
    expect(cert?.stateKind).toBe('certification');
    expect(cert?.treatment).toBe('certification');
    const expertView = await demoView('expert');
    const qualification = expertView.doing.cards.find(
      (card) => card.recordId === 'demo.expert-qualification.structural-review',
    );
    expect(qualification?.stateKind).toBe('expert-judgment');
    expect(qualification?.treatment).toBe('expert-judgment');
  });

  it('changes the LENS per role — landing, reads and emphasis differ; authorization facts never do', async () => {
    const owner = await demoView('owner');
    const expert = await demoView('expert');
    expect(owner.lens.roleId).not.toBe(expert.lens.roleId);
    expect(owner.lens.landingTitle).not.toBe(expert.lens.landingTitle);
    expect(owner.doing.cards.map((card) => card.recordId)).not.toEqual(
      expert.doing.cards.map((card) => card.recordId),
    );
    // The invariant: tenant/workspace/granted roles are identical across lenses.
    expect(owner.tenantId).toBe(expert.tenantId);
    expect(owner.workspaceId).toBe(expert.workspaceId);
    expect(owner.roleSwitch.grantedRoleIds).toEqual(expert.roleSwitch.grantedRoleIds);
  });

  it('is byte-identical across two builds of the same lens (determinism)', async () => {
    expect(JSON.stringify(await demoView('researcher'))).toBe(JSON.stringify(await demoView('researcher')));
  });

  it('carries the demo determinism stamp', async () => {
    const view = await demoView();
    expect(view.demo.isDemo).toBe(true);
    expect(typeof view.demo.corpusHash).toBe('string');
    expect(view.roleHrefBase).toBe('/demo/cockpit');
  });

  it('role-switch links are explicit query state', () => {
    expect(roleSwitchHref('/demo/cockpit', 'expert')).toBe('/demo/cockpit?role=expert');
    expect(roleSwitchHref('/', 'owner')).toBe('/?role=owner');
  });
});

describe('buildCockpitHomeView — session mode (granted-role truthfulness)', () => {
  it('truthfully denies a requested role that is not granted, falling back to the granted default', async () => {
    const view = await buildCockpitHomeView({
      mode: 'session',
      facts: SESSION_FACTS,
      port: emptyReadPort(),
      requestedRoleId: 'expert',
      defaultRoleId: 'owner',
    });
    expect(view.roleSwitch.denied).toBe(true);
    expect(view.roleSwitch.deniedRequested).toBe('expert');
    expect(view.roleSwitch.activeRoleId).toBe('owner');
    expect(view.roleSwitch.requestedRoleId).toBe('expert');
  });

  it('resolves an explicitly requested granted role', async () => {
    const view = await buildCockpitHomeView({
      mode: 'session',
      facts: SESSION_FACTS,
      port: emptyReadPort(),
      requestedRoleId: 'operator',
      defaultRoleId: 'owner',
    });
    expect(view.roleSwitch.denied).toBe(false);
    expect(view.roleSwitch.activeRoleId).toBe('operator');
    expect(view.lens.landingTitle).toBe('Health summary');
  });

  it('performs every read through the injected port (no parallel data path)', async () => {
    const port = emptyReadPort();
    const view = await buildCockpitHomeView({
      mode: 'session',
      facts: SESSION_FACTS,
      port,
      defaultRoleId: 'owner',
    });
    expect(port.calls).toContain('scroll:capability-case');
    expect(port.calls).toContain('scroll:agent-body');
    expect(port.calls).toContain('scroll:certification');
    expect(port.calls).toContain('inventory');
    expect(view.doing.cards).toHaveLength(0);
    expect(view.doing.emptyKinds).toEqual(
      expect.arrayContaining(['capability-case', 'agent-body', 'certification']),
    );
    expect(view.demo.isDemo).toBe(false);
    expect(view.roleHrefBase).toBe('/');
  });

  it('emphasizes navigation without ever removing a capability of the shell', async () => {
    const view = await buildCockpitHomeView({
      mode: 'session',
      facts: SESSION_FACTS,
      port: emptyReadPort(),
      defaultRoleId: 'owner',
    });
    const hrefs = view.nav.map((item) => item.href);
    expect(hrefs.sort()).toEqual(CORE_NAV_ITEMS.map((item) => item.href).sort());
    const emphasized = view.nav.filter((item) => item.emphasized);
    expect(emphasized.length).toBeGreaterThan(0);
    // Emphasized routes lead the rail (deterministic emphasis ordering).
    const firstNonEmphasized = view.nav.findIndex((item) => !item.emphasized);
    for (const [index, item] of view.nav.entries()) {
      if (index < firstNonEmphasized) expect(item.emphasized).toBe(true);
    }
  });

  it('defaults to the first granted role deterministically when no default is given', async () => {
    const view = await buildCockpitHomeView({
      mode: 'session',
      facts: SESSION_FACTS,
      port: emptyReadPort(),
    });
    expect(view.roleSwitch.activeRoleId).toBe('operator');
  });
});
