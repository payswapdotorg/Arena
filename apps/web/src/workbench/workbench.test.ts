/**
 * The workbench end-to-end suite (Work Order A017, requirements 4-5):
 *
 *   - corpus content gates (2 expert registry profiles in different
 *     lifecycle states, the full A007 qualification + matching flow
 *     through the expert-matching reference fabric, 2 TaskSpecs + 2
 *     compilation records, 2 trajectory records with full entry chains,
 *     3 jobs through the job-orchestrator reference flow);
 *   - byte-determinism of the seeded corpus;
 *   - GOLDEN HTML for every route (sha256 goldens + inline golden
 *     fragments carrying the domain content digests — any change in
 *     domain output shows up as a test diff);
 *   - the R41 degraded corpus: last-known state served with the
 *     degradation banner + refresh affordance, and NO invented data;
 *   - read-only guarantee (mutation methods 405; full render sweep
 *     leaves the corpus byte-identical);
 *   - no-secrets negatives over every rendered page and the corpus;
 *   - transport behavior (query stripping, Content-Type, HEAD, Allow)
 *     including a REAL node:http round-trip on an ephemeral port.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildWorkbenchCorpus,
  SEED_JOB_IDS,
  SEED_TRAJECTORY_IDS,
} from './corpus.mjs';
import { requestPath, startWorkbenchServer } from './server.js';
import {
  handleWorkbenchRequest,
  isDeepFrozen,
} from '../../../../packages/workbench/src/index.js';
import type { WorkbenchCorpus } from '../../../../packages/workbench/src/index.js';

/**
 * Build the seeded corpus as its precise @arena/workbench type (the .mjs
 * builder is typed loosely via corpus.d.mts; the shape is asserted here).
 */
async function seededCorpus(): Promise<WorkbenchCorpus> {
  return (await buildWorkbenchCorpus()) as WorkbenchCorpus;
}

/** The degraded corpus (R41): the expert supply is marked unavailable. */
async function degradedCorpus(): Promise<WorkbenchCorpus> {
  return (await buildWorkbenchCorpus({ expertSupply: 'down' })) as WorkbenchCorpus;
}

const sha256 = (html: string): string => createHash('sha256').update(html).digest('hex');

/**
 * GOLDEN ROUTE HASHES. The seeded corpus is byte-deterministic, so every
 * route's rendered document has a stable sha256. A change in domain
 * output, view projection or renderer shows up here as a diff.
 */
const GOLDEN_ROUTE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'GET /': 'ddc5145c01eaa538991e3aeb22b1a38deb9f14eef255aa8fc7cde6af2d65cc9d',
  'GET /experts': 'e423f5077e64c02c0c3c2a636d5746b795cada1a52f086578308487b30baeaae',
  'GET /tasks': '6ae398faf5ec8cb1e33beb17244c49a24c68ac90dec08477d998a4ea737d278d',
  'GET /trajectories': 'a133139aa6f5f75d60d61911030f6e3139208aa75bc04497d10ffeb1fc049dd1',
  [`GET /trajectories/${SEED_TRAJECTORY_IDS[0]}`]:
    '9e55845b2eb7ac966cb3d61575118a3cc5f7d89056079df92e7b8af34bc60166',
  'GET /jobs': '10a61a74d221965ac226fd6ae2fad189b9bf7aa6cb133d6aaabf82419e27b35a',
  'GET /nope': '4e12f97d7511aa3ec1cb2ae6d1ed2e70cd585c4073034299180208f7cf28eed3',
  'POST /experts': '5c322e59afe6973218c2fa09fc667f33eca5597ed4ae783047893f82620dc8cc',
  'GET /experts (degraded)': '3a629d3cadf6beb6fda8a605cc995fa7a4b06ca724943bfa17eacca964c74868',
});

const ALL_GET_ROUTES = Object.keys(GOLDEN_ROUTE_SHA256)
  .filter((key) => key.startsWith('GET /'))
  .map((key) => key.slice(4))
  .filter((key) => !key.includes('('));

describe('the seeded corpus (A006 + A007 + A008 + A011 + A015 gates)', () => {
  it('meets every content gate (2 profiles, qualification flow, 2 specs, 2 trajectories, 3 jobs)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.profiles.map((profile) => `${profile.identity.expertId}:${profile.status}`)).toEqual([
      'expert-ada:published',
      'expert-kwame:suspended',
    ]);
    expect(corpus.claims).toHaveLength(2);
    expect(corpus.qualificationRecords.map((record) => record.status)).toEqual([
      'qualified',
      'stale',
    ]);
    expect(corpus.matchResults).toHaveLength(2);
    expect(corpus.specs.map((spec) => spec.identity.taskId)).toEqual([
      'task-reconcile-invoices',
      'task-diagnose-latency',
    ]);
    expect(corpus.compilations).toHaveLength(2);
    expect(corpus.trajectories.map((record) => record.header.trajectoryId)).toEqual([
      ...SEED_TRAJECTORY_IDS,
    ]);
    expect(corpus.jobs.map((job) => job.jobId)).toEqual([...SEED_JOB_IDS]);
  });

  it('drives qualification through the expert-matching reference flow (positive)', async () => {
    const corpus = await seededCorpus();
    // The qualified record carries per-requirement sufficiency evidence
    // (counts + freshness — no scores).
    const qualified = corpus.qualificationRecords[0];
    expect(qualified?.status).toBe('qualified');
    expect(qualified?.validFrom).toBeDefined();
    expect(qualified?.requirementOutcomes.map((outcome) => outcome.satisfied)).toEqual([
      true,
      true,
    ]);
    // The stale record: sufficient evidence COUNT on every requirement,
    // but nothing FRESH (the whole evidence set predates the window).
    const stale = corpus.qualificationRecords[1];
    expect(stale?.status).toBe('stale');
    expect(stale?.requirementOutcomes.map((outcome) => outcome.satisfied)).toEqual([
      false,
      false,
    ]);
    expect(stale?.requirementOutcomes.map((outcome) => outcome.presentCount)).toEqual([2, 1]);
  });

  it('drives matching through the expert-matching reference engine (R8, positive)', async () => {
    const corpus = await seededCorpus();
    const [reconciliation, load] = corpus.matchResults;
    // Clean match: expert-ada satisfies invoice-reconciliation in force.
    expect(reconciliation?.candidates).toHaveLength(1);
    const candidate = reconciliation?.candidates[0];
    expect(candidate?.expertId).toBe('expert-ada');
    expect(candidate?.satisfiedAll).toBe(true);
    expect(candidate?.perRequirement[0]?.claimDigest).toBe(corpus.claims[0]?.digest);
    expect(candidate?.perRequirement[0]?.recordDigest).toBe(
      corpus.qualificationRecords[0]?.digest,
    );
    // Partial-inclusive policy: EVERY registered card surfaces with its
    // explicit closed-vocabulary unmatched reason — kwame's qualification
    // is stale, and ada holds no claim on load-analysis at all (no silent
    // best-effort, no hiding).
    expect(load?.candidates).toHaveLength(2);
    const kwame = load?.candidates.find((candidate) => candidate.expertId === 'expert-kwame');
    expect(kwame?.satisfiedAll).toBe(false);
    expect(kwame?.perRequirement[0]?.unmatchedReason).toBe('qualification-stale');
    const ada = load?.candidates.find((candidate) => candidate.expertId === 'expert-ada');
    expect(ada?.perRequirement[0]?.unmatchedReason).toBe('no-competency-claim');
    expect(load?.requirementsUnmet).toEqual(['load-analysis']);
  });

  it('drives jobs through the job-orchestrator reference flow (positive)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.jobs.map((job) => job.status)).toEqual(['succeeded', 'failed', 'queued']);
    // The succeeded job carries the full reference-flow event trail.
    const succeeded = corpus.jobs[0];
    expect(succeeded?.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-progressed',
      'job-completed',
    ]);
    expect(succeeded?.progress?.percent).toBe(50);
    const failed = corpus.jobs[1];
    expect(failed?.failure?.errorClass).toBe('compilation-timeout');
    // Every job is correlation- and idempotency-addressable (lock rule 17).
    for (const job of corpus.jobs) {
      expect(job.correlationId).toMatch(/^workbench-seed-/);
      expect(job.idempotencyKey).toMatch(/^workbench-seed-/);
      expect(job.idempotencyScope).toMatch(/^(demo-matching|demo-compilation)$/);
    }
  });

  it('is byte-deterministic across builds (golden precondition)', async () => {
    const first = await seededCorpus();
    const second = await seededCorpus();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('is deep-frozen (read-only precondition)', async () => {
    const corpus = await seededCorpus();
    expect(isDeepFrozen(corpus)).toBe(true);
  });
});

describe('golden HTML per route', () => {
  it('renders byte-stable documents whose sha256 matches the committed goldens', async () => {
    const corpus = await seededCorpus();
    for (const route of ALL_GET_ROUTES) {
      const response = handleWorkbenchRequest({ method: 'GET', path: route }, corpus);
      const expected = GOLDEN_ROUTE_SHA256[`GET ${route}`];
      expect(expected, `missing golden for ${route}`).toBeDefined();
      expect(sha256(response.html), `golden drift on GET ${route}`).toBe(expected);
    }
  });

  it('renders the 405 golden for a mutation method (negative)', async () => {
    const corpus = await seededCorpus();
    const response = handleWorkbenchRequest({ method: 'POST', path: '/experts' }, corpus);
    expect(response.status).toBe(405);
    expect(sha256(response.html)).toBe(GOLDEN_ROUTE_SHA256['POST /experts'] as string);
  });

  it('renders the degraded-directory golden (R41, last-known state + banner)', async () => {
    const corpus = await degradedCorpus();
    const response = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    expect(response.status).toBe(200);
    expect(sha256(response.html)).toBe(GOLDEN_ROUTE_SHA256['GET /experts (degraded)'] as string);
  });

  it('embeds the domain content digests inline (domain output IS the golden)', async () => {
    const corpus = await seededCorpus();
    const experts = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, corpus);
    // Golden fragments: the exact profile digest refs (hard-coded).
    expect(experts.html).toContain(
      '<code class="digest">d7ebab05c185a25b437c08872603b75f848f427b2c08406a82ea1bca49a58a80</code>',
    );
    expect(experts.html).toContain(
      '<code class="digest">a911d8a228316c9f27a37b3b2db9f1fcebb5551e1b03ee85e2a1294a46677fdd</code>',
    );
    const tasks = handleWorkbenchRequest({ method: 'GET', path: '/tasks' }, corpus);
    expect(tasks.html).toContain(
      '<code class="digest">f5be36311994776ef85b8b5c450b45fd944ae9544e523dcd84a440caf44dbb3c</code>',
    );
    // The match-outcome result digests render inline (A007 output).
    expect(tasks.html).toContain(
      '<code class="digest">aa30abcc68636ea78ad73450991f78f487bde500e8b1347252b6d26752de1667</code>',
    );
    const trajectory = handleWorkbenchRequest(
      { method: 'GET', path: `/trajectories/${SEED_TRAJECTORY_IDS[0]}` },
      corpus,
    );
    expect(trajectory.html).toContain('<strong>Step 4</strong>');
    expect(trajectory.html).toContain('netting proposal recorded: INV-2291');
  });

  it('renders every page with the correct Content-Type', async () => {
    const corpus = await seededCorpus();
    for (const route of ALL_GET_ROUTES) {
      const response = handleWorkbenchRequest({ method: 'GET', path: route }, corpus);
      expect(response.contentType, route).toBe('text/html; charset=utf-8');
    }
  });
});

describe('graceful degradation over the seeded corpus (R41)', () => {
  it('serves the LAST-KNOWN directory under the degradation banner (positive)', async () => {
    const healthy = await seededCorpus();
    const degraded = await degradedCorpus();
    // The degraded corpus keeps the EXACT same records (last-known).
    expect(JSON.stringify(degraded.profiles)).toBe(JSON.stringify(healthy.profiles));
    expect(JSON.stringify(degraded.claims)).toBe(JSON.stringify(healthy.claims));
    expect(JSON.stringify(degraded.qualificationRecords)).toBe(
      JSON.stringify(healthy.qualificationRecords),
    );
    const response = handleWorkbenchRequest({ method: 'GET', path: '/experts' }, degraded);
    expect(response.status).toBe(200);
    expect(response.html).toContain('<section class="degraded" role="alert">');
    expect(response.html).toContain('<code class="digest">expert-supply-unavailable</code>');
    expect(response.html).toContain('<code class="digest">last-known-state</code>');
    expect(response.html).toContain('<a class="refresh" href="/experts">Refresh</a>');
    // The last-known experts still render (no invented data, no zeroing).
    expect(response.html).toContain('demo/expert-ada');
    expect(response.html).toContain('demo/expert-kwame');
  });

  it('rolls the degradation up on the overview (positive)', async () => {
    const degraded = await degradedCorpus();
    const response = handleWorkbenchRequest({ method: 'GET', path: '/' }, degraded);
    expect(response.html).toContain('Degraded mode');
    expect(response.html).toContain('experts');
  });

  it('degradation never changes the HTTP status (the page still serves)', async () => {
    const degraded = await degradedCorpus();
    for (const path of ['/', '/experts', '/tasks', '/trajectories', '/jobs']) {
      const response = handleWorkbenchRequest({ method: 'GET', path }, degraded);
      expect(response.status, path).toBe(200);
    }
  });
});

describe('read-only guarantee over the seeded corpus', () => {
  it('answers every mutation method with 405 on every route (negative)', async () => {
    const corpus = await seededCorpus();
    const routes = [...ALL_GET_ROUTES, '/nope'];
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of routes) {
        const response = handleWorkbenchRequest({ method, path }, corpus);
        expect(response.status, `${method} ${path}`).toBe(405);
        expect(response.allow, `${method} ${path}`).toBe('GET, HEAD');
      }
    }
  });

  it('never mutates domain state across the full render sweep (negative)', async () => {
    const corpus = await seededCorpus();
    const before = JSON.stringify(corpus);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of [...ALL_GET_ROUTES, '/trajectories/unknown']) {
        handleWorkbenchRequest({ method, path }, corpus);
      }
    }
    expect(JSON.stringify(corpus)).toBe(before);
    expect(isDeepFrozen(corpus)).toBe(true);
  });
});

describe('no-secrets negatives over the seeded corpus', () => {
  // Credential-VALUE shapes: key material is long and charset-constrained,
  // so common neutral words (e.g. "task-reconcile") never match.
  const CREDENTIAL_PATTERN =
    /(ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{20,}|xoxb-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN|bearer\s|apikey|api-key|api_key|password=|secret=|authorization:)/i;
  const PROVIDER_PATTERN =
    /(openai|anthropic|gpt-|claude|gemini|mistral|groq|ollama|deepseek|bedrock|copilot|azure|google|amazon)/i;

  it('renders no credential or provider material on any route (negative)', async () => {
    for (const corpus of [await seededCorpus(), await degradedCorpus()]) {
      for (const method of ['GET', 'POST']) {
        for (const path of [...ALL_GET_ROUTES, '/nope']) {
          const response = handleWorkbenchRequest({ method, path }, corpus);
          expect(CREDENTIAL_PATTERN.test(response.html), `${method} ${path} leaked credentials`).toBe(
            false,
          );
          expect(PROVIDER_PATTERN.test(response.html), `${method} ${path} leaked a brand`).toBe(
            false,
          );
        }
      }
    }
  });

  it('carries no secrets in the corpus itself (negative)', async () => {
    for (const corpus of [await seededCorpus(), await degradedCorpus()]) {
      const serialized = JSON.stringify(corpus);
      expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
      expect(PROVIDER_PATTERN.test(serialized)).toBe(false);
    }
  });

  it('the scanner itself detects the deny-list words (self-test, negative control)', async () => {
    const corpus = await seededCorpus();
    // Assembled at runtime so no literal token-shaped string is committed.
    const githubPat = ['g', 'h', 'p', '_'].join('') + 'a1b2c3d4e5f6a7b8c9d0';
    expect(CREDENTIAL_PATTERN.test(`token: ${githubPat}`)).toBe(true);
    expect(CREDENTIAL_PATTERN.test('key: sk-abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(CREDENTIAL_PATTERN.test('Authorization: Bearer xyz')).toBe(true);
    expect(CREDENTIAL_PATTERN.test('x-api-key: abc')).toBe(true);
    // No false positives on the corpus vocabulary:
    const serialized = JSON.stringify(corpus);
    expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
    expect(/task-reconcile-invoices/.test(serialized)).toBe(true);
  });
});

describe('transport behavior', () => {
  it('strips query strings and fragments before routing (positive)', () => {
    expect(requestPath('/experts?XTransformPort=3030')).toBe('/experts');
    expect(requestPath('/experts#directory')).toBe('/experts');
    expect(requestPath(undefined)).toBe('/');
    expect(requestPath('/trajectories/x?follow=1')).toBe('/trajectories/x');
  });

  it('serves a hostile route path escaped through the 404 view (negative)', async () => {
    const corpus = await seededCorpus();
    const response = handleWorkbenchRequest(
      { method: 'GET', path: '/trajectories/<script>alert(1)</script>' },
      corpus,
    );
    expect(response.status).toBe(404);
    expect(response.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.html).not.toContain('<script');
  });
});

describe('real node:http round-trip (end to end)', () => {
  it('serves the workbench over a real socket (positive)', async () => {
    const corpus = await seededCorpus();
    const handler = (request: { method: string; path: string }) =>
      handleWorkbenchRequest(request, corpus);
    const running = await startWorkbenchServer(handler, { port: 0, host: '127.0.0.1' });
    try {
      const home = await fetch(running.url);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const body = await home.text();
      expect(body).toContain('<!DOCTYPE html>');
      expect(body).toContain('<h1>Workbench Overview</h1>');
      expect(body).toContain('Registered experts');

      const experts = await fetch(new URL('/experts', running.url));
      expect(experts.status).toBe(200);
      const expertsBody = await experts.text();
      expect(expertsBody).toContain('demo/expert-ada');
      expect(expertsBody).toContain('class="badge status-qualified"');
      expect(expertsBody).toContain('class="badge status-stale"');

      const notFound = await fetch(new URL('/nope', running.url));
      expect(notFound.status).toBe(404);
      expect(notFound.headers.get('content-type')).toBe('text/html; charset=utf-8');

      const mutation = await fetch(new URL('/experts', running.url), { method: 'POST' });
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get('allow')).toBe('GET, HEAD');

      const head = await fetch(new URL('/jobs', running.url), { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
      // HEAD carries headers only.
      expect(await head.text()).toBe('');

      const trajectory = await fetch(
        new URL(`/trajectories/${SEED_TRAJECTORY_IDS[0]}`, running.url),
      );
      expect(trajectory.status).toBe(200);
      expect(await trajectory.text()).toContain('netting proposal recorded: INV-2291');
    } finally {
      await running.close();
    }
  });

  it('serves the DEGRADED workbench over a real socket (R41, positive)', async () => {
    const corpus = await degradedCorpus();
    const handler = (request: { method: string; path: string }) =>
      handleWorkbenchRequest(request, corpus);
    const running = await startWorkbenchServer(handler, { port: 0, host: '127.0.0.1' });
    try {
      const experts = await fetch(new URL('/experts', running.url));
      expect(experts.status).toBe(200);
      const body = await experts.text();
      expect(body).toContain('<section class="degraded" role="alert">');
      expect(body).toContain('expert-supply-unavailable');
      expect(body).toContain('<a class="refresh" href="/experts">Refresh</a>');
      // Last-known entries still render.
      expect(body).toContain('demo/expert-ada');
    } finally {
      await running.close();
    }
  });
});
