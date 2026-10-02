/**
 * B017 product-E2E driver — boot the web app in LOCAL/DEMO mode at the
 * composition layer (Work Order B017; tests/product-e2e).
 *
 * "Booting the app in demo mode" here means exactly what the /demo/*
 * route mounts do: the shared B006 demo runtime (zero-credential local
 * auth stack, deterministic frozen corpus, reserved `arena-demo`
 * tenant, ManualClock at the narrative epoch), the per-surface demo
 * contexts composed over it, and the canonical read path (B005) +
 * product-flows runtime (B008) over the demo store's own B002
 * repository port. Every layer is the REAL product code; only the
 * Next.js HTTP transport is replaced by in-process calls — the
 * served-app HTTP layer is covered separately (served-walk.test.ts).
 *
 * Determinism: the corpus is the frozen B006 seed; the boot asserts the
 * corpus hash matches the frozen constant, so any drift fails here
 * instead of deep inside a scenario. Cleanup: `resetDemoApp()` drops
 * every demo singleton + the runtime itself (the tests/product
 * equivalent of POST /demo/reset plus a process-fresh reseed).
 */

import {
  DEMO_TENANT_ID,
  computeDemoCorpusHash,
  demoCorpusHashSummary,
} from '../../../packages/demo/src/index.js';
import { getDemoRuntime, resetDemoRuntime } from '../../../apps/web/src/demo/runtime.js';
import { getDemoCockpitContext, resetDemoCockpitContext } from '../../../apps/web/src/cockpit/runtime.js';
import type { CockpitReadPort, CockpitSessionFacts } from '../../../apps/web/src/cockpit/runtime.js';
import {
  getDemoCapabilityContext,
  resetDemoCapabilityContext,
} from '../../../apps/web/src/capability/runtime.js';
import type { CapabilityFlowRuntime } from '../../../apps/web/src/capability/runtime.js';
import { resetDemoEvaluationContext } from '../../../apps/web/src/evaluation/runtime.js';
import { resetDemoResearchContext } from '../../../apps/web/src/research/runtime.js';
import { resetDemoBodyStudioContext } from '../../../apps/web/src/bodies/runtime.js';
import { resetDemoOperationsContext } from '../../../apps/web/src/operations/runtime.js';

/** The expected corpus-hash summary of the frozen B006 demo corpus. */
export const EXPECTED_DEMO_CORPUS_HASH_SUMMARY: string = demoCorpusHashSummary(
  computeDemoCorpusHash(),
);

/**
 * The four reference roles the role-switch simulation projects through
 * (B017 brief: Owner, Expert, Builder, Researcher). The B003 lens
 * registry also carries `operator`; these four are the product
 * walkthrough set.
 */
export const FOUR_REFERENCE_ROLES = Object.freeze([
  'owner',
  'expert',
  'agent-builder',
  'researcher',
] as const);

export type FourReferenceRole = (typeof FOUR_REFERENCE_ROLES)[number];

/** Drop every demo singleton + the shared demo runtime (total demo reset). */
export function resetDemoApp(): void {
  resetDemoCockpitContext();
  resetDemoCapabilityContext();
  resetDemoEvaluationContext();
  resetDemoResearchContext();
  resetDemoBodyStudioContext();
  resetDemoOperationsContext();
  resetDemoRuntime();
}

/** The composed demo app handle (the seam the /demo route mounts use). */
export interface DemoAppBoot {
  /** The demo session tenant (always the reserved demo tenant). */
  readonly tenantId: typeof DEMO_TENANT_ID;
  /** The demo session facts (identity -> workspace -> granted roles). */
  readonly facts: CockpitSessionFacts;
  /** Canonical reads through the B005 read path (B006 demo session). */
  readonly port: CockpitReadPort;
  /** The guided-flow runtime over the demo store's B002 port (B008). */
  readonly flow: CapabilityFlowRuntime;
  /** The corpus hash of the seeded demo state (determinism stamp). */
  readonly corpusHash: string;
  /** The corpus-hash summary (the B016 seed report's digest form). */
  readonly corpusHashSummary: string;
}

/**
 * Boot the demo app: total reset, then the shared runtime + capability
 * context (the exact composition `/demo/*` uses). Fails closed when the
 * tenant or corpus hash drifts from the frozen contract.
 */
export async function bootDemoApp(): Promise<DemoAppBoot> {
  resetDemoApp();
  const runtime = await getDemoRuntime();
  const summary = demoCorpusHashSummary(runtime.corpusHash);
  if (runtime.session.tenantId !== DEMO_TENANT_ID) {
    throw new Error(
      `demo runtime tenant drift: ${JSON.stringify(runtime.session.tenantId)} (expected ${DEMO_TENANT_ID})`,
    );
  }
  if (summary !== EXPECTED_DEMO_CORPUS_HASH_SUMMARY) {
    throw new Error(
      `demo corpus hash drift: ${summary} (expected ${EXPECTED_DEMO_CORPUS_HASH_SUMMARY})`,
    );
  }
  const context = await getDemoCapabilityContext();
  return Object.freeze({
    tenantId: DEMO_TENANT_ID,
    facts: context.facts,
    port: context.port,
    flow: context.flow,
    corpusHash: runtime.corpusHash,
    corpusHashSummary: summary,
  });
}
