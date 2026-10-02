/**
 * Operations-route composition (Work Order B014;
 * apps/web/src/operations). SERVER-ONLY.
 *
 * Mirrors the B007/B012 route patterns:
 *   - `/operations` and its screens probe the browser session FIRST
 *     (fail closed — an unauthenticated visitor gets the auth-required
 *     notice, NEVER an anonymous surface), then compose the views
 *     through the protocol packages' public reads (jobs/SLO/audit) and
 *     the B002 capacity contracts;
 *   - `/demo/operations/**` composes over the shared B006 demo runtime
 *     (zero credentials, deterministic corpus, reserved demo tenant) with
 *     the deterministic B014 protocol corpus, under the demo labelling
 *     contract.
 *
 * Every experience carries its truth classes (the B003 taxonomy through
 * the B014 state marks). The session posture's sections are HONEST
 * states: the SLO board runs the REAL A035 evaluator over zero samples
 * (verdict no-data, budget reported exhausted — fail closed), the
 * capacity board renders the unwired providers' DISABLED posture
 * (configuration-missing), and the jobs/audit sections render their
 * honest empties — nothing is fabricated to fill the space.
 */

import { toJobDetailView, toJobSummaryView } from './jobs-view-model.js';
import type {
  JobDetailView,
  JobLifecycleView,
  JobSummaryView,
} from './jobs-view-model.js';
import { toSloRowView } from './slo-view-model.js';
import type { SloRowView } from './slo-view-model.js';
import { toAuditStreamView } from './audit-view-model.js';
import type { AuditEventView, AuditStreamView } from './audit-view-model.js';
import { toCapacityBoardView, toProviderCapacityView } from './capacity-view-model.js';
import type { CapacityBoardView } from './capacity-view-model.js';
import { toOperationsRoleLensView } from './role-lens.js';
import type { OperationsRoleLensView } from './role-lens.js';
import {
  OPERATIONS_AUDIT_APPEND_ONLY_NOTE,
  OPERATIONS_JOB_HONESTY_NOTE,
  OPERATIONS_SLO_MEASUREMENT_NOTE,
  truthClassLegend,
} from './state-mark.js';
import type { TruthClassMark } from './state-mark.js';
import {
  OPERATIONS_DEMO_EPOCH_MS,
  OPERATIONS_PROVIDERS,
  buildSessionProviderHealths,
  buildSloCatalog,
  evaluateSloEmpty,
} from './fixtures.js';
import type { CockpitSessionFacts, SessionProbe } from './runtime.js';
import { getDemoOperationsContext, resolveSessionOperations } from './runtime.js';

// ---------------------------------------------------------------------------
// Posture notes (carried as data, rendered verbatim)
// ---------------------------------------------------------------------------

/** The session-posture jobs note: no orchestrator is composed, the list renders honestly empty. */
const SESSION_JOBS_NOTE =
  'No job records exist in this posture: jobs are read server-side through the A015 job protocol, and the local composition holds none (a wired control plane records them through the same seam). The list renders the store as it is — nothing is fabricated.';

/** The session-posture capacity note: local parity, hosted adapters unwired, fail closed. */
const SESSION_CAPACITY_NOTE =
  'This posture composes the B002 local-parity fakes (in-memory control plane, coordination and blob stores); the hosted adapters are wired by the deployment work orders (B015/B016) through the same CapacityProbe port. An unwired provider reads DISABLED (configuration-missing) and every gated operation fails closed — quotas and ceilings render here once an adapter is wired, and no billable fallback exists in any posture.';

/** The demo-posture capacity note: all four closed states, deterministically. */
const DEMO_CAPACITY_NOTE =
  'Deterministic demo postures across the closed FT2.0 vocabulary: AVAILABLE, DEGRADED (near-limit), EXHAUSTED (quota-exhausted) and DISABLED (configuration-missing) — the honest states a hosted free tier can hold, with visible ceilings and the fail-closed guarantee. Demo state is not customer state.';

/** How many audit events the overview previews (the full stream lives on the audit screen). */
const AUDIT_PREVIEW_COUNT = 3;

// ---------------------------------------------------------------------------
// The shared view models
// ---------------------------------------------------------------------------

/** The complete `/operations` overview view model. */
export interface OperationsHomeViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  /** The role lens (facts + framing — never authorization). */
  readonly lens: OperationsRoleLensView;
  /** Job summary rows (empty in the session posture — honest). */
  readonly jobs: readonly JobSummaryView[];
  readonly jobsNote: string;
  /** Counts by lifecycle view state (rendered next to the jobs table). */
  readonly jobLifecycleCounts: Readonly<Record<JobLifecycleView, number>>;
  /** The SLO board rows (no-data in the session posture — fail closed). */
  readonly sloRows: readonly SloRowView[];
  readonly sloNote: string;
  /** The capacity board (DISABLED providers in the session posture — fail closed). */
  readonly capacity: CapacityBoardView;
  /** The audit stream preview (append-only evidence, order verbatim). */
  readonly auditPreview: readonly AuditEventView[];
  readonly auditPreviewNote: string;
  readonly honestyNote: string;
  /** The truth-class legend (the teaching UI). */
  readonly legend: readonly TruthClassMark[];
  readonly jobHrefBase: string;
  readonly auditHrefBase: string;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

/** The `/operations/jobs` list view model. */
export interface JobsListViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly jobs: readonly JobSummaryView[];
  readonly jobsNote: string;
  readonly honestyNote: string;
  readonly jobDetailHrefBase: string;
  readonly demo: { readonly isDemo: boolean };
}

/** The `/operations/jobs/:jobId` detail view model. */
export interface JobDetailScreenViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly principalLabel: string;
  readonly view: JobDetailView;
  readonly honestyNote: string;
  readonly jobsHrefBase: string;
  readonly demo: { readonly isDemo: boolean };
}

/** The `/operations/audit` stream view model. */
export interface AuditScreenViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly stream: AuditStreamView;
  readonly demo: { readonly isDemo: boolean };
}

/** The `/operations/capacity` board view model. */
export interface CapacityScreenViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly board: CapacityBoardView;
  readonly demo: { readonly isDemo: boolean };
}

// ---------------------------------------------------------------------------
// The experiences (what each route renders)
// ---------------------------------------------------------------------------

/** What `/operations` renders: the auth-required notice, or the overview. */
export type OperationsExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'home'; readonly view: OperationsHomeViewModel };

/** What `/operations/jobs` renders: the auth-required notice, or the list. */
export type JobsScreenExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'list'; readonly view: JobsListViewModel };

/** What a job detail renders: auth-required, honest not-found, or the job. */
export type JobDetailExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly jobId: string }
  | { readonly kind: 'job'; readonly view: JobDetailScreenViewModel };

/** What `/operations/audit` renders: the auth-required notice, or the stream. */
export type AuditScreenExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'stream'; readonly view: AuditScreenViewModel };

/** What `/operations/capacity` renders: the auth-required notice, or the board. */
export type CapacityScreenExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'board'; readonly view: CapacityScreenViewModel };

/** Shared resolve options: a session-probe seam (tests) + the session-posture clock instant. */
export interface ResolveOperationsOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /** The instant the session posture stamps on evaluation windows and capacity checks (default: wall clock). */
  readonly now?: number;
}

/** A job-detail resolve input. */
export interface ResolveJobDetailOptions extends ResolveOperationsOptions {
  readonly id: string;
}

// ---------------------------------------------------------------------------
// View assembly (shared by both postures)
// ---------------------------------------------------------------------------

/** The per-posture data bundle the screens render. */
interface OperationsViews {
  readonly jobs: readonly JobSummaryView[];
  readonly jobsNote: string;
  readonly sloRows: readonly SloRowView[];
  readonly capacity: CapacityBoardView;
  readonly audit: AuditStreamView;
}

/** Counts by lifecycle view state (closed vocabulary, deterministic order). */
function lifecycleCounts(jobs: readonly JobSummaryView[]): Readonly<Record<JobLifecycleView, number>> {
  const counts: Record<JobLifecycleView, number> = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
  };
  for (const job of jobs) {
    counts[job.state] += 1;
  }
  return Object.freeze(counts);
}

function demoStamp(isDemo: boolean, corpusHash?: string): { readonly isDemo: boolean; readonly corpusHash?: string } {
  return Object.freeze({
    isDemo,
    ...(corpusHash !== undefined ? { corpusHash } : {}),
  });
}

/** The session-posture views: honest empties, real no-data SLO evaluations, DISABLED capacity. */
function buildSessionViews(now: number): OperationsViews {
  const sloRows = buildSloCatalog().map((definition) =>
    toSloRowView({ definition, evaluation: evaluateSloEmpty(definition, now) }),
  );
  const providers = buildSessionProviderHealths(now).map((health, index) => {
    const spec = OPERATIONS_PROVIDERS[index];
    return toProviderCapacityView({
      health,
      role: spec?.role ?? 'provider',
      ...(spec !== undefined ? { note: spec.note } : {}),
    });
  });
  return {
    jobs: Object.freeze([]),
    jobsNote: SESSION_JOBS_NOTE,
    sloRows: Object.freeze(sloRows),
    capacity: toCapacityBoardView({ providers, checkedAt: now, note: SESSION_CAPACITY_NOTE }),
    audit: toAuditStreamView([]),
  };
}

/** The demo-posture views: the deterministic protocol corpus, projected. */
async function buildDemoViews(): Promise<OperationsViews> {
  const context = await getDemoOperationsContext();
  const corpus = context.corpus;
  const jobs = corpus.jobs.map((job) => toJobSummaryView(job));
  const sloRows = corpus.sloCatalog.map((definition) =>
    toSloRowView({
      definition,
      evaluation: corpus.sloEvaluations.find((entry) => entry.sloId === definition.sloId),
    }),
  );
  const providers = corpus.providers.map((entry) =>
    toProviderCapacityView({
      health: entry.health,
      role: entry.role,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    }),
  );
  return {
    jobs: Object.freeze(jobs),
    jobsNote:
      'Deterministic demo jobs: five REAL A015 records across the lifecycle vocabulary (succeeded, running, re-queued after a retryable failure, failed with the retry budget exhausted, cancelled) — built through the package transitions themselves, so the histories are the state machine output.',
    sloRows: Object.freeze(sloRows),
    capacity: toCapacityBoardView({
      providers,
      checkedAt: OPERATIONS_DEMO_EPOCH_MS,
      note: DEMO_CAPACITY_NOTE,
    }),
    audit: toAuditStreamView(corpus.auditRecords, { chainVerified: corpus.auditChainVerified }),
  };
}

function assembleHome(
  mode: 'session' | 'demo',
  facts: CockpitSessionFacts,
  views: OperationsViews,
  demo: { readonly isDemo: boolean; readonly corpusHash?: string },
): OperationsHomeViewModel {
  return Object.freeze({
    mode,
    tenantId: facts.tenantId,
    workspaceId: facts.workspaceId,
    principalLabel: facts.principalLabel,
    lens: toOperationsRoleLensView(facts.grantedRoleIds),
    jobs: views.jobs,
    jobsNote: views.jobsNote,
    jobLifecycleCounts: lifecycleCounts(views.jobs),
    sloRows: views.sloRows,
    sloNote: OPERATIONS_SLO_MEASUREMENT_NOTE,
    capacity: views.capacity,
    auditPreview: Object.freeze(views.audit.events.slice(0, AUDIT_PREVIEW_COUNT)),
    auditPreviewNote: OPERATIONS_AUDIT_APPEND_ONLY_NOTE,
    honestyNote: OPERATIONS_JOB_HONESTY_NOTE,
    legend: truthClassLegend(),
    jobHrefBase: mode === 'demo' ? '/demo/operations/jobs' : '/operations/jobs',
    auditHrefBase: mode === 'demo' ? '/demo/operations/audit' : '/operations/audit',
    demo,
  } satisfies OperationsHomeViewModel);
}

// ---------------------------------------------------------------------------
// Session experiences (fail closed first, honest states after)
// ---------------------------------------------------------------------------

/**
 * Resolve the `/operations` overview: probe the browser session (fail
 * closed — typed AUTH_* outcomes render the auth-required notice, never
 * an anonymous surface), then compose the honest session posture.
 */
export async function resolveOperationsExperience(
  options: ResolveOperationsOptions = {},
): Promise<OperationsExperience> {
  const outcome = await resolveSessionOperations(
    options.probe !== undefined ? { probe: options.probe } : {},
  );
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const now = options.now ?? Date.now();
  const views = buildSessionViews(now);
  return {
    kind: 'home',
    view: assembleHome('session', outcome.facts, views, demoStamp(false)),
  };
}

/** Resolve the `/operations/jobs` list (honest empty in the session posture). */
export async function resolveOperationsJobsExperience(
  options: ResolveOperationsOptions = {},
): Promise<JobsScreenExperience> {
  const outcome = await resolveSessionOperations(
    options.probe !== undefined ? { probe: options.probe } : {},
  );
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const views = buildSessionViews(options.now ?? Date.now());
  return {
    kind: 'list',
    view: Object.freeze({
      mode: 'session',
      tenantId: outcome.facts.tenantId,
      workspaceId: outcome.facts.workspaceId,
      principalLabel: outcome.facts.principalLabel,
      jobs: views.jobs,
      jobsNote: views.jobsNote,
      honestyNote: OPERATIONS_JOB_HONESTY_NOTE,
      jobDetailHrefBase: '/operations/jobs',
      demo: demoStamp(false),
    } satisfies JobsListViewModel),
  };
}

/**
 * Resolve the `/operations/jobs/:jobId` detail. The session posture holds
 * no job records, so an authenticated session resolves the honest
 * not-found outcome — never a fabricated job.
 */
export async function resolveOperationsJobExperience(
  options: ResolveJobDetailOptions,
): Promise<JobDetailExperience> {
  const outcome = await resolveSessionOperations(
    options.probe !== undefined ? { probe: options.probe } : {},
  );
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return { kind: 'not-found', jobId: options.id };
}

/** Resolve the `/operations/audit` stream (honest empty in the session posture). */
export async function resolveOperationsAuditExperience(
  options: ResolveOperationsOptions = {},
): Promise<AuditScreenExperience> {
  const outcome = await resolveSessionOperations(
    options.probe !== undefined ? { probe: options.probe } : {},
  );
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const views = buildSessionViews(options.now ?? Date.now());
  return {
    kind: 'stream',
    view: Object.freeze({
      mode: 'session',
      tenantId: outcome.facts.tenantId,
      workspaceId: outcome.facts.workspaceId,
      principalLabel: outcome.facts.principalLabel,
      stream: views.audit,
      demo: demoStamp(false),
    } satisfies AuditScreenViewModel),
  };
}

/** Resolve the `/operations/capacity` board (DISABLED providers in the session posture). */
export async function resolveOperationsCapacityExperience(
  options: ResolveOperationsOptions = {},
): Promise<CapacityScreenExperience> {
  const outcome = await resolveSessionOperations(
    options.probe !== undefined ? { probe: options.probe } : {},
  );
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const views = buildSessionViews(options.now ?? Date.now());
  return {
    kind: 'board',
    view: Object.freeze({
      mode: 'session',
      tenantId: outcome.facts.tenantId,
      workspaceId: outcome.facts.workspaceId,
      principalLabel: outcome.facts.principalLabel,
      board: views.capacity,
      demo: demoStamp(false),
    } satisfies CapacityScreenViewModel),
  };
}

// ---------------------------------------------------------------------------
// Demo experiences (B006 posture, deterministic, visibly labelled)
// ---------------------------------------------------------------------------

/** Resolve the DEMO `/demo/operations` overview (deterministic corpus). */
export async function resolveDemoOperationsHome(): Promise<OperationsHomeViewModel> {
  const context = await getDemoOperationsContext();
  const views = await buildDemoViews();
  return assembleHome('demo', context.facts, views, demoStamp(true, context.corpusHash));
}

/** Resolve the DEMO `/demo/operations/jobs` list (deterministic corpus). */
export async function resolveDemoOperationsJobs(): Promise<JobsListViewModel> {
  const context = await getDemoOperationsContext();
  const views = await buildDemoViews();
  return Object.freeze({
    mode: 'demo',
    tenantId: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    jobs: views.jobs,
    jobsNote: views.jobsNote,
    honestyNote: OPERATIONS_JOB_HONESTY_NOTE,
    jobDetailHrefBase: '/demo/operations/jobs',
    demo: demoStamp(true),
  } satisfies JobsListViewModel);
}

/**
 * Resolve the DEMO job detail (`/demo/operations/jobs/:jobId`): the
 * deterministic corpus carries exactly its five job ids — anything else
 * resolves the honest not-found outcome, never a fabricated job.
 */
export async function resolveDemoOperationsJobExperience(
  jobId: string,
): Promise<JobDetailExperience> {
  const context = await getDemoOperationsContext();
  const record = context.corpus.jobs.find((job) => job.jobId === jobId);
  if (record === undefined) {
    return { kind: 'not-found', jobId };
  }
  return {
    kind: 'job',
    view: Object.freeze({
      mode: 'demo',
      tenantId: context.facts.tenantId,
      principalLabel: context.facts.principalLabel,
      view: toJobDetailView(record),
      honestyNote: OPERATIONS_JOB_HONESTY_NOTE,
      jobsHrefBase: '/demo/operations/jobs',
      demo: demoStamp(true),
    } satisfies JobDetailScreenViewModel),
  };
}

/** Resolve the DEMO `/demo/operations/audit` stream (verified chain, deterministic). */
export async function resolveDemoOperationsAudit(): Promise<AuditScreenViewModel> {
  const context = await getDemoOperationsContext();
  const views = await buildDemoViews();
  return Object.freeze({
    mode: 'demo',
    tenantId: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    stream: views.audit,
    demo: demoStamp(true),
  } satisfies AuditScreenViewModel);
}

/** Resolve the DEMO `/demo/operations/capacity` board (all four closed states). */
export async function resolveDemoOperationsCapacity(): Promise<CapacityScreenViewModel> {
  const context = await getDemoOperationsContext();
  const views = await buildDemoViews();
  return Object.freeze({
    mode: 'demo',
    tenantId: context.facts.tenantId,
    workspaceId: context.facts.workspaceId,
    principalLabel: context.facts.principalLabel,
    board: views.capacity,
    demo: demoStamp(true),
  } satisfies CapacityScreenViewModel);
}
