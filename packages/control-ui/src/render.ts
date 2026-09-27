/**
 * Pure HTML renderers (Work Order A018, gate 3): `(view) => string`
 * functions, one per view-model, plus the document layout and the
 * index/dashboard renderer that aggregates every section.
 *
 * XSS-safety BY CONSTRUCTION: every dynamic value passes through the
 * shared `escapeHtml` / `escapeHtmlAttribute` utils (see escape.ts); the
 * only raw HTML in any output comes from these renderers' own literal
 * templates. Semantic HTML throughout: headings, tables, lists,
 * definition lists, header/main/footer/nav landmarks.
 */

import { escapeHtml, escapeHtmlAttribute } from './escape.js';
import { CONSOLE_STYLESHEET } from './stylesheet.js';
import type {
  BodyListView,
  BodyView,
  CaseListView,
  CaseSummaryView,
  DashboardView,
  EnvironmentRunView,
  JobListView,
  JobView,
  MethodNotAllowedView,
  NotFoundView,
  RunListView,
  StatusCount,
  SubstrateListView,
  SubstrateView,
  TrajectoryStep,
  TrajectoryView,
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
function orDash(value: string | undefined): string {
  return value === undefined || value.length === 0
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
// Document layout
// ---------------------------------------------------------------------------

/** One entry of the site navigation (server-routed, hash-free — gate 4). */
export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** The console's static navigation (pure data). */
export const NAV_LINKS: readonly NavLink[] = Object.freeze([
  { href: '/', label: 'Dashboard' },
  { href: '/cases', label: 'Capability Cases' },
  { href: '/bodies', label: 'Agent Bodies' },
  { href: '/substrates', label: 'Substrates' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/runs', label: 'Environment Runs' },
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
  return `<nav class="site" aria-label="Console sections">${links}</nav>`;
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
<title>${escapeHtml(title)} — Arena Control Console</title>
<style>${CONSOLE_STYLESHEET}</style>
</head>
<body>
<header class="site">
  <div class="title">Arena Control Console</div>
  <div class="subtitle">Read-only inspection over the Arena reference state — capability cases, agent bodies, substrates, jobs and environment runs.</div>
  ${renderNav(currentPath)}
</header>
<main>
${bodyHtml}
</main>
<footer class="site">
  <p>Arena control plane — read-only console. No mutations: every page is derived from frozen, content-addressed domain records.</p>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Section renderers (one per view-model — gate 3)
// ---------------------------------------------------------------------------

/** Render the /cases section. */
export function renderCaseList(view: CaseListView): string {
  const rows = view.cases
    .map(
      (entry) => `<tr>
  <td>${escapeHtml(entry.tenant)}/${escapeHtml(entry.caseId)}</td>
  <td>${escapeHtml(entry.version)}</td>
  <td>${badge(entry.status)}</td>
  <td>${escapeHtml(entry.priority)}</td>
  <td>${escapeHtml(entry.risk)}</td>
  <td>${escapeHtml(entry.problemStatement)}</td>
  <td class="num">${escapeHtml(String(entry.evidenceCount))}</td>
  <td>${digestRef(entry.digest)}</td>
</tr>`,
    )
    .join('');
  return `<h1>Capability Cases</h1>
<p class="lead">Versioned roots-of-record composing the Problem tuple (target capability, body, substrate, environment, tasks, evaluation, verification).</p>
<table>
  <thead><tr>
    <th scope="col">Case</th><th scope="col">Version</th><th scope="col">Status</th>
    <th scope="col">Priority</th><th scope="col">Risk</th><th scope="col">Problem</th>
    <th scope="col" class="num">Evidence</th><th scope="col">Digest</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Render one case summary as a detail card (dashboard drill-down). */
export function renderCaseSummary(view: CaseSummaryView): string {
  return `<section class="panel">
  <h2>${escapeHtml(view.tenant)}/${escapeHtml(view.caseId)}@${escapeHtml(view.version)}</h2>
  <dl class="kv">
    <dt>Status</dt><dd>${badge(view.status)}</dd>
    <dt>Priority</dt><dd>${escapeHtml(view.priority)}</dd>
    <dt>Risk</dt><dd>${escapeHtml(view.risk)}</dd>
    <dt>Problem</dt><dd>${escapeHtml(view.problemStatement)}</dd>
    <dt>Target capability</dt><dd>${escapeHtml(view.targetCapability)}</dd>
    <dt>Domain</dt><dd>${escapeHtml(view.domain)}</dd>
    <dt>Raised by</dt><dd>${escapeHtml(view.raisedBy)}</dd>
    <dt>Created at</dt><dd>${escapeHtml(view.createdAt)}</dd>
    <dt>Evidence refs</dt><dd>${escapeHtml(String(view.evidenceCount))}</dd>
    <dt>Known unknowns</dt><dd>${escapeHtml(String(view.unknownsCount))}</dd>
    <dt>Lifecycle events</dt><dd>${escapeHtml(String(view.lifecycleEventCount))}</dd>
    <dt>Current body</dt><dd>${orDash(view.currentBodyRef)}</dd>
    <dt>Current substrate</dt><dd>${orDash(view.currentSubstrateRef)}</dd>
    <dt>Digest</dt><dd>${digestRef(view.digest)}</dd>
  </dl>
</section>`;
}

/** Render the /bodies section. */
export function renderBodyList(view: BodyListView): string {
  const rows = view.bodies
    .map(
      (body) => `<tr>
  <td>${escapeHtml(body.tenant)}/${escapeHtml(body.name)}</td>
  <td>${escapeHtml(body.version)}</td>
  <td>${escapeHtml(body.role)}</td>
  <td>${escapeHtml(body.capabilities.join(', '))}</td>
  <td class="num">${escapeHtml(String(body.skillsCount))}</td>
  <td class="num">${escapeHtml(String(body.toolsCount))}</td>
  <td>${escapeHtml(body.requiredToolCalling)}</td>
  <td>${digestRef(body.digest)}</td>
</tr>`,
    )
    .join('');
  return `<h1>Agent Bodies</h1>
<p class="lead">Immutable, content-addressed BodyVersions — the durable professional identity an Agent Capability is composed around.</p>
<table>
  <thead><tr>
    <th scope="col">Body</th><th scope="col">Version</th><th scope="col">Role</th>
    <th scope="col">Capabilities</th><th scope="col" class="num">Skills</th>
    <th scope="col" class="num">Tools</th><th scope="col">Tool calling</th><th scope="col">Digest</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Render one body detail card. */
export function renderBody(view: BodyView): string {
  return `<section class="panel">
  <h2>${escapeHtml(view.tenant)}/${escapeHtml(view.name)}@${escapeHtml(view.version)}</h2>
  <dl class="kv">
    <dt>Mission</dt><dd>${escapeHtml(view.mission)}</dd>
    <dt>Role</dt><dd>${escapeHtml(view.role)}</dd>
    <dt>Domain scope</dt><dd>${escapeHtml(view.domainScope.join(', '))}</dd>
    <dt>Capabilities</dt><dd>${escapeHtml(view.capabilities.join(', '))}</dd>
    <dt>Skills</dt><dd>${escapeHtml(String(view.skillsCount))}</dd>
    <dt>Knowledge</dt><dd>${escapeHtml(String(view.knowledgeCount))}</dd>
    <dt>Tools</dt><dd>${escapeHtml(String(view.toolsCount))}</dd>
    <dt>Procedures</dt><dd>${escapeHtml(String(view.proceduresCount))}</dd>
    <dt>Authority boundaries</dt><dd>${escapeHtml(view.authorityBoundaries.join('; '))}</dd>
    <dt>Escalation rules</dt><dd>${escapeHtml(String(view.escalationRuleCount))}</dd>
    <dt>Evaluation suites</dt><dd>${escapeHtml(String(view.evaluationSuiteCount))}</dd>
    <dt>Verification suites</dt><dd>${escapeHtml(String(view.verificationSuiteCount))}</dd>
    <dt>Environment requirements</dt><dd>${escapeHtml(String(view.environmentRequirementCount))}</dd>
    <dt>Substrate compatibility</dt><dd>${escapeHtml(view.requiredToolCalling)} · ≥ ${escapeHtml(String(view.minContextUnits))} context units</dd>
    <dt>Parents</dt><dd>${escapeHtml(String(view.parentsCount))}</dd>
    <dt>Forged by</dt><dd>${escapeHtml(view.forgedBy)}</dd>
    <dt>Created at</dt><dd>${escapeHtml(view.createdAt)}</dd>
    <dt>Digest</dt><dd>${digestRef(view.digest)}</dd>
  </dl>
</section>`;
}

/** Render the /substrates section. */
export function renderSubstrateList(view: SubstrateListView): string {
  const rows = view.substrates
    .map(
      (substrate) => `<tr>
  <td>${escapeHtml(substrate.substrateId)}</td>
  <td>${escapeHtml(substrate.modelFamily)}/${escapeHtml(substrate.modelId)}@${escapeHtml(substrate.modelRevision)}</td>
  <td>${escapeHtml(substrate.adapterId)}@${escapeHtml(substrate.adapterVersion)}</td>
  <td>${escapeHtml(substrate.modalityProfile.join(', '))}</td>
  <td>${escapeHtml(substrate.toolCallingProfile)}</td>
  <td class="num">${escapeHtml(String(substrate.maxContextUnits))}</td>
  <td>${escapeHtml(substrate.conditions.join(', '))}</td>
  <td>${digestRef(substrate.contentDigest)}</td>
</tr>`,
    )
    .join('');
  return `<h1>Cognitive Substrates</h1>
<p class="lead">Provider-neutral substrate registrations — a substrate is a cognitive substrate reference, never the identity of an agent body.</p>
<table>
  <thead><tr>
    <th scope="col">Registry id</th><th scope="col">Model</th><th scope="col">Adapter</th>
    <th scope="col">Modalities</th><th scope="col">Tool calling</th>
    <th scope="col" class="num">Max context</th><th scope="col">Conditions</th><th scope="col">Digest</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Render one substrate detail card. */
export function renderSubstrate(view: SubstrateView): string {
  return `<section class="panel">
  <h2>${escapeHtml(view.substrateId)}</h2>
  <dl class="kv">
    <dt>Adapter</dt><dd>${escapeHtml(view.adapterId)}@${escapeHtml(view.adapterVersion)}</dd>
    <dt>Adapter digest</dt><dd>${digestRef(view.adapterDigest)}</dd>
    <dt>Model family</dt><dd>${escapeHtml(view.modelFamily)}</dd>
    <dt>Model id</dt><dd>${escapeHtml(view.modelId)}</dd>
    <dt>Model revision</dt><dd>${escapeHtml(view.modelRevision)}</dd>
    <dt>Modalities</dt><dd>${escapeHtml(view.modalityProfile.join(', '))}</dd>
    <dt>Tool calling</dt><dd>${escapeHtml(view.toolCallingProfile)}</dd>
    <dt>Context limits</dt><dd>${escapeHtml(String(view.maxContextUnits))} in / ${escapeHtml(String(view.maxOutputUnits))} out</dd>
    <dt>Conditions</dt><dd>${escapeHtml(view.conditions.join(', '))}</dd>
    <dt>Registered at</dt><dd>${escapeHtml(view.registeredAt)}</dd>
    <dt>Content digest</dt><dd>${digestRef(view.contentDigest)}</dd>
    <dt>Registration digest</dt><dd>${digestRef(view.registrationDigest)}</dd>
  </dl>
</section>`;
}

/** Render the /jobs section. */
export function renderJobList(view: JobListView): string {
  const rows = view.jobs
    .map(
      (job) => `<tr>
  <td>${escapeHtml(job.jobId)}</td>
  <td>${escapeHtml(job.jobKind)}</td>
  <td>${badge(job.status)}</td>
  <td class="num">${escapeHtml(String(job.attempts))}/${escapeHtml(String(job.maxAttempts))}</td>
  <td>${escapeHtml(job.submittedAt)}</td>
  <td>${escapeHtml(job.lastEventKind)}</td>
  <td>${digestRef(job.definitionDigest)}</td>
</tr>`,
    )
    .join('');
  return `<h1>Durable Jobs</h1>
<p class="lead">Append-only job records driven through the job-orchestrator reference flow — idempotent submissions, correlation-addressable, audit-chained.</p>
<table>
  <thead><tr>
    <th scope="col">Job id</th><th scope="col">Kind</th><th scope="col">Status</th>
    <th scope="col" class="num">Attempts</th><th scope="col">Submitted</th>
    <th scope="col">Last event</th><th scope="col">Definition digest</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Render one job detail card. */
export function renderJob(view: JobView): string {
  return `<section class="panel">
  <h2>${escapeHtml(view.jobId)}</h2>
  <dl class="kv">
    <dt>Kind</dt><dd>${escapeHtml(view.jobKind)}</dd>
    <dt>Status</dt><dd>${badge(view.status)}</dd>
    <dt>Definition digest</dt><dd>${digestRef(view.definitionDigest)}</dd>
    <dt>Correlation id</dt><dd>${escapeHtml(view.correlationId)}</dd>
    <dt>Idempotency scope</dt><dd>${escapeHtml(view.idempotencyScope)}</dd>
    <dt>Idempotency key</dt><dd>${escapeHtml(view.idempotencyKey)}</dd>
    <dt>Attempts</dt><dd>${escapeHtml(String(view.attempts))} of ${escapeHtml(String(view.maxAttempts))}</dd>
    <dt>Timeout policy</dt><dd>${escapeHtml(String(view.timeoutMs))} ms</dd>
    <dt>Submitted at</dt><dd>${escapeHtml(view.submittedAt)}</dd>
    <dt>Updated at</dt><dd>${escapeHtml(view.updatedAt)}</dd>
    <dt>Event count</dt><dd>${escapeHtml(String(view.eventCount))} (last: ${escapeHtml(view.lastEventKind)})</dd>
    <dt>Progress</dt><dd>${
      view.progressPercent === undefined
        ? '<span class="muted">—</span>'
        : `${escapeHtml(String(view.progressPercent))}%${view.progressNote !== undefined ? ` — ${escapeHtml(view.progressNote)}` : ''}`
    }</dd>
    <dt>Failure</dt><dd>${
      view.failureKind === undefined
        ? '<span class="muted">—</span>'
        : `${escapeHtml(view.failureKind)}: ${escapeHtml(view.failureClass ?? '')} — ${escapeHtml(view.failureMessage ?? '')}`
    }</dd>
  </dl>
</section>`;
}

/** Render the /runs section. */
export function renderRunList(view: RunListView): string {
  const rows = view.runs
    .map(
      (run) => `<tr>
  <td><a href="/runs/${escapeHtmlAttribute(run.runId)}/trajectory">${escapeHtml(run.runId)}</a></td>
  <td>${escapeHtml(run.environment)}@${escapeHtml(run.environmentVersion)}</td>
  <td>${escapeHtml(run.taskId)}@${escapeHtml(run.taskVersion)}</td>
  <td>${digestRef(run.initialSnapshotDigest)}</td>
  <td class="num">${escapeHtml(String(run.evidenceDigests.length))}</td>
  <td>${digestRef(run.trajectoryDigest)}</td>
</tr>`,
    )
    .join('');
  return `<h1>Environment Runs</h1>
<p class="lead">Executed runs over content-addressed environment definitions — every run addressable by task version, environment version, run id, snapshot digest, trajectory digest and evidence digests.</p>
<table>
  <thead><tr>
    <th scope="col">Run</th><th scope="col">Environment</th><th scope="col">Task</th>
    <th scope="col">Initial snapshot</th><th scope="col" class="num">Evidence</th><th scope="col">Trajectory</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/** Render one environment run detail card. */
export function renderEnvironmentRun(view: EnvironmentRunView): string {
  return `<section class="panel">
  <h2>Run ${escapeHtml(view.runId)}</h2>
  <dl class="kv">
    <dt>Environment</dt><dd>${escapeHtml(view.environment)}@${escapeHtml(view.environmentVersion)}</dd>
    <dt>Environment digest</dt><dd>${digestRef(view.environmentDigest)}</dd>
    <dt>Image digest</dt><dd>${digestRef(view.imageDigest)}</dd>
    <dt>Task</dt><dd>${escapeHtml(view.taskId)}@${escapeHtml(view.taskVersion)}</dd>
    <dt>Initial snapshot</dt><dd>${digestRef(view.initialSnapshotDigest)}</dd>
    <dt>Trajectory</dt><dd><a href="/runs/${escapeHtmlAttribute(view.runId)}/trajectory">${digestRef(view.trajectoryDigest)}</a></dd>
    <dt>Evidence digests</dt><dd>${view.evidenceDigests.map((entry) => digestRef(entry)).join('<br>')}</dd>
    <dt>Evidence outputs</dt><dd>${escapeHtml(view.evidenceOutputKinds.join(', '))}</dd>
    <dt>Network egress</dt><dd>${escapeHtml(view.networkEgress)}</dd>
    <dt>Filesystem</dt><dd>${escapeHtml(view.filesystemWriteMode)}</dd>
    <dt>Deadline behavior</dt><dd>${escapeHtml(view.deadlineBehavior)}</dd>
  </dl>
</section>`;
}

/** Render one trajectory step list item. */
function renderTrajectoryStep(step: TrajectoryStep): string {
  return `<li>
  <p><strong>Step ${escapeHtml(String(step.sequence))}</strong> — ${escapeHtml(step.at)} — ${escapeHtml(step.actor)}</p>
  <p>Action: ${escapeHtml(step.action)}</p>
  <p>Observation: ${escapeHtml(step.observation)}</p>
  ${step.evidenceDigest === undefined ? '' : `<p>Evidence: ${digestRef(step.evidenceDigest)}</p>`}
</li>`;
}

/** Render a run trajectory (/runs/:id/trajectory). */
export function renderTrajectory(view: TrajectoryView): string {
  return `<h1>Trajectory — run ${escapeHtml(view.runId)}</h1>
<p class="lead">Append-only trajectory of one environment run, pinned to the run address by its trajectory digest.</p>
<section class="panel">
  <h2>Run address</h2>
  <dl class="kv">
    <dt>Run</dt><dd>${escapeHtml(view.runId)}</dd>
    <dt>Task</dt><dd>${escapeHtml(view.taskId)}@${escapeHtml(view.taskVersion)}</dd>
    <dt>Environment</dt><dd>${escapeHtml(view.environment)}</dd>
    <dt>Trajectory digest</dt><dd>${digestRef(view.trajectoryDigest)}</dd>
    <dt>Steps</dt><dd>${escapeHtml(String(view.stepCount))}</dd>
  </dl>
</section>
<section class="panel">
  <h2>Steps</h2>
  <ol class="steps">${view.steps.map((step) => renderTrajectoryStep(step)).join('')}
  </ol>
</section>`;
}

// ---------------------------------------------------------------------------
// Index/dashboard (aggregates all sections — gate 3)
// ---------------------------------------------------------------------------

/** Render the index/dashboard: aggregate stats + per-section rollups. */
export function renderDashboard(view: DashboardView): string {
  const digestList = view.latestCaseDigests
    .map((entry) => `<li>${digestRef(entry)}</li>`)
    .join('');
  const jobIdList = view.latestJobIds
    .map((entry) => `<li>${escapeHtml(entry)}</li>`)
    .join('');
  return `<h1>Dashboard</h1>
<p class="lead">A human can discover a task, perform it in the correct environment, review evidence and inspect results — without developer intervention.</p>
<div class="cards">
  <div class="card"><div class="stat">${escapeHtml(String(view.caseCount))}</div><div class="label">Capability cases (<a href="/cases">browse</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.bodyCount))}</div><div class="label">Agent bodies (<a href="/bodies">browse</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.substrateCount))}</div><div class="label">Cognitive substrates (<a href="/substrates">browse</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.jobCount))}</div><div class="label">Durable jobs (<a href="/jobs">browse</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.runCount))}</div><div class="label">Environment runs (<a href="/runs">browse</a>)</div></div>
  <div class="card"><div class="stat">${escapeHtml(String(view.trajectoryStepCount))}</div><div class="label">Recorded trajectory steps</div></div>
</div>
<section class="panel">
  <h2>Capability case statuses</h2>
  ${renderStatusCounts(view.caseStatusBreakdown)}
</section>
<section class="panel">
  <h2>Job statuses</h2>
  ${renderStatusCounts(view.jobStatusBreakdown)}
</section>
<section class="panel">
  <h2>Case digests (content-addressed state)</h2>
  <ul>${digestList}</ul>
</section>
<section class="panel">
  <h2>Job ids</h2>
  <ul>${jobIdList}</ul>
</section>`;
}

// ---------------------------------------------------------------------------
// Error views (negative routes — gate 4)
// ---------------------------------------------------------------------------

/** Render the 404 view. */
export function renderNotFound(view: NotFoundView): string {
  return `<h1>Not found</h1>
<p class="lead">No console route matches <code class="digest">${escapeHtml(view.path)}</code>.</p>
<p>The console is read-only and serves a fixed set of sections — see the navigation above.</p>`;
}

/** Render the 405 view (read-only guarantee — gate 7). */
export function renderMethodNotAllowed(view: MethodNotAllowedView): string {
  return `<h1>Method not allowed</h1>
<p class="lead"><code class="digest">${escapeHtml(view.method)}</code> is not allowed on <code class="digest">${escapeHtml(view.path)}</code>.</p>
<p>The console is strictly read-only. Allowed methods: ${escapeHtml(view.allowedMethods.join(', '))}. No POST, PUT, DELETE or PATCH route exists — domain state can never be mutated through this surface.</p>`;
}
