/**
 * The router — positive and negative tests (Work Order A017,
 * requirement 5): every route renders; the degraded corpus routes with
 * its banner; unknown routes render the 404 view; mutation methods
 * render the 405 view (read-only guarantee); HEAD renders like GET; the
 * router is pure with respect to the corpus.
 */

import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_ALLOWED_METHODS,
  WORKBENCH_ROUTES,
  handleWorkbenchRequest,
  routePath,
} from './router.js';
import {
  makeDegradedCorpus,
  makeEmptyDegradedCorpus,
  makeFixtureCorpus,
  FIXTURE_TRAJECTORY_ID,
} from './test-support.js';
import type { WorkbenchCorpus } from './corpus.js';

const ALL_ROUTES = [
  ...WORKBENCH_ROUTES,
  `/trajectories/${FIXTURE_TRAJECTORY_ID}`,
] as const;

describe('routePath — every route renders a view (positive)', () => {
  it('routes every section path', async () => {
    const corpus = await makeFixtureCorpus();
    const kinds = ALL_ROUTES.map((path) => routePath(path, corpus).kind);
    expect(kinds).toEqual([
      'workbench-overview',
      'expert-directory',
      'task-queue',
      'trajectory-feed',
      'job-status',
      'trajectory-detail',
    ]);
  });

  it('renders non-empty HTML for every route (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    for (const path of ALL_ROUTES) {
      const response = handleWorkbenchRequest({ method: 'GET', path }, corpus);
      expect(response.status, path).toBe(200);
      expect(response.contentType, path).toBe('text/html; charset=utf-8');
      expect(response.html.length, path).toBeGreaterThan(200);
      expect(response.html, path).toContain('<!DOCTYPE html>');
      expect(response.html, path).toContain('<title>');
    }
  });

  it('is strict about paths: query strings are the transport\u2019s concern (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    expect(routePath('/experts?XTransformPort=3030', corpus).kind).toBe('not-found');
    expect(routePath('/?tab=experts', corpus).kind).toBe('not-found');
  });
});

describe('routePath — negative routes (negative)', () => {
  it('renders the 404 view for an unknown path', async () => {
    const corpus = await makeFixtureCorpus();
    const view = routePath('/does-not-exist', corpus);
    expect(view.kind).toBe('not-found');
    expect(view.kind === 'not-found' ? view.path : '').toBe('/does-not-exist');
    const response = handleWorkbenchRequest({ method: 'GET', path: '/does-not-exist' }, corpus);
    expect(response.status).toBe(404);
    expect(response.html).toContain('<h1>Not found</h1>');
  });

  it('renders the 404 view for an unknown trajectory id on the detail route', async () => {
    const corpus = await makeFixtureCorpus();
    expect(routePath('/trajectories/traj-unknown-9999', corpus).kind).toBe('not-found');
  });

  it('rejects malformed trajectory paths (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    expect(routePath('/trajectories//', corpus).kind).toBe('not-found');
    expect(routePath('/trajectories/x/extra', corpus).kind).toBe('not-found');
    expect(routePath('/experts/', corpus).kind).toBe('not-found');
    expect(routePath('/EXPERTS', corpus).kind).toBe('not-found');
    expect(routePath('/jobs/../experts', corpus).kind).toBe('not-found');
  });

  it('never routes a hash fragment (hash-free navigation — negative)', async () => {
    const corpus = await makeFixtureCorpus();
    expect(routePath('/#/experts', corpus).kind).toBe('not-found');
  });
});

describe('handleWorkbenchRequest — read-only guarantee (negative)', () => {
  it('answers every mutation method with the 405 view', async () => {
    const corpus = await makeFixtureCorpus();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'CONNECT']) {
      const response = handleWorkbenchRequest({ method, path: '/experts' }, corpus);
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
      const response = handleWorkbenchRequest({ method: 'POST', path }, corpus);
      expect(response.status, path).toBe(405);
    }
    // 405 wins over 404: a mutation against an unknown path is still a
    // read-only violation first.
    const response = handleWorkbenchRequest({ method: 'DELETE', path: '/nope' }, corpus);
    expect(response.status).toBe(405);
    expect(response.html).toContain('Method not allowed');
  });

  it('treats method names case-insensitively (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const response = handleWorkbenchRequest({ method: 'post', path: '/jobs' }, corpus);
    expect(response.status).toBe(405);
    const head = handleWorkbenchRequest({ method: 'head', path: '/jobs' }, corpus);
    expect(head.status).toBe(200);
  });

  it('HEAD renders the same document as GET (positive)', async () => {
    const corpus = await makeFixtureCorpus();
    const get = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    const head = handleWorkbenchRequest({ method: 'HEAD', path: '/experts' }, corpus);
    expect(head.html).toBe(get.html);
    expect(head.status).toBe(200);
  });
});

describe('routing over degraded corpora (R41 — positive)', () => {
  it('serves the degraded directory with its banner and refresh affordance', async () => {
    const corpus: WorkbenchCorpus = await makeDegradedCorpus();
    const response = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    expect(response.status).toBe(200);
    expect(response.html).toContain('<section class="degraded" role="alert">');
    expect(response.html).toContain('expert-supply-unavailable');
    expect(response.html).toContain('<a class="refresh" href="/experts">Refresh</a>');
    // Last-known entries still render.
    expect(response.html).toContain('tenant-wb/expert-fixture-ada');
  });

  it('serves the empty degraded directory honestly (no invented data)', async () => {
    const corpus: WorkbenchCorpus = await makeEmptyDegradedCorpus();
    const response = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    expect(response.status).toBe(200);
    expect(response.html).toContain('The directory is empty');
    expect(response.html).not.toContain('tenant-wb/expert-fixture-ada');
  });

  it('rolls the degradation up on the overview', async () => {
    const corpus: WorkbenchCorpus = await makeDegradedCorpus();
    const response = handleWorkbenchRequest({ method: 'GET', path: '/' }, corpus);
    expect(response.status).toBe(200);
    expect(response.html).toContain('Degraded mode');
    expect(response.html).toContain('expert-supply-unavailable');
  });

  it('degradation never changes the HTTP status (the page still serves)', async () => {
    const corpus: WorkbenchCorpus = await makeDegradedCorpus();
    for (const path of WORKBENCH_ROUTES) {
      const response = handleWorkbenchRequest({ method: 'GET', path }, corpus);
      expect(response.status, path).toBe(200);
    }
  });
});

describe('router purity (positive)', () => {
  it('never mutates the corpus across a full sweep (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const before = JSON.stringify(corpus);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of [...ALL_ROUTES, '/nope', '/trajectories/unknown']) {
        handleWorkbenchRequest({ method, path }, corpus);
      }
    }
    expect(JSON.stringify(corpus)).toBe(before);
  });

  it('is deterministic: the same request yields the same document', async () => {
    const corpus = await makeFixtureCorpus();
    const first = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    const second = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    expect(second.html).toBe(first.html);
  });

  it('exposes the read-only method policy as frozen data', () => {
    expect([...WORKBENCH_ALLOWED_METHODS]).toEqual(['GET', 'HEAD']);
    expect(Object.isFrozen(WORKBENCH_ALLOWED_METHODS)).toBe(true);
    expect(Object.isFrozen(WORKBENCH_ROUTES)).toBe(true);
  });
});
