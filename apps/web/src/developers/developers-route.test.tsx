/**
 * Developers-route composition tests (Work Order C017) — the fail-closed
 * route outcome (auth-required), the deterministic DEMO compositions
 * (visibly labelled; sandbox truth labels; consequence exposure; the
 * shown-once secret moment), the honest session-posture empty states,
 * and the SDK quickstart generated from the REAL ES1.0 contract
 * vocabulary. House style: REAL composed boundaries with injected
 * session probes (the operations-route test pattern).
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
  DevelopersAuthRequiredView,
  DevelopersErrorView,
  DevelopersLoadingView,
  resolveDevelopersHomeExperience,
  resolveDevelopersKeysExperience,
  resolveDevelopersObservabilityExperience,
  resolveDevelopersQuickstartExperience,
  resolveDevelopersSandboxExperience,
  resetDemoDevelopersContext,
} from './index.js';
import { ESCALATION_MODES, ESCALATION_URGENCIES } from '../../../../packages/escalation/src/index.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session probe for one tenant (the cockpit pattern). */
async function buildSessionProbe(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'c017-test-session-secret-0123456789abcdefghij',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-c017-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `c017-${who}`,
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
      identityId: `principal-c017-${who}`,
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
          identityId: `principal-c017-${who}`,
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

describe('fail-closed: unauthenticated visitors never see an anonymous portal', () => {
  it('every developers route renders the auth-required notice (negative)', async () => {
    for (const resolve of [
      resolveDevelopersHomeExperience,
      resolveDevelopersKeysExperience,
      resolveDevelopersQuickstartExperience,
      resolveDevelopersSandboxExperience,
      resolveDevelopersObservabilityExperience,
    ]) {
      const experience = await resolve({ probe: NO_COOKIE_PROBE });
      expect(experience.kind).toBe('auth-required');
      const html = render(experience.view);
      expect(html).toContain('data-arena-surface-auth="required"');
      expect(html).toContain('authenticated session (B004 session boundary)');
    }
  });

  it('the auth-required view renders standalone (permission-denied state)', () => {
    const html = render(<DevelopersAuthRequiredView />);
    expect(html).toContain('data-arena-state="denied"');
    expect(html).not.toContain('dak_');
  });
});

describe('deterministic DEMO composition (visibly labelled, never customer state)', () => {
  let demoProbe: Awaited<ReturnType<typeof buildSessionProbe>>;

  beforeAll(async () => {
    resetDemoDevelopersContext();
    demoProbe = await buildSessionProbe('arena-demo', 'demo-dev');
  });

  it('the portal home renders demo-labelled facts', async () => {
    const experience = await resolveDevelopersHomeExperience({ probe: demoProbe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('data-arena-fact="client-apps"');
    expect(html).toContain('never confers human role authority');
  });

  it('the keys page shows the shown-once moment (demo-labelled) + consequence exposure', async () => {
    const experience = await resolveDevelopersKeysExperience({ probe: demoProbe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-secret="once"');
    expect(html).toMatch(/dak_sandbox_[0-9a-f]{64}/);
    expect(html).toContain('demo-labelled example secret');
    // Consequence exposure per the UX gate law.
    expect(html).toContain('Consequence exposure');
    expect(html).toContain('Revoking is terminal');
    expect(html).toContain('Rotating mints a new secret');
  });

  it('the sandbox console shows the canned run, its events and the truth labels', async () => {
    const experience = await resolveDevelopersSandboxExperience({ probe: demoProbe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-list="sandbox-events"');
    expect(html).toContain('escalation.created');
    expect(html).toContain('escalation.progressed');
    expect(html).toContain('demo money');
    expect(html).toContain('data-arena-scenario="boq-quantity-takeoff"');
  });

  it('the observability dashboard projects state/validation/SLA/cost with the demo label', async () => {
    const experience = await resolveDevelopersObservabilityExperience({ probe: demoProbe });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-table="escalations"');
    expect(html).toContain('data-arena-truth="sandbox"');
    expect(html).toContain('data-arena-fact="sla"');
    expect(html).toContain('data-arena-list="webhook-events"');
    expect(html).toContain('data-arena-state="stale"');
  });
});

describe('authenticated non-demo session: honest empty states (never fabricated)', () => {
  it('home renders the empty client-apps state; keys render the empty key state', async () => {
    const probe = await buildSessionProbe('tenant-c017', 'live-dev');
    const home = await resolveDevelopersHomeExperience({ probe });
    expect(home.kind).toBe('ok');
    const homeHtml = render(home.view);
    expect(homeHtml).toContain('data-arena-demo="false"');
    expect(homeHtml).toContain('No client applications registered yet');

    const keys = await resolveDevelopersKeysExperience({ probe });
    const keysHtml = render(keys.view);
    expect(keysHtml).toContain('No API keys yet');
    // NO secret material ever renders in the session posture.
    expect(keysHtml).not.toContain('dak_');
    expect(keysHtml).not.toContain('data-arena-secret');
  });

  it('observability renders the honest empty dashboard state', async () => {
    const probe = await buildSessionProbe('tenant-c017', 'live-dev');
    const experience = await resolveDevelopersObservabilityExperience({ probe });
    const html = render(experience.view);
    expect(html).toContain('No client application selected');
  });
});

describe('SDK quickstart — generated from the REAL contract vocabulary', () => {
  it('renders the trivial first path with the live modes/urgencies/version', async () => {
    const probe = await buildSessionProbe('tenant-c017', 'live-dev');
    const experience = await resolveDevelopersQuickstartExperience({ probe });
    const html = render(experience.view);
    expect(html).toContain('POST /v1/escalations');
    expect(html).toContain(`requestVersion`);
    // The snippet carries the real closed vocabularies (drift-tested).
    for (const mode of ESCALATION_MODES.slice(0, 1)) {
      expect(html).toContain(`&quot;${mode}&quot;`);
    }
    expect(html).toContain(ESCALATION_URGENCIES.join(' | '));
    expect(html).not.toContain('dak_');
    expect(html).not.toContain('whsec_');
  });
});

describe('the honest error and loading states (UX quality gates)', () => {
  it('the error view renders fail-closed with a retry action', () => {
    const html = render(<DevelopersErrorView detail="escalation port unwired (fail closed)" />);
    expect(html).toContain('data-arena-state="error"');
    expect(html).toContain('Portal read failed');
    expect(html).toContain('fail closed');
  });

  it('the loading view renders the pending state', () => {
    const html = render(<DevelopersLoadingView />);
    expect(html).toContain('data-arena-state="loading"');
  });
});
