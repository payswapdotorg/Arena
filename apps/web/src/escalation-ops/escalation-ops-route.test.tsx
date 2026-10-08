/**
 * Escalation-ops route composition tests (Work Order C021) — the
 * fail-closed route outcome (auth-required), the deterministic DEMO
 * composition (visibly labelled; timelines with dwell; met/at-risk/
 * breached SLA vocabulary; disclosed SLO formulas; small-sample
 * status; alert-rule projections), and the honest session-posture
 * empty states. House style: REAL composed boundaries with injected
 * session probes (the human-data/developers route test pattern).
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
  EscalationOpsAuthRequiredView,
  EscalationOpsErrorView,
  EscalationOpsLoadingView,
  resetDemoEscalationOpsContext,
  resolveEscalationOpsBoardExperience,
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
    secret: 'c021-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-c021-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `c021-${who}`,
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
      identityId: `principal-c021-${who}`,
      tenantId,
      workspaceId: `${tenantId}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: `${tenantId}-policy`,
        tenantId,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: ['operator'].map((roleId) =>
        grantRole({
          grantId: `grant-${roleId}`,
          identityId: `principal-c021-${who}`,
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

describe('fail-closed: unauthenticated visitors never see an anonymous ops surface', () => {
  it('the board renders the auth-required notice (negative)', async () => {
    const experience = await resolveEscalationOpsBoardExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = render(experience.view);
    expect(html).toContain('data-arena-surface-auth="required"');
    expect(html).toContain('B004 session boundary');
  });

  it('the auth-required, error and loading views render standalone (state set)', () => {
    expect(render(<EscalationOpsAuthRequiredView />)).toContain(
      'data-arena-surface-auth="required"',
    );
    const errorHtml = render(<EscalationOpsErrorView detail="boom (test)" />);
    expect(errorHtml).toContain('data-arena-state="error"');
    expect(errorHtml).toContain('boom (test)');
    expect(render(<EscalationOpsLoadingView />)).toContain('data-arena-state="loading"');
  });
});

describe('the demo composition (deterministic, visibly labelled, measured states)', () => {
  beforeAll(() => {
    resetDemoEscalationOpsContext();
  });

  it('renders timelines with dwell, SLA states, SLO formulas and health signals', async () => {
    const probe = await buildSessionProbe('arena-demo', 'demo-operator');
    const experience = await resolveEscalationOpsBoardExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    // Visibly labelled demo data.
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('Demo state is never customer state');
    // Role lens note (Operator/Admin lenses frame, never authorize).
    expect(html).toContain('lens, not authorization');
    expect(html).toContain('Operator lens: queue health');
    // Escalation list + timeline dwell.
    expect(html).toContain('Escalations');
    expect(html).toContain('dwell');
    expect(html).toContain('expert_replaced');
    // SLA vocabulary: met + breached (R3 timed out unaccepted) with reasons.
    expect(html).toContain('breached');
    expect(html).toContain('clock-breached-deadline-passed');
    expect(html).toContain('met');
    // SLO rollups with disclosed formula + sample size.
    expect(html).toContain('good / total');
    expect(html).toContain('small sample');
    // Network health signals.
    expect(html).toContain('Matching latency');
    expect(html).toContain('Replacement rate');
    // Alert-rule projections cite the catalog ancestry.
    expect(html).toContain('alert-catalog');
  });

  it('is deterministic: the same session composes the same board twice', async () => {
    const probe = await buildSessionProbe('arena-demo', 'demo-operator-2');
    const first = render((await resolveEscalationOpsBoardExperience({ probe })).view);
    const second = render((await resolveEscalationOpsBoardExperience({ probe })).view);
    expect(first).toBe(second);
  });
});

describe('the session posture (non-demo tenant — honest empty states)', () => {
  it('renders the honest empty board, never a fabricated one', async () => {
    const probe = await buildSessionProbe('acme', 'ops-viewer');
    const experience = await resolveEscalationOpsBoardExperience({ probe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="false"');
    expect(html).toContain('No projected escalations yet');
    expect(html).toContain('honest empty state');
    expect(html).toContain('No measured SLA records yet');
    expect(html).toContain('No health signals measured yet');
  });
});
