/**
 * HTML renderers — positive and negative tests (Work Order A017,
 * requirement 5): golden-string assertions for every renderer,
 * semantic-HTML markers, the R41 degradation banner (with the refresh
 * affordance), and the XSS negatives (hostile view fields render
 * escaped — the A018 discipline; hostile route paths render escaped
 * through the 404 view).
 *
 * Golden strategy (the control-ui convention): goldens pin the RENDERER
 * STRUCTURE (literal templates; the content-addressed digests of the
 * fixture domain objects are interpolated from the same runtime values
 * the renderer read). The app-side workbench suite pins the FULL
 * byte-golden of the seeded corpus pages, where the digests are
 * hard-coded constants — a change in domain output shows up as a test
 * diff there.
 */

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.js';
import {
  NAV_LINKS,
  renderDegradationBanner,
  renderDocument,
  renderExpertDirectory,
  renderJobStatus,
  renderMethodNotAllowed,
  renderNotFound,
  renderTaskQueue,
  renderTrajectoryDetail,
  renderTrajectoryFeed,
  renderWorkbenchOverview,
} from './render.js';
import { WORKBENCH_STYLESHEET } from './stylesheet.js';
import {
  toExpertDirectoryView,
  toJobStatusView,
  toTaskQueueView,
  toTrajectoryFeedView,
  toWorkbenchOverviewView,
} from './views.js';
import type { ExpertDirectoryEntryView } from './views.js';
import { degradationMode } from './degradation.js';
import {
  makeDegradedCorpus,
  makeEmptyDegradedCorpus,
  makeFixtureCorpus,
  FIXTURE_TRAJECTORY_ID,
} from './test-support.js';
import { routePath } from './router.js';

describe('renderDocument (positive)', () => {
  it('produces a complete semantic document with the inline stylesheet', () => {
    const html = renderDocument('Overview', '/', '<main-marker>');
    expect(html.startsWith('<!DOCTYPE html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Overview — Arena Expert Workbench</title>');
    // The stylesheet is served INLINE (no external assets, no CDN).
    expect(html).toContain(`<style>${WORKBENCH_STYLESHEET}</style>`);
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
    // No scripts anywhere: the workbench is server-rendered only.
    expect(html).not.toMatch(/<script/i);
  });

  it('marks the current section with aria-current (positive)', () => {
    expect(renderDocument('Jobs', '/jobs', 'x')).toContain(
      'href="/jobs" aria-current="page"',
    );
    expect(renderDocument('Jobs', '/jobs', 'x')).not.toContain(
      'href="/experts" aria-current="page"',
    );
    expect(renderDocument('Overview', '/', 'x')).toContain(
      'href="/" aria-current="page"',
    );
  });

  it('escapes a hostile page title (negative)', () => {
    const html = renderDocument('<script>alert(1)</script>', '/', 'x');
    expect(html).toContain(
      '<title>&lt;script&gt;alert(1)&lt;/script&gt; — Arena Expert Workbench</title>',
    );
    expect(html).not.toContain('<title><script>');
  });
});

describe('renderDegradationBanner — R41 (positive)', () => {
  it('renders nothing when healthy', () => {
    expect(renderDegradationBanner({ degraded: false, reasons: [] }, '/experts')).toBe('');
  });

  it('renders the banner with reasons and the refresh affordance when degraded', async () => {
    const corpus = await makeDegradedCorpus();
    const view = toExpertDirectoryView(corpus);
    const banner = renderDegradationBanner(view.degradation, '/experts');
    expect(banner).toContain('<section class="degraded" role="alert">');
    expect(banner).toContain('<h2>Degraded mode</h2>');
    expect(banner).toContain('no data has been invented');
    expect(banner).toContain('<code class="digest">expert-supply-unavailable</code>');
    expect(banner).toContain('<code class="digest">last-known-state</code>');
    // The refresh affordance is a plain hyperlink to the same route.
    expect(banner).toContain('<a class="refresh" href="/experts">Refresh</a>');
  });

  it('escapes hostile reason details (negative)', () => {
    const hostile = degradationMode([
      { code: 'expert-supply-unavailable', detail: '<img src=x onerror=alert(1)>' },
    ]);
    const banner = renderDegradationBanner(hostile, '/experts');
    expect(banner).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(banner).not.toContain('<img');
  });
});

describe('renderExpertDirectory (positive)', () => {
  it('renders the directory table with qualification states and digests', async () => {
    const corpus = await makeFixtureCorpus();
    const html = renderExpertDirectory(toExpertDirectoryView(corpus));
    expect(html).toContain('<h1>Expert Directory</h1>');
    expect(html).toContain('<td>tenant-wb/expert-fixture-ada</td>');
    expect(html).toContain('class="badge status-published"');
    expect(html).toContain('class="badge status-suspended"');
    expect(html).toContain('class="badge status-qualified"');
    expect(html).toContain('class="badge status-stale"');
    // Per-expert drill-down panels with the domain digests (the record
    // digest renders in the qualification table cell).
    expect(html).toContain(`<dd><code class="digest">${corpus.profiles[0]?.digest}</code></dd>`);
    expect(html).toContain(
      `<td><code class="digest">${corpus.qualificationRecords[0]?.digest}</code></td>`,
    );
    expect(html).toContain('Reliability (recomputed)');
    expect(html).toContain('2 completed · 1 failed · 0 no-response');
    // NO degradation banner on the healthy corpus.
    expect(html).not.toContain('section class="degraded"');
  });

  it('renders the degradation banner + last-known state when the supply is down (R41)', async () => {
    const corpus = await makeDegradedCorpus();
    const html = renderExpertDirectory(toExpertDirectoryView(corpus));
    expect(html).toContain('<section class="degraded" role="alert">');
    expect(html).toContain('expert-supply-unavailable');
    // The last-known entries are still rendered (not hidden, not zeroed).
    expect(html).toContain('<td>tenant-wb/expert-fixture-ada</td>');
    expect(html).toContain('Refresh');
  });

  it('renders the honest empty directory when nothing is known (R41, no invented data)', async () => {
    const corpus = await makeEmptyDegradedCorpus();
    const html = renderExpertDirectory(toExpertDirectoryView(corpus));
    expect(html).toContain('<section class="degraded" role="alert">');
    expect(html).toContain('The directory is empty');
    expect(html).toContain('no placeholder experts are ever shown');
    // NO expert rows and NO fabricated names.
    expect(html).not.toContain('<td>tenant-wb/');
  });
});

describe('renderTaskQueue (positive)', () => {
  it('renders specs, compilations and match outcomes (R8)', async () => {
    const corpus = await makeFixtureCorpus();
    const html = renderTaskQueue(toTaskQueueView(corpus));
    expect(html).toContain('<h1>Task Queue</h1>');
    expect(html).toContain('<td>tenant-wb/task-fixture-review</td>');
    expect(html).toContain('class="badge status-correction"');
    expect(html).toContain('compile-fixture-0001');
    expect(html).toContain('Match outcomes (A007, R8)');
    // The matched candidate + the honest unmet outcome both render.
    expect(html).toContain('tenant-wb/expert-fixture-ada');
    expect(html).toContain('No qualified expert matched');
    expect(html).toContain('<dt>Requirements unmet by every candidate</dt><dd>load-analysis</dd>');
    expect(html).toContain(
      `<td><code class="digest">${corpus.specs[0]?.digest}</code></td>`,
    );
  });
});

describe('renderTrajectoryFeed + detail (positive, R10)', () => {
  it('renders the feed with links to the detail route', async () => {
    const corpus = await makeFixtureCorpus();
    const html = renderTrajectoryFeed(toTrajectoryFeedView(corpus));
    expect(html).toContain('<h1>Trajectories</h1>');
    expect(html).toContain(`href="/trajectories/${FIXTURE_TRAJECTORY_ID}"`);
    expect(html).toContain('read 48 fixture invoices and 3 credit notes');
    expect(html).toContain('class="badge status-completed"');
    // Read-only claim is explicit.
    expect(html).toContain('read-only');
  });

  it('renders the detail view with the full entry chain', async () => {
    const corpus = await makeFixtureCorpus();
    const detail = routePath(`/trajectories/${FIXTURE_TRAJECTORY_ID}`, corpus);
    expect(detail.kind).toBe('trajectory-detail');
    if (detail.kind !== 'trajectory-detail') return;
    const html = renderTrajectoryDetail(detail);
    expect(html).toContain(`<h1>Trajectory — ${FIXTURE_TRAJECTORY_ID}</h1>`);
    // Payload summaries are escaped for HTML text context (quotes
    // become entities), so compare against the escaped form.
    expect(html).toContain(
      escapeHtml('action read-invoices — input {"invoice":"INV-2291"}'),
    );
    expect(html).toContain('Step 4');
    expect(html).toContain(
      escapeHtml('completion — outcome completed (1 evidence digest(s))'),
    );
  });
});

describe('renderJobStatus (positive, R26)', () => {
  it('renders jobs with the addressability pair and event trails', async () => {
    const corpus = await makeFixtureCorpus();
    const html = renderJobStatus(toJobStatusView(corpus));
    expect(html).toContain('<h1>Job Status</h1>');
    expect(html).toContain('<td>job-fixture-match-0001</td>');
    expect(html).toContain('tenant-wb/match-experts@1.0.0');
    expect(html).toContain('job-submitted');
    expect(html).toContain('<dt>Correlation id</dt><dd>corr-fixture-0001</dd>');
    expect(html).toContain('<dt>Idempotency key</dt><dd>idem-fixture-0001</dd>');
  });
});

describe('renderWorkbenchOverview (positive)', () => {
  it('renders the aggregate cards and stays quiet when healthy', async () => {
    const corpus = await makeFixtureCorpus();
    const html = renderWorkbenchOverview(toWorkbenchOverviewView(corpus));
    expect(html).toContain('<h1>Workbench Overview</h1>');
    expect(html).toContain('Registered experts');
    expect(html).toContain('Qualified claims (A007 records)');
    expect(html).not.toContain('section class="degraded"');
  });

  it('renders the degradation rollup when a section is degraded', async () => {
    const corpus = await makeDegradedCorpus();
    const html = renderWorkbenchOverview(toWorkbenchOverviewView(corpus));
    expect(html).toContain('<section class="degraded" role="alert">');
    expect(html).toContain('experts');
    expect(html).toContain('expert-supply-unavailable');
  });
});

describe('XSS negatives — hostile view fields render escaped (negative)', () => {
  // View-models are CONSTRUCTED, not parsed: a hostile actor feeding the
  // renderer must go through a view object, so the negatives construct
  // hostile views directly (the A018 convention — domain constructors
  // themselves reject hostile text, so hostile data can only enter a
  // hand-built view).
  const HOSTILE = '<script>alert("workbench")</script>';
  const HOSTILE_ATTR = '" onmouseover="alert(1)';

  it('escapes every interpolant of an expert directory entry (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = toExpertDirectoryView(corpus);
    const hostileEntry: ExpertDirectoryEntryView = {
      ...view.entries[0]!,
      tenant: HOSTILE,
      expertId: HOSTILE,
      availabilitySummary: HOSTILE,
      domainScopeSummary: HOSTILE,
      qualifications: view.entries[0]?.qualifications.map((line) => ({
        ...line,
        capability: HOSTILE,
      })) ?? [],
      limitations: [HOSTILE],
    };
    const html = renderExpertDirectory({
      ...view,
      entries: [hostileEntry],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert("workbench")<');
    expect(html).toContain(escapeHtml(HOSTILE));
    // The digest cell still renders the honest value.
    expect(html).toContain(`<dd><code class="digest">${view.entries[0]?.digest}</code></dd>`);
  });

  it('escapes a hostile degradation detail in the banner (negative)', async () => {
    const corpus = await makeDegradedCorpus();
    const view = toExpertDirectoryView(corpus);
    const hostile = degradationMode([
      { code: 'expert-supply-unavailable', detail: `${HOSTILE}${HOSTILE_ATTR}` },
    ]);
    const html = renderExpertDirectory({ ...view, degradation: hostile });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onmouseover="alert(1)');
    expect(html).toContain(escapeHtml(HOSTILE));
  });

  it('escapes hostile trajectory summaries and job fields (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const feed = toTrajectoryFeedView(corpus);
    const hostileFeed = {
      ...feed,
      entries: feed.entries.map((entry) => ({
        ...entry,
        trajectoryId: HOSTILE,
        entries: entry.entries.map((step) => ({ ...step, summary: HOSTILE })),
      })),
    };
    const feedHtml = renderTrajectoryFeed(hostileFeed);
    expect(feedHtml).not.toContain('<script>');
    expect(feedHtml).toContain(escapeHtml(HOSTILE));

    const jobs = toJobStatusView(corpus);
    const hostileJobs = {
      ...jobs,
      jobs: jobs.jobs.map((job) => ({ ...job, jobId: HOSTILE, correlationId: HOSTILE })),
    };
    const jobsHtml = renderJobStatus(hostileJobs);
    expect(jobsHtml).not.toContain('<script>');
    expect(jobsHtml).toContain(escapeHtml(HOSTILE));
  });

  it('serves a hostile route path escaped through the 404 view (negative)', async () => {
    const corpus = await makeFixtureCorpus();
    const view = routePath(`/trajectories/${HOSTILE}`, corpus);
    expect(view.kind).toBe('not-found');
    const html = renderNotFound(
      view.kind === 'not-found' ? view : { kind: 'not-found', path: '/' },
    );
    expect(html).toContain(escapeHtml(`/trajectories/${HOSTILE}`));
    expect(html).not.toContain(`<code class="digest">/trajectories/${HOSTILE}</code>`);
  });
});

describe('error views (negative routes)', () => {
  it('renders the 404 view with the path escaped', () => {
    const html = renderNotFound({ kind: 'not-found', path: '/no-such-page' });
    expect(html).toContain('<h1>Not found</h1>');
    expect(html).toContain('<code class="digest">/no-such-page</code>');
  });

  it('renders the 405 view naming the read-only policy', () => {
    const html = renderMethodNotAllowed({
      kind: 'method-not-allowed',
      method: 'POST',
      path: '/experts',
      allowedMethods: ['GET', 'HEAD'],
    });
    expect(html).toContain('<h1>Method not allowed</h1>');
    expect(html).toContain('No POST, PUT, DELETE or PATCH route exists');
    expect(html).toContain('GET, HEAD');
  });
});
