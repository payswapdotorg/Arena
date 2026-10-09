/**
 * Route-mount tests for `/body-marketplace/**` (P005/S-02): the mounts
 * the route inventory added over the C014 feature module, plus the
 * mount-owned session-probe wiring that adapts the feature's
 * `BodyMarketplaceSessionProbe` contract onto the REAL B004 session
 * boundary. House style (app.test.tsx precedent): session-aware mounts
 * are asserted STRUCTURALLY (async server components), the pure probe
 * seams are unit-tested directly, and the exact composition each mount
 * delegates to is exercised through the resolvers' injected-probe seam:
 * the fail-closed auth boundary, the deterministic visibly-labelled DEMO
 * truth state (ADR-P001-02), the honest session-empty truth state, and
 * the explicit `?lens=` role-lens query state.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

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
import type { AuthenticatedSession } from '../../../../../services/auth/src/index.js';
import { AuthError, AUTH_ERROR_CODES } from '../../../../../packages/auth/src/index.js';

import BodyMarketplacePage from './page.js';
import ListingDetailPage from './listings/[listingId]/page.js';
import RequestPretrainingPage from './request-pretraining/page.js';
import MyListingsPage from './my-listings/page.js';
import BodyMarketplaceLoading from './loading.js';
import {
  sessionToFacts,
  validateSessionToFacts,
} from './_lib/session-probe.js';
import {
  BodyMarketplaceLoadingView,
  DEMO_TENANT,
  resetDemoBodyMarketplaceContext,
  resolveBodyMarketplaceBrowseExperience,
  resolveBodyMarketplaceMyListingsExperience,
} from '../../body-marketplace/index.js';

const T = '2026-10-01T08:00:00.000Z';

beforeAll(() => {
  resetDemoBodyMarketplaceContext();
});

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

/** A REAL authenticated session for one tenant over the local auth stack. */
async function buildSession(tenantId: string, who: string) {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'p005-bm-mount-session-secret-0123456789ab',
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
  return { auth, cookieValue: issuance.cookie.value, session: issuance.session };
}

/** The mount's own probe wiring over a REAL session (the _lib seam). */
function probeOver(session: Awaited<ReturnType<typeof buildSession>>) {
  return {
    cookieValue: () => Promise.resolve(session.cookieValue),
    validate: (token: string) =>
      validateSessionToFacts((value) => session.auth.service.validateSession(value), token),
  };
}

const NO_COOKIE_PROBE = {
  cookieValue: () => Promise.resolve(null),
  validate: () => Promise.reject(new Error('unreachable')),
};

describe('the /body-marketplace mounts (S-02: thin mounts over the C014 resolvers)', () => {
  it('mounts browse, listing detail, request-pretraining and my-listings as async server components', () => {
    // The mounts delegate to the C014 resolvers with the REAL session
    // probe wired through the B004 boundary; calling them outside a
    // request scope would misread the session, so the mounts are
    // asserted structurally here (the B007 home precedent).
    expect(BodyMarketplacePage.constructor.name).toBe('AsyncFunction');
    expect(ListingDetailPage.constructor.name).toBe('AsyncFunction');
    expect(RequestPretrainingPage.constructor.name).toBe('AsyncFunction');
    expect(MyListingsPage.constructor.name).toBe('AsyncFunction');
  });

  it('the loading route renders the honest pending state', () => {
    const html = render(<BodyMarketplaceLoading />);
    expect(html).toContain('data-arena-state="loading"');
    expect(html).toContain('Loading capability bodies');
    expect(render(<BodyMarketplaceLoadingView />)).toContain('data-arena-state="loading"');
  });

  it('every mount carries distinct route metadata (no generic shell title)', async () => {
    const { metadata: browse } = await import('./page.js');
    const { metadata: detail } = await import('./listings/[listingId]/page.js');
    const { metadata: pretraining } = await import('./request-pretraining/page.js');
    const { metadata: myListings } = await import('./my-listings/page.js');
    expect(browse.title).toBe('Capability-body marketplace');
    expect(detail.title).toBe('Marketplace listing');
    expect(pretraining.title).toBe('Request pretraining');
    expect(myListings.title).toBe('My listings');
  });
});

describe('the mount-owned session probe (the B004 boundary wiring)', () => {
  it('projects a validated session onto the probe facts (tenant, label, granted roles)', async () => {
    const { session } = await buildSession('acme', 'acme-operator');
    const facts = sessionToFacts(session);
    expect(facts.tenantId).toBe('acme');
    expect(facts.principalLabel).toBe('p005-acme-operator');
    expect(facts.roles).toContain('owner');
  });

  it('falls back to the principal id when the label is absent', async () => {
    const { session } = await buildSession('acme', 'nolabel');
    const unlabeled = { ...session, principal: { ...session.principal, label: null } };
    expect(sessionToFacts(unlabeled).principalLabel).toBe('principal-p005-nolabel');
  });

  it('fails closed when the session tenant and workspace tenant disagree', async () => {
    const { session } = await buildSession('acme', 'mismatch');
    const tampered = {
      ...session,
      workspaceContext: {
        ...session.workspaceContext,
        tenantId: 'evil' as unknown as typeof session.workspaceContext.tenantId,
      },
    } satisfies AuthenticatedSession;
    expect(() => sessionToFacts(tampered)).toThrow(/does not match workspace tenant/);
  });

  it('maps typed AUTH_* validation failures to the unauthenticated outcome (null)', async () => {
    const failing = () =>
      Promise.reject(new AuthError(AUTH_ERROR_CODES.SESSION_NOT_FOUND, { message: 'gone' }));
    await expect(validateSessionToFacts(failing, 'stale-cookie')).resolves.toBeNull();
  });

  it('rethrows non-auth failures so the route renders its honest error state', async () => {
    const failing = () => Promise.reject(new Error('store unreachable'));
    await expect(validateSessionToFacts(failing, 'any')).rejects.toThrow('store unreachable');
  });

  it('validates a REAL session cookie through the real service and rejects a tampered one', async () => {
    const { auth, cookieValue } = await buildSession('acme', 'roundtrip');
    const facts = await validateSessionToFacts(
      (token) => auth.service.validateSession(token),
      cookieValue,
    );
    expect(facts?.tenantId).toBe('acme');
    const tampered = await validateSessionToFacts(
      (token) => auth.service.validateSession(token),
      `${cookieValue.slice(0, -4)}dead`,
    );
    expect(tampered).toBeNull();
  });
});

describe('the mounted composition: fail-closed auth boundary (never an anonymous marketplace)', () => {
  it('the browse experience renders auth-required for a cookie-less visitor', async () => {
    const experience = await resolveBodyMarketplaceBrowseExperience({
      probe: NO_COOKIE_PROBE,
    });
    expect(experience.kind).toBe('auth-required');
    const html = render(experience.view);
    expect(html).toContain('data-arena-state="permission-denied"');
    expect(html).toContain('never renders anonymously');
  });
});

describe('the mounted composition: the DEMO truth lens is visibly labelled (ADR-P001-02)', () => {
  it('the demo tenant reads the deterministic, labelled demo corpus through the mount wiring', async () => {
    const demo = await buildSession(DEMO_TENANT, 'demo-operator');
    const experience = await resolveBodyMarketplaceBrowseExperience({
      probe: probeOver(demo),
    });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('DEMO DATA');
    expect(html).toContain('Ledger Reconciler (pretrained)');
  });
});

describe('the mounted composition: session tenants get honest empty states + the role lens', () => {
  it('a non-demo session renders the empty browse state (never fabricated listings)', async () => {
    const acme = await buildSession('acme', 'acme-operator');
    const experience = await resolveBodyMarketplaceBrowseExperience({
      probe: probeOver(acme),
    });
    expect(experience.kind).toBe('ok');
    const html = render(experience.view);
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No capability bodies listed yet');
    expect(html).not.toContain('DEMO DATA');
  });

  it('the explicit ?lens= query state selects the active role lens (query state, not permission)', async () => {
    const demo = await buildSession(DEMO_TENANT, 'demo-operator');
    const experience = await resolveBodyMarketplaceBrowseExperience({
      probe: probeOver(demo),
      lens: 'auditor',
    });
    const html = render(experience.view);
    expect(html).toContain('data-arena-lens="auditor"');
  });

  it('a non-demo session renders the empty my-listings state through the mount wiring', async () => {
    const acme = await buildSession('acme', 'acme-operator');
    const experience = await resolveBodyMarketplaceMyListingsExperience({
      probe: probeOver(acme),
    });
    expect(experience.kind).toBe('ok');
    expect(render(experience.view)).toContain('No listings or pretraining runs yet');
  });
});
