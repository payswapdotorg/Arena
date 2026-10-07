/**
 * Drift-verdict derivation tests (Work Order C004): typed verdicts over
 * predicted-vs-observed, precedence, and input-order determinism.
 */

import { describe, expect, it } from 'vitest';
import { createDriftPolicy, deriveDriftVerdict, DRIFT_VERDICTS, summarizeCalibrationRecords } from './verdict.js';
import { ExpertCalibrationError } from './errors.js';
import type { CalibrationRecord } from './record.js';
import {
  buildCalibrationRecord,
  buildProgram,
  T1,
  T2,
  T3,
} from './test-support.js';

const POLICY = createDriftPolicy({ minimumSample: 3, tolerance: 0.1, freshnessWindowDays: 90 });

async function records(
  specs: readonly { confidence: number; outcome: 'correct' | 'incorrect' | 'inconclusive'; observedAt?: string; predictedAt?: string }[],
): Promise<CalibrationRecord[]> {
  const program = await buildProgram();
  const built: CalibrationRecord[] = [];
  for (const [index, spec] of specs.entries()) {
    built.push(
      await buildCalibrationRecord({
        calibrationId: `cal-record-${index + 1}`,
        programDigest: program.digest,
        predicted: { confidence: spec.confidence, score: null },
        observed: { outcome: spec.outcome, score: null },
        predictedAt: spec.predictedAt ?? T1,
        observedAt: spec.observedAt ?? T2,
        provenance: { recordedBy: 'verifier-tax-audit', recordedAt: T2, notes: null },
      }),
    );
  }
  return built;
}

describe('createDriftPolicy', () => {
  it('rejects a zero minimum sample, out-of-band tolerance and non-positive windows', () => {
    expect(() => createDriftPolicy({ minimumSample: 0, tolerance: 0.1, freshnessWindowDays: 90 })).toThrow(ExpertCalibrationError);
    expect(() => createDriftPolicy({ minimumSample: 3, tolerance: 1.5, freshnessWindowDays: 90 })).toThrow(ExpertCalibrationError);
    expect(() => createDriftPolicy({ minimumSample: 3, tolerance: 0.1, freshnessWindowDays: 0 })).toThrow(ExpertCalibrationError);
  });
});

describe('deriveDriftVerdict', () => {
  it('derives CALIBRATED when |bias| <= tolerance over the fresh decided sample', async () => {
    const built = await records([
      { confidence: 0.7, outcome: 'correct' },
      { confidence: 0.7, outcome: 'correct' },
      { confidence: 0.7, outcome: 'incorrect' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('calibrated');
    // mean confidence 0.7, observed rate 2/3 => bias ≈ 0.0333
    expect(verdict.bias).toBeCloseTo(0.7 - 2 / 3, 10);
    expect(verdict.freshDecidedCount).toBe(3);
  });

  it('derives OVERCONFIDENT when predicted confidence exceeds observed outcomes', async () => {
    const built = await records([
      { confidence: 0.9, outcome: 'correct' },
      { confidence: 0.9, outcome: 'incorrect' },
      { confidence: 0.9, outcome: 'incorrect' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('overconfident');
    expect(verdict.bias).toBeCloseTo(0.9 - 1 / 3, 10);
  });

  it('derives UNDERCONFIDENT when observed outcomes exceed predicted confidence', async () => {
    const built = await records([
      { confidence: 0.2, outcome: 'correct' },
      { confidence: 0.2, outcome: 'correct' },
      { confidence: 0.2, outcome: 'correct' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('underconfident');
    expect(verdict.bias).toBeCloseTo(0.2 - 1, 10);
  });

  it('derives INSUFFICIENT-SAMPLE below the declared minimum fresh decided sample', async () => {
    const built = await records([
      { confidence: 0.8, outcome: 'correct' },
      { confidence: 0.8, outcome: 'incorrect' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('insufficient-sample');
    expect(verdict.bias).toBeNull();
  });

  it('derives STALE when every decided observation aged out of the freshness window', async () => {
    const built = await records([
      { confidence: 0.8, outcome: 'correct', predictedAt: '2026-05-01T00:00:00.000Z', observedAt: '2026-06-01T00:00:00.000Z' },
      { confidence: 0.8, outcome: 'incorrect', predictedAt: '2026-05-02T00:00:00.000Z', observedAt: '2026-06-02T00:00:00.000Z' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('stale');
    expect(verdict.staleDecidedCount).toBe(2);
    expect(verdict.freshDecidedCount).toBe(0);
  });

  it('never folds inconclusive outcomes into the bias (LE1.0: compare against decided outcomes)', async () => {
    const built = await records([
      { confidence: 0.8, outcome: 'inconclusive' },
      { confidence: 0.8, outcome: 'inconclusive' },
      { confidence: 0.8, outcome: 'inconclusive' },
    ]);
    const verdict = deriveDriftVerdict(built, POLICY, T3);
    expect(verdict.verdict).toBe('stale'); // zero fresh DECIDED records, records exist
    expect(verdict.inconclusiveCount).toBe(3);
  });

  it('is DETERMINISTIC under input permutation (seeded ordering)', async () => {
    const built = await records([
      { confidence: 0.6, outcome: 'correct', observedAt: '2026-10-02T01:00:00.000Z' },
      { confidence: 0.8, outcome: 'correct', observedAt: '2026-10-02T02:00:00.000Z' },
      { confidence: 0.4, outcome: 'incorrect', observedAt: '2026-10-02T00:30:00.000Z' },
    ]);
    const forward = deriveDriftVerdict(built, POLICY, T3);
    const reversed = deriveDriftVerdict([...built].reverse(), POLICY, T3);
    expect(forward).toEqual(reversed);
  });

  it('keeps the verdict vocabulary closed', () => {
    expect([...DRIFT_VERDICTS]).toEqual([
      'calibrated',
      'overconfident',
      'underconfident',
      'insufficient-sample',
      'stale',
    ]);
  });
});

describe('summarizeCalibrationRecords', () => {
  it('reports the pure LE1.0 diagnostic (never a capability claim)', async () => {
    const built = await records([
      { confidence: 1.0, outcome: 'correct' },
      { confidence: 0.0, outcome: 'incorrect' },
      { confidence: 0.5, outcome: 'inconclusive' },
    ]);
    const summary = summarizeCalibrationRecords(built);
    expect(summary.recordCount).toBe(3);
    expect(summary.correctCount).toBe(1);
    expect(summary.incorrectCount).toBe(1);
    expect(summary.inconclusiveCount).toBe(1);
    expect(summary.brierScore).toBe(0);
  });
});
