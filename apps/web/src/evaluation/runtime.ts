/**
 * Evaluation/verification/certification runtime composition (Work Order
 * B012; issue #87; apps/web/src/evaluation). SERVER-ONLY surface.
 *
 * Two compositions feed the evaluation surface, both reading THROUGH
 * versioned boundaries — never a second data model, never a parallel
 * demo API (the B007 cockpit / B009 expert / B010 bodies posture):
 *
 *   SESSION composition — the authenticated `/evaluation` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous surface);
 *     2. the tenant/workspace facts come from the VALIDATED session's
 *        B003 workspace context (tenant from the session, never the
 *        client);
 *     3. canonical RENDER reads (the certification claims) go through
 *        the B005 read-API boundary (`ReadApiService.handleReadRequest`);
 *     4. evaluation/verification/certification PROTOCOL data is read
 *        server-side through the PUBLIC APIs of packages/evaluation,
 *        packages/verification and packages/certification. In the local
 *        session posture no evaluation runs are recorded yet, so those
 *        sections render their honest empty states — nothing is
 *        fabricated (the hosted control plane wires real runs through
 *        the same seams in the deployment work orders).
 *
 *   DEMO composition — the B006 demo posture (`/demo/evaluation`): the
 *     shared demo runtime (zero credentials, deterministic corpus,
 *     reserved demo tenant) with claims read through the SAME canonical
 *     read path, plus the deterministic B012 protocol corpus (REAL A012/
 *     A013/A023 objects built through the packages' public factories),
 *     visibly labelled per the demo labelling contract. Demo state is
 *     never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched.
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
import { buildEvaluationDemoCorpus } from './fixtures.js';
import type { EvaluationDemoCorpus } from './fixtures.js';

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
 * Resolve the session evaluation surface: the browser session is probed
 * FIRST (fail closed — typed AUTH_* outcomes never produce an anonymous
 * surface), then the session facts + read port are exposed through the
 * B005 read-API boundary. This is the cockpit's `resolveSessionCockpit`
 * composition, reused read-only: one session wiring, every studio.
 */
export async function resolveSessionEvaluation(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; deterministic corpus)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_EVALUATION_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo evaluation context: facts + reads + the deterministic protocol corpus + determinism stamp. */
export interface DemoEvaluationContext {
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly corpus: EvaluationDemoCorpus;
  readonly corpusHash: string;
}

let demoContext: Promise<DemoEvaluationContext> | undefined;

/**
 * The demo evaluation context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset) plus the
 * deterministic B012 protocol corpus. Claims read through the canonical
 * read path over the demo corpus, scoped to the reserved demo tenant;
 * the protocol corpus is rebuilt per composition (pure factories, so
 * two compositions are byte-identical — tested).
 */
export function getDemoEvaluationContext(): Promise<DemoEvaluationContext> {
  demoContext ??= (async () => {
    const cockpit = await getDemoCockpitContext();
    if (!isDemoTenant(cockpit.facts.tenantId)) {
      throw new Error('demo evaluation context requires the reserved demo tenant (fail closed)');
    }
    const corpus = await buildEvaluationDemoCorpus();
    return Object.freeze({
      facts: cockpit.facts,
      port: cockpit.port,
      corpus,
      corpusHash: cockpit.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo evaluation context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoEvaluationContext(): void {
  demoContext = undefined;
}
