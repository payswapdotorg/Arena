/**
 * SLO view-model tests (Work Order B014).
 *
 * Positive: measured rows carry their measured value + window + verdict +
 * budget; no-data rows render the no-data posture with the fail-closed
 * note; missing evaluations render the honest missing note.
 * Adversarial: malformed definitions, foreign verdicts and mismatched
 * evaluations degrade truthfully — unknown truth class, no fabricated
 * numbers, no thrown renders.
 */

import { describe, expect, it } from 'vitest';

import {
  buildOperationsDemoCorpus,
  buildSloCatalog,
  evaluateSloEmpty,
  OPERATIONS_DEMO_EPOCH_MS,
} from './fixtures.js';
import { sloVerdictCounts, sloWindowLabel, toSloRowView } from './slo-view-model.js';
import { toJobSummaryView } from './jobs-view-model.js';

describe('slo view projection (positive)', () => {
  it('measured rows carry the measured value + the window + the verdict + the budget', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const completion = corpus.sloEvaluations.find(
      (evaluation) => evaluation.sloId === 'slo-job-completion',
    );
    const definition = corpus.sloCatalog.find(
      (candidate) => candidate.sloId === 'slo-job-completion',
    );
    const row = toSloRowView({ definition, evaluation: completion });
    expect(row.posture).toBe('measured');
    expect(row.verdict).toBe('breached');
    expect(row.truthClass).toBe('evaluation-result');
    expect(row.readable).toBe(true);
    expect(row.targetRatio).toBe(0.99);
    expect(row.windowMs).toBe(3_600_000);
    expect(row.windowLabel).toBe('1h');
    expect(row.measured?.sampleCount).toBe(25);
    expect(row.measured?.achievedRatio).toBeCloseTo(0.96, 10);
    expect(row.measured?.badCount).toBe(1);
    expect(row.measured?.budgetExhausted).toBe(true);
    expect(row.measured?.windowStart).toBe(OPERATIONS_DEMO_EPOCH_MS - 3_600_000);
    expect(row.measured?.windowEnd).toBe(OPERATIONS_DEMO_EPOCH_MS);
  });

  it('window labels render with every verdict (1h and 24h for the catalog windows)', () => {
    expect(sloWindowLabel(3_600_000)).toBe('1h');
    expect(sloWindowLabel(86_400_000)).toBe('24h');
    expect(sloWindowLabel(1234)).toBe('1234ms');
    expect(sloWindowLabel(undefined)).toBeUndefined();
  });

  it('a no-data evaluation renders the no-data posture — never a pass, never a number', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const evaluation = corpus.sloEvaluations.find(
      (entry) => entry.sloId === 'slo-certification-determinism',
    );
    const definition = corpus.sloCatalog.find(
      (candidate) => candidate.sloId === 'slo-certification-determinism',
    );
    const row = toSloRowView({ definition, evaluation });
    expect(row.posture).toBe('no-data');
    expect(row.verdict).toBe('no-data');
    expect(row.measured).toBeNull();
    expect(row.noDataNote).toContain('no-data');
    expect(row.noDataNote).toContain('not a pass');
    expect(row.truthClass).toBe('evaluation-result');
  });

  it('a missing evaluation renders the honest no-data note (nothing fabricated)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const definition = corpus.sloCatalog.find(
      (candidate) => candidate.sloId === 'slo-runner-lease',
    );
    const row = toSloRowView({ definition });
    expect(row.posture).toBe('no-data');
    expect(row.verdict).toBe('unknown');
    expect(row.measured).toBeNull();
    expect(row.noDataNote).toContain('No evaluation is recorded');
    // The declared target still renders (a definition is a fact, not a measurement).
    expect(row.targetRatio).toBe(0.999);
    expect(row.windowLabel).toBe('24h');
  });

  it('the board summary counts rows over the closed verdict vocabulary', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const rows = corpus.sloEvaluations.map((evaluation) => ({
      definition: corpus.sloCatalog.find(
        (candidate) => candidate.sloId === evaluation.sloId,
      ),
      evaluation,
    }));
    const views = rows.map((input) => toSloRowView(input));
    const counts = sloVerdictCounts(views);
    expect(counts.breached).toBe(1);
    expect(counts['at-risk']).toBe(2);
    expect(counts.met).toBe(4);
    expect(counts['no-data']).toBe(1);
    expect(counts.unknown).toBe(0);
  });

  it('the empty-samples evaluation fails closed through the A035 evaluator itself', async () => {
    const catalog = await buildSloCatalog();
    const definition = catalog.find((candidate) => candidate.sloId === 'slo-job-completion');
    if (definition === undefined) {
      throw new Error('the SLO catalog must carry slo-job-completion');
    }
    const evaluation = evaluateSloEmpty(definition, OPERATIONS_DEMO_EPOCH_MS);
    expect(evaluation.verdict).toBe('no-data');
    expect(evaluation.sampleCount).toBe(0);
    expect(evaluation.errorBudget.exhausted).toBe(true);
    const row = toSloRowView({ definition, evaluation });
    expect(row.posture).toBe('no-data');
    expect(row.noDataNote).toContain('0 of at least 20');
  });
});

describe('slo view projection (adversarial — truthful degradation)', () => {
  it('a malformed definition degrades to the unknown truth class with named unknowns', () => {
    const row = toSloRowView({
      definition: { definitionVersion: 1, sloId: 'slo-x', targetRatio: 1.2 },
      evaluation: { sloId: 'slo-x', verdict: 'met' },
    });
    expect(row.readable).toBe(false);
    expect(row.truthClass).toBe('unknown');
    expect(row.sloId).toBeUndefined();
    expect(row.targetRatio).toBeUndefined();
    expect(row.posture).toBe('no-data');
    expect(row.unknownFields.join(' ')).toContain('unreadable');
  });

  it('an evaluation whose sloId does not match is not a measurement of this SLO', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const definition = corpus.sloCatalog.find(
      (candidate) => candidate.sloId === 'slo-job-completion',
    );
    const foreign = corpus.sloEvaluations.find(
      (entry) => entry.sloId === 'slo-job-latency',
    );
    const row = toSloRowView({ definition, evaluation: foreign });
    expect(row.posture).toBe('no-data');
    expect(row.verdict).toBe('unknown');
    expect(row.measured).toBeNull();
    expect(row.unknownFields.join(' ')).toContain('mismatch');
  });

  it('a foreign verdict value renders unknown — the closed vocabulary is never guessed', () => {
    const catalog = buildSloCatalog();
    const definition = catalog.find((candidate) => candidate.sloId === 'slo-job-completion');
    const row = toSloRowView({
      definition,
      evaluation: { sloId: 'slo-job-completion', verdict: 'excellent' },
    });
    expect(row.verdict).toBe('unknown');
    expect(row.posture).toBe('no-data');
    expect(row.unknownFields.join(' ')).toContain('evaluation');
  });

  it('non-object inputs degrade without throwing', () => {
    for (const payload of [null, undefined, 42, 'slo']) {
      const row = toSloRowView({ definition: payload });
      expect(row.truthClass).toBe('unknown');
      expect(row.readable).toBe(false);
    }
  });

  it('an SLO row never borrows job truth classes (evaluation results are their own class)', async () => {
    const corpus = await buildOperationsDemoCorpus();
    const definition = corpus.sloCatalog.find(
      (candidate) => candidate.sloId === 'slo-job-completion',
    );
    const evaluation = corpus.sloEvaluations.find(
      (entry) => entry.sloId === 'slo-job-completion',
    );
    const row = toSloRowView({ definition, evaluation });
    const job = toJobSummaryView(corpus.jobs[0]);
    expect(row.truthClass).not.toBe(job.truthClass === 'unknown' ? 'unknown' : 'evaluation-result-x');
    expect(row.truthClass).toBe('evaluation-result');
  });
});
