/**
 * Reproducibility + integration tests for the SE Repair Benchmark
 * (Work Order A030): deterministic runs, derived aggregates,
 * leaderboard records, public dataset packaging and verification.
 */

import { describe, expect, it } from 'vitest';
import { runSeRepairBenchmark, verifySeRepairBenchmarkRun } from './runner.js';
import { createBenchmarkResult } from '@arena/research';
import { BENCH } from './shared.js';

describe('SE Repair Benchmark run', () => {
  it('produces a published, verification-checked, leaderboard-recorded run', async () => {
    const run = await runSeRepairBenchmark();

    // The descriptor: published, citable, content-addressed.
    expect(run.benchmark.status).toBe('published');
    expect(run.benchmark.benchmarkId).toBe(BENCH.benchmarkId);
    expect(run.benchmark.digest).toMatch(/^[0-9a-f]{64}$/);

    // The result: derived aggregate, full evidence chain.
    expect(run.result.aggregate.outcome).toBe('pass');
    expect(run.result.scores).toHaveLength(3);
    expect(run.result.evidence.verificationRecord.digest).toBe(
      run.receipt.verificationRecord.digest,
    );
    expect(run.result.evidence.certificationRecord?.digest).toBe(
      run.receipt.certificationRecord.digest,
    );
    expect(run.result.run.seed).toBe(BENCH.seed);
    expect(run.result.methodology.digest).toBe(run.methodology.digest);

    // The leaderboard: one ranked row, a citable snapshot.
    const ranking = run.leaderboard.ranking(run.benchmark.digest);
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.rank).toBe(1);
    const snapshot = await run.leaderboard.snapshot(run.benchmark.digest);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);

    // The public datasets verify end-to-end through A014.
    const verified = await verifySeRepairBenchmarkRun(run);
    expect(verified.descriptorDigest).toBe(run.benchmark.digest);
    expect(verified.resultDigest).toBe(run.result.digest);
    expect(run.definitionDataset.manifest.identity.namespace).toBe('public');
    expect(run.resultsDataset.manifest.identity.namespace).toBe('public');
    expect(run.resultsDataset.manifest.entries).toHaveLength(1);
  });

  it('is deterministic: two full runs produce byte-identical digests', async () => {
    const a = await runSeRepairBenchmark();
    const b = await runSeRepairBenchmark();
    expect(a.benchmark.digest).toBe(b.benchmark.digest);
    expect(a.result.digest).toBe(b.result.digest);
    expect(a.methodology.digest).toBe(b.methodology.digest);
    expect(a.evaluationCriteriaDigests).toEqual(b.evaluationCriteriaDigests);
    expect(a.definitionDataset.manifest.digest).toBe(b.definitionDataset.manifest.digest);
    expect(a.resultsDataset.manifest.digest).toBe(b.resultsDataset.manifest.digest);
    expect((await a.leaderboard.snapshot(a.benchmark.digest)).digest).toBe(
      (await b.leaderboard.snapshot(b.benchmark.digest)).digest,
    );
    // The A028 scenario receipt itself is deterministic.
    expect(a.receiptDigests).toEqual(b.receiptDigests);
  });

  it('appends a superseding run of the same subject and keeps the audit trail', async () => {
    const run = await runSeRepairBenchmark();
    // A second, later-recorded result of the same subject supersedes.
    const { recordVersion: _rv, aggregate: _agg, digest: _digest, ...input } = run.result;
    const superseding = await createBenchmarkResult({
      ...input,
      methodology: {
        ...run.result.methodology,
        aggregation: run.methodology.aggregation,
        passAt: run.methodology.passAt,
      },
      run: { ...run.result.run, finishedAt: '2026-10-01T11:30:00.000Z' },
      provenance: {
        ...run.result.provenance,
        recordedAt: '2026-10-01T11:30:00.000Z',
        notes: 'A030 supersession probe',
      },
    });
    await run.leaderboard.append(superseding);
    expect(run.leaderboard.size).toBe(2);
    expect(run.leaderboard.supersededDigests()).toEqual([run.result.digest]);
    const ranking = run.leaderboard.ranking(run.benchmark.digest);
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.result.digest).toBe(superseding.digest);
  });
});
