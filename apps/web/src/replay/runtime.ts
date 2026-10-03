/**
 * Replay viewer runtime composition (Work Order B011; issue #86;
 * apps/web/src/replay). SERVER-ONLY surface.
 *
 * Two compositions feed the replay viewer, both reading THROUGH
 * versioned boundaries — never a second data model, never a parallel
 * demo API (the B007 cockpit / B012 evaluation posture):
 *
 *   SESSION composition — the authenticated `/replay` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous surface);
 *     2. the tenant/workspace facts come from the VALIDATED session's
 *        B003 workspace context (tenant from the session, never the
 *        client);
 *     3. canonical RENDER reads go through the B005 read-API boundary
 *        (`ReadApiService.handleReadRequest`);
 *     4. trajectory/environment/evaluation/verification PROTOCOL data
 *        is read server-side through the PUBLIC APIs of
 *        packages/trajectory, packages/environment-runtime,
 *        packages/evaluation and packages/verification. In the local
 *        session posture no runs are recorded yet, so the run list
 *        renders its honest empty state — nothing is fabricated (the
 *        hosted control plane wires real runs through the same seams in
 *        the deployment work orders).
 *
 *   DEMO composition — the B006 demo posture (`/demo/replay`): the
 *     shared demo runtime (zero credentials, deterministic corpus,
 *     reserved demo tenant) with reads through the SAME canonical read
 *     path, plus the deterministic B011 replay corpus (REAL A011/A010/
 *     A012/A013 objects built through the packages' public factories),
 *     visibly labelled per the demo labelling contract. Demo state is
 *     never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/cockpit and apps/web/src/evaluation).
 */

import { isDemoTenant } from '@arena/demo';
import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';
import { getDemoCockpitContext } from '../cockpit/runtime.js';
import { buildReplayDemoCorpus } from '../../../../packages/replay-ui/src/index.js';
import type { ReplayDemoCorpus } from '../../../../packages/replay-ui/src/index.js';

export type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
  SessionProbe,
} from '../cockpit/runtime.js';

// ---------------------------------------------------------------------------
// Session composition (fail closed through the B004 boundary)
// ---------------------------------------------------------------------------

/**
 * Resolve the session replay surface: the browser session is probed
 * FIRST (fail closed — typed AUTH_* outcomes never produce an anonymous
 * surface), then the session facts + read port are exposed through the
 * B005 read-API boundary. This is the cockpit's `resolveSessionCockpit`
 * composition, reused read-only: one session wiring, every studio.
 */
export async function resolveSessionReplay(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; deterministic corpus)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_REPLAY_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo replay context: facts + reads + the deterministic replay corpus + determinism stamp. */
export interface DemoReplayContext {
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly corpus: ReplayDemoCorpus;
  readonly corpusHash: string;
}

let demoContext: Promise<DemoReplayContext> | undefined;

/**
 * The demo replay context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset) plus the
 * deterministic B011 replay corpus. The corpus is rebuilt per
 * composition (pure factories, so two compositions are byte-identical —
 * tested in packages/replay-ui).
 */
export function getDemoReplayContext(): Promise<DemoReplayContext> {
  demoContext ??= (async () => {
    const cockpit = await getDemoCockpitContext();
    if (!isDemoTenant(cockpit.facts.tenantId)) {
      throw new Error('demo replay context requires the reserved demo tenant (fail closed)');
    }
    const corpus = await buildReplayDemoCorpus();
    return Object.freeze({
      facts: cockpit.facts,
      port: cockpit.port,
      corpus,
      corpusHash: cockpit.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo replay context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoReplayContext(): void {
  demoContext = undefined;
}
