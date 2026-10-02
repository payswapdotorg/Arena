/**
 * Operations runtime composition (Work Order B014;
 * apps/web/src/operations). SERVER-ONLY surface.
 *
 * Two compositions feed the operations surface, both reading THROUGH
 * versioned boundaries — never a second data model, never a parallel
 * demo API (the B007 cockpit / B012 evaluation posture):
 *
 *   SESSION composition — the authenticated `/operations` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous surface);
 *     2. the tenant/workspace facts come from the VALIDATED session's
 *        B003 workspace context (tenant from the session, never the
 *        client);
 *     3. jobs / SLO / audit data is read server-side through the PUBLIC
 *        APIs of the sibling protocol packages (`@arena/job-protocol`
 *        A015, `@arena/observability` A035, `@arena/security` A034 —
 *        relative imports, the expert-runtime posture). In the local
 *        session posture no jobs/audit records exist and no telemetry is
 *        recorded, so those sections render their honest empty states —
 *        the SLO board runs the REAL evaluator over zero samples (the
 *        A035 no-data fail-closed verdict), and nothing is fabricated;
 *     4. capacity/quota postures come from the B002 hosted-adapter
 *        layer's health/capacity contracts (`@arena/persistence` public
 *        ports — never by instantiating a provider client): the hosted
 *        adapters are not wired in the local posture (B015/B016 wire
 *        them through the same CapacityProbe port), so every provider
 *        reads DISABLED with reason `configuration-missing` — the
 *        contract's own fail-closed unwired posture.
 *
 *   DEMO composition — the B006 demo posture (`/demo/operations`): the
 *     shared demo runtime (zero credentials, deterministic corpus,
 *     reserved demo tenant) with the deterministic B014 protocol corpus
 *     (REAL A015/A035/A034/B002 objects built through the packages'
 *     public factories), visibly labelled per the demo labelling
 *     contract. Demo state is never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched.
 */

import { isDemoTenant } from '@arena/demo';
import { resolveSessionCockpit, getDemoCockpitContext } from '../cockpit/runtime.js';
import type {
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';
import { buildOperationsDemoCorpus } from './fixtures.js';
import type { OperationsDemoCorpus } from './fixtures.js';

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
 * Resolve the session operations surface: the browser session is probed
 * FIRST (fail closed — typed AUTH_* outcomes never produce an anonymous
 * surface), then the session facts are exposed. This is the cockpit's
 * `resolveSessionCockpit` composition, reused read-only: one session
 * wiring, every studio.
 */
export async function resolveSessionOperations(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; deterministic corpus)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_OPERATIONS_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo operations context: facts + the deterministic protocol corpus + determinism stamp. */
export interface DemoOperationsContext {
  readonly facts: CockpitSessionFacts;
  readonly corpus: OperationsDemoCorpus;
  readonly corpusHash: string;
}

let demoContext: Promise<DemoOperationsContext> | undefined;

/**
 * The demo operations context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset) plus the
 * deterministic B014 protocol corpus. The corpus is rebuilt per
 * composition (pure factories, so two compositions are byte-identical —
 * tested); reads for the cockpit facts go through the canonical demo
 * posture, scoped to the reserved demo tenant.
 */
export function getDemoOperationsContext(): Promise<DemoOperationsContext> {
  demoContext ??= (async () => {
    const cockpit = await getDemoCockpitContext();
    if (!isDemoTenant(cockpit.facts.tenantId)) {
      throw new Error('demo operations context requires the reserved demo tenant (fail closed)');
    }
    const corpus = await buildOperationsDemoCorpus();
    return Object.freeze({
      facts: cockpit.facts,
      corpus,
      corpusHash: cockpit.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo operations context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoOperationsContext(): void {
  demoContext = undefined;
}
