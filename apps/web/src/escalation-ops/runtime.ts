/**
 * Escalation-ops runtime (Work Order C021; apps/web/src/escalation-ops).
 * SERVER-ONLY surface — the HOST that wires the escalation-observability
 * reference service onto its injected ports (boundary rule B2: services
 * never import each other; the app wires them — the human-data/
 * developers host composition pattern).
 *
 * SESSION composition — the authenticated `/escalation-ops` experience:
 * the B004 session boundary validates FIRST (fail closed: typed AUTH_*
 * outcomes never produce an anonymous surface — the cockpit's
 * resolveSessionCockpit composition, reused read-only). In the local
 * session posture no escalation projections exist yet — the page
 * renders its honest empty states.
 *
 * DEMO composition — the deterministic corpus (fixtures.ts) over the
 * SAME real service with a fixed clock, visibly labelled per the demo
 * labelling contract. Demo state is never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/developers, src/human-data).
 */

import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';

import {
  DEMO_MATERIALIZATION_KEY,
  ESCALATION_OPS_DEMO_TENANT,
  buildDemoEscalationOpsRuntime,
} from './fixtures.js';

export type {
  CockpitReadPort,
  CockpitSessionFacts,
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
  SessionProbe,
} from '../cockpit/runtime.js';

/** Resolve the session escalation-ops surface (fail closed through the B004 boundary). */
export async function resolveSessionEscalationOps(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// The host wiring — EscalationObservabilityService over the reference fabric
// ---------------------------------------------------------------------------

export interface DemoEscalationOpsContext {
  readonly tenant: string;
  readonly service: ReturnType<typeof buildDemoEscalationOpsRuntime>['service'];
  readonly at: string;
  readonly materialized: boolean;
}

let demoContext: DemoEscalationOpsContext | null = null;

/** The deterministic demo escalation-ops context (fixed clock, labelled). */
export async function getDemoEscalationOpsContext(): Promise<DemoEscalationOpsContext> {
  if (demoContext === null) {
    const { service, at } = buildDemoEscalationOpsRuntime();
    await service.materializeTenantProjections(
      { tenant: ESCALATION_OPS_DEMO_TENANT },
      { correlationId: 'demo-escalation-ops', idempotencyKey: DEMO_MATERIALIZATION_KEY, at },
    );
    demoContext = {
      tenant: ESCALATION_OPS_DEMO_TENANT,
      service,
      at,
      materialized: true,
    };
  }
  return demoContext;
}

/** Reset the demo context (tests). */
export function resetDemoEscalationOpsContext(): void {
  demoContext = null;
}
