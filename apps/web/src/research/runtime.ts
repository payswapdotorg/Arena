/**
 * Research/benchmark runtime composition (Work Order B012; issue #87;
 * apps/web/src/research). SERVER-ONLY surface.
 *
 * The same two compositions as the evaluation surface (B012 sibling):
 *
 *   SESSION composition — the authenticated `/research` experience: the
 *     B004 session boundary validates FIRST (fail closed), the facts
 *     come from the validated session's B003 workspace context, and the
 *     benchmark/dataset data is read server-side through the PUBLIC APIs
 *     of packages/datasets (and the B012 evaluation corpus for the
 *     evidence chains). In the local session posture no benchmark runs
 *     are recorded yet — honest empty states, nothing fabricated.
 *
 *   DEMO composition — the B006 demo posture (`/demo/research`): the
 *     shared demo runtime plus the deterministic B012 research corpus
 *     (REAL A014 dataset manifests with lineage; composition-scoped
 *     benchmark runs whose evidence chain binds the REAL A012/A013/A023
 *     digests), visibly labelled per the demo labelling contract.
 *
 * Workspace imports are RELATIVE because apps/web's package manifest is
 * B001-owned and stays untouched.
 */

import { isDemoTenant } from '@arena/demo';
import { resolveSessionCockpit } from '../cockpit/runtime.js';
import type {
  ResolveSessionCockpitOptions,
  SessionCockpitOutcome,
} from '../cockpit/runtime.js';
import { getDemoCockpitContext } from '../cockpit/runtime.js';
import { buildEvaluationDemoCorpus } from '../evaluation/fixtures.js';
import type { EvaluationDemoCorpus } from '../evaluation/fixtures.js';
import { buildResearchDemoCorpus } from './fixtures.js';
import type { ResearchDemoCorpus } from './fixtures.js';

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
 * Resolve the session research surface: the browser session is probed
 * FIRST (fail closed — typed AUTH_* outcomes never produce an anonymous
 * surface). The cockpit's `resolveSessionCockpit` composition, reused
 * read-only.
 */
export async function resolveSessionResearch(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
  return resolveSessionCockpit(options);
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; deterministic research corpus)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_RESEARCH_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo research context: facts + the deterministic research corpus + determinism stamps. */
export interface DemoResearchContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly corpus: ResearchDemoCorpus;
  readonly corpusHash: string;
  readonly evaluationCorpusHash: string;
}

let demoContext: Promise<DemoResearchContext> | undefined;

/**
 * The demo research context over the SHARED B006 demo runtime plus the
 * deterministic B012 research corpus (module singleton — deterministic,
 * resettable through /demo/reset).
 */
export function getDemoResearchContext(): Promise<DemoResearchContext> {
  demoContext ??= (async () => {
    const cockpit = await getDemoCockpitContext();
    if (!isDemoTenant(cockpit.facts.tenantId)) {
      throw new Error('demo research context requires the reserved demo tenant (fail closed)');
    }
    const evaluationCorpus: EvaluationDemoCorpus = await buildEvaluationDemoCorpus();
    const corpus = await buildResearchDemoCorpus(evaluationCorpus);
    return Object.freeze({
      tenantId: cockpit.facts.tenantId,
      workspaceId: cockpit.facts.workspaceId,
      principalLabel: cockpit.facts.principalLabel,
      corpus,
      corpusHash: corpus.corpusHash,
      evaluationCorpusHash: evaluationCorpus.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo research context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoResearchContext(): void {
  demoContext = undefined;
}
