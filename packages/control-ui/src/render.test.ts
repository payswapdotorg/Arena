/**
 * HTML renderers — positive and negative tests (Work Order A018, gates 3
 * and 6): golden-string assertions for every renderer, semantic-HTML
 * markers, and the XSS negatives (hostile view fields render escaped;
 * hostile route paths render escaped through the 404 view).
 *
 * Golden strategy: control-ui goldens pin the RENDERER STRUCTURE (literal
 * templates; the content-addressed digests of the fixture domain objects
 * are interpolated from the same runtime values the renderer read). The
 * app-side console suite (apps/web/src/console/console.test.ts) pins the
 * FULL byte-golden of the seeded corpus pages, where the digests are
 * hard-coded constants — a change in domain output shows up as a test
 * diff there.
 */

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.js';
import {
  NAV_LINKS,
  renderBody,
  renderCaseSummary,
  renderDashboard,
  renderDocument,
  renderEnvironmentRun,
  renderJob,
  renderMethodNotAllowed,
  renderNotFound,
  renderSubstrate,
  renderTrajectory,
} from './render.js';
import { CONSOLE_STYLESHEET } from './stylesheet.js';
import {
  toBodyView,
  toCaseSummaryView,
  toEnvironmentRunView,
  toJobView,
  toSubstrateView,
  toTrajectoryView,
} from './views.js';
import type { CaseSummaryView } from './views.js';
import {
  makeFixtureBody,
  makeFixtureCase,
  makeFixtureJob,
  makeFixtureRun,
  makeFixtureSteps,
  makeFixtureSubstrate,
} from './test-support.js';

describe('renderDocument (gate 3)', () => {
  it('produces a complete semantic document with the inline stylesheet (positive)', () => {
    const html = renderDocument('Dashboard', '/', '<main-marker>');
    expect(html.startsWith('<!DOCTYPE html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Dashboard — Arena Control Console</title>');
    // The stylesheet is served INLINE (no external assets, no CDN).
    expect(html).toContain(`<style>${CONSOLE_STYLESHEET}</style>`);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/[^"']*\.(css|js)/i);
    // Landmarks + navigation are server-routed, hash-free links.
    expect(html).toContain('<header class="site">');
    expect(html).toContain('<main>');
    expect(html).toContain('<footer class="site">');
    for (const link of NAV_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
      expect(link.href.includes('#')).toBe(false);
    }
    expect(html).toContain('<main-marker>');
    expect(html.endsWith('</html>')).toBe(true);
  });

  it('marks the current section with aria-current (positive)', () => {
    expect(renderDocument('Jobs', '/jobs', 'x')).toContain(
      'href="/jobs" aria-current="page"',
    );
    expect(renderDocument('Jobs', '/jobs', 'x')).not.toContain(
      'href="/cases" aria-current="page"',
    );
    expect(renderDocument('Dashboard', '/', 'x')).toContain(
      'href="/" aria-current="page"',
    );
  });

  it('escapes a hostile page title (negative)', () => {
    const html = renderDocument('<script>alert(1)</script>', '/', 'x');
    expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; — Arena Control Console</title>');
    expect(html).not.toContain('<title><script>');
  });
});

describe('renderCaseSummary (gate 3)', () => {
  it('renders the case detail card as a definition list (positive)', async () => {
    const caseRecord = await makeFixtureCase();
    const html = renderCaseSummary(toCaseSummaryView(caseRecord));
    expect(html).toContain('<h2>tenant-fixture/case-fixture@1.0.0</h2>');
    expect(html).toContain('<dt>Problem</dt><dd>Fixture problem statement for console rendering tests.</dd>');
    expect(html).toContain('<dt>Evidence refs</dt><dd>1</dd>');
    expect(html).toContain(`<dd><code class="digest">${caseRecord.digest}</code></dd>`);
    expect(html).toContain('class="badge status-draft"');
    expect(html).toContain('<dl class="kv">');
  });
});

describe('renderBody (gate 3)', () => {
  it('renders the body card with counts and compatibility (positive)', async () => {
    const body = await makeFixtureBody();
    const html = renderBody(toBodyView(body));
    expect(html).toContain('<h2>tenant-fixture/fixture-agent@1.0.0</h2>');
    expect(html).toContain('<dt>Skills</dt><dd>1</dd>');
    expect(html).toContain('<dt>Substrate compatibility</dt><dd>json-schema · ≥ 1000 context units</dd>');
    expect(html).toContain(`<dd><code class="digest">${body.digest}</code></dd>`);
  });
});

describe('renderSubstrate (gate 3)', () => {
  it('renders the substrate card with neutral ids and digest refs (positive)', async () => {
    const registration = await makeFixtureSubstrate();
    const html = renderSubstrate(toSubstrateView(registration));
    expect(html).toContain('<h2>substrate-fixture</h2>');
    expect(html).toContain('<dt>Adapter</dt><dd>fixture-adapter@1.0.0</dd>');
    expect(html).toContain('<dt>Context limits</dt><dd>4096 in / 2048 out</dd>');
    expect(html).toContain(
      `<dd><code class="digest">${registration.substrate.integrity.contentDigest}</code></dd>`,
    );
  });
});

describe('renderJob (gate 3)', () => {
  it('renders the job card with the addressability pair (positive)', async () => {
    const job = await makeFixtureJob();
    const html = renderJob(toJobView(job));
    expect(html).toContain('<h2>job-fixture-0001</h2>');
    expect(html).toContain('<dt>Correlation id</dt><dd>fixture-correlation-1</dd>');
    expect(html).toContain('<dt>Idempotency key</dt><dd>fixture-idempotency-1</dd>');
    expect(html).toContain('<dt>Progress</dt><dd><span class="muted">—</span></dd>');
    expect(html).toContain('<dt>Failure</dt><dd><span class="muted">—</span></dd>');
  });
});

describe('renderEnvironmentRun (gate 3)', () => {
  it('renders the run card with its full evidence address (positive)', async () => {
    const run = await makeFixtureRun();
    const html = renderEnvironmentRun(toEnvironmentRunView(run));
    expect(html).toContain('<h2>Run run-fixture-0001</h2>');
    expect(html).toContain('<dt>Network egress</dt><dd>default-deny</dd>');
    expect(html).toContain(
      `<dt>Trajectory</dt><dd><a href="/runs/run-fixture-0001/trajectory"><code class="digest">${run.address.trajectoryDigest}</code></a></dd>`,
    );
  });
});

describe('renderTrajectory (gate 3)', () => {
  it('renders an ordered step list pinned by the trajectory digest (positive)', async () => {
    const run = await makeFixtureRun();
    const html = renderTrajectory(toTrajectoryView(run.address, makeFixtureSteps()));
    expect(html).toContain('<h1>Trajectory — run run-fixture-0001</h1>');
    expect(html).toContain('<ol class="steps">');
    expect(html).toContain('<strong>Step 1</strong>');
    expect(html).toContain('Action: fixture-action: read inputs');
    expect(html).toContain('Evidence: <code class="digest">');
    expect(html).toContain('<dt>Steps</dt><dd>2</dd>');
  });
});

describe('renderDashboard (gate 3)', () => {
  it('aggregates every section with links and breakdowns (positive)', () => {
    const html = renderDashboard({
      kind: 'dashboard',
      caseCount: 2,
      bodyCount: 3,
      substrateCount: 4,
      jobCount: 5,
      runCount: 6,
      trajectoryStepCount: 7,
      caseStatusBreakdown: [
        { status: 'active', count: 1 },
        { status: 'draft', count: 1 },
      ],
      jobStatusBreakdown: [{ status: 'queued', count: 5 }],
      latestCaseDigests: ['a'.repeat(64)],
      latestJobIds: ['job-1'],
    });
    expect(html).toContain('<h1>Dashboard</h1>');
    expect(html).toContain('<div class="stat">2</div>');
    expect(html).toContain('Capability cases (<a href="/cases">browse</a>)');
    expect(html).toContain('class="badge status-active"');
    expect(html).toContain('<th scope="col" class="num">Count</th>');
    expect(html).toContain(`<li><code class="digest">${'a'.repeat(64)}</code></li>`);
  });
});

describe('error renderers (gate 4 negatives)', () => {
  it('renders the 404 view with the path escaped (negative)', () => {
    const html = renderNotFound({ kind: 'not-found', path: '/runs/<script>/trajectory' });
    expect(html).toContain('<h1>Not found</h1>');
    expect(html).toContain(
      `<code class="digest">${escapeHtml('/runs/<script>/trajectory')}</code>`,
    );
    expect(html).not.toContain('<script>');
  });

  it('renders the 405 view naming the allowed methods (negative)', () => {
    const html = renderMethodNotAllowed({
      kind: 'method-not-allowed',
      method: 'POST',
      path: '/cases',
      allowedMethods: ['GET', 'HEAD'],
    });
    expect(html).toContain('<h1>Method not allowed</h1>');
    expect(html).toContain('<code class="digest">POST</code>');
    expect(html).toContain('Allowed methods: GET, HEAD');
    expect(html).toContain('No POST, PUT, DELETE or PATCH route exists');
  });
});

describe('XSS safety across every renderer (gate 3 negative)', () => {
  it('renders a hostile case summary fully escaped (negative)', () => {
    const hostile: CaseSummaryView = Object.freeze({
      kind: 'case-summary',
      tenant: 'tenant-x',
      caseId: 'case-<script>alert(1)</script>',
      version: '1.0.0',
      status: 'draft',
      priority: 'high',
      risk: 'low',
      problemStatement: '<script>alert("pwned")</script>',
      targetCapability: 'cap<script>@1.0.0',
      domain: 'domain<script>',
      evidenceCount: 1,
      unknownsCount: 1,
      lifecycleEventCount: 1,
      raisedBy: 'tenant/principal<script>',
      createdAt: '2026-01-01T00:00:00.000Z',
      currentBodyRef: 'tenant/body<script>@1.0.0',
      currentSubstrateRef: 'adapter:model<script>@r1',
      digest: 'd'.repeat(64),
    });
    const html = renderCaseSummary(hostile);
    // Every hostile field is escaped...
    expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
    expect(html).toContain('case-&lt;script&gt;alert(1)&lt;/script&gt;');
    // ...and no raw script tag ever appears.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror=');
  });

  it('renders hostile job fields fully escaped (negative)', () => {
    const html = renderJob({
      kind: 'job',
      jobId: 'job-<script>',
      jobKind: 'ns/name<script>@1.0.0',
      definitionDigest: 'a'.repeat(64),
      correlationId: 'corr-<img src=x onerror=alert(1)>',
      idempotencyKey: 'idem',
      idempotencyScope: 'scope',
      status: 'failed',
      attempts: 2,
      maxAttempts: 3,
      timeoutMs: 1000,
      submittedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
      eventCount: 4,
      lastEventKind: 'job-failed',
      progressPercent: 50,
      progressNote: 'note<script>',
      failureKind: 'error',
      failureClass: 'class<script>',
      failureMessage: 'message<script>',
    });
    expect(html).toContain('job-&lt;script&gt;');
    expect(html).toContain('corr-&lt;img src=x onerror=alert(1)&gt;');
    // No RAW markup ever appears: the escaped text above contains the
    // literal "onerror=" inside DISPLAY text (harmless); what must never
    // appear is the unescaped tag/attribute injection forms.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('onerror=\'');
  });
});
