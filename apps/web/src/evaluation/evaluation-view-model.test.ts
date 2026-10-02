/**
 * Evaluation report view-model tests (Work Order B012; issue #87).
 *
 * Positive: the full projection of the REAL A012 objects — suite
 * identity on every metric, run conditions, honest not-verified framing.
 * Adversarial: malformed payloads degrade TRUTHFULLY (named unknown
 * fields, no fabricated scores, no thrown renders).
 */

import { describe, expect, it } from 'vitest';

import { toEvaluationReportView } from './evaluation-view-model.js';
import { buildEvaluationDemoCorpus, EVALUATION_DEMO_IDS } from './fixtures.js';

describe('evaluation report view projection (positive)', () => {
  it('projects the full report: suite identity, metrics, run conditions, not-verified framing', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = toEvaluationReportView({
      record: corpus.evaluationRecord,
      criteria: corpus.criteria,
      descriptor: corpus.evaluator,
      reportId: EVALUATION_DEMO_IDS.report,
    });

    expect(view.viewVersion).toBe(1);
    expect(view.readable).toBe(true);
    expect(view.reportId).toBe(EVALUATION_DEMO_IDS.report);
    expect(view.digest).toBe(corpus.evaluationRecord.digest);
    // The governing truth class: an evaluation result is NEVER a verification claim.
    expect(view.truthClass).toBe('evaluation-result');
    expect(view.notVerifiedNote).toContain('NOT a verification outcome');
    expect(view.unknownFields).toEqual([]);

    // Suite identity rides with every score set.
    expect(view.suite.criteriaId).toBe('criteria-payments-reliability');
    expect(view.suite.criteriaVersion).toBe('1.0.0');
    expect(view.suite.aggregation).toBe('weighted-sum');
    expect(view.suite.passAt).toBe(0.75);
    expect(view.suite.evaluatorId).toBe('evaluator-payments-reliability');
    expect(view.suite.evaluatorKind).toBe('deterministic-test');
    expect(view.suite.evaluatorRef).toBe(corpus.evaluator.digest);

    // Metrics: one row per criterion verdict, with weight + judgment.
    expect(view.metrics).toHaveLength(3);
    expect(view.metrics[0]?.criterionId).toBe('regression-coverage');
    expect(view.metrics[0]?.weight).toBe(1);
    expect(view.metrics[0]?.score).toBe(0.9);
    expect(view.metrics[0]?.judgment).toContain('Regression tests');
    // weighted-sum: the pass bar applies at the aggregate — per-criterion pass is Unknown, not guessed.
    expect(view.metrics[0]?.meetsThreshold).toBeNull();

    // Run conditions render with every report.
    expect(view.runConditions.seed).toBe('demo-seed-payments-reliability-001');
    expect(view.runConditions.deterministic).toBe(true);
    expect(view.runConditions.requiresHuman).toBe(false);
    expect(view.runConditions.startedAt).toBe('2026-10-01T08:05:00.000Z');
    expect(view.runConditions.executedBy).toBe('arena-demo-evaluator');

    // The aggregate is the package's computed judgment.
    expect(view.aggregate?.outcome).toBe('meets-criteria');
    expect(view.aggregate?.score).toBeCloseTo(0.916667, 6);
    expect(view.confidence).toBe(0.9);

    // Subject refs render as digest addresses.
    expect(view.subjects.caseRef).toBe(corpus.evaluationRecord.caseRef);
  });

  it('is deterministic: two projections of the same corpus are identical', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const one = toEvaluationReportView({ record: corpus.evaluationRecord, criteria: corpus.criteria, descriptor: corpus.evaluator });
    const two = toEvaluationReportView({ record: corpus.evaluationRecord, criteria: corpus.criteria, descriptor: corpus.evaluator });
    expect(one).toEqual(two);
  });
});

describe('evaluation report view projection (adversarial — truthful degradation)', () => {
  it('degrades a structurally unreadable record without throwing and without fabricating', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    for (const malformed of [null, 42, 'record', {}, { recordVersion: 99 }]) {
      const view = toEvaluationReportView({
        record: malformed,
        criteria: corpus.criteria,
        descriptor: corpus.evaluator,
      });
      expect(view.readable).toBe(false);
      expect(view.digest).toBeNull();
      expect(view.aggregate).toBeNull();
      expect(view.metrics).toEqual([]);
      expect(view.unknownFields).toContain('evaluation record (structurally unreadable)');
      // The truth class stays 'evaluation-result' (the surface's contract),
      // but the record itself is marked unreadable — never a guessed report.
      expect(view.runConditions.startedAt).toBeUndefined();
    }
  });

  it('degrades the suite identity honestly when the criteria/descriptor pieces are missing', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const view = toEvaluationReportView({ record: corpus.evaluationRecord });
    expect(view.readable).toBe(true);
    expect(view.suite.criteriaId).toBeUndefined();
    expect(view.suite.passAt).toBeUndefined();
    expect(view.suite.evaluatorId).toBeUndefined();
    // The record still binds its digest refs — those are honest.
    expect(view.suite.criteriaRef).toBe(corpus.evaluationRecord.criteriaRef);
    expect(view.unknownFields).toContain('criteria set');
    expect(view.unknownFields).toContain('evaluator descriptor');
    // Metrics lose weight/description (unknown), keep the honest score.
    expect(view.metrics).toHaveLength(3);
    expect(view.metrics[0]?.score).toBe(0.9);
    expect(view.metrics[0]?.weight).toBeUndefined();
    expect(view.unknownFields).toContain('criteria entry regression-coverage');
    expect(view.metrics[0]?.meetsThreshold).toBeNull();
  });

  it('never invents a verification posture: the not-verified note rides even the degraded view', async () => {
    const view = toEvaluationReportView({ record: {} });
    expect(view.truthClass).toBe('evaluation-result');
    expect(view.notVerifiedNote).toContain('NOT a verification outcome');
  });
});
