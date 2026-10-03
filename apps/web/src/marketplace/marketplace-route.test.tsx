import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * Marketplace route/view tests (Work Order B013) — the house style: compose
 * through the REAL demo runtime + injected session probes, render the SYNC
 * views through react-dom/server, assert on data-arena-* attributes.
 * Demo mode is labelled; purchase is never certification; entitlement
 * states render explicitly; unknown stays unknown.
 */

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
import {
  MarketplaceAuthRequiredView,
  MarketplaceDetailView,
  MarketplaceEntitlementsView,
  MarketplaceHomeView,
  resolveDemoMarketplaceDetailOutcome,
  resolveDemoMarketplaceEntitlementsView,
  resolveDemoMarketplaceHomeView,
  resolveMarketplaceExperience,
} from './index.js';
import type { MarketplaceSessionProbe } from './index.js';
import {
  SEED_DATASET_OFFER_ID,
  SEED_EXPERT_LISTING_ID,
} from './corpus.js';

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);
const T = '2026-10-01T08:00:00.000Z';

async function buildSessionProbe(tenantId: string): Promise<MarketplaceSessionProbe> {
  const clock = new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
  const auth = createLocalAuthStack({
    secret: 'test-session-secret-0123456789abcdefghijklmnop',
    credentials: [
      {
        credential: createAuthMethodDescriptor({
          method: 'test-login',
          claims: { who: 'marketplace-visitor' },
        }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'marketplace-visitor',
          kind: 'customer-identity',
          tenantScope: tenantId,
          roles: ['tenant-member'],
          label: 'marketplace-visitor',
        }),
      },
    ],
    clock,
  });
  const principal = await auth.service.authenticate({
    method: 'test-login',
    claims: { who: 'marketplace-visitor' },
  });
  const issuance = await auth.service.issueSession({
    principal,
    tenantId,
    workspaceContext: createWorkspaceContext({
      identityId: 'marketplace-visitor',
      tenantId,
      workspaceId: `${tenantId}-ws`,
      permissionPolicy: createPermissionPolicy({
        policyId: `${tenantId}-policy`,
        tenantId,
        descriptor: { kind: 'test-policy' },
        issuedAt: T,
      }),
      grantedRoles: [
        grantRole({
          grantId: `grant-marketplace-participant-0`,
          identityId: 'marketplace-visitor',
          tenantId,
          roleId: 'marketplace-participant',
          policyId: `${tenantId}-policy`,
          grantedBy: 'test',
          grantedAt: T,
          validFrom: T,
        }),
      ],
    }),
    authMethod: createAuthMethodDescriptor({
      method: 'test-login',
      claims: { who: 'marketplace-visitor' },
    }),
  });
  const cookieValue = issuance.cookie.value;
  return {
    cookieValue: () => Promise.resolve(cookieValue),
    validate: (token: string) => auth.service.validateSession(token),
  };
}

const NO_COOKIE_PROBE: MarketplaceSessionProbe = {
  cookieValue: () => Promise.resolve(null),
  validate: () => {
    throw new Error('unreachable: no cookie means validate is never called');
  },
};

describe('demo marketplace home (B006 labelling + B013 truth)', () => {
  it('renders the browse screen with labelled demo state and every truth section (positive)', async () => {
    const html = render(<MarketplaceHomeView view={await resolveDemoMarketplaceHomeView()} />);
    expect(html).toContain('data-arena-route="marketplace"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-truth="demo"');
    expect(html).toContain('Senior Rust code review, evidence-backed');
    expect(html).toContain('Solder joint defect dataset');
    expect(html).toContain('data-arena-marketplace-truth="purchase-not-certification"');
    expect(html).toContain('is NOT a certification');
    expect(html).toContain('data-arena-verification-status="verified"');
    expect(html).toContain('data-arena-entitlement-state="revoked"');
    expect(html).toContain('data-arena-rights-posture="open"');
    expect(html).toContain('data-arena-corpus-hash="true"');
  });

  it('renders not certified — never a blank — on every listing (negative)', async () => {
    const html = render(<MarketplaceHomeView view={await resolveDemoMarketplaceHomeView()} />);
    expect(html).toContain('data-arena-certification="not-certified"');
    expect(html).toContain('Not certified');
    // The demo workspace carries ONE certification record (a body
    // composition) — rendered as context, never as a listing badge.
    expect(html).toContain('data-arena-workspace-certification="certified"');
  });

  it('renders byte-identical pages (determinism) (positive)', async () => {
    const first = render(<MarketplaceHomeView view={await resolveDemoMarketplaceHomeView()} />);
    const second = render(<MarketplaceHomeView view={await resolveDemoMarketplaceHomeView()} />);
    expect(second).toBe(first);
  });
});

describe('demo marketplace detail (provenance / rights / verification / entitlement)', () => {
  it('renders the artifact detail with the full evidence chain and licence terms (positive)', async () => {
    const outcome = await resolveDemoMarketplaceDetailOutcome('artifacts', SEED_DATASET_OFFER_ID);
    expect(outcome.kind).toBe('artifact');
    const html = render(<MarketplaceDetailView outcome={outcome} />);
    expect(html).toContain('Provenance chain');
    expect(html).toContain('derived-from');
    expect(html).toContain('data-arena-evidence-addresses="true"');
    expect(html).toContain('data-arena-provenance-class="evidence"');
    expect(html).toContain('CC-BY-4.0');
    expect(html).toContain('data-arena-verification-status="verified"');
    expect(html).toContain('data-arena-grant-state="revoked"');
    expect(html).toContain('licence review: terms breached');
  });

  it('renders the purchase panel fail-closed in demo mode — no real purchase (negative)', async () => {
    const outcome = await resolveDemoMarketplaceDetailOutcome('artifacts', SEED_DATASET_OFFER_ID);
    const html = render(<MarketplaceDetailView outcome={outcome} />);
    expect(html).toContain('data-arena-purchase-availability="demo"');
    expect(html).toContain('Demo — not purchasable');
    expect(html).toContain('data-arena-purchase-does-not-grant="true"');
    expect(html).toContain('Certification — a purchase never certifies');
    expect(html).toContain('never a real price or a real purchase');
  });

  it('renders the expert detail with qualification evidence and engagement terms (positive)', async () => {
    const outcome = await resolveDemoMarketplaceDetailOutcome('experts', SEED_EXPERT_LISTING_ID);
    expect(outcome.kind).toBe('expert');
    const html = render(<MarketplaceDetailView outcome={outcome} />);
    expect(html).toContain('Qualification evidence (the A007 gate)');
    expect(html).toContain('data-arena-qualification-in-force="true"');
    expect(html).toContain('Advisory code review only.');
    expect(html).toContain('data-arena-entitlement-state="unknown"');
    expect(html).toContain('engagement records');
  });

  it('renders unknown ids as the honest not-found state (negative)', async () => {
    const outcome = await resolveDemoMarketplaceDetailOutcome('artifacts', 'no-such-offer');
    expect(outcome.kind).toBe('not-found');
    const html = render(<MarketplaceDetailView outcome={outcome} />);
    expect(html).toContain('Listing not found');
    expect(html).toContain('nothing is fabricated');
  });

  it('renders byte-identical detail pages (determinism) (positive)', async () => {
    const first = render(
      <MarketplaceDetailView
        outcome={await resolveDemoMarketplaceDetailOutcome('artifacts', SEED_DATASET_OFFER_ID)}
      />,
    );
    const second = render(
      <MarketplaceDetailView
        outcome={await resolveDemoMarketplaceDetailOutcome('artifacts', SEED_DATASET_OFFER_ID)}
      />,
    );
    expect(second).toBe(first);
  });
});

describe('demo marketplace entitlements (the explicit state machine)', () => {
  it('renders every entitlement state explicitly, with lineage and grounds (positive)', async () => {
    const html = render(
      <MarketplaceEntitlementsView view={await resolveDemoMarketplaceEntitlementsView()} />,
    );
    expect(html).toContain('data-arena-route="marketplace-entitlements"');
    expect(html).toContain('data-arena-demo-banner="true"');
    expect(html).toContain('data-arena-grant-state="granted"');
    expect(html).toContain('data-arena-grant-state="revoked"');
    expect(html).toContain('data-arena-grant-state="expired"');
    expect(html).toContain('data-arena-grant-state="pending"');
    expect(html).toContain('policy violation — terminal');
    expect(html).toContain('data-arena-entitlement-lineage="true"');
    expect(html).toContain('never implied by listing ownership');
  });
});

describe('session marketplace composition (fail closed, tenant-scoped)', () => {
  it('renders the denied state when the boundary closes (negative)', async () => {
    const experience = await resolveMarketplaceExperience({ probe: NO_COOKIE_PROBE });
    expect(experience.kind).toBe('auth-required');
    if (experience.kind === 'auth-required') {
      expect(experience.code).toBe('AUTH_SESSION_NOT_FOUND');
      const html = render(<MarketplaceAuthRequiredView code={experience.code} />);
      expect(html).toContain('data-arena-state="denied"');
      expect(html).toContain('data-arena-auth-code="AUTH_SESSION_NOT_FOUND"');
      expect(html).toContain('never renders anonymously');
    }
  });

  it('composes the home through an injected tenant-a session (positive)', async () => {
    const probe = await buildSessionProbe('tenant-a');
    const experience = await resolveMarketplaceExperience({ probe });
    expect(experience.kind).toBe('home');
    if (experience.kind === 'home') {
      const view = experience.view;
      expect(view.mode).toBe('session');
      expect(view.expertListings).toHaveLength(1);
      // tenant-a sees the two public offers; the tenant-internal environment
      // offer belongs to tenant-b and stays invisible (display scoping).
      expect(view.artifactListings).toHaveLength(2);
      // The local read model carries no certification records — honest.
      expect(view.certifications).toHaveLength(0);
      const html = render(<MarketplaceHomeView view={view} />);
      expect(html).toContain('data-arena-marketplace-mode="session"');
      expect(html).not.toContain('data-arena-demo-banner="true"');
      expect(html).not.toContain('Engineering sandbox environment');
    }
  });

  it('scopes a tenant-b session to the tenant-internal offer it owns (positive)', async () => {
    const probe = await buildSessionProbe('tenant-b');
    const experience = await resolveMarketplaceExperience({ probe });
    expect(experience.kind).toBe('home');
    if (experience.kind === 'home') {
      const view = experience.view;
      // tenant-b owns the tenant-internal environment offer: it sees all
      // three artifacts but no tenant-a expert listing.
      expect(view.expertListings).toHaveLength(0);
      expect(view.artifactListings).toHaveLength(3);
    }
  });
});
