/**
 * SLO evaluation tests (Work Order A035): positive + adversarial
 * (budget math, window violations, no-data fail-closed).
 */

import { describe, expect, it } from 'vitest';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import { evaluateSlo, toSloDefinition } from './slo.js';
import type { SloDefinition } from './slo.js';
import { logSignal, metricSignal, sloDefinition, windowOf } from './test-support.js';
import { isSloDefinition } from './slo.js';
import type { EvaluationWindow } from './slo.js';

function errorOf(fn: () => unknown): ObservabilityError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ObservabilityError) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

const WINDOW_MS = 3_600_000;

function windowFor(windowMs = WINDOW_MS): EvaluationWindow {
  return windowOf(windowMs);
}

describe('SLO definitions', () => {
  it('validates a structurally valid definition and freezes it (positive)', () => {
    const definition = sloDefinition();
    expect(isSloDefinition(definition)).toBe(true);
    const round = toSloDefinition(JSON.parse(JSON.stringify(definition)));
    expect(round).toEqual(definition);
    expect(Object.isFrozen(round)).toBe(true);
    expect(Object.isFrozen(round.sli)).toBe(true);
  });

  it('rejects invalid targets, windows, sample floors (adversarial)', () => {
    for (const bad of [0, 1, 1.5, -0.1]) {
      expect(errorOf(() => toSloDefinition({ ...sloDefinition(), targetRatio: bad })).code).toBe(
        OBS_ERROR_CODES.INVALID_SLO,
      );
    }
    expect(errorOf(() => toSloDefinition({ ...sloDefinition(), windowMs: 0 })).code).toBe(
      OBS_ERROR_CODES.INVALID_SLO,
    );
    expect(errorOf(() => toSloDefinition({ ...sloDefinition(), minSampleCount: 0 })).code).toBe(
      OBS_ERROR_CODES.INVALID_SLO,
    );
  });

  it('requires thresholdMs only for latency indicators (adversarial)', () => {
    // latency indicator WITHOUT a threshold:
    expect(
      errorOf(() => toSloDefinition(sloDefinition({ sliKind: 'latency-threshold-ratio', thresholdMs: null }))).code,
    ).toBe(OBS_ERROR_CODES.INVALID_SLO);
    // non-latency indicator WITH a threshold:
    expect(
      errorOf(() =>
        toSloDefinition({ ...sloDefinition(), sli: { kind: 'good-total-ratio', metricName: 'job-outcome-good', thresholdMs: 100 } }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_SLO);
  });
});

describe('SLO evaluation (good-total-ratio)', () => {
  const definition: SloDefinition = sloDefinition({ minSampleCount: 10 });

  function samples(count: number, bad: number, start = 1_000_000): ReturnType<typeof metricSignal>[] {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(
        metricSignal({
          sequence: i + 1,
          occurredAt: start + i * 1_000,
          value: i < count - bad ? 1 : 0,
        }),
      );
    }
    return out;
  }

  it('reports MET with untouched budget when the target holds (positive)', () => {
    const clean = evaluateSlo({ definition, window: windowFor(), samples: samples(100, 0) });
    expect(clean.verdict).toBe('met');
    expect(clean.sampleCount).toBe(100);
    expect(clean.goodCount).toBe(100);
    expect(clean.achievedRatio).toBe(1);
    expect(clean.errorBudget.consumedRatio).toBe(0);
    expect(clean.errorBudget.exhausted).toBe(false);
    expect(clean.targetRatio).toBeCloseTo(0.99, 12);
  });

  it('derives the error budget as 1 - target and reports burn exactly (positive)', () => {
    const evaluation = evaluateSlo({
      definition,
      window: windowFor(),
      samples: samples(200, 2), // observed bad ratio 0.01 == allowed 0.01
    });
    expect(evaluation.errorBudget.allowedBadRatio).toBeCloseTo(0.01, 12);
    expect(evaluation.errorBudget.observedBadRatio).toBeCloseTo(0.01, 12);
    expect(evaluation.errorBudget.consumedRatio).toBeCloseTo(1, 12);
    expect(evaluation.errorBudget.exhausted).toBe(true);
    expect(evaluation.verdict).toBe('at-risk'); // achieved 0.99 >= target; budget fully burned
  });

  it('reports BREACHED when the achieved ratio drops below target (positive)', () => {
    const evaluation = evaluateSlo({
      definition,
      window: windowFor(),
      samples: samples(100, 5),
    });
    expect(evaluation.achievedRatio).toBeCloseTo(0.95, 12);
    expect(evaluation.verdict).toBe('breached');
    expect(evaluation.errorBudget.exhausted).toBe(true);
    expect(evaluation.errorBudget.remainingRatio).toBe(0);
  });

  it('classifies at-risk between met and breached via atRiskThresholdRatio (positive)', () => {
    const evaluation = evaluateSlo({
      definition,
      window: windowFor(),
      samples: samples(1000, 7), // 0.993 achieved >= 0.99 target; burn 0.7 of budget
    });
    expect(evaluation.verdict).toBe('at-risk');
    expect(evaluation.errorBudget.consumedRatio).toBeCloseTo(0.7, 12);
  });

  it('ignores signals from other services / other metrics (positive scoping)', () => {
    const foreign = [
      ...samples(10, 0),
      metricSignal({ sequence: 11, occurredAt: 1_010_000, sourceService: 'certification-fabric' }),
      metricSignal({ sequence: 12, occurredAt: 1_011_000, metricName: 'other-metric' }),
    ];
    const evaluation = evaluateSlo({ definition, window: windowFor(), samples: foreign });
    expect(evaluation.sampleCount).toBe(10);
  });

  it('NO-DATA FAILS CLOSED: below minSampleCount the verdict is no-data, never met (adversarial)', () => {
    const evaluation = evaluateSlo({
      definition,
      window: windowFor(),
      samples: samples(9, 0),
    });
    expect(evaluation.verdict).toBe('no-data');
    expect(evaluation.errorBudget.exhausted).toBe(true);
    expect(evaluation.errorBudget.remainingRatio).toBe(0);
    expect(evaluation.achievedRatio).toBe(0);
  });
});

describe('SLO evaluation (latency-threshold-ratio)', () => {
  it('measures the share of samples within the latency threshold (positive)', () => {
    const definition = sloDefinition({
      sliKind: 'latency-threshold-ratio',
      metricName: 'job-latency-ms',
      thresholdMs: 200,
      targetRatio: 0.95,
      minSampleCount: 4,
    });
    const samples = [50, 100, 150, 400, 120, 130].map((value, i) =>
      metricSignal({
        sequence: i + 1,
        occurredAt: 1_000_000 + i * 1_000,
        metricName: 'job-latency-ms',
        value,
      }),
    );
    const evaluation = evaluateSlo({ definition, window: windowFor(), samples });
    expect(evaluation.sampleCount).toBe(6);
    expect(evaluation.goodCount).toBe(5);
    expect(evaluation.achievedRatio).toBeCloseTo(5 / 6, 12);
  });
});

describe('SLO evaluation (log-error-ratio)', () => {
  it('measures the healthy share of the service log stream (positive)', () => {
    const definition = sloDefinition({
      sliKind: 'log-error-ratio',
      metricName: 'logs',
      service: 'certification-fabric',
      targetRatio: 0.5,
      atRiskThresholdRatio: 0.9,
      minSampleCount: 5,
    });
    const levels = ['info', 'info', 'error', 'warn', 'info', 'info', 'error', 'info'] as const;
    const samples = levels.map((level, i) =>
      logSignal({
        sequence: i + 1,
        occurredAt: 1_000_000 + i * 1_000,
        sourceService: 'certification-fabric',
        level,
      }),
    );
    const evaluation = evaluateSlo({ definition, window: windowFor(), samples });
    expect(evaluation.sampleCount).toBe(8);
    // warn counts as bad for the healthy share
    expect(evaluation.goodCount).toBe(5);
    expect(evaluation.verdict).toBe('met');
  });
});

describe('window discipline (adversarial)', () => {
  const definition: SloDefinition = sloDefinition({ minSampleCount: 1 });

  it('rejects samples outside the window (never silently widens)', () => {
    const samples = [
      metricSignal({ sequence: 1, occurredAt: 1_000_000 - 1, value: 1 }),
    ];
    expect(
      errorOf(() => evaluateSlo({ definition, window: windowFor(), samples })).code,
    ).toBe(OBS_ERROR_CODES.SAMPLE_OUTSIDE_WINDOW);
    const late = [metricSignal({ sequence: 1, occurredAt: 1_000_000 + WINDOW_MS + 1, value: 1 })];
    expect(
      errorOf(() => evaluateSlo({ definition, window: windowFor(), samples: late })).code,
    ).toBe(OBS_ERROR_CODES.SAMPLE_OUTSIDE_WINDOW);
  });

  it('rejects unordered samples', () => {
    const samples = [
      metricSignal({ sequence: 1, occurredAt: 1_001_000, value: 1 }),
      metricSignal({ sequence: 2, occurredAt: 1_000_500, value: 1 }),
    ];
    expect(errorOf(() => evaluateSlo({ definition, window: windowFor(), samples })).code).toBe(
      OBS_ERROR_CODES.SAMPLES_UNORDERED,
    );
  });

  it('rejects windows whose duration differs from windowMs (no silent widening/shrinking)', () => {
    const window: EvaluationWindow = {
      windowStart: 1_000_000 as EvaluationWindow['windowStart'],
      windowEnd: (1_000_000 + WINDOW_MS - 1) as EvaluationWindow['windowEnd'],
    };
    const samples = [metricSignal({ sequence: 1, occurredAt: 1_000_000, value: 1 })];
    expect(errorOf(() => evaluateSlo({ definition, window, samples })).code).toBe(
      OBS_ERROR_CODES.INVALID_WINDOW,
    );
  });

  it('rejects inverted / malformed windows', () => {
    const samples = [metricSignal({ sequence: 1, occurredAt: 1_000_000, value: 1 })];
    expect(
      errorOf(() =>
        evaluateSlo({
          definition,
          window: { windowStart: 2_000_000, windowEnd: 1_000_000 } as unknown as EvaluationWindow,
          samples,
        }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_WINDOW);
    expect(
      errorOf(() =>
        evaluateSlo({
          definition,
          window: { windowStart: -1, windowEnd: WINDOW_MS } as unknown as EvaluationWindow,
          samples,
        }),
      ).code,
    ).toBe(OBS_ERROR_CODES.INVALID_WINDOW);
  });
});
