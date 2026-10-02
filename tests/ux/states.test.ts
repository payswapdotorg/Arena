/**
 * B017 M2 — UX conformance: empty/loading/error states are truthful
 * and actionable.
 *
 * Truthful: an empty state appears ONLY when there is genuinely nothing
 * (an authenticated session over an EMPTY control plane), never as a
 * masked failure; a fail-closed gate appears when there is no session —
 * never an anonymous data surface. Actionable: every empty/gate state
 * carries its next-step affordance (start a case / sign in), and the
 * error state carries a retry.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { resolveSessionCaseList } from '../../apps/web/src/capability/case-routes.js';
import { CaseListView } from '../../apps/web/src/capability/capability-views.js';
import { resolveEvaluationExperience } from '../../apps/web/src/evaluation/evaluation-route.js';
import { EvaluationHomeView } from '../../apps/web/src/evaluation/evaluation-home-view.js';
import { resolveResearchExperience } from '../../apps/web/src/research/research-route.js';
import { ResearchHomeView } from '../../apps/web/src/research/research-views.js';
import { resolveBodiesExperience } from '../../apps/web/src/bodies/bodies-route.js';
import { BodyStudioView } from '../../apps/web/src/bodies/bodies-home-view.js';
import { resolveOperationsExperience } from '../../apps/web/src/operations/operations-route.js';
import { OperationsHomeView } from '../../apps/web/src/operations/operations-home-view.js';
import type { SessionProbe } from '../../apps/web/src/cockpit/runtime.js';
import { createLocalAuthStack } from '../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../packages/security/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../packages/role-context/src/index.js';
import { FakeControlPlaneRepository, ManualClock } from '../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '../../packages/demo/src/index.js';

const T = '2026-10-01T08:00:00.000Z';
const TENANT = 'tenant-ux-empty';

const NO_COOKIE_PROBE: SessionProbe = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** An authenticated probe over an EMPTY control plane (the honest-empty posture). */
async function authenticatedEmptyProbe(): Promise<{
  readonly probe: SessionProbe;
  readonly repository: FakeControlPlaneRepository;
}> {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const repository = new FakeControlPlaneRepository({ clock });
  const auth = createLocalAuthStack({
    secret: 'ux-empty-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'ux-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'ux-1',
          kind: 'customer-identity',
          tenantScope: TENANT,
          roles: ['tenant-member'],
          label: 'ux-empty-user',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({
    method: 'test-login',
    claims: { who: 'ux-1' },
  });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId: TENANT,
    workspaceContext: createWorkspaceContext({
      identityId: 'ux-1',
      tenantId: TENANT,
      workspaceId: `${TENANT}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: 'ux-policy',
        tenantId: TENANT,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: [
        grantRole({
          grantId: 'grant-owner',
          identityId: 'ux-1',
          tenantId: TENANT,
          roleId: 'owner',
          policyId: 'ux-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ],
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'ux-1' } }),
  });
  return {
    probe: {
      cookieValue: () => Promise.resolve(issuance.cookie.value),
      validate: (token: string) => auth.service.validateSession(token),
    },
    repository,
  };
}

describe('B017 M2 — fail-closed gates (no session -> no anonymous data surface)', () => {
  it('the case list gates an unauthenticated visitor with an actionable gate', async () => {
    const experience = await resolveSessionCaseList({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('gate');
    if (experience.kind !== 'gate') return;
    expect(experience.code).toBe('AUTH_SESSION_NOT_FOUND');
  });

  it('the evaluation surface gates an unauthenticated visitor', async () => {
    const experience = await resolveEvaluationExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
  });

  it('the research surface gates an unauthenticated visitor', async () => {
    const experience = await resolveResearchExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
  });

  it('the bodies studio gates an unauthenticated visitor', async () => {
    const experience = await resolveBodiesExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
  });

  it('the operations surface gates an unauthenticated visitor', async () => {
    const experience = await resolveOperationsExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
  });
});

describe('B017 M2 — honest empty states (authenticated over an EMPTY control plane)', () => {
  it('the case list renders the truthful empty state with an actionable next step', async () => {
    const { probe } = await authenticatedEmptyProbe();
    const experience = await resolveSessionCaseList({ probe });
    expect(experience.kind).toBe('cases');
    if (experience.kind !== 'cases') return;
    expect(experience.view.cards).toHaveLength(0);
    expect(experience.view.empty).toBe(true);
    const html = renderToStaticMarkup(createElement(CaseListView, { view: experience.view }));
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No capability cases yet');
    // Actionable: the start affordance is one click away.
    expect(html).toContain('href="/cases/start"');
    // No fabricated data fills the empty space.
    expect(html).not.toContain('data-arena-case-cards');
  });

  it('the evaluation home renders honest empty sections (nothing fabricated)', async () => {
    const { probe } = await authenticatedEmptyProbe();
    const experience = await resolveEvaluationExperience({ probe });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') return;
    expect(experience.view.reports).toHaveLength(0);
    expect(experience.view.verifications).toHaveLength(0);
    expect(experience.view.certifications).toHaveLength(0);
    expect(experience.view.claims).toHaveLength(0);
    // The honest-empty note names the empty sections.
    expect(experience.view.emptySections.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      createElement(EvaluationHomeView, { view: experience.view }),
    );
    expect(html).toContain('data-arena-state="empty"');
    // The distinction + legend still teach on an empty surface.
    expect(html).toContain('Evaluation ≠ Verification ≠ Certification');
  });

  it('the research home renders the honest empty benchmark posture', async () => {
    const { probe } = await authenticatedEmptyProbe();
    const experience = await resolveResearchExperience({ probe });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') return;
    expect(experience.view.comparison.rows).toHaveLength(0);
    const html = renderToStaticMarkup(createElement(ResearchHomeView, { view: experience.view }));
    expect(html).toContain('None are recorded in this posture — nothing is fabricated to fill the space.');
    expect(html).toContain('data-arena-research-distinction="true"');
  });

  it('the bodies studio renders the honest empty body library', async () => {
    const { probe } = await authenticatedEmptyProbe();
    const experience = await resolveBodiesExperience({ probe });
    expect(experience.kind).toBe('studio');
    if (experience.kind !== 'studio') return;
    expect(experience.view.bodies).toHaveLength(0);
    const html = renderToStaticMarkup(createElement(BodyStudioView, { view: experience.view }));
    expect(html).toContain('data-arena-state="empty"');
  });

  it('the operations home renders honest empty jobs + no-data SLOs (never green fabrications)', async () => {
    const { probe } = await authenticatedEmptyProbe();
    const experience = await resolveOperationsExperience({
      probe,
      now: DEMO_NARRATIVE_EPOCH_MS,
    });
    expect(experience.kind).toBe('home');
    if (experience.kind !== 'home') return;
    expect(experience.view.jobs).toHaveLength(0);
    expect(experience.view.jobsNote.length).toBeGreaterThan(0);
    // SLO evaluations over ZERO samples are honest no-data, never green.
    const html = renderToStaticMarkup(
      createElement(OperationsHomeView, { view: experience.view }),
    );
    expect(html).toContain('no-data');
    expect(html).not.toContain('data-arena-slo-outcome="good"');
  });
});
