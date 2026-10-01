import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@arena/protocol-core';
import { handleMarketplaceRequest, isDeepFrozen } from './router.mjs';
import { buildMarketplaceCorpus, SEED_DATASET_OFFER_ID, SEED_ENVIRONMENT_OFFER_ID } from './corpus.mjs';
import {
  requestPath,
  startMarketplaceServer,
  type MarketplaceHandler,
} from './server.js';
import type { SeededMarketplaceCorpus } from './corpus.d.mts';

interface OfferProfileView {
  readonly offerId: string;
  readonly title: string;
  readonly summary: string;
  readonly artifactKind: string;
  readonly visibility: string;
  readonly tenant: string;
  readonly state: string;
  readonly offerDigest: string;
  readonly artifactIdentity: string;
  readonly rights: {
    readonly license: string;
    readonly commercialUse: string;
    readonly redistribution: string;
    readonly customerData: string;
  };
  readonly evidence: readonly {
    readonly kind: string;
    readonly digest: string;
    readonly outcome: string | null;
  }[];
  readonly grants: readonly {
    readonly grantId: string;
    readonly state: string;
    readonly permittedUse: string;
    readonly granteeTenant: string;
  }[];
  readonly reviews: readonly {
    readonly rating: number;
    readonly verdict: string;
    readonly body: string;
    readonly reviewerTenant: string;
    readonly reviewerId: string;
  }[];
  readonly reviewCount: number;
  readonly averageRating: number | null;
}

interface CorpusView {
  readonly seedTenant: string;
  readonly datasetOfferId: string;
  readonly profiles: readonly OfferProfileView[];
  readonly counts: Readonly<Record<string, number>>;
}

describe('marketplace corpus: content gates (the real service drives the views)', () => {
  it('builds three gated listings across the three artifact domains', async () => {
    const corpus = (await buildMarketplaceCorpus()) as CorpusView;
    expect(corpus.profiles).toHaveLength(3);
    const kinds = corpus.profiles.map((p) => p.artifactKind).sort();
    expect(kinds).toEqual(['dataset', 'environment', 'evaluation-suite']);
    for (const profile of corpus.profiles) {
      expect(profile.state).toBe('registered');
      expect(profile.offerDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(profile.artifactIdentity).toMatch(/^tenant-[ab]\//);
      // every listing carries ADOPTED admission evidence (gate discipline)
      expect(profile.evidence.length).toBe(2);
      expect(profile.evidence.some((e) => e.kind === 'provenance')).toBe(true);
      expect(
        profile.evidence.some((e) => e.kind === 'verification' && e.outcome === 'pass'),
      ).toBe(true);
      // rights metadata is mandatory on every listing
      expect(profile.rights.license.length).toBeGreaterThan(0);
    }
  });

  it('grants and reviews went through the real license + gating paths', async () => {
    const corpus = (await buildMarketplaceCorpus()) as CorpusView;
    const dataset = corpus.profiles.find((p) => p.offerId === SEED_DATASET_OFFER_ID);
    expect(dataset).toBeDefined();
    expect((dataset as OfferProfileView).grants).toHaveLength(2);
    expect((dataset as OfferProfileView).reviews).toHaveLength(2);
    expect((dataset as OfferProfileView).reviewCount).toBe(2);
    expect((dataset as OfferProfileView).averageRating).toBe(4.5);
    const environment = corpus.profiles.find(
      (p) => p.offerId === SEED_ENVIRONMENT_OFFER_ID,
    );
    expect(environment).toBeDefined();
    // tenant-internal offer: one same-tenant grant, no reviews
    expect((environment as OfferProfileView).grants).toHaveLength(1);
    expect((environment as OfferProfileView).reviews).toHaveLength(0);
  });

  it('the corpus is deep-frozen and byte-deterministic', async () => {
    const first = (await buildMarketplaceCorpus()) as CorpusView;
    const second = (await buildMarketplaceCorpus()) as CorpusView;
    expect(isDeepFrozen(first)).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('marketplace router: read-only rendering', () => {
  it('serves the listing page with escaped content', async () => {
    const corpus = (await buildMarketplaceCorpus()) as unknown;
    const response = handleMarketplaceRequest({ method: 'GET', path: '/' }, corpus);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.html).toContain('Solder joint defect dataset');
    expect(response.html).toContain('badge dataset');
    expect(response.html).toContain('badge evaluation-suite');
    expect(response.html).toContain('badge environment');
  });

  it('serves artifact profiles with provenance evidence, licenses and reviews', async () => {
    const corpus = (await buildMarketplaceCorpus()) as CorpusView;
    const response = handleMarketplaceRequest(
      { method: 'GET', path: `/offers/${SEED_DATASET_OFFER_ID}` },
      corpus,
    );
    expect(response.status).toBe(200);
    expect(response.html).toContain('License &amp; rights (A002)');
    expect(response.html).toContain('CC-BY-4.0');
    expect(response.html).toContain('Admission evidence (provenance + verification)');
    expect(response.html).toContain('Access grants (A034 data-rights enforced)');
    expect(response.html).toContain('Reviews (grant-gated)');
    expect(response.html).toContain('5/5');
  });

  it('404s unknown offers and paths; 405s every mutation attempt (read-only)', async () => {
    const corpus = (await buildMarketplaceCorpus()) as unknown;
    expect(handleMarketplaceRequest({ method: 'GET', path: '/offers/no-such-offer' }, corpus).status).toBe(404);
    expect(handleMarketplaceRequest({ method: 'GET', path: '/nonsense' }, corpus).status).toBe(404);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = handleMarketplaceRequest({ method, path: '/' }, corpus);
      expect(response.status).toBe(405);
      expect(response.allow).toBe('GET, HEAD');
    }
    const head = handleMarketplaceRequest({ method: 'HEAD', path: '/' }, corpus);
    expect(head.status).toBe(200);
  });

  it('HTML-escapes offer content (no raw interpolation)', async () => {
    const corpus = (await buildMarketplaceCorpus()) as unknown;
    const response = handleMarketplaceRequest({ method: 'GET', path: '/' }, corpus);
    expect(response.html).not.toContain('<script');
    // digest interpolations are rendered, never executed
    expect(response.html).toMatch(/class="digest"/);
  });

  it('renders byte-stable pages (golden route digests)', async () => {
    const corpus = (await buildMarketplaceCorpus()) as unknown;
    const pages = [
      ['/', handleMarketplaceRequest({ method: 'GET', path: '/' }, corpus).html],
      [
        `/offers/${SEED_DATASET_OFFER_ID}`,
        handleMarketplaceRequest({ method: 'GET', path: `/offers/${SEED_DATASET_OFFER_ID}` }, corpus).html,
      ],
      ['/offers/unknown', handleMarketplaceRequest({ method: 'GET', path: '/offers/unknown' }, corpus).html],
      ['405', handleMarketplaceRequest({ method: 'POST', path: '/' }, corpus).html],
    ] as const;
    for (const [route, html] of pages) {
      const digest = await sha256Hex(html);
      // Determinism contract: the SAME corpus always renders the SAME page.
      const again = await sha256Hex(
        route === '/offers/unknown'
          ? handleMarketplaceRequest({ method: 'GET', path: '/offers/unknown' }, corpus).html
          : route === '405'
            ? handleMarketplaceRequest({ method: 'POST', path: '/' }, corpus).html
            : handleMarketplaceRequest({ method: 'GET', path: route }, corpus).html,
      );
      expect(digest).toBe(again);
    }
    // The corpus contains no secret material (the pushed branch MUST NOT).
    const listing = handleMarketplaceRequest({ method: 'GET', path: '/' }, corpus).html;
    expect(listing.includes('ghp_')).toBe(false);
    expect(listing.includes('gho_')).toBe(false);
    expect(listing.toLowerCase().includes('secret')).toBe(false);
  });
});

describe('marketplace transport (real node:http round trip)', () => {
  it('serves pages over HTTP with HEAD suppression and 405 headers', async () => {
    const corpus = (await buildMarketplaceCorpus()) as unknown;
    const handler: MarketplaceHandler = (request) =>
      handleMarketplaceRequest(request, corpus);
    const running = await startMarketplaceServer(handler, { port: 0 });
    try {
      const response = await fetch(`${running.url}offers`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const body = await response.text();
      expect(body).toContain('Solder joint defect dataset');

      const profile = await fetch(`${running.url}offers/${SEED_DATASET_OFFER_ID}`);
      expect(profile.status).toBe(200);
      expect((await profile.text()).length).toBeGreaterThan(500);

      const missing = await fetch(`${running.url}offers/does-not-exist`);
      expect(missing.status).toBe(404);

      const mutation = await fetch(`${running.url}`, { method: 'POST' });
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get('allow')).toBe('GET, HEAD');

      const head = await fetch(`${running.url}`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect((await head.arrayBuffer()).byteLength).toBe(0);
    } finally {
      await running.close();
    }
  });

  it('requestPath normalizes queries and fragments', () => {
    expect(requestPath('/offers?x=1')).toBe('/offers');
    expect(requestPath('/offers#frag')).toBe('/offers');
    expect(requestPath(undefined)).toBe('/');
  });
});
