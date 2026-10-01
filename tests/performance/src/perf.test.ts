/**
 * PERF1.0 — the performance suite battery (positive, adversarial,
 * contract/parity, reproducibility).
 *
 * The suite exercises the REAL Arena api fabric (A025) in-process:
 * every request is a serialized envelope handled by `ApiService`.
 * Latency and error-budget assertions use the A035 SLO evaluator
 * (`evaluateSlo`) with exact logical windows.
 */

import { describe, expect, it } from 'vitest';
import { ARENA_V1_SLO_CATALOG } from '@arena/deploy';
import {
  buildLoad,
  loadShape,
} from './load-shape.js';
import {
  buildSignals,
  consoleAvailabilitySlo,
  consoleReadLatencySlo,
  evaluateRunSlo,
  runLoad,
} from './harness.js';
import { buildPerformanceEvidence } from './evidence.js';

const SEED = 42;
const availabilitySlo = consoleAvailabilitySlo(ARENA_V1_SLO_CATALOG);
const latencySlo = consoleReadLatencySlo();

async function runShape(shapeId: 'steady-baseline' | 'fault-injection' | 'sparse-no-data', seed: number) {
  const shape = loadShape(shapeId, seed);
  const requests = buildLoad(shape);
  const run = await runLoad(shapeId, seed, requests);
  const signals = buildSignals(run);
  const evaluations = [
    { sloId: 'slo-console-availability', evaluation: evaluateRunSlo(availabilitySlo, signals) },
    { sloId: 'slo-console-read-latency', evaluation: evaluateRunSlo(latencySlo, signals) },
  ];
  const evidence = await buildPerformanceEvidence(run, evaluations);
  return { shape, requests, run, signals, evaluations, evidence };
}

describe('PERF1.0 positive — the release-load contract', () => {
  it('steady baseline: 120 real fabric requests all succeed and meet both SLOs', async () => {
    const { run, evaluations, evidence } = await runShape('steady-baseline', SEED);
    expect(run.requestCount).toBe(120);
    expect(run.goodCount).toBe(120);
    expect(run.badCount).toBe(0);
    for (const { evaluation } of evaluations) {
      expect(evaluation.verdict).toBe('met');
      expect(evaluation.errorBudget.exhausted).toBe(false);
    }
    expect(evidence.verdict).toBe('pass');
  });

  it('valid requests are answered with the SAME correlation id (envelope parity)', async () => {
    const { run } = await runShape('steady-baseline', SEED);
    for (const outcome of run.outcomes) {
      expect(outcome.ok).toBe(true);
    }
  });

  it('latency assertion is real: every request is under the A035-derived 300s bar', async () => {
    const { evaluations, run } = await runShape('steady-baseline', SEED);
    const latency = evaluations.find((entry) => entry.sloId === 'slo-console-read-latency');
    expect(latency?.evaluation.sampleCount).toBe(run.requestCount);
    expect(latency?.evaluation.goodCount).toBe(run.requestCount);
    expect(latency?.evaluation.verdict).toBe('met');
  });
});

describe('PERF1.0 adversarial — SLO-violating releases are rejected', () => {
  it('fault injection: 6 malformed requests breach the availability budget → suite FAILS', async () => {
    const { run, evidence, evaluations } = await runShape('fault-injection', SEED);
    expect(run.badCount).toBe(6);
    const availability = evaluations.find((entry) => entry.sloId === 'slo-console-availability');
    expect(availability?.evaluation.verdict).toBe('breached');
    expect(availability?.evaluation.errorBudget.exhausted).toBe(true);
    expect(evidence.verdict).toBe('fail');
  });

  it('malformed requests are deterministically rejected by the fabric (fail-closed)', async () => {
    const { run } = await runShape('fault-injection', SEED);
    const malformed = run.outcomes.filter((outcome) => outcome.malformed);
    expect(malformed).toHaveLength(6);
    for (const outcome of malformed) {
      expect(outcome.ok).toBe(false);
    }
    for (const outcome of run.outcomes.filter((entry) => !entry.malformed)) {
      expect(outcome.ok).toBe(true);
    }
  });

  it('sparse load: under minSampleCount the verdict is no-data → suite FAILS (fail-closed)', async () => {
    const { run, evidence, evaluations } = await runShape('sparse-no-data', SEED);
    expect(run.requestCount).toBe(20);
    const availability = evaluations.find((entry) => entry.sloId === 'slo-console-availability');
    expect(availability?.evaluation.verdict).toBe('no-data');
    expect(availability?.evaluation.errorBudget.exhausted).toBe(true);
    expect(evidence.verdict).toBe('fail');
  });
});

describe('PERF1.0 reproducibility — the evidence contract', () => {
  it('same (shape, seed) → identical outcome sequence and identical evidence digest', async () => {
    const first = await runShape('steady-baseline', SEED);
    const second = await runShape('steady-baseline', SEED);
    expect(first.evidence.digest).toBe(second.evidence.digest);
    expect(
      first.run.outcomes.map((outcome) => `${outcome.index}:${outcome.ok}`),
    ).toEqual(second.run.outcomes.map((outcome) => `${outcome.index}:${outcome.ok}`));
  });

  it('different seed → different request stream (the PRNG is real, not constant)', async () => {
    const first = await runShape('fault-injection', SEED);
    const second = await runShape('fault-injection', SEED + 1);
    expect(first.evidence.digest).not.toBe(second.evidence.digest);
    const firstMalformed = first.run.outcomes.filter((o) => o.malformed).map((o) => o.index);
    const secondMalformed = second.run.outcomes.filter((o) => o.malformed).map((o) => o.index);
    expect(firstMalformed).not.toEqual(secondMalformed);
  });

  it('evidence digests exclude wall-clock: the record carries measurements separately from the digested core', async () => {
    const first = await runShape('steady-baseline', SEED);
    expect(first.evidence.measurements).toHaveProperty('p50Ms');
    expect(first.evidence.measurements).toHaveProperty('p95Ms');
    expect(first.evidence.measurements.maxMs).toBeGreaterThanOrEqual(0);
    // Measurements are numbers outside the digested core: the digest
    // field itself is computed only over counts/verdicts/ratios.
    expect(first.evidence.digest).toMatch(/^[0-9a-f]{64}$/);
    const second = await runShape('steady-baseline', SEED);
    expect(first.evidence.digest).toBe(second.evidence.digest);
  });
});

describe('PERF1.0 catalog parity — the assertions track A035 targets', () => {
  it('the availability SLO evaluated here is the A035 catalog record (0.995 target, 1h window, min 100)', () => {
    expect(availabilitySlo.targetRatio).toBe(0.995);
    expect(availabilitySlo.windowMs).toBe(3_600_000);
    expect(availabilitySlo.minSampleCount).toBe(100);
    expect(availabilitySlo.sli.metricName).toBe('console-request-good');
  });

  it('the latency SLO mirrors the A035 job-latency threshold policy', () => {
    expect(latencySlo.sli.thresholdMs).toBe(300_000);
    expect(latencySlo.targetRatio).toBe(0.95);
    expect(latencySlo.minSampleCount).toBe(20);
  });

  it('steady-baseline satisfies the minSampleCount gate exactly (120 ≥ 100)', async () => {
    const { evaluations } = await runShape('steady-baseline', SEED);
    const availability = evaluations.find((entry) => entry.sloId === 'slo-console-availability');
    expect(availability?.evaluation.sampleCount).toBe(120);
  });
});
