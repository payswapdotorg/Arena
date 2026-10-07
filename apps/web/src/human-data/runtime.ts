/**
 * The human-data studio runtime (Work Order C012; apps/web/src/human-data).
 * SERVER-ONLY surface — the HOST that wires the human-data reference
 * service onto its injected ports (boundary rule B2: services never import
 * each other; the app wires them, exactly like the developers/cockpit host
 * compositions).
 *
 * SESSION composition — the authenticated `/human-data/**` experience: the
 * B004 session boundary validates FIRST (fail closed: typed AUTH_* outcomes
 * never produce an anonymous surface — the cockpit's resolveSessionCockpit
 * composition, reused read-only). In the local session posture no
 * commissions exist yet — the pages render their honest empty states.
 *
 * DEMO composition — the deterministic demo corpus (fixtures.ts) over the
 * SAME real service + reference fabric with a fixed clock: a delivered
 * correction-pairs dataset and an in-production demonstrations commission,
 * visibly labelled per the demo labelling contract. Demo state is never
 * customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/developers, src/replay and src/cockpit).
 */

import { isDemoTenant, DEMO_TENANT_ID } from '@arena/demo';

import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';

import { HumanDataService } from '../../../../services/human-data/src/index.js';
import { createHumanDataReferenceFabric } from '../../../../services/human-data/src/index.js';
import type { HumanDataReferenceFabric } from '../../../../services/human-data/src/index.js';

import { buildDemoHumanDataCorpus } from './fixtures.js';
import type { DemoHumanDataCorpus } from './fixtures.js';

export type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
  SessionProbe,
} from '../cockpit/runtime.js';

export type { DemoHumanDataCorpus } from './fixtures.js';

// ---------------------------------------------------------------------------
// Session composition (fail closed through the B004 boundary)
// ---------------------------------------------------------------------------

/** Resolve the session human-data surface (fail closed; reused cockpit wiring). */
export async function resolveSessionHumanData(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// The host wiring — HumanDataService over the reference fabric
// ---------------------------------------------------------------------------

export interface HumanDataRuntime {
  readonly service: HumanDataService;
  readonly fabric: HumanDataReferenceFabric;
}

/** Wire the REAL service over the reference fabric (the app host owns the seams). */
export function createHumanDataRuntime(atMs: number): HumanDataRuntime {
  const fabric = createHumanDataReferenceFabric(atMs);
  const service = new HumanDataService({
    clock: fabric.clock,
    store: fabric.store,
    escalations: fabric.escalations,
    sources: fabric.sources,
    events: fabric.events,
  });
  return { service, fabric };
}

// ---------------------------------------------------------------------------
// Demo composition (deterministic corpus; visibly labelled)
// ---------------------------------------------------------------------------

/** The demo human-data context: facts + the deterministic corpus. */
export interface DemoHumanDataContext {
  readonly facts: CockpitSessionFacts;
  readonly corpus: DemoHumanDataCorpus;
}

let demoContext: Promise<DemoHumanDataContext> | undefined;

/** The deterministic demo human-data context (module singleton; resettable). */
export function getDemoHumanDataContext(): Promise<DemoHumanDataContext> {
  demoContext ??= (async () => {
    const corpus = await buildDemoHumanDataCorpus();
    return Object.freeze({
      facts: {
        tenantId: DEMO_TENANT_ID,
        workspaceId: 'demo-workspace',
        principalLabel: 'Demo Data Commissioner',
        grantedRoleIds: [],
      },
      corpus,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo context (test seam; /demo/reset re-seeds the runtime). */
export function resetDemoHumanDataContext(): void {
  demoContext = undefined;
}

export { isDemoTenant, DEMO_TENANT_ID };
