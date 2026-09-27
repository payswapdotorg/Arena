/**
 * The console end-to-end suite (Work Order A018, gates 5-10):
 *
 *   - corpus content gates (≥2 cases, ≥2 bodies, ≥2 substrates via the
 *     model-substrate reference adapters, ≥2 jobs through the
 *     job-orchestrator reference flow, ≥1 run with trajectory entries);
 *   - byte-determinism of the seeded corpus;
 *   - GOLDEN HTML for every route (sha256 goldens + inline golden
 *     fragments carrying the domain content digests — any change in
 *     domain output shows up as a test diff);
 *   - read-only guarantee (mutation methods 405; full render sweep leaves
 *     every content digest verifiable);
 *   - no-secrets negatives over every rendered page and the corpus;
 *   - transport behavior (query stripping, Content-Type, HEAD, Allow)
 *     including a REAL node:http round-trip on an ephemeral port.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  buildConsoleCorpus,
  SEED_JOB_IDS,
  SEED_RUN_ID,
} from './corpus.mjs';
import { requestPath, startConsoleServer } from './server.js';
import {
  handleConsoleRequest,
  isDeepFrozen,
} from '../../../../packages/control-ui/src/index.js';
import type { ConsoleCorpus } from '../../../../packages/control-ui/src/index.js';

/**
 * Build the seeded corpus as its precise @arena/control-ui type (the .mjs
 * builder is typed loosely via corpus.d.mts; the shape is asserted here).
 */
async function seededCorpus(): Promise<ConsoleCorpus> {
  return (await buildConsoleCorpus()) as ConsoleCorpus;
}
import { verifyCapabilityCase } from '../../../../packages/capability-case/src/index.js';
import { verifyEnvironmentDefinition } from '../../../../packages/environment-protocol/src/index.js';

const sha256 = (html: string): string => createHash('sha256').update(html).digest('hex');

/**
 * GOLDEN ROUTE HASHES (gate 6). The seeded corpus is byte-deterministic,
 * so every route's rendered document has a stable sha256. A change in
 * domain output, view projection or renderer shows up here as a diff.
 */
const GOLDEN_ROUTE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'GET /': '11d9dfd2f9d23b0bad6e550a20cd7aa69d96d0e0e655910158ef55c9724a7e7a',
  'GET /cases': '1458d95a9acacebd6c2682b631960d338e1af7c7e1d4da97e40ee40de85893eb',
  'GET /bodies': '7bb3ffb79ccbc91aea25358192be5accb6570eb20d93ac6e6fa4f3c245ee9220',
  'GET /substrates': '404ef1a16deabc74857200679474ace7c5cf100a8f02b42482988d6fcee149d4',
  'GET /jobs': 'ee7799b7a2cea8b5c95165e21665a4c7c9038cba9a8af662c6a823fe44411f75',
  'GET /runs': 'bc71fc01853e2088033dea9aef43852408809d8d0aaec39c4582f9ef3b480bdf',
  [`GET /runs/${SEED_RUN_ID}/trajectory`]:
    'a8179eeeeb2f3b875196b9440f714cfd546b44544d26ef830ff39f018b12508b',
  'GET /nope': '02f34a6e8a9330a3e0f8fad1f093c40be5bade4c643bf9b3a8530ab3bec09bcb',
  'POST /cases': '53050017713827faa4f3f6c6dbade8370097d903539da24aac7cf2c293a6bfbc',
});

const ALL_GET_ROUTES = Object.keys(GOLDEN_ROUTE_SHA256)
  .filter((key) => key.startsWith('GET '))
  .map((key) => key.slice(4));

describe('the seeded corpus (gate 5)', () => {
  it('meets every content gate (≥2 cases, ≥2 bodies, ≥2 substrates, ≥2 jobs, ≥1 run)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.cases.length).toBeGreaterThanOrEqual(2);
    expect(corpus.bodies.length).toBeGreaterThanOrEqual(2);
    expect(corpus.substrates.length).toBeGreaterThanOrEqual(2);
    expect(corpus.jobs.length).toBeGreaterThanOrEqual(2);
    expect(corpus.runs.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(corpus.trajectories)).toEqual([SEED_RUN_ID]);
    expect(corpus.trajectories[SEED_RUN_ID]?.length).toBeGreaterThanOrEqual(2);
  });

  it('registers substrates through BOTH model-substrate reference adapters (positive)', async () => {
    const corpus = await seededCorpus();
    const adapterIds = corpus.substrates.map((entry) => entry.adapterDescriptor.adapterId);
    expect(adapterIds).toContain('neutral-mock');
    expect(adapterIds).toContain('offline-stub');
    // Neutral registry ids + digests only (gate 9).
    expect(corpus.substrates.map((entry) => entry.substrateId)).toEqual([
      'substrate-reasoner-general',
      'substrate-offline-baseline',
    ]);
  });

  it('drives jobs through the job-orchestrator reference flow (positive)', async () => {
    const corpus = await seededCorpus();
    expect(corpus.jobs.map((job) => job.jobId)).toEqual([...SEED_JOB_IDS]);
    const statuses = corpus.jobs.map((job) => job.status);
    expect(statuses).toEqual(['succeeded', 'failed', 'queued']);
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
    expect(failed?.failure?.errorClass).toBe('verification-mismatch');
    // Every job is correlation- and idempotency-addressable (lock rule 17).
    for (const job of corpus.jobs) {
      expect(job.correlationId).toMatch(/^console-seed-/);
      expect(job.idempotencyKey).toMatch(/^console-seed-/);
      expect(job.idempotencyScope).toMatch(/^(demo-evaluation|demo-verification)$/);
    }
  });

  it('carries cases in different lifecycle states incl. a full intake journey (positive)', async () => {
    const corpus = await seededCorpus();
    const statuses = corpus.cases.map((entry) => `${entry.identity.caseId}:${entry.status}`);
    expect(statuses).toEqual(['case-load-review-latency:draft', 'case-review-invoices:active']);
    const active = corpus.cases[1];
    expect(active?.lifecycle.map((event) => event.kind)).toEqual([
      'case-created',
      'case-submitted',
      'case-triaged',
      'case-activated',
    ]);
  });

  it('is byte-deterministic across builds (gate 6 precondition)', async () => {
    const first = await seededCorpus();
    const second = await seededCorpus();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('is deep-frozen (gate 7 precondition)', async () => {
    const corpus = await seededCorpus();
    expect(isDeepFrozen(corpus)).toBe(true);
  });
});

describe('golden HTML per route (gate 6)', () => {
  it('renders byte-stable documents whose sha256 matches the committed goldens', async () => {
    const corpus = await seededCorpus();
    for (const route of ALL_GET_ROUTES) {
      const response = handleConsoleRequest({ method: 'GET', path: route }, corpus);
      const expected = GOLDEN_ROUTE_SHA256[`GET ${route}`];
      expect(expected, `missing golden for ${route}`).toBeDefined();
      expect(sha256(response.html), `golden drift on GET ${route}`).toBe(expected);
    }
  });

  it('renders the 405 golden for a mutation method (negative)', async () => {
    const corpus = await seededCorpus();
    const response = handleConsoleRequest({ method: 'POST', path: '/cases' }, corpus);
    expect(response.status).toBe(405);
    expect(sha256(response.html)).toBe(GOLDEN_ROUTE_SHA256['POST /cases'] as string);
  });

  it('embeds the domain content digests inline (domain output IS the golden)', async () => {
    const corpus = await seededCorpus();
    const cases = handleConsoleRequest({ method: 'GET', path: '/cases' }, corpus);
    // Golden fragments: the exact case row digest refs (hard-coded).
    expect(cases.html).toContain(
      '<code class="digest">fa7d102635566559f196bc5fc583ceb696b3f9ef1ffcc48bfb2d3d7481200a16</code>',
    );
    expect(cases.html).toContain(
      '<code class="digest">345c5e07454478ba5f75d85296600dd76a8911979e1737f9d1592f6deb257331</code>',
    );
    const bodies = handleConsoleRequest({ method: 'GET', path: '/bodies' }, corpus);
    expect(bodies.html).toContain(
      '<code class="digest">06b6381289c1b72f70eb4a808f14671b5400742f1d265cd7dba2b3a22f068b6c</code>',
    );
    const substrates = handleConsoleRequest({ method: 'GET', path: '/substrates' }, corpus);
    expect(substrates.html).toContain(
      '<code class="digest">4ac7f399cb1ee273e180872f83291aa8b0f3e4455d7e9499188026280f8d65ab</code>',
    );
    const trajectory = handleConsoleRequest(
      { method: 'GET', path: `/runs/${SEED_RUN_ID}/trajectory` },
      corpus,
    );
    expect(trajectory.html).toContain('<strong>Step 2</strong> — 2026-10-03T09:04:00.000Z');
    expect(trajectory.html).toContain('propose-netting: INV-2291 + credit note CN-0117');
  });

  it('renders every page with the correct Content-Type (gate 5)', async () => {
    const corpus = await seededCorpus();
    for (const route of ALL_GET_ROUTES) {
      const response = handleConsoleRequest({ method: 'GET', path: route }, corpus);
      expect(response.contentType, route).toBe('text/html; charset=utf-8');
    }
  });
});

describe('read-only guarantee over the seeded corpus (gate 7)', () => {
  it('answers every mutation method with 405 on every route (negative)', async () => {
    const corpus = await seededCorpus();
    const routes = [...ALL_GET_ROUTES, `/runs/${SEED_RUN_ID}/trajectory`];
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of routes) {
        const response = handleConsoleRequest({ method, path }, corpus);
        expect(response.status, `${method} ${path}`).toBe(405);
        expect(response.allow, `${method} ${path}`).toBe('GET, HEAD');
      }
    }
  });

  it('never mutates domain state across the full render sweep (negative)', async () => {
    const corpus = await seededCorpus();
    const before = JSON.stringify(corpus);
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of [...ALL_GET_ROUTES, '/runs/unknown/trajectory']) {
        handleConsoleRequest({ method, path }, corpus);
      }
    }
    expect(JSON.stringify(corpus)).toBe(before);
    // Fail-closed re-verification of every content-addressed record.
    for (const caseRecord of corpus.cases) {
      await expect(verifyCapabilityCase(caseRecord)).resolves.toBe(caseRecord.digest);
    }
    for (const run of corpus.runs) {
      await expect(verifyEnvironmentDefinition(run.definition)).resolves.toBe(
        run.definition.digest,
      );
    }
    expect(isDeepFrozen(corpus)).toBe(true);
  });
});

describe('no-secrets negatives over the seeded corpus (gate 9)', () => {
  // Credential-VALUE shapes: key material is long and charset-constrained,
  // so common neutral words (e.g. "task-reconcile") never match.
  const CREDENTIAL_PATTERN =
    /(ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9]{20,}|xoxb-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN|bearer\s|apikey|api-key|api_key|password=|secret=|authorization:)/i;
  const PROVIDER_PATTERN =
    /(openai|anthropic|gpt-|claude|gemini|mistral|groq|ollama|deepseek|bedrock|copilot|azure|google|amazon)/i;

  it('renders no credential or provider material on any route (negative)', async () => {
    const corpus = await seededCorpus();
    for (const method of ['GET', 'POST']) {
      for (const path of [...ALL_GET_ROUTES, `/runs/${SEED_RUN_ID}/trajectory`]) {
        const response = handleConsoleRequest({ method, path }, corpus);
        expect(CREDENTIAL_PATTERN.test(response.html), `${method} ${path} leaked credentials`).toBe(
          false,
        );
        expect(PROVIDER_PATTERN.test(response.html), `${method} ${path} leaked a brand`).toBe(
          false,
        );
      }
    }
  });

  it('carries no secrets in the corpus itself (negative)', async () => {
    const corpus = await seededCorpus();
    const serialized = JSON.stringify(corpus);
    expect(CREDENTIAL_PATTERN.test(serialized)).toBe(false);
    expect(PROVIDER_PATTERN.test(serialized)).toBe(false);
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

describe('transport behavior (gate 5)', () => {
  it('strips query strings and fragments before routing (positive)', () => {
    expect(requestPath('/cases?XTransformPort=3030')).toBe('/cases');
    expect(requestPath('/cases#section')).toBe('/cases');
    expect(requestPath(undefined)).toBe('/');
    expect(requestPath('/runs/x/trajectory?follow=1')).toBe('/runs/x/trajectory');
  });

  it('serves a hostile route path escaped through the 404 view (negative)', async () => {
    const corpus = await seededCorpus();
    const response = handleConsoleRequest(
      { method: 'GET', path: '/runs/<script>alert(1)</script>/trajectory' },
      corpus,
    );
    expect(response.status).toBe(404);
    expect(response.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.html).not.toContain('<script');
  });
});

describe('real node:http round-trip (gate 5, end to end)', () => {
  it('serves the console over a real socket (positive)', async () => {
    const corpus = await seededCorpus();
    const handler = (request: { method: string; path: string }) =>
      handleConsoleRequest(request, corpus);
    const running = await startConsoleServer(handler, { port: 0, host: '127.0.0.1' });
    try {
      const home = await fetch(running.url);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const body = await home.text();
      expect(body).toContain('<!DOCTYPE html>');
      expect(body).toContain('<h1>Dashboard</h1>');
      expect(body).toContain('Capability cases');
      // The dashboard carries the corpus's content-addressed case digests.
      expect(body).toContain(
        '345c5e07454478ba5f75d85296600dd76a8911979e1737f9d1592f6deb257331',
      );

      const notFound = await fetch(new URL('/nope', running.url));
      expect(notFound.status).toBe(404);
      expect(notFound.headers.get('content-type')).toBe('text/html; charset=utf-8');

      const mutation = await fetch(new URL('/cases', running.url), { method: 'POST' });
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get('allow')).toBe('GET, HEAD');

      const head = await fetch(new URL('/jobs', running.url), { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
      // HEAD carries headers only.
      expect(await head.text()).toBe('');

      const trajectory = await fetch(new URL(`/runs/${SEED_RUN_ID}/trajectory`, running.url));
      expect(trajectory.status).toBe(200);
      expect(await trajectory.text()).toContain('propose-netting: INV-2291');
    } finally {
      await running.close();
    }
  });
});
