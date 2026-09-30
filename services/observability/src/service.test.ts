/**
 * Observability service tests (Work Order A035): positive + adversarial.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryAlertStateStore,
  InMemoryTelemetryStore,
  ManualClock,
} from './in-memory.js';
import { ObservabilityService } from './service.js';
import { LOG_ERROR_RATIO_WINDOW_MS } from './service.js';
import type { EventSink } from './ports.js';
import {
  makeEvaluateAlertsQuery,
  makeEvaluateSloQuery,
  makeIngestTelemetryCommand,
  OBS_ERROR_CODES,
  ObservabilityError,
} from '@arena/observability';
import { alertRule, corr, idem, logSignal, metricSignal, outcomeBatch, sloDefinition } from './test-support.js';

function errorOf(fn: () => unknown): ObservabilityError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ObservabilityError) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

async function errorOfAsync(fn: () => Promise<unknown>): Promise<ObservabilityError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ObservabilityError) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

class RecordingSink implements EventSink {
  readonly events: string[] = [];
  async appendTelemetryIngested(): Promise<void> {
    this.events.push('ack');
  }
}

function makeService(start = 1_000_000) {
  const clock = new ManualClock(start);
  const store = new InMemoryTelemetryStore();
  const alertStates = new InMemoryAlertStateStore();
  const sink = new RecordingSink();
  const service = new ObservabilityService({ clock, store, alertStates, sink });
  return { clock, store, alertStates, sink, service };
}

describe('ingestion (envelope-wired, idempotent)', () => {
  it('ingests a valid command and acknowledges with an event envelope (positive)', async () => {
    const { service, sink } = makeService();
    const signal = metricSignal({ sequence: 1, occurredAt: 999_000 });
    const command = makeIngestTelemetryCommand(signal, {
      correlationId: corr('corr-svc-1'),
      idempotencyKey: idem('idem-svc-1'),
    });
    const ack = await service.ingest(JSON.stringify(command));
    expect(ack.kind).toBe('event');
    expect(ack.payload.signalId).toBe(signal.signalId);
    expect(ack.payload.sequence).toBe(1);
    expect(ack.payload.ingestedAt).toBe(1_000_000);
    expect(sink.events.length).toBe(1);
  });

  it('replays the SAME command idempotently: same ack envelope, single append (positive R27)', async () => {
    const { service, sink, store } = makeService();
    const signal = metricSignal({ sequence: 1, occurredAt: 999_000 });
    const raw = JSON.stringify(
      makeIngestTelemetryCommand(signal, {
        correlationId: corr('corr-svc-2'),
        idempotencyKey: idem('idem-svc-2'),
      }),
    );
    const first = await service.ingest(raw);
    const second = await service.ingest(raw);
    expect(second).toEqual(first);
    expect((await store.list()).length).toBe(1);
    expect(sink.events.length).toBe(1);
  });

  it('rejects malformed wire commands FAIL-CLOSED (adversarial)', async () => {
    const { service } = makeService();
    await expect(service.ingest('not json')).rejects.toBeTruthy();
    await expect(service.ingest(JSON.stringify({ hello: 'world' }))).rejects.toBeTruthy();
  });

  it('rejects unknown signal kinds on the wire FAIL-CLOSED (adversarial)', async () => {
    const { service } = makeService();
    // Build a VALID command, then tamper the payload kind on the wire —
    // the service must fail closed at parse time:
    const command = makeIngestTelemetryCommand(metricSignal({ sequence: 1 }), {
      correlationId: corr('corr-svc-3'),
      idempotencyKey: idem('idem-svc-3'),
    });
    const tampered = JSON.parse(JSON.stringify(command));
    tampered.payload = { ...tampered.payload, kind: 'mystery' };
    const error = await errorOfAsync(() => service.ingest(JSON.stringify(tampered)));
    expect(error.code).toBe(OBS_ERROR_CODES.UNKNOWN_EVENT);
  });

  it('enforces per-source sequence discipline at the store (adversarial)', async () => {
    const { service } = makeService();
    await service.ingestSignal(metricSignal({ signalId: 'svc-m-1', sequence: 1, occurredAt: 1_000_000 }));
    const gap = await errorOfAsync(() =>
      service.ingestSignal(metricSignal({ signalId: 'svc-m-2', sequence: 3, occurredAt: 1_000_001 })),
    );
    expect(gap.code).toBe(OBS_ERROR_CODES.SEQUENCE_GAP);
    const regression = await errorOfAsync(() =>
      service.ingestSignal(metricSignal({ signalId: 'svc-m-3', sequence: 1, occurredAt: 1_000_002 })),
    );
    expect(regression.code).toBe(OBS_ERROR_CODES.SEQUENCE_DUPLICATE);
  });

  it('deduplicates replayed signals by signalId without double-counting (adversarial)', async () => {
    const { service, store } = makeService();
    const signal = metricSignal({ signalId: 'svc-m-10', sequence: 1, occurredAt: 1_000_000 });
    const first = await service.ingestSignal(signal);
    const second = await service.ingestSignal(signal);
    expect(second).toEqual(first);
    expect((await store.list()).length).toBe(1);
  });

  it('queries telemetry by correlation id, kind and range (positive)', async () => {
    const { service } = makeService();
    const correlationId = metricSignal().correlationId;
    await service.ingestSignal(metricSignal({ signalId: 'q-1', sequence: 1, occurredAt: 1_000_000, correlationId }));
    await service.ingestSignal(metricSignal({ signalId: 'q-2', sequence: 2, occurredAt: 1_000_100, correlationId }));
    await service.ingestSignal(logSignal({ signalId: 'q-3', sequence: 1, occurredAt: 1_000_200, correlationId }));
    expect((await service.queryTelemetry({ correlationId })).length).toBe(3);
    expect((await service.queryTelemetry({ correlationId, kind: 'log' })).length).toBe(1);
    expect((await service.queryTelemetry({ correlationId, from: 1_000_050 })).length).toBe(2);
    expect((await service.queryTelemetry({ correlationId, to: 1_000_050 })).length).toBe(1);
  });
});

describe('SLO evaluation over the window fabric', () => {
  it('evaluates a registered SLO over the rolling window (positive)', async () => {
    const { service, clock } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 1, targetRatio: 0.9 }));
    for (const sample of outcomeBatch({ count: 10, bad: 0, sequence: 1, occurredAt: 1_900_000 })) {
      await service.ingestSignal(sample);
    }
    const evaluation = await service.evaluateSlo('slo-job-completion', 2_000_000);
    expect(evaluation.verdict).toBe('met');
    expect(evaluation.sampleCount).toBe(10);
    expect(clock.now()).toBe(2_000_000);
  });

  it('ignores samples outside the rolling window (positive scoping)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 1 }));
    // Stale samples ingested FIRST (per-source time ordering) — outside
    // the window AND under a different metric name:
    for (let i = 0; i < 3; i++) {
      await service.ingestSignal(
        metricSignal({
          signalId: `stale-${i}`,
          sequence: 1 + i,
          occurredAt: 1_500_000 + i,
          metricName: 'stale-metric',
        }),
      );
    }
    for (const sample of outcomeBatch({ count: 5, bad: 0, sequence: 4, occurredAt: 1_995_000 })) {
      await service.ingestSignal(sample);
    }
    const evaluation = await service.evaluateSlo('slo-job-completion', 2_000_000);
    expect(evaluation.sampleCount).toBe(5);
  });

  it('FAILS CLOSED on unknown SLO ids (adversarial)', async () => {
    const { service } = makeService();
    const error = await errorOfAsync(() => service.evaluateSlo('nope', 1_000));
    expect(error.code).toBe(OBS_ERROR_CODES.INVALID_SLO);
  });

  it('rejects windows that would start before the epoch (adversarial)', async () => {
    const { service } = makeService();
    service.registerSlo(sloDefinition({ windowMs: 100_000 }));
    const error = await errorOfAsync(() => service.evaluateSlo('slo-job-completion', 50_000));
    expect(error.code).toBe(OBS_ERROR_CODES.INVALID_WINDOW);
  });

  it('no-data fails closed through the service path (adversarial)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 5 }));
    const evaluation = await service.evaluateSlo('slo-job-completion', 2_000_000);
    expect(evaluation.verdict).toBe('no-data');
    expect(evaluation.errorBudget.exhausted).toBe(true);
  });

  it('evaluates SLO queries through envelope-wired responses (positive)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(
      sloDefinition({ windowMs: 100_000, minSampleCount: 1, targetRatio: 0.8, atRiskThresholdRatio: 0.9 }),
    );
    for (const sample of outcomeBatch({ count: 10, bad: 1, sequence: 1, occurredAt: 1_900_000 })) {
      await service.ingestSignal(sample);
    }
    const query = makeEvaluateSloQuery(
      { sloId: 'slo-job-completion', windowEnd: 2_000_000 },
      { correlationId: corr('corr-slo-q1') },
    );
    const response = await service.evaluateSloQuery(JSON.stringify(query));
    expect(response.kind).toBe('response');
    expect(response.correlationId).toBe('corr-slo-q1');
    expect(response.payload.verdict).toBe('met');
  });
});

describe('alert evaluation (deterministic, persisted, flap-protected)', () => {
  it('fires budget-exhausted alerts from ingested telemetry (positive)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 1, targetRatio: 0.9 }));
    service.registerAlertRule(alertRule({ condition: 'slo-error-budget-exhausted' }));
    for (const sample of outcomeBatch({ count: 10, bad: 5, sequence: 1, occurredAt: 1_900_000 })) {
      await service.ingestSignal(sample);
    }
    const evaluations = await service.evaluateAlerts(2_000_000);
    expect(evaluations.length).toBe(1);
    expect(evaluations[0]?.state).toBe('firing');
    expect(evaluations[0]?.severity).toBe('critical');
  });

  it('slo-no-data rules fire when telemetry goes silent (adversarial)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 5 }));
    service.registerAlertRule(alertRule({ condition: 'slo-no-data' }));
    const evaluations = await service.evaluateAlerts(2_000_000);
    expect(evaluations[0]?.state).toBe('firing');
    expect(evaluations[0]?.reason.kind).toBe('no-data-fail-closed');
  });

  it('persists alert state across evaluations and enforces cooldown flaps (adversarial)', async () => {
    const { service } = makeService(2_000_000);
    service.registerSlo(sloDefinition({ windowMs: 100_000, minSampleCount: 1, targetRatio: 0.9 }));
    service.registerAlertRule(
      alertRule({ condition: 'slo-error-budget-exhausted', forDurationMs: 0, cooldownMs: 200_000 }),
      1_000_000,
    );
    // Breach → fire
    for (const sample of outcomeBatch({ count: 10, bad: 5, sequence: 1, occurredAt: 1_900_000 })) {
      await service.ingestSignal(sample);
    }
    let evaluations = await service.evaluateAlerts(2_000_000);
    expect(evaluations[0]?.state).toBe('firing');
    // Heal → resolve (healed window [2_000_000, 2_100_000])
    for (const sample of outcomeBatch({ count: 10, bad: 0, sequence: 11, occurredAt: 2_000_000 })) {
      await service.ingestSignal(sample);
    }
    evaluations = await service.evaluateAlerts(2_100_000);
    expect(evaluations[0]?.state).toBe('resolved');
    // Re-breach INSIDE the cooldown window → flap suppressed
    for (const sample of outcomeBatch({ count: 10, bad: 9, sequence: 21, occurredAt: 2_100_100 })) {
      await service.ingestSignal(sample);
    }
    evaluations = await service.evaluateAlerts(2_150_000);
    expect(evaluations[0]?.state).toBe('resolved');
    expect(evaluations[0]?.reason.kind).toBe('cooldown-suppressed');
    // Cooldown elapsed (200_000 since 2_100_000) with a live breach → fires again
    for (const sample of outcomeBatch({ count: 10, bad: 9, sequence: 31, occurredAt: 2_300_000 })) {
      await service.ingestSignal(sample);
    }
    evaluations = await service.evaluateAlerts(2_350_000);
    expect(evaluations[0]?.state).toBe('firing');
  });

  it('evaluates alert queries through envelope-wired responses (positive)', async () => {
    const { service } = makeService(2_000_000);
    service.registerAlertRule(alertRule({ condition: 'metric-above-threshold', threshold: 5 }));
    await service.ingestSignal(
      metricSignal({ signalId: 'alert-m-1', sequence: 1, occurredAt: 1_000_000, metricName: 'job-outcome-good', value: 9 }),
    );
    const query = makeEvaluateAlertsQuery({ now: 2_000_000 }, { correlationId: corr('corr-alert-q1') });
    const responses = await service.evaluateAlertsQuery(JSON.stringify(query));
    expect(responses.length).toBe(1);
    expect(responses[0]?.kind).toBe('response');
    expect(responses[0]?.payload.state).toBe('firing');
  });

  it('log-error-ratio conditions derive their ratio from the window (positive)', async () => {
    const { service } = makeService(2_000_000);
    service.registerAlertRule(alertRule({ condition: 'log-error-ratio', threshold: 0.5 }));
    const from = 2_000_000 - LOG_ERROR_RATIO_WINDOW_MS;
    for (let i = 0; i < 4; i++) {
      await service.ingestSignal(
        logSignal({
          signalId: `log-ok-${i}`,
          sequence: i + 1,
          occurredAt: from + i * 100,
          level: i === 3 ? 'error' : 'info',
        }),
      );
    }
    const evaluations = await service.evaluateAlerts(2_000_000);
    // 1 error of 4 logs = 0.25 < 0.5 → not met
    expect(evaluations[0]?.state).toBe('inactive');
  });

  it('health conditions trip off reported component health (positive)', async () => {
    const { service } = makeService(2_000_000);
    service.registerAlertRule(alertRule({ condition: 'health-status-degraded', healthStatus: 'degraded' }));
    let evaluations = await service.evaluateAlerts(2_000_000);
    expect(evaluations[0]?.state).toBe('inactive');
    await service.reportHealth([
      { component: 'certification-fabric', status: 'degraded', detail: null, checkedAt: 2_000_000 },
    ]);
    evaluations = await service.evaluateAlerts(2_000_000);
    expect(evaluations[0]?.state).toBe('firing');
  });

  it('rejects invalid evaluation times (adversarial)', async () => {
    const { service } = makeService(1_000);
    const error = await errorOfAsync(() => service.evaluateAlerts(-5));
    expect(error.code).toBe(OBS_ERROR_CODES.INVALID_TIMESTAMP);
  });
});

describe('health reporting', () => {
  it('aggregates worst-of and stores the latest report (positive)', async () => {
    const { service } = makeService(2_000_000);
    const report = await service.reportHealth([
      { component: 'job-orchestrator', status: 'healthy', detail: null, checkedAt: 1_999_000 },
      { component: 'environment-runner', status: 'unhealthy', detail: 'runner lease lost', checkedAt: 1_999_000 },
    ]);
    expect(report.aggregate).toBe('unhealthy');
    expect(service.currentHealth()?.aggregate).toBe('unhealthy');
  });

  it('fails closed on malformed contributions (adversarial)', async () => {
    const { service } = makeService();
    await expect(
      service.reportHealth([{ component: 'job-orchestrator', status: 'fine', detail: null, checkedAt: 1 }]),
    ).rejects.toBeInstanceOf(ObservabilityError);
  });
});

describe('registry validation', () => {
  it('rejects malformed SLO definitions and alert rules at registration (adversarial)', () => {
    const { service } = makeService();
    expect(errorOf(() => service.registerSlo({ bad: true })).code).toBe(OBS_ERROR_CODES.INVALID_SLO);
    expect(errorOf(() => service.registerAlertRule({ condition: 'nonsense' })).code).toBe(
      OBS_ERROR_CODES.INVALID_ALERT_RULE,
    );
  });
});
