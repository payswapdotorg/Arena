/**
 * Route-mount tests for `/competitions/**` (P005/S-01): the mounts the
 * route inventory added over the C013 feature module. House style
 * (app.test.tsx precedent): session-aware mounts are asserted
 * STRUCTURALLY (async server components — calling them outside a
 * request scope would misread the session), the loading state renders
 * directly, and the exact composition each mount delegates to is
 * exercised through the resolvers' injected-probe seam: the fail-closed
 * auth boundary, the deterministic visibly-labelled DEMO truth state
 * (ADR-P001-02), and the honest session-empty truth state.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ManualClock } from '../../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_EPOCH_MS } from '@arena/demo';
import {
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
} from '../../../../../packages/role-context/src/index.js';
import { createLocalAuthStack } from '../../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../../packages/auth/src/index.js';
import { toSecurityPrincipal } from '../../../../../packages/security/src/index.js';

import CompetitionsHome from './page.js';
import CompetitionsDetail from './[id]/page.js';
import CompetitionsLoading from './loading.js';
import {
  CompetitionsLoadingView,
  buildDemoCompetitionsCorpus,
  resolveCompetitionsHomeExperience,
  resolveCompetitionDetailExperience,
} from '../../competitions/index.js';

const T = '2026-10-01T08:00:00.000Z';

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

/** Build a REAL authenticated session probe for one tenant (the C013 pattern). */
async function buildSessionProbe(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'p005-mount-test-session-secret-0123456789',
    credentials: [
      {
        credential: createAuthMethodDescriptor({ method: 'test-login', claims: { who } }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: `principal-p005-${who}`,
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-owner'],
          label: `p005-${who}`,
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
      identityId: `principal-p005-${who}`,
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
          identityId: `principal-p005-${who}`,
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

const DEMO_COMPETITION_ID = buildDemoCompetitionsCorpus().competition.competitionId;

describe('the /competitions mounts (S-01: thin mounts over the C013 resolvers)', () => {
  it('mounts the arena home and the competition detail as async server components', () => {
    // The mounts delegate to resolveCompetitionsHomeExperience /
    // resolveCompetitionDetailExperience (probe -> auth-required |
    // demo | session-empty); calling them outside a request scope would
    // misread the session, so the mounts are asserted structurally here
    // (the B007 home precedent).
    expect(CompetitionsHome.constructor.name).toBe('AsyncFunction');
    expect(CompetitionsDetail.constructor.name).toBe('AsyncFunction');
  });

  it('the loading route renders the honest pending state', () => {
    const html = render(<CompetitionsLoading />);
    expect(html).toContain('data-arena-state="loading"');
    expect(html).toContain('data-arena-route="competitions"');
    expect(render(<CompetitionsLoadingView />)).toContain('role="status"');
  });

  it('both mounts carry distinct route metadata (no generic shell title)', async () => {
    const { metadata } = await import('./page.js');
    const { metadata: detailMetadata } = await import('./[id]/page.js');
    expect(metadata.title).toBe('Expert Arena');
    expect(detailMetadata.title).toBe('Competition');
  });
});

describe('the mounted composition: fail-closed auth boundary (never an anonymous arena)', () => {
  it('the home experience renders auth-required for a cookie-less visitor', async () => {
    const experience = await resolveCompetitionsHomeExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    const html = render(experience.view);
    expect(html).toContain('data-arena-state="denied"');
    expect(html).toContain('data-arena-surface-auth="required"');
  });

  it('the detail experience renders auth-required for a cookie-less visitor', async () => {
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: NO_COOKIE_PROBE,
    });
    expect(experience.kind).toBe('auth-required');
    expect(render(experience.view)).toContain('data-arena-state="denied"');
  });
});

describe('the mounted composition: the DEMO truth lens is visibly labelled (ADR-P001-02)', () => {
  it('the demo tenant reads the deterministic, labelled demo corpus', async () => {
    const experience = await resolveCompetitionsHomeExperience({
      probe: await buildSessionProbe('arena-demo', 'demo-operator'),
    });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-route="competitions-home"');
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('data-arena-truth="demo"');
    expect(html).toContain('Demo data');
  });

  it('the demo detail renders the full chain for the demo competition only', async () => {
    const experience = await resolveCompetitionDetailExperience(DEMO_COMPETITION_ID, {
      probe: await buildSessionProbe('arena-demo', 'demo-operator'),
    });
    expect(experience.kind).toBe('ok');
    expect(render(experience.view)).toContain('data-arena-route="competition-detail"');
  });
});

describe('the mounted composition: session tenants get the honest empty state', () => {
  it('a non-demo session renders the empty arena (never fabricated competitions)', async () => {
    const experience = await resolveCompetitionsHomeExperience({
      probe: await buildSessionProbe('acme', 'acme-operator'),
    });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="false"');
    expect(html).toContain('data-arena-state="empty"');
    expect(html).not.toContain('DEMO DATA');
  });
});
