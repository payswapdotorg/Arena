/**
 * Pure HTML renderers (Work Order A017): `(view) => string` functions,
 * one per view-model, plus the document layout, the R41 degradation
 * banner (with the refresh affordance) and the overview renderer that
 * aggregates every section.
 *
 * XSS-safety BY CONSTRUCTION (the A018 discipline): every dynamic value
 * passes through the shared `escapeHtml` / `escapeHtmlAttribute` utils
 * (see escape.ts); the only raw HTML in any output comes from these
 * renderers' own literal templates. Semantic HTML throughout: headings,
 * tables, lists, definition lists, header/main/footer/nav landmarks,
 * and an ARIA-live degradation alert.
 */

import { escapeHtml, escapeHtmlAttribute } from './escape.js';
import { WORKBENCH_STYLESHEET } from './stylesheet.js';
import type { DegradationState } from './degradation.js';
import type {
  ExpertDirectoryEntryView,
  ExpertDirectoryView,
  ExpertQualificationLineView,
  JobStatusEntryView,
  JobStatusView,
  MatchOutcomeView,
  MethodNotAllowedView,
  NotFoundView,
  StatusCount,
  TaskQueueView,
  TrajectoryDetailView,
  TrajectoryEntrySummaryView,
  TrajectoryFeedEntryView,
  TrajectoryFeedView,
  WorkbenchOverviewView,
} from './views.js';

// ---------------------------------------------------------------------------
// Small shared partials
// ---------------------------------------------------------------------------

/** A status pill (class keyed by the status value, escaped). */
function badge(status: string): string {
  return `<span class="badge status-${escapeHtmlAttribute(status)}">${escapeHtml(status)}</span>`;
}

/** A `<code class="digest">` cell/inline value for a sha256 digest. */
function digestRef(digest: string): string {
  return `<code class="digest">${escapeHtml(digest)}</code>`;
}

/** An optional string rendered as a muted em-dash when absent. */
function orDash(value: string | undefined | null): string {
  return value === undefined || value === null || value.length === 0
    ? '<span class="muted">—</span>'
    : escapeHtml(value);
}

/** Render a breakdown list (`StatusCount` aggregates). */
function renderStatusCounts(breakdown: readonly StatusCount[]): string {
  if (breakdown.length === 0) return '<p class="note">No entries.</p>';
  const rows = breakdown
    .map(
      (entry) =>
        `<tr><td>${badge(entry.status)}</td><td class="num">${escapeHtml(String(entry.count))}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th scope="col">Status</th><th scope="col" class="num">Count</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// The R41 degradation banner + refresh affordance
// ---------------------------------------------------------------------------

/**
 * The graceful-degradation banner (R41): rendered ABOVE the section
 * content whenever the view is degraded. It names every machine-readable
 * reason with its detail and offers the refresh affordance — a plain
 * hyperlink to the same read-only route (a GET re-request re-renders
 * from the source; the reference server rebuilds its corpus per boot,
 * which is a documented limitation, not a silent one). The banner states
 * the no-invented-data rule explicitly so operators can trust degraded
 * pages.
 */
export function renderDegradationBanner(
  state: DegradationState,
  refreshPath: string,
): string {
  if (!state.degraded) return '';
  const reasons = state.reasons
    .map(
      (reason) =>
        `<li><code class="digest">${escapeHtml(reason.code)}</code> — ${escapeHtml(reason.detail)}</li>`,
    )
    .join('');
  return `<section class="degraded" role="alert">
  <h2>Degraded mode</h2>
  <p>This section is serving its last-known state — no data has been invented to fill gaps.</p>
  <ul class="reasons">${reasons}</ul>
  <p><a class="refresh" href="${escapeHtmlAttribute(refreshPath)}">Refresh</a> to retry the live source.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Document layout
// ---------------------------------------------------------------------------

/** One entry of the site navigation (server-routed, hash-free). */
export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** The workbench's static navigation (pure data). */
export const NAV_LINKS: readonly NavLink[] = Object.freeze([
  { href: '/', label: 'Overview' },
  { href: '/experts', label: 'Expert Directory' },
  { href: '/tasks', label: 'Task Queue' },
  { href: '/trajectories', label: 'Trajectories' },
  { href: '/jobs', label: 'Job Status' },
]);

function renderNav(currentPath: string): string {
  const links = NAV_LINKS.map((link) => {
    const current =
      link.href === '/'
        ? currentPath === '/'
        : currentPath === link.href || currentPath.startsWith(`${link.href}/`);
    return `<a href="${escapeHtmlAttribute(link.href)}"${
      current ? ' aria-current="page"' : ''
    }>${escapeHtml(link.label)}</a>`;
  }).join('');
  return `<nav class="site" aria-label="Workbench sections">${links}</nav>`;
}

/**
 * Wrap section HTML into a full HTML document with the inline stylesheet,
 * the site header/navigation (marking `currentPath`) and a site footer.
 */
export function renderDocument(
  title: string,
  currentPath: string,
  bodyHtml: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Arena Expert Workbench</title>
<style>${WORKBENCH_STYLESHEET}</style>
</head>
<body>
<header class="site">
  <div class="title">Arena Expert Workbench</div>
  <div class="subtitle">The expert operational surface — qualification and matching, the task queue, trajectories and async jobs. Read-only, derived from frozen, content-addressed domain records.</div>
  ${renderNav(currentPath)}
</header>
<main>
${bodyHtml}
</main>
<footer class="site">
  <p>Arena expert workbench — read-only surface. No mutations: every page is derived from frozen, content-addressed domain records, and degraded pages show last-known state only.</p>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Section renderers (one per view-model)
// ---------------------------------------------------------------------------

/** Render one qualification line row (per-expert drill-down). */
function renderQualificationLine(line: ExpertQualificationLineView): string {
  return `<tr>
  <td>${escapeHtml(line.capability)}</td>
  <td>${escapeHtml(line.proficiency)}</td>
  <td>${badge(line.status)}</td>
  <td>${escapeHtml(line.evaluatedAt)}</td>
  <td>${orDash(line.validFrom)}</td>
  <td>${orDash(line.validUntil)}</td>
  <td>${digestRef(line.recordDigest)}</td>
</tr>`;
}

/** Render one expert directory entry as a detail panel. */
function renderExpertEntry(entry: ExpertDirectoryEntryView): string {
  const qualificationRows =
    entry.qualifications.length === 0
      ? '<p class="note">No qualification records yet (the expert has claims pending evaluation or none declared).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Capability</th><th scope="col">Proficiency</th><th scope="col">Record status</th>
    <th scope="col">Evaluated at</th><th scope="col">Valid from</th><th scope="col">Valid until</th><th scope="col">Record digest</th>
  </tr></thead>
  <tbody>${entry.qualifications.map((line) => renderQualificationLine(line)).join('')}</tbody>
</table>`;
  return `<section class="panel">
  <h2>${escapeHtml(entry.tenant)}/${escapeHtml(entry.expertId)}@${escapeHtml(entry.version)}</h2>
  <dl class="kv">
    <dt>Lifecycle</dt><dd>${badge(entry.status)}</dd>
    <dt>Competencies</dt><dd>${escapeHtml(String(entry.competencyCount))} (${escapeHtml(entry.competencyRefs.join(', '))})</dd>
    <dt>Qualification states</dt><dd>${escapeHtml(entry.qualifications.map((line) => line.status).join(', ') || 'none')}</dd>
    <dt>Availability</dt><dd>${escapeHtml(entry.availabilitySummary)}</dd>
    <dt>Reliability (recomputed)</dt><dd>${escapeHtml(String(entry.completedTasks))} completed · ${escapeHtml(String(entry.failedTasks))} failed · ${escapeHtml(String(entry.noResponseEvents))} no-response</dd>
    <dt>Task history</dt><dd>${escapeHtml(String(entry.taskHistoryCount))} record ref(s)</dd>
    <dt>Evidence refs</dt><dd>${escapeHtml(String(entry.evidenceCount))}</dd>
    <dt>Domain scope</dt><dd>${escapeHtml(entry.domainScopeSummary)}</dd>
    <dt>Professional limitations</dt><dd>${entry.limitations.length === 0 ? '<span class="muted">—</span>' : escapeHtml(entry.limitations.join('; '))}</dd>
    <dt>Profile digest</dt><dd>${digestRef(entry.digest)}</dd>
  </dl>
  <h3>Qualification records (A007)</h3>
  ${qualificationRows}
</section>`;
}

/** Render the /experts section. */
export function renderExpertDirectory(view: ExpertDirectoryView): string {
  const rows = view.entries
    .map(
      (entry) => `<tr>
  <td>${escapeHtml(entry.tenant)}/${escapeHtml(entry.expertId)}</td>
  <td>${escapeHtml(entry.version)}</td>
  <td>${badge(entry.status)}</td>
  <td>${escapeHtml(entry.competencyRefs.join(', '))}</td>
  <td>${escapeHtml(entry.qualifications.map((line) => line.status).join(', ') || 'none')}</td>
  <td>${escapeHtml(entry.availabilitySummary)}</td>
  <td class="num">${escapeHtml(String(entry.completedTasks))}/${escapeHtml(String(entry.failedTasks))}/${escapeHtml(String(entry.noResponseEvents))}</td>
  <td>${escapeHtml(entry.domainScopeSummary)}</td>
</tr>`,
    )
    .join('');
  const table =
    view.entries.length === 0
      ? '<p class="note">The directory is empty — either no experts are registered, or the expert supply is unavailable and no last-known state exists (see the banner above; no placeholder experts are ever shown).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Expert</th><th scope="col">Version</th><th scope="col">Lifecycle</th>
    <th scope="col">Competencies</th><th scope="col">Qualification states</th>
    <th scope="col">Availability</th><th scope="col" class="num">Reliability (c/f/n)</th><th scope="col">Domain scope</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return `${renderDegradationBanner(view.degradation, '/experts')}
<h1>Expert Directory</h1>
<p class="lead">Registry profiles (A006) joined with their evidence-backed qualification states (A007) — qualification is data about evidence, never authorization. Reliability counters are recomputed from each profile's append-only ledger.</p>
${table}
<section class="panel">
  <h2>Lifecycle breakdown</h2>
  ${renderStatusCounts(view.lifecycleStatusBreakdown)}
</section>
${view.entries.map((entry) => renderExpertEntry(entry)).join('')}`;
}

/** Render one match outcome panel (matching UX, R8). */
function renderMatchOutcome(outcome: MatchOutcomeView): string {
  const rows = outcome.candidates
    .map(
      (candidate) => `<tr>
  <td>${escapeHtml(candidate.tenant)}/${escapeHtml(candidate.expertId)}</td>
  <td>${candidate.satisfiedAll ? '<span class="badge status-qualified">all satisfied</span>' : '<span class="badge status-stale">partial</span>'}</td>
  <td class="num">${escapeHtml(String(candidate.satisfiedCount))}/${escapeHtml(String(candidate.requirementCount))}</td>
  <td class="num">${escapeHtml(String(candidate.evidenceCount))}</td>
  <td>${escapeHtml(candidate.unmatchedReasons.join(', '))}</td>
</tr>`,
    )
    .join('');
  const candidates =
    outcome.candidates.length === 0
      ? '<p class="note">No qualified expert matched — every requirement is explicitly unmet (no silent best-effort matching).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Candidate</th><th scope="col">Outcome</th><th scope="col" class="num">Requirements</th>
    <th scope="col" class="num">Evidence</th><th scope="col">Unmatched reasons</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return `<section class="panel">
  <h2>Match outcome ${digestRef(outcome.digest)}</h2>
  <dl class="kv">
    <dt>Request digest</dt><dd>${digestRef(outcome.requestDigest)}</dd>
    <dt>Matching policy digest</dt><dd>${digestRef(outcome.matchingPolicyDigest)}</dd>
    <dt>Evaluated at</dt><dd>${escapeHtml(outcome.evaluatedAt)}</dd>
    <dt>Candidates</dt><dd>${escapeHtml(String(outcome.candidateCount))}</dd>
    <dt>Requirements unmet by every candidate</dt><dd>${outcome.requirementsUnmet.length === 0 ? '<span class="muted">none — every requirement has a satisfying candidate</span>' : escapeHtml(outcome.requirementsUnmet.join(', '))}</dd>
  </dl>
  ${candidates}
</section>`;
}

/** Render the /tasks section. */
export function renderTaskQueue(view: TaskQueueView): string {
  const specRows = view.specs
    .map(
      (spec) => `<tr>
  <td>${escapeHtml(spec.tenant)}/${escapeHtml(spec.taskId)}</td>
  <td>${escapeHtml(spec.version)}</td>
  <td>${escapeHtml(spec.taskClass)}</td>
  <td>${escapeHtml(spec.capabilityLabels.join(', '))}</td>
  <td>${escapeHtml(spec.difficulty)}</td>
  <td>${escapeHtml(spec.expertRequirementCapabilities.join(', '))}</td>
  <td>${digestRef(spec.digest)}</td>
</tr>`,
    )
    .join('');
  const specTable =
    view.specs.length === 0
      ? '<p class="note">The task queue is empty — no TaskSpecs compiled, or the queue is unavailable with no last-known state (see the banner above).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Task</th><th scope="col">Version</th><th scope="col">Class</th>
    <th scope="col">Capability labels</th><th scope="col">Difficulty</th>
    <th scope="col">Expert requirements</th><th scope="col">Digest</th>
  </tr></thead>
  <tbody>${specRows}</tbody>
</table>`;
  const compilationRows = view.compilations
    .map(
      (record) => `<tr>
  <td>${escapeHtml(record.compilationKey)}</td>
  <td>${escapeHtml(record.correlationId)}</td>
  <td>${escapeHtml(record.caseRef)}</td>
  <td>${escapeHtml(record.emittedSpecs.join(', '))}</td>
  <td>${escapeHtml(record.compiledAt)}</td>
  <td>${digestRef(record.digest)}</td>
</tr>`,
    )
    .join('');
  const compilationTable =
    view.compilations.length === 0
      ? '<p class="note">No compilation records yet.</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Compilation key</th><th scope="col">Correlation id</th><th scope="col">Case ref</th>
    <th scope="col">Emitted specs</th><th scope="col">Compiled at</th><th scope="col">Digest</th>
  </tr></thead>
  <tbody>${compilationRows}</tbody>
</table>`;
  return `${renderDegradationBanner(view.degradation, '/tasks')}
<h1>Task Queue</h1>
<p class="lead">Compiled TaskSpecs (A008) with their derivation provenance and idempotent compilation records — the work an expert picks up. Match outcomes (A007) show which experts the matching protocol proposes for the required competencies.</p>
${specTable}
<section class="panel">
  <h2>Compilation records (A008)</h2>
  ${compilationTable}
</section>
<section class="panel">
  <h2>Match outcomes (A007, R8)</h2>
  ${view.matchOutcomes.length === 0 ? '<p class="note">No match outcomes recorded yet.</p>' : view.matchOutcomes.map((outcome) => renderMatchOutcome(outcome)).join('')}
</section>
<section class="panel">
  <h2>Task class breakdown</h2>
  ${renderStatusCounts(view.taskClassBreakdown)}
</section>`;
}

/** Render one trajectory entry summary as a list item. */
function renderTrajectoryEntrySummary(entry: TrajectoryEntrySummaryView): string {
  const digests =
    entry.digests.length === 0
      ? ''
      : `<br><span class="muted">digests:</span> ${entry.digests.map((digest) => digestRef(digest)).join(' ')}`;
  return `<li>
  <p><strong>Step ${escapeHtml(String(entry.sequence))}</strong> · ${badge(entry.kind)} · ${escapeHtml(entry.occurredAt)}</p>
  <p>${escapeHtml(entry.summary)}</p>${digests}
</li>`;
}

/** Render one trajectory feed entry as a detail panel. */
function renderTrajectoryEntry(entry: TrajectoryFeedEntryView): string {
  return `<section class="panel">
  <h2>${escapeHtml(entry.trajectoryId)}</h2>
  <dl class="kv">
    <dt>Run</dt><dd>${escapeHtml(entry.runId)}</dd>
    <dt>Task</dt><dd>${escapeHtml(entry.taskId)}@${escapeHtml(entry.taskVersion)}</dd>
    <dt>Environment</dt><dd>${escapeHtml(entry.environment)}</dd>
    <dt>Agent body ref</dt><dd>${digestRef(entry.agentBodyRef)}</dd>
    <dt>Substrate ref</dt><dd>${digestRef(entry.substrateRef)}</dd>
    <dt>Started at</dt><dd>${escapeHtml(entry.startedAt)}</dd>
    <dt>Seed</dt><dd>${entry.seed === null ? '<span class="muted">none</span>' : escapeHtml(entry.seed)}</dd>
    <dt>Entries</dt><dd>${escapeHtml(String(entry.entryCount))} (${entry.completed ? 'completed' : 'in progress'})</dd>
    <dt>Chain head</dt><dd>${digestRef(entry.chainHead)}</dd>
    <dt>Header digest</dt><dd>${digestRef(entry.digest)}</dd>
  </dl>
  <h3>Entries (append-only, read-only)</h3>
  <ol class="steps">${entry.entries.map((step) => renderTrajectoryEntrySummary(step)).join('')}
  </ol>
</section>`;
}

/** Render the /trajectories section (read-only feed, R10). */
export function renderTrajectoryFeed(view: TrajectoryFeedView): string {
  const rows = view.entries
    .map(
      (entry) => `<tr>
  <td><a href="/trajectories/${escapeHtmlAttribute(entry.trajectoryId)}">${escapeHtml(entry.trajectoryId)}</a></td>
  <td>${escapeHtml(entry.runId)}</td>
  <td>${escapeHtml(entry.taskId)}@${escapeHtml(entry.taskVersion)}</td>
  <td>${escapeHtml(entry.environment)}</td>
  <td>${escapeHtml(entry.startedAt)}</td>
  <td class="num">${escapeHtml(String(entry.entryCount))}</td>
  <td>${entry.completed ? '<span class="badge status-completed">completed</span>' : '<span class="badge status-running">open</span>'}</td>
  <td>${digestRef(entry.chainHead)}</td>
</tr>`,
    )
    .join('');
  const table =
    view.entries.length === 0
      ? '<p class="note">No trajectories recorded — or the trajectory store is unavailable with no last-known state (see the banner above).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Trajectory</th><th scope="col">Run</th><th scope="col">Task</th>
    <th scope="col">Environment</th><th scope="col">Started</th>
    <th scope="col" class="num">Entries</th><th scope="col">State</th><th scope="col">Chain head</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return `${renderDegradationBanner(view.degradation, '/trajectories')}
<h1>Trajectories</h1>
<p class="lead">Append-only, digest-chained trajectory records (A011) — read-only visibility into expert and agent work (R10). Every entry is replayed exactly as it was appended; nothing is filtered or reordered.</p>
${table}
${view.entries.map((entry) => renderTrajectoryEntry(entry)).join('')}`;
}

/** Render the /trajectories/:trajectoryId detail page. */
export function renderTrajectoryDetail(view: TrajectoryDetailView): string {
  return `${renderDegradationBanner(view.degradation, `/trajectories/${view.entry.trajectoryId}`)}
<h1>Trajectory — ${escapeHtml(view.entry.trajectoryId)}</h1>
<p class="lead">One trajectory record, drilled down from the feed: the run address, the digest-chained entry history and its content-addressed evidence (read-only, R10).</p>
${renderTrajectoryEntry(view.entry)}`;
}

/** Render one job-status entry as a detail panel. */
function renderJobEntry(job: JobStatusEntryView): string {
  return `<section class="panel">
  <h2>${escapeHtml(job.jobId)}</h2>
  <dl class="kv">
    <dt>Kind</dt><dd>${escapeHtml(job.jobKind)}</dd>
    <dt>Status</dt><dd>${badge(job.status)}</dd>
    <dt>Attempts</dt><dd>${escapeHtml(String(job.attempts))} of ${escapeHtml(String(job.maxAttempts))}</dd>
    <dt>Correlation id</dt><dd>${escapeHtml(job.correlationId)}</dd>
    <dt>Idempotency scope</dt><dd>${escapeHtml(job.idempotencyScope)}</dd>
    <dt>Idempotency key</dt><dd>${escapeHtml(job.idempotencyKey)}</dd>
    <dt>Submitted at</dt><dd>${escapeHtml(job.submittedAt)}</dd>
    <dt>Updated at</dt><dd>${escapeHtml(job.updatedAt)}</dd>
    <dt>Event trail</dt><dd>${escapeHtml(job.eventKinds.join(' → '))} (${escapeHtml(String(job.eventCount))} event(s), last: ${escapeHtml(job.lastEventKind)})</dd>
    <dt>Progress</dt><dd>${
      job.progressPercent === undefined
        ? '<span class="muted">—</span>'
        : `${escapeHtml(String(job.progressPercent))}%${job.progressNote !== undefined ? ` — ${escapeHtml(job.progressNote)}` : ''}`
    }</dd>
    <dt>Failure</dt><dd>${
      job.failureKind === undefined
        ? '<span class="muted">—</span>'
        : `${escapeHtml(job.failureKind)}: ${escapeHtml(job.failureClass ?? '')} — ${escapeHtml(job.failureMessage ?? '')}`
    }</dd>
  </dl>
</section>`;
}

/** Render the /jobs section (R26). */
export function renderJobStatus(view: JobStatusView): string {
  const rows = view.jobs
    .map(
      (job) => `<tr>
  <td>${escapeHtml(job.jobId)}</td>
  <td>${escapeHtml(job.jobKind)}</td>
  <td>${badge(job.status)}</td>
  <td class="num">${escapeHtml(String(job.attempts))}/${escapeHtml(String(job.maxAttempts))}</td>
  <td>${escapeHtml(job.correlationId)}</td>
  <td>${escapeHtml(job.eventKinds.join(' → '))}</td>
</tr>`,
    )
    .join('');
  const table =
    view.jobs.length === 0
      ? '<p class="note">No durable jobs recorded — or the job store is unavailable with no last-known state (see the banner above).</p>'
      : `<table>
  <thead><tr>
    <th scope="col">Job id</th><th scope="col">Kind</th><th scope="col">Status</th>
    <th scope="col" class="num">Attempts</th><th scope="col">Correlation</th><th scope="col">Event trail</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return `${renderDegradationBanner(view.degradation, '/jobs')}
<h1>Job Status</h1>
<p class="lead">Durable, idempotent, correlation-addressable jobs (A015) with their append-only event trails — async long-running work made visible (R26).</p>
${table}
<section class="panel">
  <h2>Status breakdown</h2>
  ${renderStatusCounts(view.statusBreakdown)}
</section>
${view.jobs.map((job) => renderJobEntry(job)).join('')}`;
}

// ---------------------------------------------------------------------------
// Overview (aggregates all sections + degradation rollup)
// ---------------------------------------------------------------------------

/** Render the workbench index/overview. */
export function renderWorkbenchOverview(view: WorkbenchOverviewView): string {
  const degraded =
    view.degradation.degraded
      ? `<section class="degraded" role="alert">
  <h2>Degraded mode</h2>
  <p>Some workbench sections are serving last-known state (R41): ${escapeHtml(view.degradedSections.join(', '))}.</p>
  <ul class="reasons">${view.degradation.reasons
    .map(
      (reason) =>
        `<li><code class="digest">${escapeHtml(reason.code)}</code> — ${escapeHtml(reason.detail)}</li>`,
    )
    .join('')}</ul>
</section>`
      : '';
  return `${degraded}
<h1>Workbench Overview</h1>
<p class="lead">The expert operational surface in one place: qualified experts and match outcomes (R7/R8), the compiled task queue, trajectory visibility (R10) and async job status (R26) — every count derived from frozen, content-addressed domain records.</p>
<div class="cards">
  <div class="card"><div class="stat">${escapeHtml(String(view.expertCount))}</div><div class="label">Registered experts (<a href="/experts">directory</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.qualifiedClaimCount))}</div><div class="label">Qualified claims (A007 records)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.matchOutcomeCount))}</div><div class="label">Match outcomes (<a href="/tasks">queue</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.specCount))}</div><div class="label">Compiled TaskSpecs (A008)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.compilationCount))}</div><div class="label">Compilation records</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.trajectoryCount))}</div><div class="label">Trajectories (<a href="/trajectories">feed</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.trajectoryEntryCount))}</div><div class="label">Trajectory entries (${escapeHtml(String(view.completedTrajectoryCount))} completed)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.jobCount))}</div><div class="label">Durable jobs (<a href="/jobs">status</a>)</div></div>
</div>`;
}

// ---------------------------------------------------------------------------
// Error views (negative routes)
// ---------------------------------------------------------------------------

/** Render the 404 view. */
export function renderNotFound(view: NotFoundView): string {
  return `<h1>Not found</h1>
<p class="lead">No workbench route matches <code class="digest">${escapeHtml(view.path)}</code>.</p>
<p>The workbench is read-only and serves a fixed set of sections — see the navigation above.</p>`;
}

/** Render the 405 view (read-only guarantee). */
export function renderMethodNotAllowed(view: MethodNotAllowedView): string {
  return `<h1>Method not allowed</h1>
<p class="lead"><code class="digest">${escapeHtml(view.method)}</code> is not allowed on <code class="digest">${escapeHtml(view.path)}</code>.</p>
<p>The workbench is strictly read-only. Allowed methods: ${escapeHtml(view.allowedMethods.join(', '))}. No POST, PUT, DELETE or PATCH route exists — domain state can never be mutated through this surface.</p>`;
}
