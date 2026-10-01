import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Home-route composition tests (Work Order B007): the landing-vs-cockpit
 * decision (fail closed on the session probe), the requested-role query
 * state, and the demo cockpit resolution. The authenticated path uses the
 * REAL B004 local auth stack (the same composition shape the boundary
 * mounts) through the injected probe seam.
 */

import { resolveDemoCockpitView, resolveHomeExperience } from './home-route.js';
import { CockpitHomeView } from './cockpit-home-view.js';
import type { SessionProbe } from './runtime.js';
import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../packages/role-context/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE: SessionProbe = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

async function authenticatedProbe(): Promise<SessionProbe> {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'test-session-secret-0123456789abcdefghijklmnop',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'worker-1',
          kind: 'customer-identity',
          tenantScope: 'tenant-alpha',
          roles: ['tenant-member'],
          label: 'worker-one',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({
    method: 'test-login',
    claims: { who: 'worker-1' },
  });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId: 'tenant-alpha',
    workspaceContext: createWorkspaceContext({
      identityId: 'worker-1',
      tenantId: 'tenant-alpha',
      workspaceId: 'tenant-alpha-ws',
      permissionPolicy: createPermissionPolicy({
        policyId: 'alpha-policy',
        tenantId: 'tenant-alpha',
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: [
        grantRole({
          grantId: 'grant-owner',
          identityId: 'worker-1',
          tenantId: 'tenant-alpha',
          roleId: 'owner',
          policyId: 'alpha-policy',
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ],
    }),
    authMethod: createAuthMethodDescriptor({ method: 'test-login', claims: { who: 'worker-1' } }),
  });
  const cookieValue = issuance.cookie.value;
  return {
    cookieValue: () => Promise.resolve(cookieValue),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

describe('resolveHomeExperience (the authenticated / experience)', () => {
  it('renders the first-run landing for an unauthenticated visitor (fail closed, never an anonymous cockpit)', async () => {
    const experience = await resolveHomeExperience({ probe: NO_COOKIE_PROBE });
    expect(experience).toEqual({ kind: 'landing' });
  });

  it('propagates a non-auth session-probe failure (never a silent landing for a broken boundary)', async () => {
    await expect(
      resolveHomeExperience({
        probe: {
          cookieValue: () => Promise.reject(new Error('boundary exploded')),
          validate: () => Promise.reject(new Error('unreachable')),
        },
      }),
    ).rejects.toThrow('boundary exploded');
  });

  it('routes an authenticated visitor to the cockpit for their granted default role', async () => {
    const experience = await resolveHomeExperience({ probe: await authenticatedProbe() });
    expect(experience.kind).toBe('cockpit');
    if (experience.kind !== 'cockpit') return;
    expect(experience.view.mode).toBe('session');
    expect(experience.view.tenantId).toBe('tenant-alpha');
    expect(experience.view.roleSwitch.activeRoleId).toBe('owner');
    expect(experience.view.roleSwitch.denied).toBe(false);
    expect(experience.view.demo.isDemo).toBe(false);
    const html = renderToStaticMarkup(<CockpitHomeView view={experience.view} />);
    expect(html).toContain('data-arena-route="cockpit"');
    expect(html).toContain('data-arena-cockpit-mode="session"');
    expect(html).not.toContain('data-arena-demo-banner');
  });

  it('applies an explicitly requested granted role; truthfully denies a non-granted one', async () => {
    const probe = await authenticatedProbe();
    const granted = await resolveHomeExperience({ probe, requestedRoleId: 'owner' });
    if (granted.kind !== 'cockpit') throw new Error('expected cockpit');
    expect(granted.view.roleSwitch.activeRoleId).toBe('owner');
    const denied = await resolveHomeExperience({ probe, requestedRoleId: 'expert' });
    if (denied.kind !== 'cockpit') throw new Error('expected cockpit');
    expect(denied.view.roleSwitch.denied).toBe(true);
    expect(denied.view.roleSwitch.deniedRequested).toBe('expert');
    expect(denied.view.roleSwitch.activeRoleId).toBe('owner');
  });
});

describe('resolveDemoCockpitView (the demo posture)', () => {
  it('builds a deterministic, demo-labelled cockpit view over the demo runtime', async () => {
    const view = await resolveDemoCockpitView();
    expect(view.mode).toBe('demo');
    expect(view.demo.isDemo).toBe(true);
    expect(typeof view.demo.corpusHash).toBe('string');
    expect(view.roleSwitch.activeRoleId).toBe('owner');
    const html = renderToStaticMarkup(<CockpitHomeView view={view} />);
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-route="cockpit"');
  });

  it('honors explicit query-state role lenses (all eight reference roles)', async () => {
    for (const roleId of [
      'owner',
      'agent-builder',
      'expert',
      'evaluator',
      'researcher',
      'operator',
      'marketplace-participant',
      'administrator',
    ]) {
      const view = await resolveDemoCockpitView(roleId);
      expect(view.roleSwitch.activeRoleId).toBe(roleId);
      expect(view.roleSwitch.denied).toBe(false);
    }
  });

  it('is byte-identical across two resolutions of the same lens', async () => {
    const first = await resolveDemoCockpitView('expert');
    const second = await resolveDemoCockpitView('expert');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
