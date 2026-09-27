/**
 * The router — positive and negative tests (Work Order A018, gates 4 and
 * 7): every route renders; unknown routes render the 404 view; mutation
 * methods render the 405 view (read-only guarantee); HEAD renders like
 * GET; the router is pure with respect to the corpus.
 */

import { describe, expect, it } from 'vitest';
import {
  CONSOLE_ALLOWED_METHODS,
  CONSOLE_ROUTES,
  handleConsoleRequest,
  routePath,
} from './router.js';
import { makeFixtureCorpus, RUN_ID } from './test-support.js';

const ALL_ROUTES = [...CONSOLE_ROUTES, `/runs/${RUN_ID}/trajectory`] as const;

describe('routePath — every route renders a view (gate 4 positive)', () => {
  it('routes every section path (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const kinds = ALL_ROUTES.map((path) => routePath(path, corpus).kind);
    expect(kinds).toEqual([
      'dashboard',
      'case-list',
      'body-list',
      'substrate-list',
      'job-list',
      'run-list',
      'trajectory',
    ]);
  });

  it('renders non-empty HTML for every route (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of ALL_ROUTES) {
      const response = handleConsoleRequest({ method: 'GET', path }, corpus);
      expect(response.status, path).toBe(200);
      expect(response.contentType, path).toBe('text/html; charset=utf-8');
      expect(response.html.length, path).toBeGreaterThan(200);
      expect(response.html, path).toContain('<!DOCTYPE html>');
    }
  });

  it('routes the trajectory path for a known run id (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = routePath(`/runs/${RUN_ID}/trajectory`, corpus);
    expect(view.kind).toBe('trajectory');
  });

  it('is strict about paths: query strings are the transport\u2019s concern (negative)', async () => {
    // The router maps EXACT paths only; the HTTP transport strips query
    // strings (see requestPath in apps/web/src/console/server.ts) before
    // routing. A raw query string therefore never matches a route here.
    const corpus = await makeFixtureCorpus();
    expect(routePath('/cases?XTransformPort=3030', corpus).kind).toBe('not-found');
    expect(routePath('/?tab=overview', corpus).kind).toBe('not-found');
  });
});

describe('routePath — negative routes (gate 4 negative)', () => {
  it('renders the 404 view for an unknown path (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = routePath('/does-not-exist', corpus);
    expect(view.kind).toBe('not-found');
    expect(view.kind === 'not-found' ? view.path : '').toBe('/does-not-exist');
    const response = handleConsoleRequest({ method: 'GET', path: '/does-not-exist' }, corpus);
    expect(response.status).toBe(404);
    expect(response.html).toContain('<h1>Not found</h1>');
  });

  it('renders the 404 view for an unknown run id on the trajectory route (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = routePath('/runs/run-unknown-9999/trajectory', corpus);
    expect(view.kind).toBe('not-found');
  });

  it('rejects malformed trajectory paths (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    expect(routePath('/runs//trajectory', corpus).kind).toBe('not-found');
    expect(routePath('/runs/x/trajectory/extra', corpus).kind).toBe('not-found');
    expect(routePath('/runs/../cases', corpus).kind).toBe('not-found');
    expect(routePath('/cases/', corpus).kind).toBe('not-found');
    expect(routePath('/CASES', corpus).kind).toBe('not-found');
  });

  it('never routes a hash fragment (hash-free navigation — negative)', async () => {
    const corpus = await makeFixtureCorpus();
    // A path carrying a fragment part is NOT a section route.
    expect(routePath('/#/cases', corpus).kind).toBe('not-found');
  });
});

describe('handleConsoleRequest — read-only guarantee (gate 7 negative)', () => {
  it('answers every mutation method with the 405 view (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'CONNECT']) {
      const response = handleConsoleRequest({ method, path: '/cases' }, corpus);
      expect(response.status, method).toBe(405);
      expect(response.allow, method).toBe('GET, HEAD');
      expect(response.html, method).toContain('<h1>Method not allowed</h1>');
      expect(response.html, method).toContain(
        'No POST, PUT, DELETE or PATCH route exists',
      );
    }
  });

  it('answers mutations on every route, including unknown ones (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of [...ALL_ROUTES, '/nope']) {
      const response = handleConsoleRequest({ method: 'POST', path }, corpus);
      expect(response.status, path).toBe(405);
    }
    // 405 wins over 404: a mutation against an unknown path is still a
    // read-only violation first.
    const response = handleConsoleRequest({ method: 'DELETE', path: '/nope' }, corpus);
    expect(response.status).toBe(405);
    expect(response.html).toContain('Method not allowed');
  });

  it('serves HEAD exactly like GET (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const get = handleConsoleRequest({ method: 'GET', path: '/jobs' }, corpus);
    const head = handleConsoleRequest({ method: 'HEAD', path: '/jobs' }, corpus);
    expect(head.status).toBe(200);
    expect(head.html).toBe(get.html);
  });

  it('treats a lowercase method name case-insensitively (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const response = handleConsoleRequest({ method: 'get', path: '/' }, corpus);
    expect(response.status).toBe(200);
    const mutated = handleConsoleRequest({ method: 'post', path: '/' }, corpus);
    expect(mutated.status).toBe(405);
  });

  it('exports exactly the allowed methods (positive)', () => {
    expect([...CONSOLE_ALLOWED_METHODS]).toEqual(['GET', 'HEAD']);
  });
});

describe('router purity (gate 7)', () => {
  it('never mutates the corpus while routing and rendering (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const before = JSON.stringify(corpus);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
      for (const path of [...ALL_ROUTES, '/nope', '/runs/x/trajectory']) {
        handleConsoleRequest({ method, path }, corpus);
      }
    }
    expect(JSON.stringify(corpus)).toBe(before);
  });

  it('is deterministic: the same path renders byte-identical HTML (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of ALL_ROUTES) {
      const first = handleConsoleRequest({ method: 'GET', path }, corpus);
      const second = handleConsoleRequest({ method: 'GET', path }, corpus);
      expect(first.html, path).toBe(second.html);
    }
  });
});
