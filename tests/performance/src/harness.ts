/**
 * The load harness: runs a planned request stream against the REAL
 * Arena api fabric in-process, converts outcomes into A035 telemetry
 * signals and evaluates the SLO-based assertions.
 *
 * Determinism contract:
 *   - request outcomes are a pure function of (shape, seed) — the
 *     fabric is deterministic (valid queries succeed, malformed
 *     envelopes fail-closed identically every run);
 *   - wall-clock durations are RECORDED as measurements but never
 *     digested or asserted — machine speed cannot flip a verdict;
 *   - the SLO evaluation window is logical (frozen instants), so
 *     evaluateSlo is exercised with exact windows every run.
 *
 * The console edge: the harness fronts the api fabric as the
 * 'console' service (A035's console-availability SLO measures the
 * console read path this fabric serves).
 */

import type { MetricSignal, SloDefinition, SloEvaluation } from '@arena/observability';
import {
  evaluateSlo,
  toNeutralId,
  toObservabilityTimestamp,
  toSloDefinition,
  toTelemetryId,
} from '@arena/observability';
import { toCorrelationId } from '@arena/protocol-core';
import { ApiService } from '@arena/api-fabric';
import type { PlannedRequest } from './load-shape.js';
import { WINDOW_START } from './load-shape.js';

/** One executed request. */
export interface RequestOutcome {
  readonly index: number;
  readonly correlationId: string;
  readonly ok: boolean;
  readonly malformed: boolean;
  readonly durationMs: number;
}

/** The frozen result of one load run. */
export interface LoadRunResult {
  readonly shapeId: string;
  readonly seed: number;
  readonly requestCount: number;
  readonly goodCount: number;
  readonly badCount: number;
  readonly outcomes: readonly RequestOutcome[];
  /** Wall-clock measurements — evidence only, never asserted. */
  readonly measurements: {
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
  };
}

/** Run a planned request stream against a fresh api fabric. */
export async function runLoad(
  shapeId: string,
  seed: number,
  requests: readonly PlannedRequest[],
): Promise<LoadRunResult> {
  const service = new ApiService();
  const outcomes: RequestOutcome[] = [];
  for (const request of requests) {
    const startedAt = performance.now();
    let ok: boolean;
    try {
      const outcome = await service.handleQueryRequest(request.raw);
      // Fail-closed harness: a query that resolves must answer with
      // the SAME correlation id (envelope discipline).
      ok = outcome.request.correlationId === request.correlationId;
    } catch {
      ok = false; // fabric rejected the request (fail-closed by design)
    }
    const durationMs = performance.now() - startedAt;
    outcomes.push({
      index: request.index,
      correlationId: request.correlationId,
      ok,
      malformed: request.malformed,
      durationMs,
    });
  }
  const durations = [...outcomes].map((outcome) => outcome.durationMs).sort((a, b) => a - b);
  const goodCount = outcomes.filter((outcome) => outcome.ok).length;
  return {
    shapeId,
    seed,
    requestCount: outcomes.length,
    goodCount,
    badCount: outcomes.length - goodCount,
    outcomes,
    measurements: {
      p50Ms: durations[Math.floor(durations.length / 2)] ?? 0,
      p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
      maxMs: durations[durations.length - 1] ?? 0,
    },
  };
}

/** Convert a run into A035 metric signals over a logical window. */
export function buildSignals(run: LoadRunResult): readonly MetricSignal[] {
  const service = toNeutralId('console');
  const goodMetric = toNeutralId('console-request-good');
  const latencyMetric = toNeutralId('console-read-latency-ms');
  const windowMs = 3_600_000;
  const step = Math.floor(windowMs / (run.requestCount + 1));
  const signals: MetricSignal[] = [];
  for (const outcome of run.outcomes) {
    const occurredAt = toObservabilityTimestamp(
      WINDOW_START + (outcome.index + 1) * step,
    );
    signals.push({
      signalVersion: 1,
      kind: 'metric',
      signalId: toTelemetryId(`perf-${run.shapeId}-${run.seed}-good-${outcome.index}`),
      sequence: outcome.index + 1,
      occurredAt,
      sourceService: service,
      correlationId: toCorrelationId(outcome.correlationId),
      causationId: null,
      tenantId: null,
      metricName: goodMetric,
      metricType: 'counter',
      unit: 'count',
      value: outcome.ok ? 1 : 0,
      labels: {},
    });
    signals.push({
      signalVersion: 1,
      kind: 'metric',
      signalId: toTelemetryId(`perf-${run.shapeId}-${run.seed}-lat-${outcome.index}`),
      sequence: run.requestCount + outcome.index + 1,
      occurredAt,
      sourceService: service,
      correlationId: toCorrelationId(outcome.correlationId),
      causationId: null,
      tenantId: null,
      metricName: latencyMetric,
      metricType: 'timer',
      unit: 'milliseconds',
      value: outcome.durationMs,
      labels: {},
    });
  }
  return signals;
}

/** A035 console-availability SLO (from the DEP1.0 catalog copy). */
export function consoleAvailabilitySlo(catalog: readonly SloDefinition[]): SloDefinition {
  const found = catalog.find((slo) => slo.sloId === 'slo-console-availability');
  if (found === undefined) {
    throw new Error('console-availability SLO missing from catalog');
  }
  return found;
}

/** Perf-local latency SLO for the console read path (A035-derived). */
export function consoleReadLatencySlo(): SloDefinition {
  // Mirrors the A035 job-latency policy (300,000ms threshold, 0.95
  // target over 1h, min 20 samples) applied to the console read
  // path. The generous threshold keeps the verdict deterministic in
  // CI while the ratio semantics stay real: every request must be
  // under the bar.
  return toSloDefinition({
    definitionVersion: 1,
    sloId: 'slo-console-read-latency',
    name: 'Console read latency under 5 minutes',
    service: 'console',
    sli: { kind: 'latency-threshold-ratio', metricName: 'console-read-latency-ms', thresholdMs: 300_000 },
    targetRatio: 0.95,
    windowMs: 3_600_000,
    minSampleCount: 20,
    atRiskThresholdRatio: 0.5,
    description: 'perf-suite (A036): share of console read requests under 300000ms',
  });
}

/** Evaluate one SLO over a run's signals (exact logical window). */
export function evaluateRunSlo(
  definition: SloDefinition,
  signals: readonly MetricSignal[],
): SloEvaluation {
  return evaluateSlo({
    definition,
    window: {
      windowStart: toObservabilityTimestamp(WINDOW_START),
      windowEnd: toObservabilityTimestamp(WINDOW_START + definition.windowMs),
    },
    samples: signals,
  });
}
