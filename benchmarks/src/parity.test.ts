/**
 * Contract/parity tests for the benchmarks suite (Work Order A030):
 * the descriptor's pinned protocol identities must be byte-identical
 * to the objects the run actually used (A012 criteria/evaluator, A013
 * verifier, A028 body), and the research layer's closed enums must be
 * the dependency fabrics' very enums.
 */

import { describe, expect, it } from 'vitest';
import { runSeRepairBenchmark } from './runner.js';
import { createCriteria } from './criteria.js';
import { AGGREGATION_POLICIES, EVALUATOR_KINDS } from '@arena/evaluation';
import { createScoringMethodology } from '@arena/research';
import { BENCH, CONTAMINATION_POLICY } from './shared.js';
import { seRepairMethodology, seRepairDefinitionDataset, seRepairRubricMethodology } from './suite.js';

describe('descriptor pins vs actual run (byte identity)', () => {
  it('pins exactly the criteria suites, evaluator and verifier the run used', async () => {
    const run = await runSeRepairBenchmark();

    // Criteria pins: identity parity with the actual suites.
    const bound = await createCriteria({
      caseDigest: run.receipt.caseRecord.digest,
      trajectoryDigest: run.receipt.trajectory.chainHead,
    });
    expect(run.benchmark.criteriaPins[0]!.criteriaId).toBe(bound.criteriaId);
    expect(run.benchmark.criteriaPins[0]!.version).toBe(bound.version);
    expect(run.evaluationCriteriaDigests).toContain(bound.digest);

    // Evaluator pins: the A012 evaluator identities the run registered
    // (the primary is the reference evaluator's identity; the secondary
    // is the suite-bound derivative).
    expect(run.benchmark.evaluatorPins).toHaveLength(2);
    expect(run.benchmark.evaluatorPins[0]!.evaluatorId).toBe(run.receipt.evaluator.evaluatorId);
    expect(run.benchmark.evaluatorPins[0]!.version).toBe(run.receipt.evaluator.version);
    expect(run.benchmark.evaluatorPins[0]!.kind).toBe(run.receipt.evaluator.kind);
    expect(run.benchmark.evaluatorPins[1]!.evaluatorId.startsWith(run.receipt.evaluator.evaluatorId)).toBe(true);
    expect(run.benchmark.evaluatorPins[1]!.kind).toBe(run.receipt.evaluator.kind);

    // Verifier pin: the A013 verifier identity the receipt verified under.
    expect(run.benchmark.verifierPins[0]!.verifierId).toBe(run.receipt.verifier.verifierId);
    expect(run.benchmark.verifierPins[0]!.version).toBe(run.receipt.verifier.version);

    // Subject scope: the A028 body version the scenario forged.
    const bodyRef = run.benchmark.subjectScope.bodyRefs[0]!;
    expect(bodyRef.digest).toBe(run.receipt.bodyBuild.evolved.bodyVersion.digest);
    expect(bodyRef.name).toBe(run.receipt.bodyBuild.evolved.bodyVersion.body.name);
  });

  it('pins the methodology the result scored under (digest parity)', async () => {
    const run = await runSeRepairBenchmark();
    expect(run.benchmark.methodologyRef.digest).toBe(run.methodology.digest);
    expect(run.result.methodology.digest).toBe(run.methodology.digest);
    expect(run.methodology.aggregation).toBe('weighted-sum');
    expect(run.rubricMethodology.aggregation).toBe('rubric-level');
  });
});

describe('protocol enum parity (A012 reuse)', () => {
  it('uses the A012 aggregation + evaluator-kind enums verbatim', async () => {
    const methodology = await seRepairMethodology();
    expect(AGGREGATION_POLICIES).toContain(methodology.aggregation);
    expect(EVALUATOR_KINDS).toContain('deterministic-test');
    // A methodology over an unknown policy is rejected (enum is closed).
    await expect(
      createScoringMethodology({
        methodologyId: 'methodology-bad',
        version: '1.0.0',
        aggregation: 'stochastic-vibes',
        passAt: 0.5,
        tieBreaking: 'digest-asc',
        knownLimitations: 'x',
        contaminationPolicy: 'y',
        provenance: { authoredBy: 'arena-research', submittedAt: BENCH.t0, notes: null },
      }),
    ).rejects.toBeTruthy();
  });
});

describe('public dataset parity (A014 packaging)', () => {
  it('packages the methodology views byte-identically into the definition dataset', async () => {
    const run = await runSeRepairBenchmark();
    const fresh = await seRepairDefinitionDataset(
      await seRepairMethodology(),
      await seRepairRubricMethodology(),
    );
    expect(fresh.manifest.digest).toBe(run.definitionDataset.manifest.digest);
    expect(fresh.manifest.entries.length).toBe(run.definitionDataset.manifest.entries.length);
    expect(fresh.manifest.identity.name).toBe(BENCH.datasetName);
  });

  it('states the contamination policy in the dataset lineage notes', () => {
    expect(CONTAMINATION_POLICY).toContain('no customer data');
    expect(CONTAMINATION_POLICY).toContain('not professional licensure claims');
  });
});
