/**
 * The deterministic B012 research/benchmark corpus (Work Order B012;
 * issue #87; apps/web/src/research).
 *
 * PURE, DETERMINISTIC fixtures: the datasets are REAL A014 objects built
 * through the PUBLIC API of packages/datasets (content-addressed
 * `DatasetManifest`s with a lineage-recorded derivation — relative
 * imports), and the benchmark runs carry the A030 posture as view models
 * whose evidence chain points at the REAL A012/A013/A023 digests of the
 * B012 evaluation corpus. No randomness, no wall clock — two
 * constructions are byte-identical (tested), so the demo research
 * surface stays deterministic, resettable and visibly labelled.
 */

import { canonicalJson } from '@arena/protocol-core';
import { createMaterialArtifact } from '../../../../packages/artifact-protocol/src/index.js';
import {
  createDatasetManifest,
  deriveDatasetManifest,
} from '../../../../packages/datasets/src/index.js';
import type { DatasetManifest } from '../../../../packages/datasets/src/index.js';
import { EVALUATION_DEMO_TIME } from '../evaluation/fixtures.js';
import type { EvaluationDemoCorpus } from '../evaluation/fixtures.js';
import { RESEARCH_COMPOSITION_SCOPE_NOTE } from '../evaluation/state-mark.js';
import { buildBenchmarkComparison } from './research-view-model.js';
import type {
  BenchmarkComparisonView,
  BenchmarkRunView,
  DatasetLineageView,
} from './research-view-model.js';
import { toDatasetLineageView } from './research-view-model.js';

/** Stable route ids for the demo research surface. */
export const RESEARCH_DEMO_IDS = Object.freeze({
  benchmarkRun1: 'demo.research.benchmark.run-1',
  benchmarkRun2: 'demo.research.benchmark.run-2',
  datasetParent: 'demo.research.dataset.payments-reliability',
  datasetChild: 'demo.research.dataset.payments-reliability-holdout',
} as const);

/** The demo benchmark identity (the A030 posture: published, versioned, methodology-pinned). */
const DEMO_BENCHMARK = Object.freeze({
  benchmarkId: 'benchmark-payments-reliability',
  version: '1.0.0',
  status: 'published' as const,
  methodology: Object.freeze({ aggregation: 'weighted-sum', passAt: 0.75 }),
});

/** The demo dataset rights declaration. */
const DEMO_RIGHTS = Object.freeze({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
});

/** The deterministic research demo corpus. */
export interface ResearchDemoCorpus {
  /** The REAL A014 parent dataset manifest (the benchmark corpus). */
  readonly datasetParent: DatasetManifest;
  /** The REAL A014 derived child manifest (lineage-recorded holdout split). */
  readonly datasetChild: DatasetManifest;
  /** The composition-scoped benchmark runs (run 1 superseded by run 2). */
  readonly benchmarkRuns: readonly BenchmarkRunView[];
  /** The comparison table over the runs. */
  readonly comparison: BenchmarkComparisonView;
  /** The dataset lineage view over both manifests. */
  readonly lineage: DatasetLineageView;
  /** Canonical-JSON determinism stamp over the ordered corpus digests + ids. */
  readonly corpusHash: string;
}

/** Ref view of a material artifact (identity + digest), for manifest entries. */
function refOf(artifact: {
  readonly identity: { readonly namespace: string; readonly name: string; readonly version: string };
  readonly digest: string;
}): { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string } {
  return Object.freeze({
    namespace: artifact.identity.namespace,
    name: artifact.identity.name,
    version: artifact.identity.version,
    digest: artifact.digest,
  });
}

/**
 * Build the deterministic research demo corpus over the B012 evaluation
 * corpus (the benchmark's evidence chain binds the REAL A012/A013/A023
 * digests). PURE: identical calls yield identical objects.
 */
export async function buildResearchDemoCorpus(
  evaluation: EvaluationDemoCorpus,
): Promise<ResearchDemoCorpus> {
  const { t1, t2, t3 } = EVALUATION_DEMO_TIME;

  // 1) REAL content-addressed artifacts for the benchmark dataset entries.
  const corpusArtifact = await createMaterialArtifact({
    identity: { namespace: 'arena-demo', name: 'benchmark-corpus', version: '1.0.0' },
    refs: [],
    content: {
      kind: 'benchmark-corpus',
      note: 'Payments-reliability scenarios: reproduce the flaky refund timeout under load.',
      scenarios: 12,
    },
  });
  const evalSplitArtifact = await createMaterialArtifact({
    identity: { namespace: 'arena-demo', name: 'benchmark-eval-split', version: '1.0.0' },
    refs: [refOf(corpusArtifact)],
    content: {
      kind: 'benchmark-split',
      note: 'The evaluation split (fixed seed) of the payments-reliability corpus.',
      scenarios: 9,
    },
  });

  // 2) The parent dataset manifest (the published benchmark corpus).
  const datasetParent = await createDatasetManifest({
    identity: {
      namespace: 'arena-demo',
      name: 'payments-reliability-benchmark',
      version: '1.0.0',
    },
    entries: [
      { role: 'input', artifact: refOf(corpusArtifact) },
      { role: 'eval', artifact: refOf(evalSplitArtifact) },
    ],
    provenance: {
      creator: { type: 'service', tenant: 'arena-demo', principalId: 'arena-research-runner' },
      createdAt: t1,
      parents: [],
      rights: DEMO_RIGHTS,
      verification: [],
    },
  });

  // 3) The derived child manifest (lineage-recorded holdout split).
  const datasetChild = await deriveDatasetManifest({
    identity: {
      namespace: 'arena-demo',
      name: 'payments-reliability-benchmark-holdout',
      version: '1.0.0',
    },
    entries: [{ role: 'split', artifact: refOf(evalSplitArtifact) }],
    parent: datasetParent,
    relation: 'extracted-from',
    provenance: {
      creator: { type: 'service', tenant: 'arena-demo', principalId: 'arena-research-runner' },
      createdAt: t2,
      rights: DEMO_RIGHTS,
      verification: [],
    },
  });

  // 4) The composition-scoped benchmark runs. The subject is the SAME
  //    five-part composition the evaluation corpus certified, and the
  //    evidence chain binds the REAL A012/A013/A023 digests — a benchmark
  //    statement is never about the model alone.
  const subject = Object.freeze({
    bodyVersion: Object.freeze({
      tenant: evaluation.subject.bodyVersionRef.tenant,
      name: evaluation.subject.bodyVersionRef.name,
      version: evaluation.subject.bodyVersionRef.version,
    }),
    substrate: Object.freeze({
      substrateId: evaluation.subject.substrateRef.substrateId,
      substrateVersion: evaluation.subject.substrateRef.substrateVersion,
    }),
    environment: Object.freeze({
      environmentId: evaluation.subject.environmentRef.environmentId,
      environmentVersion: evaluation.subject.environmentRef.environmentVersion,
    }),
    runtime: Object.freeze({
      runtimeId: evaluation.subject.runtimeProfile.runtimeId,
      runtimeVersion: evaluation.subject.runtimeProfile.runtimeVersion,
    }),
  });

  const benchmarkRun1: BenchmarkRunView = Object.freeze({
    viewVersion: 1,
    runId: RESEARCH_DEMO_IDS.benchmarkRun1,
    truthClass: 'evaluation-result',
    benchmark: DEMO_BENCHMARK,
    subject,
    run: Object.freeze({
      seed: 'demo-benchmark-seed-001',
      startedAt: t1,
      finishedAt: t2,
      runner: 'arena-research-runner',
      correlationId: 'demo-corr-benchmark-run-1',
      idempotencyKey: 'demo-idem-benchmark-run-1',
    }),
    scores: Object.freeze([
      Object.freeze({ criterionId: 'regression-coverage', score: 0.9 }),
      Object.freeze({ criterionId: 'retry-behavior', score: 0.85 }),
      Object.freeze({ criterionId: 'review-readiness', score: 1 }),
    ]),
    aggregate: Object.freeze({ score: 0.916667, outcome: 'pass' }),
    evidence: Object.freeze({
      evaluationRecordDigest: evaluation.evaluationRecord.digest,
      verificationRecordDigest: evaluation.verificationRecord.digest,
      certificationRecordDigest: evaluation.certificationRunB.digest,
    }),
    supersession: Object.freeze({
      supersededBy: RESEARCH_DEMO_IDS.benchmarkRun2,
      note: 'Superseded by run 2 (the append-only ledger posture — the old row is never silently deleted).',
    }),
    confidence: 0.9,
    limitations:
      'Deterministic benchmark over one recorded corpus and one composition; scores do not generalize beyond the tested scope.',
    compositionScopeNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
  } satisfies BenchmarkRunView);

  const benchmarkRun2: BenchmarkRunView = Object.freeze({
    viewVersion: 1,
    runId: RESEARCH_DEMO_IDS.benchmarkRun2,
    truthClass: 'evaluation-result',
    benchmark: DEMO_BENCHMARK,
    subject,
    run: Object.freeze({
      seed: 'demo-benchmark-seed-002',
      startedAt: t2,
      finishedAt: t3,
      runner: 'arena-research-runner',
      correlationId: 'demo-corr-benchmark-run-2',
      idempotencyKey: 'demo-idem-benchmark-run-2',
    }),
    scores: Object.freeze([
      Object.freeze({ criterionId: 'regression-coverage', score: 0.95 }),
      Object.freeze({ criterionId: 'retry-behavior', score: 0.9 }),
      Object.freeze({ criterionId: 'review-readiness', score: 1 }),
    ]),
    aggregate: Object.freeze({ score: 0.95, outcome: 'pass' }),
    evidence: Object.freeze({
      evaluationRecordDigest: evaluation.evaluationRecord.digest,
      verificationRecordDigest: evaluation.verificationRecord.digest,
      certificationRecordDigest: evaluation.certificationRunB.digest,
    }),
    supersession: Object.freeze({ supersededBy: null, note: 'Current run of the leaderboard.' }),
    confidence: 0.92,
    limitations:
      'Deterministic benchmark over one recorded corpus and one composition; scores do not generalize beyond the tested scope.',
    compositionScopeNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
  } satisfies BenchmarkRunView);

  const benchmarkRuns: readonly BenchmarkRunView[] = Object.freeze([benchmarkRun1, benchmarkRun2]);
  const comparison = buildBenchmarkComparison(benchmarkRuns);
  const lineage = toDatasetLineageView([datasetParent, datasetChild]);

  const corpusHash = canonicalJson([
    RESEARCH_DEMO_IDS.benchmarkRun1,
    RESEARCH_DEMO_IDS.benchmarkRun2,
    datasetParent.digest,
    datasetChild.digest,
    corpusArtifact.digest,
    evalSplitArtifact.digest,
  ]);

  return Object.freeze({
    datasetParent,
    datasetChild,
    benchmarkRuns,
    comparison,
    lineage,
    corpusHash,
  } satisfies ResearchDemoCorpus);
}
