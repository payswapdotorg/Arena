/**
 * Human-data route composition tests (Work Order C012) — the fail-closed
 * route outcome (auth-required), the deterministic DEMO compositions
 * (visibly labelled; consequence exposure; the rights wall surfaced; the
 * download gate), and the honest session-posture empty states. House
 * style: REAL composed boundaries with injected session probes (the
 * developers-route test pattern).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';

import {
  HumanDataAuthRequiredView,
  HumanDataErrorView,
  HumanDataLoadingView,
  resetDemoHumanDataContext,
  resolveHumanDataDatasetsExperience,
  resolveHumanDataHomeExperience,
  resolveHumanDataProductionExperience,
} from './index.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session probe for one tenant (the cockpit pattern). */
async function buildSessionProbe(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'c012-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-c012-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `c012-${who}`,
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({ method: 'test-login', claims: { who } });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: createWorkspaceContext({
      identityId: `principal-c012-${who}`,
      tenantId,
      workspaceId: `${tenantId}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: `${tenantId}-policy`,
        tenantId,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['owner'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: `principal-c012-${who}`,
          tenantId,
          roleId,
          policyId: `${tenantId}-policy`,
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ),
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
  });
  return {
    cookieValue: () => Promise.resolve(issuance.cookie.value),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

describe('fail-closed: unauthenticated visitors never see an anonymous studio', () => {
  it('every human-data route renders the auth-required notice (negative)', async () => {
    for (const resolve of [
      resolveHumanDataHomeExperience,
      resolveHumanDataProductionExperience,
      resolveHumanDataDatasetsExperience,
    ]) {
      const experience = await resolve({ probe: NO_COOKIE_PROBE });
      expect(experience.kind).toBe('auth-required');
      const html = render(experience.view);
      expect(html).toContain('data-arena-surface-auth="required"');
      expect(html).toContain('authenticated session (B004 session boundary)');
      expect(html).toContain('rights wall is structural');
    }
  });

  it('the auth-required, error and loading views render standalone (state set)', () => {
    expect(render(<HumanDataAuthRequiredView />)).toContain('data-arena-surface-auth="required"');
    const errorHtml = render(<HumanDataErrorView detail="boom (test)" />);
    expect(errorHtml).toContain('data-arena-state="error"');
    expect(errorHtml).toContain('boom (test)');
    expect(render(<HumanDataLoadingView />)).toContain('data-arena-state="loading"');
  });
});

describe('the demo composition (deterministic, visibly labelled, walls surfaced)', () => {
  beforeAll(() => {
    resetDemoHumanDataContext();
  });

  it('the builder renders the declared commission with consequence exposure', async () => {
    const probe = await buildSessionProbe('arena-demo', 'demo-commissioner');
    const experience = await resolveHumanDataHomeExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('demo state is never customer state');
    expect(html).toContain('demo-triage-demonstrations');
    expect(html).toContain('capability need');
    expect(html).toContain('consequence exposure');
    expect(html).toContain('minimum accepted ratio');
    expect(html).toContain('ERF1.0');
  });

  it('the production dashboard renders the live C001 escalation projections', async () => {
    const probe = await buildSessionProbe('arena-demo', 'demo-commissioner');
    const experience = await resolveHumanDataProductionExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-route="human-data-production"');
    expect(html).toMatch(/esc_[0-9a-f]{32}/);
    expect(html).toContain('in_production');
    expect(html).toContain('C001 state');
  });

  it('the dataset delivery page renders the manifest, rights/lineage view and the download gate', async () => {
    const probe = await buildSessionProbe('arena-demo', 'demo-commissioner');
    const experience = await resolveHumanDataDatasetsExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-route="human-data-datasets"');
    expect(html).toMatch(/[0-9a-f]{64}/);
    expect(html).toContain('arena-demo/demo-triage-corrections');
    expect(html).toContain('redistribution');
    expect(html).toContain('data-arena-download="permitted"');
    expect(html).toContain('no self-certified deliverables');
    expect(html).toContain('consent/rights statement');
  });
});

describe('the session composition (honest empty states in the local posture)', () => {
  it('a non-demo authenticated tenant sees honest empty states, never fabricated data', async () => {
    const probe = await buildSessionProbe('tenant-session-a', 'session-commissioner');
    for (const resolve of [
      resolveHumanDataHomeExperience,
      resolveHumanDataProductionExperience,
      resolveHumanDataDatasetsExperience,
    ]) {
      const experience = await resolve({ probe });
      expect(experience.kind).toBe('ok');
      const html = render(experience.view);
      expect(html).toContain('data-arena-demo="false"');
      expect(html).not.toContain('data-arena-download');
      expect(html).not.toMatch(/esc_[0-9a-f]{32}/);
    }
    const home = await resolveHumanDataHomeExperience({ probe });
    expect(render(home.view)).toContain('No commission declared yet');
    const production = await resolveHumanDataProductionExperience({ probe });
    expect(render(production.view)).toContain('No commission in production');
    const datasets = await resolveHumanDataDatasetsExperience({ probe });
    expect(render(datasets.view)).toContain('No dataset delivered yet');
  });
});
