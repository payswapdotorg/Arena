/**
 * Aggregate + ingestion-mapping tests (Work Order C005): the single-
 * dimension aggregate law (typed, versioned, disclosing formula/sample
 * sizes/limitations; cross-dimension rejection; the no-happy-path global
 * score) and the closed (source-family → dimension) ingestion mapping
 * with the forced evaluator-change attribution.
 */

import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_FORMULAS,
  MANDATORY_AGGREGATE_LIMITATIONS,
  EXPERT_PERFORMANCE_ERROR_CODES,
  ExpertPerformanceError,
  applyDimensionWeights,
  buildDimensionalSummaryAggregate,
  buildGlobalExpertScore,
  consumeProfileAsGlobalScore,
  createEvidenceRecord,
  evaluatorVersionOfSource,
  mapSourceEvidence,
} from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CAPABILITY = Object.freeze({
  kind: 'skill',
  id: 'rust-code-review',
  version: '1.0.0',
  digest: DIGEST_A,
});

async function evidence(overrides: Record<string, unknown>, index: number) {
  return createEvidenceRecord({
    recordId: `perf-${String(index).padStart(3, '0')}`,
    tenant: 'tenant-1',
    expertId: 'expert-1',
    dimension: 'skill-competency',
    outcome: 'demonstrated',
    applicability: { capability: CAPABILITY },
    sampleSize: 2,
    confidence: null,
    observedAt: '2026-09-01T00:00:00.000Z',
    recordedAt: '2026-09-01T01:00:00.000Z',
    source: { family: 'skill-extraction-outcome', refDigest: DIGEST_B, locator: DIGEST_B },
    attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A },
    ...overrides,
  } as Parameters<typeof createEvidenceRecord>[0]);
}

describe('DimensionalSummaryAggregate (the only aggregate)', () => {
  it('builds a typed, versioned, single-dimension frequency summary with disclosures', async () => {
    const first = await evidence({}, 1);
    const second = await evidence({ outcome: 'improved' }, 2);
    const aggregate = await buildDimensionalSummaryAggregate({
      dimension: 'skill-competency',
      records: [first, second],
      limitations: ['derived-test-window'],
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(aggregate.aggregateVersion).toBe(1);
    expect(aggregate.dimension).toBe('skill-competency');
    expect(aggregate.formula).toBe('dimensional-outcome-frequency');
    expect(aggregate.formulaVersion).toBe('1.0.0');
    expect(aggregate.outcomeCounts).toEqual({ demonstrated: 1, improved: 1 });
    expect(aggregate.sampleSize).toBe(4);
    expect(aggregate.limitations).toContain('derived-test-window');
    for (const disclosure of MANDATORY_AGGREGATE_LIMITATIONS) {
      expect(aggregate.limitations).toContain(disclosure);
    }
    expect(aggregate.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(AGGREGATE_FORMULAS).toEqual(['dimensional-outcome-frequency']);
  });

  it('REJECTS cross-dimension records (structurally unavailable aggregation)', async () => {
    const skill = await evidence({}, 1);
    const other = await evidence(
      {
        dimension: 'task-family-outcome',
        outcome: 'completed',
        applicability: { taskFamily: 'bug-fix-review' },
      },
      2,
    );
    await expect(
      buildDimensionalSummaryAggregate({
        dimension: 'skill-competency',
        records: [skill, other],
        asOf: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('the global score has NO happy path (three fail-closed markers)', () => {
    expect(() => consumeProfileAsGlobalScore()).toThrow(ExpertPerformanceError);
    expect(() => buildGlobalExpertScore('weighted-composite')).toThrow(ExpertPerformanceError);
    expect(() => applyDimensionWeights()).toThrow(ExpertPerformanceError);
    try {
      consumeProfileAsGlobalScore();
      expect.unreachable('global score consumption must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED,
      );
    }
  });

  it('is deterministic and excludes records recorded after asOf', async () => {
    const first = await evidence({}, 1);
    const later = await evidence(
      { outcome: 'improved', recordedAt: '2026-10-02T00:00:00.000Z' },
      2,
    );
    const aggregate = await buildDimensionalSummaryAggregate({
      dimension: 'skill-competency',
      records: [first, later],
      asOf: '2026-10-01T00:00:00.000Z',
    });
    expect(aggregate.outcomeCounts).toEqual({ demonstrated: 1 });
  });
});

describe('mapSourceEvidence (the closed ingestion mapping)', () => {
  it('maps a C004 calibration verdict into skill-competency evidence', () => {
    const mapped = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-101',
      family: 'expert-calibration-verdict',
      dimension: 'skill-competency',
      recordedAt: '2026-10-01T00:00:00.000Z',
      source: {
        verdict: 'calibrated',
        capability: CAPABILITY,
        evaluatorVersion: DIGEST_A,
        freshSampleCount: 5,
        totalSampleCount: 8,
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(mapped.dimension).toBe('skill-competency');
    expect(mapped.outcome).toBe('demonstrated');
    expect(mapped.sampleSize).toBe(5);
    expect(mapped.confidence).toBeCloseTo(5 / 8);
    expect(mapped.attribution.kind).toBe('expert-change');
    expect(mapped.source.refDigest).toBe(DIGEST_B);
  });

  it('FORCES evaluator-change when the evaluator version digest changed', () => {
    const mapped = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-102',
      family: 'expert-calibration-verdict',
      dimension: 'skill-competency',
      recordedAt: '2026-10-01T00:00:00.000Z',
      priorEvaluatorVersion: DIGEST_A,
      source: {
        verdict: 'calibrated',
        capability: CAPABILITY,
        evaluatorVersion: DIGEST_B,
        freshSampleCount: 5,
        totalSampleCount: 8,
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(mapped.attribution.kind).toBe('evaluator-change');
    expect(mapped.priorEvaluatorVersion).toBe(DIGEST_A);
  });

  it('rejects a family → dimension pair outside the closed mapping', () => {
    expect(() =>
      mapSourceEvidence({
        tenant: 'tenant-1',
        expertId: 'expert-1',
        recordId: 'perf-103',
        family: 'expert-qualification-record',
        dimension: 'skill-competency',
        recordedAt: '2026-10-01T00:00:00.000Z',
        source: {
          status: 'qualified',
          capability: CAPABILITY,
          domain: 'software',
          jurisdiction: null,
          conflicts: [],
          limitations: [],
          observedAt: '2026-09-20T00:00:00.000Z',
          recordDigest: DIGEST_B,
        },
      }),
    ).toThrow(ExpertPerformanceError);
  });

  it('maps qualification records (fit + conflict/limitation families)', () => {
    const fit = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-104',
      family: 'expert-qualification-record',
      dimension: 'domain-jurisdiction-fit',
      recordedAt: '2026-10-01T00:00:00.000Z',
      source: {
        status: 'qualified',
        capability: CAPABILITY,
        domain: 'software',
        jurisdiction: 'eu',
        conflicts: [],
        limitations: [],
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(fit.outcome).toBe('fit-confirmed');
    const conflict = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-105',
      family: 'expert-qualification-record',
      dimension: 'conflict-limitation',
      recordedAt: '2026-10-01T00:00:00.000Z',
      source: {
        status: 'qualified',
        capability: CAPABILITY,
        domain: 'software',
        jurisdiction: 'eu',
        conflicts: ['competitor-engagement'],
        limitations: [],
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(conflict.outcome).toBe('conflict-declared');
  });

  it('maps match history into task-family / review / agreement evidence without inventing outcomes', () => {
    const taskFamily = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-106',
      family: 'expert-match-history',
      dimension: 'task-family-outcome',
      recordedAt: '2026-10-01T00:00:00.000Z',
      source: {
        engagementOutcome: 'completed-with-revision',
        taskFamily: 'bug-fix-review',
        domain: 'software',
        evaluatorVersion: null,
        sampleSize: 1,
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(taskFamily.outcome).toBe('completed-with-revision');
    expect(taskFamily.applicability.taskFamily).toBe('bug-fix-review');

    expect(() =>
      mapSourceEvidence({
        tenant: 'tenant-1',
        expertId: 'expert-1',
        recordId: 'perf-107',
        family: 'expert-match-history',
        dimension: 'review-outcome',
        recordedAt: '2026-10-01T00:00:00.000Z',
        source: {
          engagementOutcome: 'completed',
          taskFamily: 'bug-fix-review',
          domain: 'software',
          evaluatorVersion: null,
          sampleSize: 1,
          observedAt: '2026-09-20T00:00:00.000Z',
          recordDigest: DIGEST_B,
        },
      }),
    ).toThrow(ExpertPerformanceError);
  });

  it('maps A020 learning attribution verbatim (evaluator-change never becomes expert-change)', () => {
    const mapped = mapSourceEvidence({
      tenant: 'tenant-1',
      expertId: 'expert-1',
      recordId: 'perf-108',
      family: 'learning-experiment-attribution',
      dimension: 'skill-competency',
      recordedAt: '2026-10-01T00:00:00.000Z',
      source: {
        attributionKind: 'evaluator-change',
        evaluatorVersionBefore: DIGEST_A,
        evaluatorVersionAfter: DIGEST_B,
        capability: CAPABILITY,
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      },
    });
    expect(mapped.attribution.kind).toBe('evaluator-change');
    expect(mapped.outcome).toBe('inconclusive');
    expect(mapped.attribution.evaluatorVersion).toBe(DIGEST_B);
  });

  it('exposes the evaluator version of a source for prior-version threading', () => {
    expect(
      evaluatorVersionOfSource({
        verdict: 'calibrated',
        capability: CAPABILITY,
        evaluatorVersion: DIGEST_A,
        freshSampleCount: 1,
        totalSampleCount: 1,
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      }),
    ).toBe(DIGEST_A);
    expect(
      evaluatorVersionOfSource({
        status: 'qualified',
        capability: CAPABILITY,
        domain: 'software',
        jurisdiction: null,
        conflicts: [],
        limitations: [],
        observedAt: '2026-09-20T00:00:00.000Z',
        recordDigest: DIGEST_B,
      }),
    ).toBeNull();
  });

  it('rejects sources whose data cannot honestly express the dimension', () => {
    expect(() =>
      mapSourceEvidence({
        tenant: 'tenant-1',
        expertId: 'expert-1',
        recordId: 'perf-109',
        family: 'learning-experiment-attribution',
        dimension: 'skill-competency',
        recordedAt: '2026-10-01T00:00:00.000Z',
        source: {
          attributionKind: 'expert-change',
          evaluatorVersionBefore: null,
          evaluatorVersionAfter: null,
          capability: null,
          observedAt: '2026-09-20T00:00:00.000Z',
          recordDigest: DIGEST_B,
        },
      }),
    ).toThrow(ExpertPerformanceError);
  });
});
