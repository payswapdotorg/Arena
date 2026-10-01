/**
 * Home-route composition (Work Order B007; issue #78; apps/web/src/cockpit).
 * SERVER-ONLY.
 *
 * `/` is the authenticated capability cockpit (UXM1.0 §Core routes) and
 * the first-run landing for everyone else: the session is probed FIRST
 * (fail closed); an unauthenticated visitor gets the B001 Level 0 landing
 * — NEVER an anonymous cockpit. The authenticated visitor gets the
 * cockpit for their active role lens, read through the B005 boundary.
 */

import { buildCockpitHomeView } from './cockpit-view.js';
import type { CockpitHomeViewModel } from './cockpit-view.js';
import {
  getDemoCockpitContext,
  resolveSessionCockpit,
} from './runtime.js';
import type { SessionProbe } from './runtime.js';
import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';

/** What `/` renders: the first-run landing, or the authenticated cockpit. */
export type HomeExperience =
  | { readonly kind: 'landing' }
  | { readonly kind: 'cockpit'; readonly view: CockpitHomeViewModel };

export interface ResolveHomeExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  /** Explicit query-state role request (`?role=`). */
  readonly requestedRoleId?: string;
}

/**
 * Resolve the home experience: probe the browser session (fail closed —
 * typed AUTH_* outcomes render the landing, never an anonymous cockpit),
 * then build the cockpit view for the validated session's granted roles.
 */
export async function resolveHomeExperience(
  options: ResolveHomeExperienceOptions = {},
): Promise<HomeExperience> {
  const outcome = await resolveSessionCockpit({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'landing' };
  }
  const view = await buildCockpitHomeView({
    mode: 'session',
    facts: outcome.facts,
    port: outcome.port,
    ...(options.requestedRoleId !== undefined
      ? { requestedRoleId: options.requestedRoleId }
      : {}),
  });
  return { kind: 'cockpit', view };
}

/**
 * Resolve the DEMO cockpit view (`/demo/cockpit`): the B006 demo runtime
 * (zero credentials, deterministic corpus, reserved demo tenant) with
 * reads through the canonical read path, rendered under the demo
 * labelling contract. Explicit query state selects the role lens.
 */
export async function resolveDemoCockpitView(
  requestedRoleId?: string,
): Promise<CockpitHomeViewModel> {
  const context = await getDemoCockpitContext();
  return buildCockpitHomeView({
    mode: 'demo',
    facts: context.facts,
    port: context.port,
    ...(requestedRoleId !== undefined ? { requestedRoleId } : {}),
    corpusHash: context.corpusHash,
  });
}
