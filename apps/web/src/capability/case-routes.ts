/**
 * Capability route composition (Work Order B008; issue #80;
 * apps/web/src/capability). SERVER-ONLY.
 *
 * The thin compositions the route mounts call (the B007 home-route
 * precedent): the session experiences probe the browser session FIRST
 * (fail closed — a typed AUTH_* outcome renders the sign-in gate, never an
 * anonymous case/task surface), then build the view models through the
 * canonical read port; the demo experiences run over the shared B006 demo
 * runtime, visibly labelled. Guided form POSTs are handled by
 * `handleGuidedFormPost` (origin-check → product-flows runtime → honest
 * redirect with the typed code), so the route.ts mounts stay wiring-only.
 */

import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';
import type { ControlPlaneRepository } from '../../../../packages/persistence/src/index.js';
import type { FlowActor } from '../../../../packages/product-flows/src/index.js';
import {
  resolveSessionCapability,
  getDemoCapabilityContext,
} from './runtime.js';
import type { CapabilityFlowRuntime, CapabilitySessionFacts } from './runtime.js';
import type { SessionProbe } from '../cockpit/runtime.js';
import {
  buildCaseListView,
  buildCaseDetailView,
  buildTaskDetailView,
} from './case-view.js';
import type {
  CaseListViewModel,
  CaseDetailViewModel,
  TaskDetailViewModel,
} from './case-view.js';
import { executeGuidedAction } from './flow-actions.js';

// ---------------------------------------------------------------------------
// Session experiences (fail closed: gate | view)
// ---------------------------------------------------------------------------

/** What the session `/cases` route renders: the gate, or the case list. */
export type SessionCaseListExperience =
  | { readonly kind: 'gate'; readonly code: string }
  | { readonly kind: 'cases'; readonly view: CaseListViewModel };

/** What the session `/cases/:id` route renders: gate | case | unreadable. */
export type SessionCaseDetailExperience =
  | { readonly kind: 'gate'; readonly code: string }
  | { readonly kind: 'case'; readonly view: CaseDetailViewModel }
  | {
      /** The canonical read failed (typed) — surfaced honestly, never guessed into a case. */
      readonly kind: 'unreadable';
      readonly recordId: string;
      readonly message: string;
    };

/** What the session `/tasks/:id` route renders: the gate, or the task view. */
export type SessionTaskExperience =
  | { readonly kind: 'gate'; readonly code: string }
  | { readonly kind: 'task'; readonly view: TaskDetailViewModel };

export interface SessionCapabilityRouteOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  /** Repository override for the flow runtime + read model (composition seam). */
  readonly repository?: ControlPlaneRepository;
  /** Explicit query-state role request (`?role=`). */
  readonly requestedRoleId?: string;
}

function requestedRoleOf(options: SessionCapabilityRouteOptions): string | undefined {
  return options.requestedRoleId !== undefined && options.requestedRoleId.length > 0
    ? options.requestedRoleId
    : undefined;
}

/** The acting principal for guided writes (from the VALIDATED session facts). */
export function sessionActor(facts: CapabilitySessionFacts): FlowActor {
  return Object.freeze({
    type: 'user',
    tenant: facts.tenantId,
    // The principal label is the inspectable identity the session exposes;
    // the canonical charset is enforced downstream (typed rejection, never guessed).
    principalId: facts.principalLabel,
  });
}

/** Resolve the session case-list experience (`/cases`). */
export async function resolveSessionCaseList(
  options: SessionCapabilityRouteOptions = {},
): Promise<SessionCaseListExperience> {
  const outcome = await resolveSessionCapability({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
    ...(options.repository !== undefined ? { repository: options.repository } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'gate', code: outcome.code };
  }
  const requestedRoleId = requestedRoleOf(options);
  const view = await buildCaseListView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
  });
  return { kind: 'cases', view };
}

/** Resolve the session case-detail experience (`/cases/:id`). */
export async function resolveSessionCaseDetail(
  recordId: string,
  options: SessionCapabilityRouteOptions = {},
): Promise<SessionCaseDetailExperience> {
  const outcome = await resolveSessionCapability({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
    ...(options.repository !== undefined ? { repository: options.repository } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'gate', code: outcome.code };
  }
  const requestedRoleId = requestedRoleOf(options);
  try {
    const view = await buildCaseDetailView({
      mode: 'session',
      facts: outcome.facts,
      port: outcome.port,
      recordId,
      ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
    });
    return { kind: 'case', view };
  } catch (error) {
    // The canonical read failed with a typed boundary failure — rendered
    // honestly (never guessed into a case, never a fake empty list).
    return {
      kind: 'unreadable',
      recordId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolve the session task experience (`/tasks/:id`). */
export async function resolveSessionTask(
  taskId: string,
  options: SessionCapabilityRouteOptions = {},
): Promise<SessionTaskExperience> {
  const outcome = await resolveSessionCapability({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
    ...(options.repository !== undefined ? { repository: options.repository } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'gate', code: outcome.code };
  }
  const requestedRoleId = requestedRoleOf(options);
  const view = await buildTaskDetailView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    taskId,
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
  });
  return { kind: 'task', view };
}

// ---------------------------------------------------------------------------
// Demo experiences (B006 runtime; canonical reads; visibly labelled)
// ---------------------------------------------------------------------------

/** Resolve the demo case-list view (`/demo/cases`). */
export async function resolveDemoCaseList(requestedRoleId?: string): Promise<CaseListViewModel> {
  const context = await getDemoCapabilityContext();
  return buildCaseListView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    ...(requestedRoleId !== undefined && requestedRoleId.length > 0
      ? { requestedRoleId }
      : {}),
    corpusHash: context.corpusHash,
  });
}

/** Resolve the demo case-detail view (`/demo/cases/:id`). */
export async function resolveDemoCaseDetail(
  recordId: string,
  requestedRoleId?: string,
): Promise<CaseDetailViewModel | { readonly unreadable: true; readonly message: string }> {
  const context = await getDemoCapabilityContext();
  try {
    return await buildCaseDetailView({
      mode: 'demo',
      facts: context.facts,
      port: context.port,
      recordId,
      ...(requestedRoleId !== undefined && requestedRoleId.length > 0
        ? { requestedRoleId }
        : {}),
      corpusHash: context.corpusHash,
    });
  } catch (error) {
    return {
      unreadable: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolve the demo task view (`/demo/tasks/:id`). */
export async function resolveDemoTask(
  taskId: string,
  requestedRoleId?: string,
): Promise<TaskDetailViewModel> {
  const context = await getDemoCapabilityContext();
  return buildTaskDetailView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    taskId,
    ...(requestedRoleId !== undefined && requestedRoleId.length > 0
      ? { requestedRoleId }
      : {}),
    corpusHash: context.corpusHash,
  });
}

/** The acting principal for demo guided writes (the reserved demo tenant). */
export async function demoActor(): Promise<FlowActor> {
  const context = await getDemoCapabilityContext();
  return Object.freeze({
    type: 'user',
    tenant: context.facts.tenantId,
    principalId: context.facts.principalLabel,
  });
}

// ---------------------------------------------------------------------------
// Guided form POST handling (origin-check → flow runtime → honest redirect)
// ---------------------------------------------------------------------------

/** Where a handled guided form POST lands the visitor. */
export interface GuidedFormRedirects {
  /** Success: the surface of the resulting record (given its record id). */
  readonly success: (recordId: string) => string;
  /** Failure: the surface to return to (flowError is appended). */
  readonly failure: string;
}

/**
 * Execute one guided form POST and map the typed outcome onto the honest
 * redirect contract:
 *
 *   - origin-rejected → 403 (the B004 CSRF posture — a boundary rejection,
 *     not a redirect that would retry the write);
 *   - rejected → 303 back to the surface with `?flowError=<code>` (the
 *     typed code renders verbatim — never a fake success);
 *   - done → 303 to the resulting record surface.
 */
export async function handleGuidedFormPost(
  request: Request,
  deps: {
    readonly tenantId: string;
    readonly actor: FlowActor;
    readonly flow: CapabilityFlowRuntime;
  },
  redirects: GuidedFormRedirects,
): Promise<Response> {
  const outcome = await executeGuidedAction({
    request,
    tenantId: deps.tenantId,
    actor: deps.actor,
    flow: deps.flow,
  });
  if (outcome.status === 'origin-rejected') {
    return new Response(outcome.message, {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (outcome.status === 'rejected') {
    const separator = redirects.failure.includes('?') ? '&' : '?';
    const target = new URL(
      `${redirects.failure}${separator}flowError=${encodeURIComponent(outcome.code)}`,
      request.url,
    );
    return Response.redirect(target, 303);
  }
  return Response.redirect(new URL(redirects.success(outcome.recordId), request.url), 303);
}
