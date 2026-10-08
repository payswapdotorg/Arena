/**
 * SLO rollup tests (Work Order C021; issue #127): A035-vocabulary
 * aggregation determinism, disclosed formulas, explicit small-sample
 * status and cross-tenant suppression on aggregate endpoints.
 */

import { describe, expect, it } from 'vitest';

import { aggregateSloRollups, rollupSlo } from './slo.js';
import { EscalationObservabilityError } from './errors.js';

const WINDOW = { windowStart: 1_700_000_000_000, windowEnd: 1_700_003_600_000 };

function sample(occurredAt: number, good: boolean) {
  return { occurredAt, good };
}

describe('rollupSlo', () => {
  it('runs the REAL A035 evaluator (verdict + derived error budget)', () => {
    const view = rollupSlo({
      dimension: 'capability',
      key: 'sql-analysis',
      samples: Array.from({ length: 10 }, (_, index) =>
        sample(WINDOW.windowStart + index * 1000, index < 9),
      ),
      window: WINDOW,
      targetRatio: 0.8,
      atRiskThresholdRatio: 0.75,
    });
    expect(view.evaluation.sampleCount).toBe(10);
    expect(view.evaluation.goodCount).toBe(9);
    expect(view.evaluation.verdict).toBe('met');
    expect(view.evaluation.errorBudget.allowedBadRatio).toBeCloseTo(0.2, 12);
    expect(view.smallSample).toBe(false);
    expect(view.formula.statement).toContain('good / total');
    expect(view.sloId).toBe('slo-escalation-capability-sql-analysis');
  });

  it('reports at-risk when the budget burn crosses the at-risk threshold', () => {
    const view = rollupSlo({
      dimension: 'capability',
      key: 'sql-analysis',
      samples: Array.from({ length: 10 }, (_, index) =>
        sample(WINDOW.windowStart + index * 1000, index < 9),
      ),
      window: WINDOW,
      targetRatio: 0.9,
    });
    // 1 bad / 10 with 0.1 allowed burns exactly the whole budget.
    expect(view.evaluation.verdict).toBe('at-risk');
    expect(view.evaluation.errorBudget.consumedRatio).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('breaches honestly when achieved falls below target', () => {
    const view = rollupSlo({
      dimension: 'tenant',
      key: 'acme',
      samples: [
        sample(WINDOW.windowStart, true),
        sample(WINDOW.windowStart + 1, true),
        sample(WINDOW.windowStart + 2, false),
        sample(WINDOW.windowStart + 3, false),
      ],
      window: WINDOW,
      targetRatio: 0.9,
      minSampleCount: 2,
    });
    expect(view.evaluation.verdict).toBe('breached');
  });

  it('marks small-sample status explicitly (no-data fails closed)', () => {
    const view = rollupSlo({
      dimension: 'capability',
      key: 'rare-cap',
      samples: [sample(WINDOW.windowStart, true)],
      window: WINDOW,
      targetRatio: 0.9,
      minSampleCount: 5,
    });
    expect(view.evaluation.verdict).toBe('no-data');
    expect(view.evaluation.errorBudget.exhausted).toBe(true);
    expect(view.smallSample).toBe(true);
  });

  it('is deterministic: identical inputs yield identical rollups', () => {
    const input = {
      dimension: 'resource-class' as const,
      key: 'expert-human',
      samples: [
        sample(WINDOW.windowStart, true),
        sample(WINDOW.windowStart + 5, false),
      ],
      window: WINDOW,
      targetRatio: 0.5,
    };
    expect(rollupSlo(input)).toEqual(rollupSlo(input));
  });

  it('rejects samples outside the window (the A035 window discipline)', () => {
    expect(() =>
      rollupSlo({
        dimension: 'tenant',
        key: 'acme',
        samples: [sample(WINDOW.windowEnd + 1, true)],
        window: WINDOW,
        targetRatio: 0.9,
      }),
    ).toThrowError(/outside the evaluation window/);
  });

  it('rejects invalid targets, dimensions and keys', () => {
    expect(() =>
      rollupSlo({
        dimension: 'tenant',
        key: 'acme',
        samples: [],
        window: WINDOW,
        targetRatio: 1,
      }),
    ).toThrowError(/strictly within \(0, 1\)/);
    expect(() =>
      rollupSlo({
        dimension: 'region' as unknown as 'tenant',
        key: 'acme',
        samples: [],
        window: WINDOW,
        targetRatio: 0.9,
      }),
    ).toThrowError(/unknown SLO rollup dimension/);
    expect(() =>
      rollupSlo({ dimension: 'tenant', key: '', samples: [], window: WINDOW, targetRatio: 0.9 }),
    ).toThrowError(EscalationObservabilityError);
  });
});

describe('aggregateSloRollups (cross-tenant suppression)', () => {
  function cell(key: string, goodCount: number, badCount: number) {
    return rollupSlo({
      dimension: 'tenant',
      key,
      samples: [
        ...Array.from({ length: goodCount }, () => sample(WINDOW.windowStart, true)),
        ...Array.from({ length: badCount }, () => sample(WINDOW.windowStart, false)),
      ],
      window: WINDOW,
      targetRatio: 0.9,
      minSampleCount: 5,
    });
  }

  it('aggregates contributing cells and counts suppressed cells anonymously', () => {
    const aggregate = aggregateSloRollups({
      dimension: 'tenant',
      cells: [cell('acme', 8, 0), cell('small-co', 2, 0)],
      window: WINDOW,
      targetRatio: 0.9,
      minSampleCount: 5,
    });
    expect(aggregate.contributingCellCount).toBe(1);
    expect(aggregate.suppressedCellCount).toBe(1);
    expect(aggregate.evaluation.sampleCount).toBe(8);
    expect(aggregate.evaluation.goodCount).toBe(8);
    expect(aggregate.evaluation.verdict).toBe('met');
    // The suppressed cell's identity is NOWHERE on the view.
    const serialized = JSON.stringify(aggregate);
    expect(serialized).not.toContain('small-co');
    expect(serialized).not.toContain('acme');
  });

  it('ADVERSARIAL: tenant detail never leaks through the aggregate view', () => {
    const aggregate = aggregateSloRollups({
      dimension: 'tenant',
      cells: [cell('small-co', 3, 1), cell('tiny-co', 1, 0)],
      window: WINDOW,
      targetRatio: 0.9,
      minSampleCount: 5,
    });
    expect(aggregate.suppressedCellCount).toBe(2);
    expect(aggregate.contributingCellCount).toBe(0);
    // Every cell suppressed → no samples blend in, verdict fails closed.
    expect(aggregate.evaluation.sampleCount).toBe(0);
    expect(aggregate.evaluation.verdict).toBe('no-data');
    expect(JSON.stringify(aggregate)).not.toContain('small-co');
    expect(JSON.stringify(aggregate)).not.toContain('tiny-co');
  });

  it('rejects an unknown dimension', () => {
    expect(() =>
      aggregateSloRollups({
        dimension: 'planet' as unknown as 'tenant',
        cells: [],
        window: WINDOW,
        targetRatio: 0.9,
      }),
    ).toThrowError(/unknown SLO rollup dimension/);
  });
});
