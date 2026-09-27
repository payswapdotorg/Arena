/**
 * The console router (Work Order A018, gates 4 and 7).
 *
 * Hash-free, server-routed paths:
 *   /                          → dashboard (aggregate)
 *   /cases                     → capability cases
 *   /bodies                    → agent bodies
 *   /substrates                → cognitive substrates
 *   /jobs                      → durable jobs
 *   /runs                      → environment runs
 *   /runs/:runId/trajectory    → one run's trajectory
 *
 * `routePath` is a PURE function `(path, corpus) => view`: no I/O, no
 * clocks, no mutation — it projects corpus data through the view-model
 * constructors and returns a discriminated-union page view. Unknown paths
 * return the 404 view (negative route); unknown run ids on the trajectory
 * route likewise 404.
 *
 * `handleConsoleRequest` layers the read-only guarantee on top (gate 7):
 * GET (and HEAD, rendered identically) are the ONLY served methods — every
 * mutation method (POST/PUT/DELETE/PATCH/...) yields the 405 view. No
 * mutation route exists anywhere in the console.
 */

import type { ConsoleCorpus } from './corpus.js';
import { toDashboardView } from './corpus.js';
import { renderDocument } from './render.js';
import {
  renderBodyList,
  renderCaseList,
  renderDashboard,
  renderEnvironmentRun,
  renderJobList,
  renderMethodNotAllowed,
  renderNotFound,
  renderRunList,
  renderSubstrateList,
  renderTrajectory,
} from './render.js';
import type {
  BodyListView,
  CaseListView,
  DashboardView,
  EnvironmentRunView,
  JobListView,
  MethodNotAllowedView,
  NotFoundView,
  RunListView,
  SubstrateListView,
  TrajectoryView,
} from './views.js';
import {
  toBodyView,
  toCaseSummaryView,
  toEnvironmentRunView,
  toJobView,
  toSubstrateView,
  toTrajectoryView,
} from './views.js';

/** The full set of section paths the router serves (navigation order). */
export const CONSOLE_ROUTES = Object.freeze([
  '/',
  '/cases',
  '/bodies',
  '/substrates',
  '/jobs',
  '/runs',
] as readonly string[]);

/** The only methods the console ever serves (read-only surface — gate 7). */
export const CONSOLE_ALLOWED_METHODS = Object.freeze(['GET', 'HEAD'] as readonly string[]);

/** Discriminated union of every page view the router can produce. */
export type PageView =
  | DashboardView
  | CaseListView
  | BodyListView
  | SubstrateListView
  | JobListView
  | RunListView
  | TrajectoryView
  | EnvironmentRunView
  | NotFoundView
  | MethodNotAllowedView;

/** A request as the console understands it (method + path only). */
export interface ConsoleRequest {
  readonly method: string;
  readonly path: string;
}

/** A rendered console response. */
export interface ConsoleResponse {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/** The trajectory route prefix (the only parameterized route). */
const TRAJECTORY_ROUTE_PATTERN = /^\/runs\/([a-z0-9][a-z0-9-]*)\/trajectory$/;

/**
 * Pure router: map a request path to a page view derived from the corpus.
 * This function NEVER mutates the corpus and performs no I/O.
 */
export function routePath(path: string, corpus: ConsoleCorpus): PageView {
  switch (path) {
    case '/':
      return toDashboardView(corpus);
    case '/cases': {
      const view: CaseListView = {
        kind: 'case-list',
        cases: corpus.cases.map((caseRecord) => toCaseSummaryView(caseRecord)),
      };
      return Object.freeze(view);
    }
    case '/bodies': {
      const view: BodyListView = {
        kind: 'body-list',
        bodies: corpus.bodies.map((body) => toBodyView(body)),
      };
      return Object.freeze(view);
    }
    case '/substrates': {
      const view: SubstrateListView = {
        kind: 'substrate-list',
        substrates: corpus.substrates.map((registration) => toSubstrateView(registration)),
      };
      return Object.freeze(view);
    }
    case '/jobs': {
      const view: JobListView = {
        kind: 'job-list',
        jobs: corpus.jobs.map((job) => toJobView(job)),
      };
      return Object.freeze(view);
    }
    case '/runs': {
      const view: RunListView = {
        kind: 'run-list',
        runs: corpus.runs.map((run) => toEnvironmentRunView(run)),
      };
      return Object.freeze(view);
    }
    default: {
      const trajectoryMatch = TRAJECTORY_ROUTE_PATTERN.exec(path);
      if (trajectoryMatch !== null) {
        const runId = trajectoryMatch[1] ?? '';
        const run = corpus.runs.find((entry) => entry.address.runId === runId);
        if (run === undefined) {
          return notFound(path);
        }
        const steps = corpus.trajectories[runId] ?? [];
        return toTrajectoryView(run.address, steps);
      }
      return notFound(path);
    }
  }
}

/** The 404 view for a path (negative route). */
export function notFound(path: string): NotFoundView {
  return Object.freeze({ kind: 'not-found', path });
}

/** The 405 view for a disallowed method (read-only negative route). */
export function methodNotAllowed(method: string, path: string): MethodNotAllowedView {
  return Object.freeze({
    kind: 'method-not-allowed',
    method,
    path,
    allowedMethods: CONSOLE_ALLOWED_METHODS,
  });
}

/** Page titles per view kind (document <title> + heading). */
const PAGE_TITLES: Readonly<Record<PageView['kind'], string>> = Object.freeze({
  dashboard: 'Dashboard',
  'case-list': 'Capability Cases',
  'body-list': 'Agent Bodies',
  'substrate-list': 'Cognitive Substrates',
  'job-list': 'Durable Jobs',
  'run-list': 'Environment Runs',
  trajectory: 'Run Trajectory',
  'environment-run': 'Environment Run',
  'not-found': 'Not Found',
  'method-not-allowed': 'Method Not Allowed',
});

/** Render any page view into its section HTML (pure). */
export function renderPageView(view: PageView): string {
  switch (view.kind) {
    case 'dashboard':
      return renderDashboard(view);
    case 'case-list':
      return renderCaseList(view);
    case 'body-list':
      return renderBodyList(view);
    case 'substrate-list':
      return renderSubstrateList(view);
    case 'job-list':
      return renderJobList(view);
    case 'run-list':
      return renderRunList(view);
    case 'trajectory':
      return renderTrajectory(view);
    case 'environment-run':
      return renderEnvironmentRun(view);
    case 'not-found':
      return renderNotFound(view);
    case 'method-not-allowed':
      return renderMethodNotAllowed(view);
  }
}

/**
 * Handle one console request against the corpus: enforce the read-only
 * method policy (gate 7), route the path, render the full document.
 * Pure with respect to the corpus — the corpus is never mutated.
 */
export function handleConsoleRequest(
  request: ConsoleRequest,
  corpus: ConsoleCorpus,
): ConsoleResponse {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const view = methodNotAllowed(method, request.path);
    return {
      status: 405,
      contentType: 'text/html; charset=utf-8',
      html: renderDocument(PAGE_TITLES[view.kind], request.path, renderPageView(view)),
      allow: CONSOLE_ALLOWED_METHODS.join(', '),
    };
  }
  const view = routePath(request.path, corpus);
  const status = view.kind === 'not-found' ? 404 : 200;
  return {
    status,
    contentType: 'text/html; charset=utf-8',
    html: renderDocument(PAGE_TITLES[view.kind], request.path, renderPageView(view)),
  };
}
