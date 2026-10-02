/**
 * Research-route composition (Work Order B012; issue #87;
 * apps/web/src/research). SERVER-ONLY.
 *
 * Mirrors the B007/B010/B012-evaluation route patterns: `/research`
 * probes the browser session FIRST (fail closed — an unauthenticated
 * visitor gets the auth-required notice, NEVER an anonymous research
 * surface), and `/demo/research` composes over the shared B006 demo
 * runtime with the deterministic B012 research corpus under the demo
 * labelling contract.
 *
 * The A030 posture rides every view: benchmark statements are
 * composition-scoped (never about the model alone), scores are
 * evaluation results (their own truth class), and dataset lineage is
 * evidence. The session posture's empty sections are HONEST.
 */

import { buildBenchmarkComparison } from './research-view-model.js';
import type {
  BenchmarkComparisonView,
  BenchmarkRunView,
  DatasetLineageView,
} from './research-view-model.js';
import { toDatasetLineageView } from './research-view-model.js';
import { buildResearchDemoCorpus } from './fixtures.js';
import type { ResearchDemoCorpus } from './fixtures.js';
import { RESEARCH_COMPOSITION_SCOPE_NOTE, truthClassLegend } from '../evaluation/state-mark.js';
import type { TruthClassMark } from '../evaluation/state-mark.js';
import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';
import { buildEvaluationDemoCorpus } from '../evaluation/fixtures.js';
import {
  getDemoResearchContext,
  resolveSessionResearch,
} from './runtime.js';
import type { CockpitSessionFacts } from './runtime.js';

// ---------------------------------------------------------------------------
// The /research home view model
// ---------------------------------------------------------------------------

/** The complete `/research` view model. */
export interface ResearchHomeViewModel {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  /** The benchmark runs (composition-scoped, evidence-chained). */
  readonly runs: readonly BenchmarkRunView[];
  /** The comparison table over the runs. */
  readonly comparison: BenchmarkComparisonView;
  /** The dataset lineage view (content-addressed manifests + parent edges). */
  readonly lineage: DatasetLineageView;
  /** The persistent composition-scope note (the A030 posture). */
  readonly distinctionNote: string;
  /** The truth-class legend (the teaching UI). */
  readonly legend: readonly TruthClassMark[];
  /** Sections with no data — honest empty states. */
  readonly emptySections: readonly string[];
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

/** What `/research` renders: the auth-required notice, or the research home. */
export type ResearchExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'home'; readonly view: ResearchHomeViewModel };

export interface ResolveResearchExperienceOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionResearch>[0]>['probe'];
  /** Read-model override (composition seam); default: local-parity fake-backed service. */
  readonly readModel?: CanonicalReadModel;
}

/** Build the demo research home view model (the deterministic posture). */
async function buildDemoResearchHome(): Promise<ResearchHomeViewModel> {
  const context = await getDemoResearchContext();
  const corpus: ResearchDemoCorpus = context.corpus;
  return Object.freeze({
    mode: 'demo',
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    principalLabel: context.principalLabel,
    runs: corpus.benchmarkRuns,
    comparison: corpus.comparison,
    lineage: corpus.lineage,
    distinctionNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
    legend: truthClassLegend(),
    emptySections: Object.freeze([]),
    demo: Object.freeze({
      isDemo: true,
      ...(context.corpusHash !== undefined ? { corpusHash: context.corpusHash } : {}),
    }),
  } satisfies ResearchHomeViewModel);
}

/**
 * Resolve the `/research` experience: probe the browser session (fail
 * closed — typed AUTH_* outcomes render the auth-required notice, never
 * an anonymous surface), then build the home view. In the local session
 * posture no benchmark runs or published datasets are recorded — the
 * honest empty states, nothing fabricated.
 */
export async function resolveResearchExperience(
  options: ResolveResearchExperienceOptions = {},
): Promise<ResearchExperience> {
  const outcome = await resolveSessionResearch({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  const facts: CockpitSessionFacts = outcome.facts;
  return {
    kind: 'home',
    view: Object.freeze({
      mode: 'session',
      tenantId: facts.tenantId,
      workspaceId: facts.workspaceId,
      principalLabel: facts.principalLabel,
      runs: Object.freeze([]),
      comparison: buildBenchmarkComparison([]),
      lineage: toDatasetLineageView([]),
      distinctionNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
      legend: truthClassLegend(),
      emptySections: Object.freeze([
        'benchmark runs',
        'dataset lineage',
      ]),
      demo: Object.freeze({ isDemo: false }),
    } satisfies ResearchHomeViewModel),
  };
}

/** Resolve the DEMO `/demo/research` home view (B006 posture, deterministic). */
export async function resolveDemoResearchHome(): Promise<ResearchHomeViewModel> {
  return buildDemoResearchHome();
}

/** The deterministic research corpus (composed once per process for demo routes). */
let researchCorpusSingleton: Promise<ResearchDemoCorpus> | undefined;

/** The deterministic research corpus over a fresh evaluation corpus (test seam + demo detail routes). */
export async function buildFreshResearchCorpus(): Promise<ResearchDemoCorpus> {
  const evaluation = await buildEvaluationDemoCorpus();
  return buildResearchDemoCorpus(evaluation);
}

/** The process-shared deterministic research corpus. */
export function demoResearchCorpus(): Promise<ResearchDemoCorpus> {
  researchCorpusSingleton ??= buildFreshResearchCorpus();
  return researchCorpusSingleton;
}

/** Hard reset of the corpus singleton (test seam). */
export function resetDemoResearchCorpusSingleton(): void {
  researchCorpusSingleton = undefined;
}
