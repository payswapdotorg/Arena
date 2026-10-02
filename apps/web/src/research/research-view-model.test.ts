/**
 * Research view-model tests (Work Order B012; issue #87).
 *
 * Positive: the composition-scoped comparison table (rows are RUNS over
 * pinned compositions; supersession renders as supersession) and the
 * dataset lineage view (content-addressed manifests with parent edges).
 * Adversarial: malformed run payloads are listed unreadable — never
 * rendered as data; missing cells render Unknown, never guessed.
 */

import { describe, expect, it } from 'vitest';

import { buildBenchmarkComparison, toDatasetLineageView } from './research-view-model.js';
import type { BenchmarkRunView } from './research-view-model.js';
import { buildResearchDemoCorpus, RESEARCH_DEMO_IDS } from './fixtures.js';
import { buildEvaluationDemoCorpus } from '../evaluation/fixtures.js';
import { RESEARCH_COMPOSITION_SCOPE_NOTE } from '../evaluation/state-mark.js';

/** A minimal well-formed benchmark run payload for the adversarial cases. */
function runFixture(overrides: Partial<BenchmarkRunView> = {}): BenchmarkRunView {
  return {
    viewVersion: 1,
    runId: 'run-x',
    truthClass: 'evaluation-result',
    benchmark: {
      benchmarkId: 'benchmark-x',
      version: '1.0.0',
      status: 'published',
      methodology: { aggregation: 'weighted-sum', passAt: 0.75 },
    },
    subject: {
      bodyVersion: { tenant: 'acme', name: 'body-x', version: '1.0.0' },
      substrate: { substrateId: 'substrate-x', substrateVersion: '1.0.0' },
      environment: { environmentId: 'env-x', environmentVersion: '1.0.0' },
      runtime: { runtimeId: 'runtime-x', runtimeVersion: '1.0.0' },
    },
    run: {
      seed: 'seed-x',
      startedAt: '2026-10-01T08:00:00.000Z',
      finishedAt: '2026-10-01T08:05:00.000Z',
      runner: 'runner-x',
      correlationId: 'corr-x',
      idempotencyKey: 'idem-x',
    },
    scores: [
      { criterionId: 'criterion-a', score: 0.9 },
      { criterionId: 'criterion-b', score: 0.8 },
    ],
    aggregate: { score: 0.85, outcome: 'pass' },
    evidence: {
      evaluationRecordDigest: 'a'.repeat(64),
      verificationRecordDigest: 'b'.repeat(64),
      certificationRecordDigest: undefined,
    },
    supersession: { supersededBy: null, note: 'Current.' },
    confidence: 0.9,
    limitations: 'fixture',
    compositionScopeNote: RESEARCH_COMPOSITION_SCOPE_NOTE,
    ...overrides,
  };
}

describe('benchmark comparison table (positive)', () => {
  it('builds the composition-scoped table over runs (columns, rows, supersession)', () => {
    const run1 = runFixture({
      runId: 'run-1',
      scores: [
        { criterionId: 'criterion-a', score: 0.9 },
        { criterionId: 'criterion-b', score: 0.8 },
      ],
      supersession: { supersededBy: 'run-2', note: 'Superseded.' },
    });
    const run2 = runFixture({
      runId: 'run-2',
      scores: [
        { criterionId: 'criterion-a', score: 0.95 },
        { criterionId: 'criterion-b', score: 0.85 },
        { criterionId: 'criterion-c', score: 1 },
      ],
    });

    const table = buildBenchmarkComparison([run1, run2]);
    expect(table.benchmarkId).toBe('benchmark-x');
    expect(table.methodology).toEqual({ aggregation: 'weighted-sum', passAt: 0.75 });
    // Columns are the first-seen criterion ids.
    expect(table.columns).toEqual(['criterion-a', 'criterion-b', 'criterion-c']);
    expect(table.rows).toHaveLength(2);
    expect(table.unreadableRuns).toEqual([]);
    expect(table.scopeNote).toContain('NEVER a statement about the model alone');

    // Rows preserve input order; supersession marks the SUPERSEDED row.
    expect(table.rows[0]?.runId).toBe('run-1');
    expect(table.rows[0]?.superseded).toBe(true);
    expect(table.rows[1]?.superseded).toBe(false);

    // Cells carry per-criterion scores; the subject label names the full composition.
    expect(table.rows[0]?.cells[0]).toEqual({ criterionId: 'criterion-a', score: 0.9 });
    expect(table.rows[1]?.cells[2]?.score).toBe(1);
    expect(table.rows[0]?.subjectLabel).toContain('acme/body-x@1.0.0');
    expect(table.rows[0]?.subjectLabel).toContain('substrate substrate-x@1.0.0');
    expect(table.rows[0]?.subjectLabel).toContain('env env-x@1.0.0');
    expect(table.rows[0]?.subjectLabel).toContain('runtime runtime-x@1.0.0');
    expect(table.rows[0]?.aggregate).toEqual({ score: 0.85, outcome: 'pass' });
  });

  it('is deterministic: the same runs build the identical table', () => {
    const runs = [runFixture({ runId: 'a' }), runFixture({ runId: 'b' })];
    expect(buildBenchmarkComparison(runs)).toEqual(buildBenchmarkComparison(runs));
  });
});

describe('benchmark comparison table (adversarial — malformed payloads never render as data)', () => {
  it('lists structurally unreadable runs instead of rendering them', () => {
    const table = buildBenchmarkComparison([runFixture(), { junk: true }, null, 42]);
    expect(table.rows).toHaveLength(1);
    expect(table.unreadableRuns).toEqual(['run[1]', 'run[2]', 'run[3]']);
  });

  it('names an unreadable run by its runId when the id survives', () => {
    const broken = { ...runFixture({ runId: 'broken-run' }), scores: 'not-an-array' };
    const table = buildBenchmarkComparison([broken]);
    expect(table.unreadableRuns).toEqual(['broken-run']);
    expect(table.rows).toHaveLength(0);
  });

  it('renders a missing cell score as null (Unknown), never a guessed value', () => {
    const sparse = runFixture({
      scores: [{ criterionId: 'criterion-a', score: 0.9 }],
    });
    const other = runFixture({ runId: 'other', scores: [{ criterionId: 'criterion-b', score: 0.5 }] });
    const table = buildBenchmarkComparison([sparse, other]);
    expect(table.columns).toEqual(['criterion-a', 'criterion-b']);
    expect(table.rows[0]?.cells[1]).toEqual({ criterionId: 'criterion-b', score: null });
    expect(table.rows[1]?.cells[0]).toEqual({ criterionId: 'criterion-a', score: null });
  });

  it('degrades the aggregate honestly (null aggregate renders as no aggregate)', () => {
    const noAggregate = runFixture({ aggregate: null });
    const table = buildBenchmarkComparison([noAggregate]);
    expect(table.rows[0]?.aggregate).toBeNull();
  });
});

describe('dataset lineage view (positive + adversarial)', () => {
  it('projects the demo manifests into the lineage view with parent edges', async () => {
    const evaluation = await buildEvaluationDemoCorpus();
    const corpus = await buildResearchDemoCorpus(evaluation);
    const lineage = corpus.lineage;

    expect(lineage.nodes).toHaveLength(2);
    expect(lineage.unreadable).toEqual([]);

    const parent = lineage.nodes[0];
    const child = lineage.nodes[1];
    expect(parent?.name).toBe('payments-reliability-benchmark');
    expect(parent?.namespace).toBe('arena-demo');
    expect(parent?.digest).toBe(corpus.datasetParent.digest);
    expect(parent?.entryRoles).toEqual(['input', 'eval']);
    expect(parent?.parents).toEqual([]);
    expect(parent?.truthClass).toBe('evidence');

    // The child's lineage edge points at the REAL parent digest.
    expect(child?.name).toBe('payments-reliability-benchmark-holdout');
    expect(child?.parents).toHaveLength(1);
    expect(child?.parents[0]?.relation).toBe('extracted-from');
    expect(child?.parents[0]?.key).toContain(`payments-reliability-benchmark@1.0.0#${corpus.datasetParent.digest}`);
  });

  it('lists malformed manifests by index instead of rendering them', () => {
    const lineage = toDatasetLineageView([{}, null, 'manifest']);
    expect(lineage.nodes).toHaveLength(0);
    expect(lineage.unreadable).toEqual([0, 1, 2]);
  });
});

describe('research demo corpus (determinism + evidence chain)', () => {
  it('two constructions are byte-identical', async () => {
    const evaluationOne = await buildEvaluationDemoCorpus();
    const evaluationTwo = await buildEvaluationDemoCorpus();
    const one = await buildResearchDemoCorpus(evaluationOne);
    const two = await buildResearchDemoCorpus(evaluationTwo);
    expect(one.datasetParent.digest).toBe(two.datasetParent.digest);
    expect(one.datasetChild.digest).toBe(two.datasetChild.digest);
    expect(one.corpusHash).toBe(two.corpusHash);
    expect(one.comparison).toEqual(two.comparison);
    expect(one.lineage).toEqual(two.lineage);
  });

  it('binds the benchmark evidence chain to the REAL A012/A013/A023 digests', async () => {
    const evaluation = await buildEvaluationDemoCorpus();
    const corpus = await buildResearchDemoCorpus(evaluation);
    for (const run of corpus.benchmarkRuns) {
      expect(run.truthClass).toBe('evaluation-result');
      expect(run.evidence.evaluationRecordDigest).toBe(evaluation.evaluationRecord.digest);
      expect(run.evidence.verificationRecordDigest).toBe(evaluation.verificationRecord.digest);
      expect(run.evidence.certificationRecordDigest).toBe(evaluation.certificationRunB.digest);
      // The subject composition is the certified composition — never the model alone.
      expect(run.subject.bodyVersion.name).toBe('software-engineer-body');
      expect(run.subject.substrate.substrateId).toBe('workspace-mount');
    }
    // Run 1 is superseded by run 2 — the append-only ledger posture.
    expect(corpus.benchmarkRuns[0]?.supersession.supersededBy).toBe(RESEARCH_DEMO_IDS.benchmarkRun2);
    expect(corpus.benchmarkRuns[1]?.supersession.supersededBy).toBeNull();
    expect(corpus.comparison.rows[0]?.superseded).toBe(true);
    expect(corpus.comparison.rows[1]?.superseded).toBe(false);
  });
});
