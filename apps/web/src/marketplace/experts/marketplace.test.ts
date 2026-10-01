/**
 * The A031 marketplace web-surface suite (the A018 console-test pattern):
 *
 *   - corpus content gates (1 published listing with in-force A007
 *     qualification evidence, 1 active offer, 1 completed+reviewed
 *     engagement, all through the REAL domain constructors + fabric);
 *   - byte-determinism of the seeded corpus;
 *   - route rendering (200 + content fragments for /, the listing detail
 *     route, /engagements; 404 for unknown; 405 + Allow for mutations);
 *   - HTML escaping of untrusted text (XSS probe);
 *   - read-only guarantee (the corpus is deep-frozen; renders never
 *     mutate it);
 *   - a REAL node:http round trip on an ephemeral port.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMarketplaceCorpus, SEED_ENGAGEMENT_ID, SEED_LISTING_ID, SEED_TENANT } from './corpus.mjs';
import { handleMarketplaceRequest, isDeepFrozen } from './router.js';
import type { MarketplaceCorpus } from './router.js';
import { requestPath, startMarketplaceServer } from './server.js';

const sha256 = (html: string): string =>
  createHash('sha256').update(html).digest('hex');

/** Build the seeded corpus as its precise router type. */
async function seededCorpus(): Promise<MarketplaceCorpus> {
  return (await buildMarketplaceCorpus()) as MarketplaceCorpus;
}

describe('marketplace corpus gates', () => {
  it('builds the seeded listing through the REAL A006/A007/A031 surfaces', async () => {
    const corpus = await seededCorpus();
    expect(corpus.tenant).toBe(SEED_TENANT);
    expect(corpus.listings).toHaveLength(1);
    const listing = corpus.listings[0];
    expect(listing?.listingId).toBe(SEED_LISTING_ID);
    expect(listing?.qualificationProofs).toHaveLength(1);
    expect(listing?.qualificationProofs[0]?.inForce).toBe(true);
    expect(listing?.qualificationProofs[0]?.status).toBe('qualified');
    expect(listing?.offers).toHaveLength(1);
    expect(listing?.offers[0]?.amountMinor).toBe(12_500);
    expect(listing?.engagements).toBe(1);
    expect(listing?.completed).toBe(1);
    expect(listing?.reviews).toBe(1);
    expect(listing?.averageRating).toBe(5);
    expect(listing?.publishedAt).toBe('2026-09-05T09:00:00.000Z');
    const engagement = corpus.engagements[0];
    expect(engagement?.engagementId).toBe(SEED_ENGAGEMENT_ID);
    expect(engagement?.status).toBe('completed');
    expect(engagement?.review?.verdict).toBe('positive');
  });

  it('is byte-deterministic across rebuilds', async () => {
    const a = await seededCorpus();
    const b = await seededCorpus();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is deep-frozen (the read-only guarantee)', async () => {
    expect(isDeepFrozen(await seededCorpus())).toBe(true);
  });
});

describe('marketplace routes', () => {
  it('renders the listing index at /', async () => {
    const corpus = await seededCorpus();
    const response = handleMarketplaceRequest({ method: 'GET', path: '/' }, corpus);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.html).toContain('Senior Rust code review, evidence-backed');
    expect(response.html).toContain('qualification in force');
    expect(response.html).toContain('USD 125.00');
    expect(response.html).toContain('5.0/5 over 1 review(s)');
  });

  it('renders the listing detail with qualification evidence and stats', async () => {
    const corpus = await seededCorpus();
    const response = handleMarketplaceRequest(
      { method: 'GET', path: `/listings/${SEED_LISTING_ID}` },
      corpus,
    );
    expect(response.status).toBe(200);
    expect(response.html).toContain('Qualification evidence (A007 gate)');
    expect(response.html).toContain('qualification in force');
    expect(response.html).toContain('Engagement statistics');
    expect(response.html).toContain('5.00');
  });

  it('404s unknown listings and paths', async () => {
    const corpus = await seededCorpus();
    expect(
      handleMarketplaceRequest({ method: 'GET', path: '/listings/nope' }, corpus).status,
    ).toBe(404);
    expect(handleMarketplaceRequest({ method: 'GET', path: '/nope' }, corpus).status).toBe(
      404,
    );
  });

  it('405s mutations with Allow: GET, HEAD (read-only surface)', async () => {
    const corpus = await seededCorpus();
    const response = handleMarketplaceRequest({ method: 'POST', path: '/' }, corpus);
    expect(response.status).toBe(405);
    expect(response.allow).toBe('GET, HEAD');
  });

  it('escapes untrusted text (XSS probe)', async () => {
    const corpus = await seededCorpus();
    const hostile: MarketplaceCorpus = {
      ...corpus,
      listings: [
        {
          ...corpus.listings[0]!,
          headline: '<script>alert(1)</script>',
          description: '"><img src=x onerror=alert(2)>',
        },
      ],
    };
    const response = handleMarketplaceRequest({ method: 'GET', path: '/' }, hostile);
    expect(response.html).not.toContain('<script>alert(1)</script>');
    expect(response.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.html).not.toContain('"><img src=x');
  });

  it('strips query strings and trailing slashes when routing', async () => {
    const corpus = await seededCorpus();
    expect(requestPath('/listings/x?debug=1#frag')).toBe('/listings/x');
    const response = handleMarketplaceRequest(
      { method: 'GET', path: `/listings/${SEED_LISTING}/` },
      corpus,
    );
    expect(response.status).toBe(200);
  });

  it('renders never mutate the corpus (full sweep digest equality)', async () => {
    const corpus = await seededCorpus();
    const before = sha256(JSON.stringify(corpus));
    for (const path of ['/', `/listings/${SEED_LISTING_ID}`, '/engagements', '/nope']) {
      handleMarketplaceRequest({ method: 'GET', path }, corpus);
    }
    expect(sha256(JSON.stringify(corpus))).toBe(before);
  });
});

const SEED_LISTING = SEED_LISTING_ID;

describe('marketplace transport', () => {
  it('serves a REAL node:http round trip on an ephemeral port', async () => {
    const corpus = await seededCorpus();
    const handler = (request: { method: string; path: string }) =>
      handleMarketplaceRequest(request, corpus);
    const running = await startMarketplaceServer(handler, { port: 0 });
    try {
      const response = await fetch(`${running.url}listings/${SEED_LISTING_ID}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const html = await response.text();
      expect(html).toContain('Senior Rust code review, evidence-backed');
      const head = await fetch(`${running.url}nope`, { method: 'POST' });
      expect(head.status).toBe(405);
      expect(head.headers.get('allow')).toBe('GET, HEAD');
    } finally {
      await running.close();
    }
  });
});
