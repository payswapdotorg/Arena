/**
 * Body-marketplace route composition tests (Work Order C014) — the
 * fail-closed route outcome (auth-required), the deterministic DEMO
 * compositions (visibly labelled; record-backed certification badges
 * ONLY; consequence exposure on blocked runs; the role-lens switcher),
 * the honest session empty states, and the adversarial cross-tenant
 * denial. House style: REAL composed boundaries with injected session
 * probes (the developers-route test pattern).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  BodyMarketplaceAuthRequiredView,
  BodyMarketplaceDetailView,
  BodyMarketplaceErrorView,
  BodyMarketplaceLoadingView,
  BodyMarketplaceRequestPretrainingView,
  resolveBodyMarketplaceBrowseExperience,
  resolveBodyMarketplaceMyListingsExperience,
  resolveBodyMarketplaceRequestPretrainingExperience,
  resetDemoBodyMarketplaceContext,
  resolveListingDetailView,
  toRoleLens,
} from './index.js';
import { DEMO_TENANT } from './runtime.js';

const DEMO_FACTS = {
  tenantId: DEMO_TENANT,
  principalLabel: 'demo operator',
  roles: ['tenant-owner'],
};

const SESSION_FACTS = {
  tenantId: 'acme',
  principalLabel: 'acme operator',
  roles: ['tenant-owner'],
};

function probeFor(facts: typeof DEMO_FACTS | null) {
  return {
    cookieValue: () => Promise.resolve(facts === null ? null : 'session-cookie'),
    validate: () => Promise.resolve(facts),
  };
}

beforeAll(() => {
  resetDemoBodyMarketplaceContext();
});

describe('fail-closed session boundary', () => {
  it('renders the auth-required experience for an unauthenticated visitor', async () => {
    const experience = await resolveBodyMarketplaceBrowseExperience({ probe: probeFor(null) });
    expect(experience.kind).toBe('auth-required');
    const html = renderToStaticMarkup(experience.view);
    expect(html).toContain('permission-denied');
    expect(html).toContain('never renders anonymously');
  });
});

describe('demo browse composition', () => {
  it('renders the labelled demo listing with a record-backed certification badge', async () => {
    const experience = await resolveBodyMarketplaceBrowseExperience({ probe: probeFor(DEMO_FACTS) });
    expect(experience.kind).toBe('ok');
    const html = renderToStaticMarkup(experience.view);
    expect(html).toContain('data-arena-demo="true"');
    expect(html).toContain('DEMO DATA');
    expect(html).toContain('Ledger Reconciler (pretrained)');
    expect(html).toContain('data-arena-certification="record-backed"');
    expect(html).toContain('CANDIDATE');
    expect(html).toContain('tested composition, never the base model');
    // The persistent role-lens switcher (query state, not permission).
    expect(html).toContain('role lens');
    expect(html).toContain('data-arena-lens="buyer"');
  });

  it('switches the role lens through explicit query state', () => {
    expect(toRoleLens('auditor')).toBe('auditor');
    expect(toRoleLens(undefined)).toBe('buyer');
    expect(toRoleLens('admin')).toBe('buyer'); // closed vocabulary
  });
});

describe('demo detail composition', () => {
  it('renders lineage, provenance, rights, substrates and version history', async () => {
    const html = await renderToStaticMarkup(
      await resolveListingDetailView(DEMO_FACTS, 'listing-demo-0001'),
    );
    expect(html).toContain('forge provenance');
    expect(html).toContain('pretraining run');
    expect(html).toContain('run-demo-0001');
    expect(html).toContain('rights');
    expect(html).toContain('substrate compatibility');
    expect(html).toContain('Version history');
    expect(html).toContain('published');
  });

  it('renders the honest empty experience for an unknown listing (tenant-scoped)', async () => {
    const html = await renderToStaticMarkup(
      await resolveListingDetailView(DEMO_FACTS, 'listing-unknown'),
    );
    expect(html).toContain('empty');
  });

  it('fail-closes cross-tenant detail reads', async () => {
    const html = await renderToStaticMarkup(
      await resolveListingDetailView(SESSION_FACTS, 'listing-demo-0001'),
    );
    expect(html).toContain('does not exist');
  });
});

describe('demo request-pretraining composition (consequence exposure)', () => {
  it('exposes the rights law and the BLOCKED run reasons', async () => {
    const experience = await resolveBodyMarketplaceRequestPretrainingExperience({
      probe: probeFor(DEMO_FACTS),
    });
    expect(experience.kind).toBe('ok');
    const html = renderToStaticMarkup(experience.view);
    expect(html).toContain('rights declaration');
    expect(html).toContain('Consequence: declaring forbidden or unspecified training use BLOCKS the run');
    expect(html).toContain('run-demo-0002 — blocked');
    expect(html).toContain('rights-insufficient');
  });
});

describe('session compositions (honest empty states)', () => {
  it('renders the empty browse state for a tenant with no listings', async () => {
    const experience = await resolveBodyMarketplaceBrowseExperience({ probe: probeFor(SESSION_FACTS) });
    expect(experience.kind).toBe('ok');
    const html = renderToStaticMarkup(experience.view);
    expect(html).toContain('data-arena-state="empty"');
    expect(html).toContain('No capability bodies listed yet');
    expect(html).not.toContain('DEMO DATA');
  });

  it('renders the empty my-listings state', async () => {
    const experience = await resolveBodyMarketplaceMyListingsExperience({ probe: probeFor(SESSION_FACTS) });
    expect(experience.kind).toBe('ok');
    const html = renderToStaticMarkup(experience.view);
    expect(html).toContain('No listings or pretraining runs yet');
  });
});

describe('the full state vocabulary renders', () => {
  it('renders loading, error, auth-required and detail-empty views', () => {
    expect(renderToStaticMarkup(<BodyMarketplaceLoadingView />)).toContain('Loading capability bodies');
    expect(
      renderToStaticMarkup(<BodyMarketplaceErrorView detail="fail closed" />),
    ).toContain('fail closed');
    expect(renderToStaticMarkup(<BodyMarketplaceAuthRequiredView />)).toContain('permission-denied');
    expect(
      renderToStaticMarkup(<BodyMarketplaceDetailView outcome={{ state: 'empty', model: null }} />),
    ).toContain('does not exist');
  });

  it('renders the request-pretraining view standalone', () => {
    const html = renderToStaticMarkup(
      <BodyMarketplaceRequestPretrainingView
        mode="session"
        tenantLabel="acme"
        runs={[
          {
            runId: 'run-x',
            outcome: 'blocked',
            blockedReasons: ['rights-insufficient: input declared forbidden'],
          },
        ]}
      />,
    );
    expect(html).toContain('run-x — blocked');
    expect(html).toContain('rights-insufficient: input declared forbidden');
  });
});
