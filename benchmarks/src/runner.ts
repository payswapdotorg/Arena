/**
 * The SE Repair Benchmark runner (Work Order A030): one deterministic
 * function that exercises the A028 reference body, scores it through
 * the A012/A013 fabrics and records a citable, verification-checked
 * result.
 *
 * The chain:
 *
 *   1. run the A028 reference scenario (`runReferenceScenario` -- the
 *      full Body→…→Certification→Release chain, no live model calls);
 *   2. score it through INDEPENDENT A012 evaluation-fabric runs against
 *      the benchmark's criteria suites (fresh fabric, fixed inputs, the
 *      receipt's semantic evaluator hook re-registered);
 *   3. check the scoring inputs through A013 (the receipt's
 *      digest-pinned verification record is the evidence a tampered
 *      input would contradict);
 *   4. assemble the published descriptor + result record through the
 *      @arena/research constructors;
 *   5. append to the leaderboard, snapshot, and package the public
 *      definition + results datasets (A014).
 */

import {
  runReferenceScenario,
  receiptDigests,
  makeSoftwareEngineerEvaluator,
} from '@arena/example-software-engineer';
import type { ScenarioReceipt } from '@arena/example-software-engineer';
import { EvaluationFabric } from '@arena/evaluation-fabric';
import { createEvaluatorDescriptor } from '@arena/evaluation';
import {
  createBenchmarkDescriptor,
  createBenchmarkResult,
  LeaderboardLedger,
  createResearchDataset,
  resolveResearchDataset,
  verifyResearchDataset,
  recomputeBenchmarkDescriptorDigest,
  recomputeBenchmarkResultDigest,
} from '@arena/research';
import type { BenchmarkDescriptor, BenchmarkResult, ScoringMethodology } from '@arena/research';
import type { DatasetManifest } from '@arena/datasets';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { BENCH, CONTAMINATION_POLICY, KNOWN_LIMITATIONS } from './shared.js';
import {
  seRepairMethodology,
  seRepairRubricMethodology,
  seRepairDefinitionDataset,
  seRepairResultsDataset,
} from './suite.js';
import { createCriteria, createPassThresholdCriteria } from './criteria.js';

/** Everything one benchmark run produces. */
export interface SeRepairBenchmarkRun {
  readonly receipt: ScenarioReceipt;
  readonly receiptDigests: Record<string, string>;
  readonly methodology: ScoringMethodology;
  readonly rubricMethodology: ScoringMethodology;
  readonly evaluationCriteriaDigests: readonly string[];
  readonly benchmark: BenchmarkDescriptor;
  readonly result: BenchmarkResult;
  readonly leaderboard: LeaderboardLedger;
  readonly definitionDataset: { manifest: DatasetManifest; artifacts: readonly MaterialArtifact[] };
  readonly resultsDataset: { manifest: DatasetManifest; artifacts: readonly MaterialArtifact[] };
}

function ref(namespace: string, name: string, version: string, digest: string) {
  return { namespace, name, version, digest };
}

/**
 * Run the SE Repair Benchmark deterministically. Every timestamp, seed
 * and key comes from the fixed suite inputs; two invocations produce
 * byte-identical digests (asserted by the reproducibility suite).
 */
export async function runSeRepairBenchmark(): Promise<SeRepairBenchmarkRun> {
  // 1. The A028 reference scenario (full chain, fixed inputs).
  const receipt = await runReferenceScenario();
  const digests = receiptDigests(receipt);

  // 2. The scoring methodologies (published, citable).
  const methodology = await seRepairMethodology();
  const rubricMethodology = await seRepairRubricMethodology();

  // 3. Independent A012 evaluation runs against the benchmark's
  //    criteria suites (fresh fabric, fixed inputs, the receipt's
  //    semantic evaluator hook re-registered per suite-bound
  //    descriptor).
  const evaluationFabric = new EvaluationFabric();
  const binding = {
    caseDigest: receipt.caseRecord.digest,
    trajectoryDigest: receipt.trajectory.chainHead,
  };
  const criteriaSuites = await Promise.all([
    createCriteria(binding),
    createPassThresholdCriteria(binding),
  ]);
  const evaluationRecords = [];
  const suiteEvaluators = [];
  for (const [index, criteria] of criteriaSuites.entries()) {
    evaluationFabric.registry.registerCriteria(criteria);
    // Each criteria suite gets its own evaluator identity: the A012
    // registry treats same evaluatorId@version with different bytes as
    // an identity conflict (any change ⇒ a new version), so suite-bound
    // descriptors carry suite-distinct ids derived from the reference
    // evaluator's id.
    const evaluatorId =
      index === 0
        ? receipt.evaluator.evaluatorId
        : `${receipt.evaluator.evaluatorId}-${criteria.criteriaId.replace('criteria-se-', '')}`;
    const suiteEvaluator = await createEvaluatorDescriptor({
      evaluatorId,
      version: receipt.evaluator.version,
      kind: receipt.evaluator.kind,
      inputs: receipt.evaluator.inputs,
      criteriaRef: criteria.digest,
      outputSchema: receipt.evaluator.outputSchema,
      reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
      confidence: receipt.evaluator.confidence,
      limitations: receipt.evaluator.limitations,
      provenance: {
        authoredBy: 'arena-benchmark-runner',
        submittedAt: BENCH.t0,
        notes: 'A030 benchmark scoring run over the A028 reference evaluator hook',
      },
    });
    evaluationFabric.registry.registerEvaluator(suiteEvaluator, makeSoftwareEngineerEvaluator());
    const record = await evaluationFabric.evaluate(
      suiteEvaluator.digest,
      receipt.caseRecord,
      receipt.trajectory,
      {
        seed: BENCH.seed,
        startedAt: BENCH.t1,
        finishedAt: BENCH.t2,
        provenanceNotes: 'A030 SE Repair Benchmark scoring run',
      },
    );
    suiteEvaluators.push(suiteEvaluator);
    evaluationRecords.push(record);
  }

  // 4. The published benchmark descriptor (needs the public dataset).
  const definitionDataset = await seRepairDefinitionDataset(methodology, rubricMethodology);
  const bodyVersion = receipt.bodyBuild.evolved.bodyVersion;
  const benchmark = await createBenchmarkDescriptor({
    benchmarkId: BENCH.benchmarkId,
    version: BENCH.benchmarkVersion,
    domain: BENCH.domain,
    title: BENCH.title,
    description:
      'Reproduce a failing test suite, repair it without prohibited shortcuts, and pass verification in the pinned sandbox -- the A028 reference software-engineer scenario as a public benchmark.',
    status: 'published',
    criteriaPins: criteriaSuites.map((criteria) => ({
      criteriaId: criteria.criteriaId,
      version: criteria.version,
    })),
    evaluatorPins: suiteEvaluators.map((evaluator) => ({
      evaluatorId: evaluator.evaluatorId,
      version: evaluator.version,
      kind: evaluator.kind,
    })),
    verifierPins: [
      { verifierId: receipt.verifier.verifierId, version: receipt.verifier.version },
    ],
    methodologyRef: ref(
      'public',
      'scoring-methodology-se-repair',
      BENCH.methodologyVersion,
      methodology.digest,
    ),
    datasetRef: ref(
      definitionDataset.manifest.identity.namespace,
      definitionDataset.manifest.identity.name,
      definitionDataset.manifest.identity.version,
      definitionDataset.manifest.digest,
    ),
    subjectScope: {
      bodyRefs: [
        ref(bodyVersion.body.tenant, bodyVersion.body.name, bodyVersion.version, bodyVersion.digest),
      ],
      environmentRef: ref(
        'arena-reference',
        'environment-software-engineer-sandbox',
        '1.0.0',
        receipt.environment.digest,
      ),
      runtimeNote: 'the A028 reference runtime profile (fixed seed, no network, declared mounts only)',
    },
    taskPopulation: {
      scenarioCount: 1,
      seedPolicy: 'fixed-seed',
      notes: 'the A028 reference repair scenario, one fixed seed',
    },
    provenance: {
      authoredBy: 'arena-research',
      submittedAt: BENCH.t0,
      notes: 'A030 reference benchmark over the A028 body',
    },
  });

  // 5. The result record (scores derived from the A012 run; the
  //    aggregate is derived by the research constructor).
  const primaryEvaluation = evaluationRecords[0]!;
  const result = await createBenchmarkResult({
    benchmark: ref('public', 'benchmark-se-repair', BENCH.benchmarkVersion, benchmark.digest),
    subject: {
      bodyVersionRef: ref(
        bodyVersion.body.tenant,
        bodyVersion.body.name,
        bodyVersion.version,
        bodyVersion.digest,
      ),
      substrateRef: ref(
        'arena-reference',
        'substrate-reference-reasoner-1',
        '1.0.0',
        receipt.substrate.integrity.contentDigest,
      ),
      possessionDigest: receipt.possession.digest,
      environmentRef: ref(
        'arena-reference',
        'environment-software-engineer-sandbox',
        '1.0.0',
        receipt.environment.digest,
      ),
    },
    run: {
      seed: BENCH.seed,
      startedAt: BENCH.t1,
      finishedAt: BENCH.t3,
      correlationId: BENCH.correlationId,
      idempotencyKey: BENCH.idempotencyKey,
      runner: BENCH.runner,
    },
    criteria: criteriaSuites.map((criteria) =>
      ref('arena-reference', `criteria-${criteria.criteriaId}`, criteria.version, criteria.digest),
    ),
    evaluator: ref(
      'arena-reference',
      `evaluator-${suiteEvaluators[0]!.evaluatorId}`,
      suiteEvaluators[0]!.version,
      primaryEvaluation.evaluatorRef,
    ),
    verifier: ref(
      'arena-reference',
      `verifier-${receipt.verifier.verifierId}`,
      receipt.verifier.version,
      receipt.verificationRecord.verifierRef,
    ),
    scores: primaryEvaluation.verdicts.map((verdict) => ({
      criterionId: verdict.criterionId,
      score: verdict.score,
    })),
    methodology: {
      ...ref('public', 'scoring-methodology-se-repair', BENCH.methodologyVersion, methodology.digest),
      aggregation: methodology.aggregation,
      passAt: methodology.passAt,
    },
    evidence: {
      evaluationRecord: ref(
        'arena-reference',
        'evaluation-record-se-repair-benchmark',
        '1.0.0',
        primaryEvaluation.digest,
      ),
      verificationRecord: ref(
        'arena-reference',
        'verification-record-se-reference',
        '1.0.0',
        receipt.verificationRecord.digest,
      ),
      certificationRecord: ref(
        'arena-reference',
        'certification-record-se-reference',
        '1.0.0',
        receipt.certificationRecord.digest,
      ),
    },
    confidence: primaryEvaluation.confidence,
    limitations: KNOWN_LIMITATIONS,
    provenance: {
      recordedBy: BENCH.runner,
      recordedAt: BENCH.t3,
      notes: 'A030 SE Repair Benchmark run over the A028 reference body',
    },
  });

  // 6. Leaderboard + results dataset.
  const leaderboard = new LeaderboardLedger();
  await leaderboard.append(result);
  const { digest: _resultDigest, ...resultView } = result;
  const resultsDataset = await seRepairResultsDataset([
    { digest: result.digest, result: resultView as unknown as Record<string, unknown> },
  ]);

  return {
    receipt,
    receiptDigests: digests,
    methodology,
    rubricMethodology,
    evaluationCriteriaDigests: criteriaSuites.map((criteria) => criteria.digest),
    benchmark,
    result,
    leaderboard,
    definitionDataset,
    resultsDataset,
  };
}

/** Verify a run end-to-end: descriptor + result digests recompute; the public datasets verify. */
export async function verifySeRepairBenchmarkRun(
  run: SeRepairBenchmarkRun,
): Promise<{ descriptorDigest: string; resultDigest: string }> {
  const descriptorDigest = await recomputeBenchmarkDescriptorDigest(run.benchmark);
  const resultDigest = await recomputeBenchmarkResultDigest(run.result);
  const definitionBundle = await resolveResearchDataset(
    run.definitionDataset.manifest,
    run.definitionDataset.artifacts,
  );
  await verifyResearchDataset(definitionBundle, run.definitionDataset.artifacts);
  const resultsBundle = await resolveResearchDataset(
    run.resultsDataset.manifest,
    run.resultsDataset.artifacts,
  );
  await verifyResearchDataset(resultsBundle, run.resultsDataset.artifacts);
  return { descriptorDigest, resultDigest };
}

export { CONTAMINATION_POLICY, createResearchDataset };
