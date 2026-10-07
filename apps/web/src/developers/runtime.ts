/**
 * The developers surface runtime (Work Order C017;
 * apps/web/src/developers). SERVER-ONLY surface — the HOST that wires
 * the developer-platform service onto the C001 escalation-api seam
 * (boundary rule B2: services never import each other; the app wires
 * them, exactly like the cockpit/replay host compositions).
 *
 * Two compositions, both through REAL services (never a parallel data
 * model):
 *
 *   SESSION composition — the authenticated `/developers/**`
 *     experience: the B004 session boundary validates FIRST (fail
 *     closed: typed AUTH_* outcomes never produce an anonymous
 *     surface — the cockpit's resolveSessionCockpit composition,
 *     reused read-only). The portal then reads the
 *     DeveloperPlatformService wired over the C001 reference service
 *     on the local-parity fabric. In the local session posture no
 *     client apps are registered yet — the pages render their honest
 *     empty states (register your first client app).
 *
 *   DEMO composition — the deterministic demo corpus over the SAME
 *     real services with the reserved demo tenant, a fixed clock and
 *     sequential secret material: a registered demo client app, live +
 *     sandbox keys (secrets NEVER leave the runtime), one sandbox run
 *     and one live escalation — visibly labelled per the demo
 *     labelling contract. Demo state is never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays
 * untouched (the same posture as apps/web/src/replay and src/cockpit).
 */

import { isDemoTenant, DEMO_TENANT_ID } from '@arena/demo';

import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';

import { EscalationApiService } from '../../../../services/escalation-api/src/index.js';
import { REFERENCE_EXPERTS } from '../../../../services/escalation-api/src/index.js';
import { FixedClock } from '../../../../services/escalation-api/src/index.js';
import { DeveloperPlatformService } from '../../../../services/developer-platform/src/index.js';
import { adaptEscalationApiService } from '../../../../services/developer-platform/src/index.js';
import { InMemoryDeveloperKeyStore } from '../../../../services/developer-platform/src/index.js';
import { constantSandboxCapacity } from '../../../../packages/developer-platform/src/index.js';
import { createNodeSecretHasher } from '../../../../packages/developer-platform/src/index.js';
import type {
  ClientAppRecord,
  DeveloperKeyRecord,
} from '../../../../packages/developer-platform/src/index.js';
import { SANDBOX_SCENARIOS } from '../../../../packages/developer-platform/src/index.js';

import { buildDemoDevelopersCorpus } from './fixtures.js';
import type { DemoDevelopersCorpus } from './fixtures.js';

export type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
  SessionProbe,
} from '../cockpit/runtime.js';

export type { DemoDevelopersCorpus } from './fixtures.js';

// ---------------------------------------------------------------------------
// Session composition (fail closed through the B004 boundary)
// ---------------------------------------------------------------------------

/** Resolve the session developers surface (fail closed; reused cockpit wiring). */
export async function resolveSessionDevelopers(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// The host wiring — DeveloperPlatformService over the C001 reference service
// ---------------------------------------------------------------------------

export interface DevelopersRuntime {
  readonly service: DeveloperPlatformService;
  readonly clock: FixedClock;
}

/** Wire the REAL services: the app host owns the B2 adapter seam. */
export function createDevelopersRuntime(atMs: number): DevelopersRuntime {
  const clock = new FixedClock(atMs);
  const escalation = new EscalationApiService({
    clock,
    directory: {
      listQualifiedExperts: async () => REFERENCE_EXPERTS,
    },
  });
  const service = new DeveloperPlatformService({
    clock,
    store: new InMemoryDeveloperKeyStore(),
    escalation: adaptEscalationApiService({
      createEscalation: (input) => escalation.createEscalation(input as never),
      getEscalationStatus: (params) => escalation.getEscalationStatus(params),
      store: escalation.store,
      outbox: escalation.outbox,
    }),
    capacity: constantSandboxCapacity('AVAILABLE'),
    hasher: createNodeSecretHasher(),
  });
  return { service, clock };
}

// ---------------------------------------------------------------------------
// Demo composition (deterministic corpus; visibly labelled)
// ---------------------------------------------------------------------------

/** The demo developers context: facts + the deterministic corpus + stamp. */
export interface DemoDevelopersContext {
  readonly facts: CockpitSessionFacts;
  readonly corpus: DemoDevelopersCorpus;
}

let demoContext: Promise<DemoDevelopersContext> | undefined;

/** The deterministic demo developers context (module singleton; resettable). */
export function getDemoDevelopersContext(): Promise<DemoDevelopersContext> {
  demoContext ??= (async () => {
    const corpus = await buildDemoDevelopersCorpus();
    return Object.freeze({
      facts: {
        tenantId: DEMO_TENANT_ID,
        workspaceId: 'demo-workspace',
        principalLabel: 'Demo Application Developer',
        grantedRoleIds: [],
      },
      corpus,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo context (test seam; /demo/reset re-seeds the runtime). */
export function resetDemoDevelopersContext(): void {
  demoContext = undefined;
}

export { isDemoTenant, DEMO_TENANT_ID };

// ---------------------------------------------------------------------------
// Session-tenant portal reads (honest empty states in the local posture)
// ---------------------------------------------------------------------------

/** The client apps + keys of the session tenant (possibly empty — never fabricated). */
export async function readSessionClientApps(
  service: DeveloperPlatformService,
  tenantId: string,
): Promise<readonly ClientAppRecord[]> {
  return service.store.listClientApps(tenantId);
}

/** The keys of one client app (wire projections; never secret material). */
export async function readClientAppKeys(
  service: DeveloperPlatformService,
  tenantId: string,
  clientAppId: string,
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await service.listKeys({ tenantId, clientAppId });
  } catch {
    // Unknown client app — the honest empty list (fail closed upstream).
    return [];
  }
}

/** The sandbox scenario catalogue (the console's canned runs). */
export function sandboxScenarioCatalogue(): readonly (typeof SANDBOX_SCENARIOS)[number][] {
  return SANDBOX_SCENARIOS;
}

/** Convenience re-export for view models (typed key record access). */
export type { DeveloperKeyRecord };
