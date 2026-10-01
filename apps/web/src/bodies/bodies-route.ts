/**
 * Bodies-route composition (Work Order B010; issue #82;
 * apps/web/src/bodies). SERVER-ONLY.
 *
 * Mirrors the B007 home-route pattern for the two studio rows:
 *   - `/bodies` and `/bodies/:id` probe the browser session FIRST (fail
 *     closed — an unauthenticated visitor gets the auth-required notice,
 *     NEVER an anonymous studio), then compose the view through the B005
 *     read path for the validated session;
 *   - `/demo/bodies` and `/demo/bodies/:id` compose over the shared B006
 *     demo runtime (zero credentials, deterministic corpus, reserved
 *     demo tenant) under the demo labelling contract.
 */

import { BodyStudioView } from './bodies-home-view.js';
import type { BodyStudioViewModel } from './studio-view.js';
import { buildBodyStudioView } from './studio-view.js';
import { resolveBodyDetail } from './body-detail-view.js';
import type { BodyDetailOutcome } from './body-detail-view.js';
import { BodyDetailView } from './bodies-detail-view.js';
import {
  getDemoBodyStudioContext,
  resolveSessionBodyStudio,
} from './runtime.js';
import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';

/** What `/bodies` renders: the auth-required notice, or the authenticated studio. */
export type BodiesExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'studio'; readonly view: BodyStudioViewModel };

export interface ResolveBodiesExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionBodyStudio>[0]>['probe'];
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  /** Explicit query-state role request (`?role=`). */
  readonly requestedRoleId?: string;
}

/**
 * Resolve the `/bodies` experience: probe the browser session (fail
 * closed — typed AUTH_* outcomes render the auth-required notice, never
 * an anonymous studio), then build the studio view for the validated
 * session's granted roles.
 */
export async function resolveBodiesExperience(
  options: ResolveBodiesExperienceOptions = {},
): Promise<BodiesExperience> {
  const outcome = await resolveSessionBodyStudio({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const view = await buildBodyStudioView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    ...(options.requestedRoleId !== undefined && options.requestedRoleId.length > 0
      ? { requestedRoleId: options.requestedRoleId }
      : {}),
  });
  return { kind: 'studio', view };
}

/**
 * Resolve the DEMO studio view (`/demo/bodies`): the B006 demo runtime
 * (zero credentials, deterministic corpus, reserved demo tenant) with
 * reads through the canonical read path, rendered under the demo
 * labelling contract. Explicit query state selects the role lens.
 */
export async function resolveDemoBodiesStudioView(
  requestedRoleId?: string,
): Promise<BodyStudioViewModel> {
  const context = await getDemoBodyStudioContext();
  return buildBodyStudioView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    ...(requestedRoleId !== undefined && requestedRoleId.length > 0
      ? { requestedRoleId }
      : {}),
    corpusHash: context.corpusHash,
  });
}

/** What `/bodies/:id` renders: auth-required, an honest failure outcome, or the body detail. */
export type BodyDetailExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly recordId: string }
  | { readonly kind: 'wrong-kind'; readonly recordId: string; readonly kindName: string }
  | { readonly kind: 'unreadable'; readonly recordId: string; readonly message: string }
  | { readonly kind: 'body'; readonly outcome: Extract<BodyDetailOutcome, { status: 'body' }> };

export interface ResolveBodyDetailExperienceOptions {
  readonly recordId: string;
  readonly probe?: NonNullable<Parameters<typeof resolveSessionBodyStudio>[0]>['probe'];
  readonly readModel?: CanonicalReadModel;
  readonly requestedRoleId?: string;
}

/**
 * Resolve the `/bodies/:id` experience: probe the session (fail closed),
 * then resolve the body detail through the canonical read path. Every
 * failure keeps its OWN honest shape — never a fabricated body.
 */
export async function resolveBodyDetailExperience(
  options: ResolveBodyDetailExperienceOptions,
): Promise<BodyDetailExperience> {
  const outcome = await resolveSessionBodyStudio({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const detail = await resolveBodyDetail({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    recordId: options.recordId,
    ...(options.requestedRoleId !== undefined && options.requestedRoleId.length > 0
      ? { requestedRoleId: options.requestedRoleId }
      : {}),
  });
  switch (detail.status) {
    case 'body':
      return { kind: 'body', outcome: detail };
    case 'not-found':
      return { kind: 'not-found', recordId: detail.recordId };
    case 'wrong-kind':
      return { kind: 'wrong-kind', recordId: detail.recordId, kindName: detail.kind };
    case 'unreadable':
      return { kind: 'unreadable', recordId: detail.recordId, message: detail.message };
  }
}

/**
 * Resolve the DEMO body detail (`/demo/bodies/:id`) over the shared B006
 * demo runtime. Explicit query state selects the role lens.
 */
export async function resolveDemoBodyDetailExperience(
  recordId: string,
  requestedRoleId?: string,
): Promise<BodyDetailOutcome> {
  const context = await getDemoBodyStudioContext();
  return resolveBodyDetail({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    recordId,
    ...(requestedRoleId !== undefined && requestedRoleId.length > 0
      ? { requestedRoleId }
      : {}),
    corpusHash: context.corpusHash,
  });
}

// Presentational re-exports so the route mounts import ONE module.
export { BodyStudioView, BodyDetailView };
export {
  BodiesAuthRequiredView,
  BodyNotFoundView,
  BodyWrongKindView,
  BodyUnreadableView,
} from './bodies-mount-views.js';
