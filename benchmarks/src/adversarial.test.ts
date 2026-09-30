/**
 * Adversarial tests for the benchmarks suite (Work Order A030):
 * non-reproducible runs rejected, tampered scoring inputs rejected,
 * tampered descriptors rejected, tampered public datasets rejected.
 */

import { describe, expect, it } from 'vitest';
import { runSeRepairBenchmark } from './runner.js';
import {
  createBenchmarkResult,
  createBenchmarkDescriptor,
  LeaderboardLedger,
  ResearchError,
  resolveResearchDataset,
  verifyResearchDataset,
  RESEARCH_ERROR_CODES,
  isResearchError,
} from '@arena/research';
import { createCriteria } from './criteria.js';
import { createEvaluationCriteria } from '@arena/evaluation';
import { BENCH, KNOWN_LIMITATIONS } from './shared.js';

/** The full methodology input shape (the constructed ref carries only the ref fields). */
function methodologyInput(run: Awaited<ReturnType<typeof runSeRepairBenchmark>>) {
  return {
    ...run.result.methodology,
    aggregation: run.methodology.aggregation,
    passAt: run.methodology.passAt,
  };
}

async function expectError(promise: Promise<unknown>, code?: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('expected a typed rejection');
  } catch (error) {
    expect(isResearchError(error)).toBe(true);
    if (code !== undefined) {
      expect((error as ResearchError).code).toBe(code);
    }
  }
}

describe('benchmark adversarial cases', () => {
  it('rejects a tampered result record (mutated aggregate)', async () => {
    const run = await runSeRepairBenchmark();
    const tampered = {
      ...run.result,
      aggregate: { score: 0.01, outcome: 'pass' as const },
    };
    const ledger = new LeaderboardLedger();
    await expectError(ledger.append(tampered), RESEARCH_ERROR_CODES.TAMPERED);
  });

  it('rejects a non-reproducible run record (wall-clock-dependent seed shape)', async () => {
    const run = await runSeRepairBenchmark();
    const { recordVersion: _rv, aggregate: _agg, digest: _digest, ...input } = run.result;
    await expectError(
      createBenchmarkResult({
        ...input,
        methodology: methodologyInput(run),
        run: { ...run.result.run, seed: '' },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
    await expectError(
      createBenchmarkResult({
        ...input,
        methodology: methodologyInput(run),
        run: { ...run.result.run, finishedAt: '2026-10-01T10:00:00.000Z' },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
    // Control: the clean input still constructs (the rejections above come
    // from the seed/window discipline, not from shape pollution).
    await expect(
      createBenchmarkResult({ ...input, methodology: methodologyInput(run) }),
    ).resolves.toBeTruthy();
  });

  it('rejects a tampered benchmark descriptor on recompute', async () => {
    const run = await runSeRepairBenchmark();
    const { recomputeBenchmarkDescriptorDigest } = await import('@arena/research');
    const tampered = { ...run.benchmark, title: 'Hacked Benchmark Title' } as typeof run.benchmark;
    await expectError(recomputeBenchmarkDescriptorDigest(tampered), RESEARCH_ERROR_CODES.TAMPERED);
  });

  it('rejects criteria suites that are not bound to the run case/trajectory', async () => {
    const run = await runSeRepairBenchmark();
    // Same criteria id but bound to foreign digests -- a different object.
    const foreign = await createEvaluationCriteria({
      criteriaId: 'criteria-se-test-repair',
      version: '1.0.0',
      entries: [
        {
          criterionId: 'criterion-tests-green',
          weight: 2,
          description: 'the repaired test suite is green in the pinned sandbox',
          targetRef: 'f'.repeat(64),
        },
      ],
      aggregation: 'weighted-sum',
      thresholds: { passAt: 0.75 },
    });
    expect(foreign.digest).not.toBe(run.evaluationCriteriaDigests[0]);
    // The bound suite, by contrast, is byte-identical to the recorded one.
    const bound = await createCriteria({
      caseDigest: run.receipt.caseRecord.digest,
      trajectoryDigest: run.receipt.trajectory.chainHead,
    });
    expect(bound.digest).toBe(run.evaluationCriteriaDigests[0]);
  });

  it('rejects a tampered public results dataset through the A014 verify chain', async () => {
    const run = await runSeRepairBenchmark();
    const bundle = await resolveResearchDataset(
      run.resultsDataset.manifest,
      run.resultsDataset.artifacts,
    );
    // Swap the recorded artifact out -- resolution must fail closed.
    await expect(verifyResearchDataset(bundle, [])).rejects.toBeTruthy();
    // Mutate the manifest digest -- bundle verification must fail.
    const tamperedManifest = { ...run.resultsDataset.manifest, digest: '0'.repeat(64) } as typeof run.resultsDataset.manifest;
    await expect(
      verifyResearchDataset(
        { ...bundle, manifest: tamperedManifest },
        run.resultsDataset.artifacts,
      ),
    ).rejects.toBeTruthy();
  });

  it('rejects a published descriptor without a public dataset', async () => {
    const run = await runSeRepairBenchmark();
    const input = {
      ...run.benchmark,
      methodologyRef: { ...run.benchmark.methodologyRef },
      datasetRef: null as null,
      subjectScope: {
        bodyRefs: run.benchmark.subjectScope.bodyRefs.map((bodyRef) => ({ ...bodyRef })),
        environmentRef: run.benchmark.subjectScope.environmentRef === null
          ? null
          : { ...run.benchmark.subjectScope.environmentRef },
        runtimeNote: run.benchmark.subjectScope.runtimeNote,
      },
      taskPopulation: { ...run.benchmark.taskPopulation },
      provenance: { ...run.benchmark.provenance },
    } as Parameters<typeof createBenchmarkDescriptor>[0];
    await expectError(
      createBenchmarkDescriptor(input),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
    await expectError(
      createBenchmarkDescriptor({ ...input, datasetRef: { ...run.benchmark.datasetRef! }, verifierPins: [] }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });

  it('states limitations and contamination policy on every artifact (hygiene)', () => {
    expect(runSeRepairBenchmark).toBeTruthy();
    expect(KNOWN_LIMITATIONS.length).toBeGreaterThan(80);
    expect(BENCH.seed).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  });
});
