/**
 * B017 M1 — the role-switch simulation (the headline scenario).
 *
 * The SAME canonical objects must project correctly for Owner, Expert,
 * Builder and Researcher — switching preserves identity/tenancy while
 * changing ONLY the projection. Proven at three layers:
 *
 *   1. CONTRACT layer (B003 `projectCapabilityCase`): the four lenses
 *      over ONE canonical CapabilityCaseView — identical canonical
 *      identity, four distinct payloads, the RC1.0 lens questions
 *      verbatim, role-specific emphasis, and tenant preserved;
 *   2. APP-SURFACE layer (the real B007/B008 composition): cockpit,
 *      case list and case detail resolved per role through the exact
 *      resolvers the /demo routes call — identical facts/record
 *      identity/corpus hash, different active lens;
 *   3. MARKUP layer: the rendered views agree on the identity anchors
 *      (tenant, record id, demo banner) and differ in lens content.
 *
 * Plus the truthful-denial path: a requested role that is NOT granted
 * resolves to an honest `not-granted` outcome with a fallback — never a
 * fake authorization, never a changed identity.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { projectCapabilityCase } from '../../packages/role-context/src/projections/capability-case-lenses.js';
import { resolveActiveRole } from '../../apps/web/src/cockpit/role-lens.js';
import { resolveDemoCockpitView } from '../../apps/web/src/cockpit/home-route.js';
import { CockpitHomeView } from '../../apps/web/src/cockpit/cockpit-home-view.js';
import { roleSwitchHref } from '../../apps/web/src/cockpit/cockpit-view.js';
import {
  resolveDemoCaseList,
  resolveDemoCaseDetail,
} from '../../apps/web/src/capability/case-routes.js';
import {
  CaseListView,
  CaseDetailView,
} from '../../apps/web/src/capability/capability-views.js';
import { toCapabilityCaseView } from './driver/case-lens-source.js';
import { bootDemoApp, FOUR_REFERENCE_ROLES, resetDemoApp } from './driver/demo-boot.js';

const NARRATIVE_RECORD_ID = 'demo.capability-case.payments-reliability';

const LENS_QUESTIONS: Record<string, string> = {
  owner: 'Why is my agent struggling?',
  expert: 'What work am I being asked to perform?',
  'agent-builder': 'What capability is missing from the Body?',
  researcher: 'What evidence supports the capability hypothesis?',
};

describe('B017 M1 — role-switch: contract layer (B003 lenses over one canonical object)', () => {
  it('projects the SAME canonical case through the four reference roles with identity preserved and only the projection changed', async () => {
    const boot = await bootDemoApp();
    const read = await boot.port.read(NARRATIVE_RECORD_ID);
    const view = toCapabilityCaseView(read);

    const projections = FOUR_REFERENCE_ROLES.map((roleId) => ({
      roleId,
      projection: projectCapabilityCase(view, roleId),
    }));

    // Same-object rule: the canonical identity is IDENTICAL across roles.
    const [ownerProjection, expertProjection, builderProjection, researcherProjection] =
      projections.map((entry) => entry.projection);
    const owner = ownerProjection;
    if (owner === undefined) throw new Error('unreachable: four projections built');
    expect(expertProjection?.canonical).toEqual(owner.canonical);
    expect(builderProjection?.canonical).toEqual(owner.canonical);
    expect(researcherProjection?.canonical).toEqual(owner.canonical);
    expect(owner.canonical).toEqual({
      kind: 'capability-case',
      tenant: 'arena-demo',
      objectId: NARRATIVE_RECORD_ID,
      version: '1.0.0',
    });

    // Different-lens rule: the payload differs per role.
    expect(
      new Set(projections.map((entry) => JSON.stringify(entry.projection.payload))).size,
      'four distinct payloads (only the projection changes)',
    ).toBe(4);

    // The RC1.0 lens questions, verbatim, in role order.
    for (const { roleId, projection } of projections) {
      expect(projection.roleId).toBe(roleId);
      expect(projection.lensQuestion).toBe(LENS_QUESTIONS[roleId]);
      expect(projection.canonical.tenant).toBe('arena-demo');
    }

    // Role-specific emphasis (never removed content — a different view).
    expect(owner.emphasis).toContain('capability-inbox');
    expect(expertProjection?.emphasis).toContain('assigned-work');
    expect(builderProjection?.emphasis).toContain('body-studio');
    expect(researcherProjection?.emphasis).toContain('benchmark-lab');

    // The lens payloads carry the SAME underlying facts, differently
    // framed: the owner sees the struggle, the expert the requested work,
    // the builder the missing capability, the researcher the hypothesis.
    const ownerPayload = owner.payload as Record<string, unknown>;
    const expertPayload = expertProjection?.payload as Record<string, unknown> | undefined;
    const builderPayload = builderProjection?.payload as Record<string, unknown> | undefined;
    const researcherPayload = researcherProjection?.payload as Record<string, unknown> | undefined;
    expect((ownerPayload['struggle'] as { observedFailure: string }).observedFailure).toBe(
      view.observedFailure,
    );
    expect(((expertPayload ?? {})['requestedWork'] as { problem: string }).problem).toBe(
      view.observedFailure,
    );
    expect(((builderPayload ?? {})['missingCapabilities'] as readonly string[]).length).toBe(
      view.missingCapabilities.length,
    );
    expect((researcherPayload ?? {})['hypothesis']).toBe(view.targetCapability);

    // An unknown role is a typed rejection — never a silent fallback.
    expect(() => projectCapabilityCase(view, 'not-a-role')).toThrow();

    await resetDemoApp();
  });

  it('resolveActiveRole: a granted switch is exact; an ungranted request is a truthful denial with fallback', () => {
    const granted = ['owner', 'researcher'] as const;
    const switched = resolveActiveRole({ grantedRoleIds: granted, requested: 'researcher' });
    expect(switched).toEqual({ status: 'granted', roleId: 'researcher', byDefault: false });

    const denied = resolveActiveRole({ grantedRoleIds: granted, requested: 'expert' });
    expect(denied.status).toBe('not-granted');
    if (denied.status !== 'not-granted') return;
    expect(denied.requested).toBe('expert');
    expect(denied.fallbackRoleId).toBe('owner');
    expect(denied.grantedRoleIds).toEqual([...granted]);

    // No explicit request -> the deterministic default.
    const byDefault = resolveActiveRole({ grantedRoleIds: granted });
    expect(byDefault).toEqual({ status: 'granted', roleId: 'owner', byDefault: true });
  });
});

describe('B017 M1 — role-switch: app-surface layer (the real demo compositions)', () => {
  it('the cockpit projects the same facts through four lenses after each role switch', async () => {
    await bootDemoApp();
    const views = await Promise.all(
      FOUR_REFERENCE_ROLES.map((roleId) => resolveDemoCockpitView(roleId)),
    );

    // Identity/tenancy preserved across every switch.
    for (const view of views) {
      expect(view.mode).toBe('demo');
      expect(view.tenantId).toBe('arena-demo');
      expect(view.workspaceId).toBe('demo-workspace');
      expect(view.principalLabel).toBe('demo-visitor');
      expect(view.demo.isDemo).toBe(true);
      expect(view.roleSwitch.denied).toBe(false);
      expect(view.roleSwitch.grantedRoleIds).toHaveLength(8);
    }

    // The lens (and ONLY the lens) changes.
    expect(views.map((view) => view.roleSwitch.activeRoleId)).toEqual([
      ...FOUR_REFERENCE_ROLES,
    ]);
    expect(new Set(views.map((view) => view.lens.landingTitle))).toHaveLength(
      new Set(['Capability cockpit', 'Assigned work', 'Research queue']).size,
    );
    expect(views[0]?.lens.heroAction.label).toBe('Find what your agent can’t do yet');
    expect(views[1]?.lens.heroAction.label).toBe('Review assigned work');
    expect(views[2]?.lens.heroAction.label).toBe('Improve an Agent Body');
    expect(views[3]?.lens.heroAction.label).toBe('Run a capability experiment');

    // Same data plane: every lens reads the same corpus records.
    for (const view of views) {
      expect(view.doing.cards.map((card) => card.recordId)).toContain(NARRATIVE_RECORD_ID);
      expect(view.demo.corpusHash).toBe(views[0]?.demo.corpusHash);
    }

    // The role switcher renders a link per granted role (explicit query
    // state — the deterministic switch affordance).
    for (const roleId of FOUR_REFERENCE_ROLES) {
      expect(roleSwitchHref('/demo/cockpit', roleId)).toBe(`/demo/cockpit?role=${roleId}`);
    }
    await resetDemoApp();
  });

  it('the case list projects the same canonical cards through four lenses', async () => {
    await bootDemoApp();
    const views = await Promise.all(
      FOUR_REFERENCE_ROLES.map((roleId) => resolveDemoCaseList(roleId)),
    );
    for (const view of views) {
      expect(view.tenantId).toBe('arena-demo');
      expect(view.cards.map((card) => card.recordId)).toEqual([NARRATIVE_RECORD_ID]);
      expect(view.demo.isDemo).toBe(true);
    }
    expect(views.map((view) => view.roleSwitch.activeRoleId)).toEqual([...FOUR_REFERENCE_ROLES]);
    // Lens headings differ (owner/expert/builder/researcher concerns).
    expect(new Set(views.map((view) => view.lens.heading))).toHaveLength(4);
    await resetDemoApp();
  });

  it('the case detail projects the SAME canonical case through four lenses (identity anchors identical)', async () => {
    await bootDemoApp();
    const views = await Promise.all(
      FOUR_REFERENCE_ROLES.map((roleId) => resolveDemoCaseDetail(NARRATIVE_RECORD_ID, roleId)),
    );
    for (const view of views) {
      expect('unreadable' in view).toBe(false);
      if ('unreadable' in view) return;
      // Identity + tenancy preserved after the switch.
      expect(view.tenantId).toBe('arena-demo');
      expect(view.recordId).toBe(NARRATIVE_RECORD_ID);
      expect(view.caseId).toBe('case-payments-reliability');
      expect(view.shape).toBe('narrative');
      expect(view.demo.isDemo).toBe(true);
      expect(view.demo.corpusHash).toBe(views[0] && 'demo' in views[0] ? views[0].demo.corpusHash : undefined);
      expect(view.roleSwitch.denied).toBe(false);
    }
    expect(views.map((view) => ('lens' in view ? view.roleSwitch.activeRoleId : ''))).toEqual([
      ...FOUR_REFERENCE_ROLES,
    ]);
    // The lens questions differ per role (the detail-surface variants).
    const questions = views.map((view) => ('lens' in view ? view.lens.question : ''));
    expect(new Set(questions)).toHaveLength(4);
    expect(questions[0]).toBe('Why is my agent struggling, and what outcome do I need?');
    expect(questions[1]).toBe('What work am I being asked to perform?');
    expect(questions[2]).toBe('What capability is missing from the Body?');
    expect(questions[3]).toBe('What evidence supports the capability hypothesis?');
    await resetDemoApp();
  });

  it('a requested-but-not-granted role renders a truthful denial, never a fake authorization and never a changed identity', async () => {
    await bootDemoApp();
    // The demo context grants all 8 roles, so drive the denial through the
    // composition seam with restricted facts (the honest denial contract).
    const cockpitModule = await import('../../apps/web/src/cockpit/cockpit-view.js');
    const runtimeModule = await import('../../apps/web/src/demo/runtime.js');
    const runtime = await runtimeModule.getDemoRuntime();
    const restrictedFacts = {
      tenantId: 'arena-demo',
      workspaceId: 'demo-workspace',
      principalLabel: 'demo-visitor',
      grantedRoleIds: ['owner'] as const,
    };
    const view = await cockpitModule.buildCockpitHomeView({
      mode: 'demo',
      facts: restrictedFacts,
      port: runtime.reads,
      requestedRoleId: 'expert',
      corpusHash: runtime.corpusHash,
    });
    expect(view.roleSwitch.denied).toBe(true);
    expect(view.roleSwitch.deniedRequested).toBe('expert');
    // The fallback is the honest default, and identity is untouched.
    expect(view.roleSwitch.activeRoleId).toBe('owner');
    expect(view.tenantId).toBe('arena-demo');
    expect(view.principalLabel).toBe('demo-visitor');
    expect(view.roleSwitch.grantedRoleIds).toEqual(['owner']);
    await resetDemoApp();
  });
});

describe('B017 M1 — role-switch: markup layer (rendered views agree on identity, differ in lens)', () => {
  it('four cockpit renders share the identity anchors and differ in lens content', async () => {
    await bootDemoApp();
    const htmls = await Promise.all(
      FOUR_REFERENCE_ROLES.map(async (roleId) =>
        renderToStaticMarkup(
          createElement(CockpitHomeView, { view: await resolveDemoCockpitView(roleId) }),
        ),
      ),
    );
    for (const html of htmls) {
      // Identity anchors: the cockpit route, the active-role mark, the
      // demo banner (the shell itself is asserted by the UX suite).
      expect(html).toContain('data-arena-route="cockpit"');
      expect(html).toContain('data-arena-cockpit-mode="demo"');
      expect(html).toContain('data-arena-demo-banner="true"');
      // The switch is a LENS, never an authorization change — the
      // inspector states it on every render.
      expect(html).toContain('data-arena-inspector-authorization="server-side"');
      // The role switcher is present with the explicit query-state links.
      expect(html).toContain('href="/demo/cockpit?role=expert"');
      expect(html).toContain('href="/demo/cockpit?role=agent-builder"');
    }
    // Lens content differs across the four renders, and the active-role
    // mark follows the switch.
    expect(htmls[0]).toContain('data-arena-active-role="owner"');
    expect(htmls[1]).toContain('data-arena-active-role="expert"');
    expect(htmls[2]).toContain('data-arena-active-role="agent-builder"');
    expect(htmls[3]).toContain('data-arena-active-role="researcher"');
    expect(htmls[0]).toContain('What am I working on?');
    expect(htmls[1]).toContain('What work am I assigned?');
    expect(htmls[2]).toContain('What am I building?');
    expect(htmls[3]).toContain('What is under investigation?');
    expect(new Set(htmls)).toHaveLength(4);
    await resetDemoApp();
  });

  it('four case-detail renders share the record identity and differ in lens content', async () => {
    await bootDemoApp();
    const htmls = await Promise.all(
      FOUR_REFERENCE_ROLES.map(async (roleId) => {
        const detail = await resolveDemoCaseDetail(NARRATIVE_RECORD_ID, roleId);
        if ('unreadable' in detail) throw new Error('narrative case detail unreadable');
        return renderToStaticMarkup(createElement(CaseDetailView, { view: detail }));
      }),
    );
    for (const html of htmls) {
      expect(html).toContain('data-arena-narrative-case="true"');
      expect(html).toContain('data-arena-demo-banner="true"');
      expect(html).toContain(NARRATIVE_RECORD_ID);
      // The role switcher links carry the explicit role query state.
      expect(html).toContain(`role=`);
    }
    expect(new Set(htmls)).toHaveLength(4);
    expect(htmls[0]).toContain('Why is my agent struggling, and what outcome do I need?');
    expect(htmls[1]).toContain('What work am I being asked to perform?');
    expect(htmls[2]).toContain('What capability is missing from the Body?');
    expect(htmls[3]).toContain('What evidence supports the capability hypothesis?');
    await resetDemoApp();
  });

  it('four case-list renders share the cards and differ in lens content', async () => {
    await bootDemoApp();
    const htmls = await Promise.all(
      FOUR_REFERENCE_ROLES.map(async (roleId) =>
        renderToStaticMarkup(
          createElement(CaseListView, { view: await resolveDemoCaseList(roleId) }),
        ),
      ),
    );
    for (const html of htmls) {
      expect(html).toContain('data-arena-mode="demo"');
      expect(html).toContain('data-arena-case-shape="narrative"');
      expect(html).toContain(NARRATIVE_RECORD_ID);
    }
    expect(new Set(htmls)).toHaveLength(4);
    await resetDemoApp();
  });
});
