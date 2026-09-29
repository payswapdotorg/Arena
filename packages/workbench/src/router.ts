/**
 * The workbench router (Work Order A017).
 *
 * Hash-free, server-routed paths:
 *   /                            → overview (aggregate + degradation rollup)
 *   /experts                     → expert directory (A006 + A007)
 *   /tasks                       → task queue (A008 + A007 match outcomes)
 *   /trajectories                → trajectory feed (A011, read-only)
 *   /trajectories/:trajectoryId  → one trajectory, drilled down
 *   /jobs                        → job status (A015)
 *
 * `routePath` is a PURE function `(path, corpus) => view`: no I/O, no
 * clocks, no mutation — it projects corpus data through the view-model
 * constructors and returns a discriminated-union page view. Unknown
 * paths return the 404 view (negative route); unknown trajectory ids on
 * the detail route likewise 404.
 *
 * `handleWorkbenchRequest` layers the read-only guarantee on top: GET
 * (and HEAD, rendered identically) are the ONLY served methods — every
 * mutation method (POST/PUT/DELETE/PATCH/...) yields the 405 view. No
 * mutation route exists anywhere in the workbench (mirroring the A018
 * console router exactly).
 */

import type { WorkbenchCorpus } from './corpus.js';
import { renderDocument } from './render.js';
import {
  renderExpertDirectory,
  renderJobStatus,
  renderMethodNotAllowed,
  renderNotFound,
  renderTaskQueue,
  renderTrajectoryDetail,
  renderTrajectoryFeed,
  renderWorkbenchOverview,
} from './render.js';
import type {
  ExpertDirectoryView,
  JobStatusView,
  MethodNotAllowedView,
  NotFoundView,
  TaskQueueView,
  TrajectoryDetailView,
  TrajectoryFeedView,
  WorkbenchOverviewView,
} from './views.js';
import {
  toExpertDirectoryView,
  toJobStatusView,
  toTaskQueueView,
  toTrajectoryFeedEntry,
  toTrajectoryFeedView,
  toWorkbenchOverviewView,
} from './views.js';
import { trajectoryFeedDegradation } from './views.js';

/** The full set of section paths the router serves (navigation order). */
export const WORKBENCH_ROUTES = Object.freeze([
  '/',
  '/experts',
  '/tasks',
  '/trajectories',
  '/jobs',
] as readonly string[]);

/** The only methods the workbench ever serves (read-only surface). */
export const WORKBENCH_ALLOWED_METHODS = Object.freeze(['GET', 'HEAD'] as readonly string[]);

/** Discriminated union of every page view the router can produce. */
export type PageView =
  | WorkbenchOverviewView
  | ExpertDirectoryView
  | TaskQueueView
  | TrajectoryFeedView
  | TrajectoryDetailView
  | JobStatusView
  | NotFoundView
  | MethodNotAllowedView;

/** A request as the workbench understands it (method + path only). */
export interface WorkbenchRequest {
  readonly method: string;
  readonly path: string;
}

/** A rendered workbench response. */
export interface WorkbenchResponse {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/** The trajectory detail route prefix (the only parameterized route). */
const TRAJECTORY_ROUTE_PATTERN = /^\/trajectories\/([a-z0-9][a-z0-9-]*)$/;

/**
 * Pure router: map a request path to a page view derived from the corpus.
 * This function NEVER mutates the corpus and performs no I/O.
 */
export function routePath(path: string, corpus: WorkbenchCorpus): PageView {
  switch (path) {
    case '/':
      return toWorkbenchOverviewView(corpus);
    case '/experts':
      return toExpertDirectoryView(corpus);
    case '/tasks':
      return toTaskQueueView(corpus);
    case '/trajectories':
      return toTrajectoryFeedView(corpus);
    case '/jobs':
      return toJobStatusView(corpus);
    default: {
      const trajectoryMatch = TRAJECTORY_ROUTE_PATTERN.exec(path);
      if (trajectoryMatch !== null) {
        const trajectoryId = trajectoryMatch[1] ?? '';
        const record = corpus.trajectories.find(
          (entry) => entry.header.trajectoryId === trajectoryId,
        );
        if (record === undefined) {
          return notFound(path);
        }
        return Object.freeze({
          kind: 'trajectory-detail',
          entry: toTrajectoryFeedEntry(record),
          degradation: trajectoryFeedDegradation(corpus),
        }) satisfies TrajectoryDetailView;
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
    allowedMethods: WORKBENCH_ALLOWED_METHODS,
  });
}

/** Page titles per view kind (document <title> + heading). */
const PAGE_TITLES: Readonly<Record<PageView['kind'], string>> = Object.freeze({
  'workbench-overview': 'Overview',
  'expert-directory': 'Expert Directory',
  'task-queue': 'Task Queue',
  'trajectory-feed': 'Trajectories',
  'trajectory-detail': 'Trajectory',
  'job-status': 'Job Status',
  'not-found': 'Not Found',
  'method-not-allowed': 'Method Not Allowed',
});

/** Render any page view into its section HTML (pure). */
export function renderPageView(view: PageView): string {
  switch (view.kind) {
    case 'workbench-overview':
      return renderWorkbenchOverview(view);
    case 'expert-directory':
      return renderExpertDirectory(view);
    case 'task-queue':
      return renderTaskQueue(view);
    case 'trajectory-feed':
      return renderTrajectoryFeed(view);
    case 'trajectory-detail':
      return renderTrajectoryDetail(view);
    case 'job-status':
      return renderJobStatus(view);
    case 'not-found':
      return renderNotFound(view);
    case 'method-not-allowed':
      return renderMethodNotAllowed(view);
  }
}

/**
 * Handle one workbench request against the corpus: enforce the read-only
 * method policy, route the path, render the full document. Pure with
 * respect to the corpus — the corpus is never mutated.
 */
export function handleWorkbenchRequest(
  request: WorkbenchRequest,
  corpus: WorkbenchCorpus,
): WorkbenchResponse {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const view = methodNotAllowed(method, request.path);
    return {
      status: 405,
      contentType: 'text/html; charset=utf-8',
      html: renderDocument(PAGE_TITLES[view.kind], request.path, renderPageView(view)),
      allow: WORKBENCH_ALLOWED_METHODS.join(', '),
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
