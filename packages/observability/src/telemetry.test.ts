/**
 * Telemetry core tests (Work Order A035): positive + adversarial.
 */

import { describe, expect, it } from 'vitest';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import {
  appendTelemetrySignal,
  createTelemetryStream,
  describeTelemetrySignal,
  isTelemetrySignal,
  toTelemetrySignal,
  verifyTelemetryStream,
} from './telemetry.js';
import { auditSignal, logSignal, metricSignal, traceSignal } from './test-support.js';

function errorOf(fn: () => unknown): ObservabilityError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ObservabilityError) return error;
    throw error;
  }
  throw new Error('expected a throw');
}

describe('telemetry signals', () => {
  it('validates structurally valid signals of every kind (positive)', () => {
    for (const signal of [metricSignal(), traceSignal(), logSignal(), auditSignal()]) {
      expect(isTelemetrySignal(signal)).toBe(true);
      const round = toTelemetrySignal(JSON.parse(JSON.stringify(signal)));
      expect(round).toEqual(signal);
      expect(Object.isFrozen(round)).toBe(true);
    }
  });

  it('rejects non-object payloads (adversarial)', () => {
    expect(() => toTelemetrySignal(null)).toThrow(ObservabilityError);
    expect(() => toTelemetrySignal('metric')).toThrow(ObservabilityError);
    expect(() => toTelemetrySignal(42)).toThrow(ObservabilityError);
  });

  it('rejects unsupported signal wire versions (adversarial)', () => {
    const raw = { ...metricSignal(), signalVersion: 2 };
    const error = errorOf(() => toTelemetrySignal(raw));
    expect(error.code).toBe(OBS_ERROR_CODES.UNSUPPORTED_SIGNAL_VERSION);
  });

  it('rejects unknown signal kinds FAIL-CLOSED (adversarial)', () => {
    const raw = { ...metricSignal(), kind: 'span' };
    const error = errorOf(() => toTelemetrySignal(raw));
    expect(error.code).toBe(OBS_ERROR_CODES.UNKNOWN_EVENT);
  });

  it('rejects non-finite metric values (adversarial)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'one', null]) {
      const error = errorOf(() => toTelemetrySignal({ ...metricSignal(), value: bad }));
      expect(error.code).toBe(OBS_ERROR_CODES.INVALID_METRIC);
    }
  });

  it('rejects unknown metric type / unit / log level / trace status (adversarial)', () => {
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), metricType: 'histogram' })).code).toBe(
      OBS_ERROR_CODES.INVALID_METRIC,
    );
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), unit: 'celsius' })).code).toBe(
      OBS_ERROR_CODES.INVALID_METRIC,
    );
    expect(errorOf(() => toTelemetrySignal({ ...logSignal(), level: 'fatal' })).code).toBe(
      OBS_ERROR_CODES.INVALID_LOG,
    );
    expect(errorOf(() => toTelemetrySignal({ ...traceSignal(), status: 'cancelled' })).code).toBe(
      OBS_ERROR_CODES.INVALID_TRACE,
    );
  });

  it('requires durationMs on closed spans and forbids it on open spans (adversarial)', () => {
    expect(
      errorOf(() => toTelemetrySignal({ ...traceSignal(), status: 'succeeded', durationMs: null })).code,
    ).toBe(OBS_ERROR_CODES.INVALID_TRACE);
    expect(
      errorOf(() => toTelemetrySignal({ ...traceSignal(), status: 'open', durationMs: 5 })).code,
    ).toBe(OBS_ERROR_CODES.INVALID_TRACE);
  });

  it('requires a correlation id on every signal (A015 discipline, adversarial)', () => {
    const raw = { ...metricSignal() } as Record<string, unknown>;
    delete raw['correlationId'];
    expect(errorOf(() => toTelemetrySignal(raw)).code).toBe(OBS_ERROR_CODES.INVALID_IDENTITY);
  });

  it('rejects invalid sourceService names (adversarial)', () => {
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), sourceService: 'Job_Orch' })).code).toBe(
      OBS_ERROR_CODES.INVALID_IDENTITY,
    );
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), sourceService: '' })).code).toBe(
      OBS_ERROR_CODES.INVALID_IDENTITY,
    );
  });

  it('rejects oversized / malformed attribute maps (adversarial)', () => {
    const labels: Record<string, string> = {};
    for (let i = 0; i < 20; i++) labels[`label_${i}`] = 'v';
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), labels })).code).toBe(
      OBS_ERROR_CODES.INVALID_METRIC,
    );
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), labels: { bad: '' } })).code).toBe(
      OBS_ERROR_CODES.INVALID_METRIC,
    );
  });

  it('rejects structurally invalid audit events FAIL-CLOSED (A034 integration, adversarial)', () => {
    const signal = auditSignal();
    const broken = { ...signal, auditEvent: { recordVersion: 1, kind: 'made-up-kind' } };
    expect(errorOf(() => toTelemetrySignal(broken)).code).toBe(OBS_ERROR_CODES.INVALID_AUDIT);
    const noEvent = { ...signal } as Record<string, unknown>;
    delete noEvent['auditEvent'];
    expect(errorOf(() => toTelemetrySignal(noEvent)).code).toBe(OBS_ERROR_CODES.INVALID_AUDIT);
  });

  it('rejects non-positive sequences (adversarial)', () => {
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), sequence: 0 })).code).toBe(
      OBS_ERROR_CODES.INVALID_SIGNAL,
    );
    expect(errorOf(() => toTelemetrySignal({ ...metricSignal(), sequence: 1.5 })).code).toBe(
      OBS_ERROR_CODES.INVALID_SIGNAL,
    );
  });
});

describe('telemetry streams (per-source append-only discipline)', () => {
  it('appends in order and freezes (positive)', () => {
    let stream = createTelemetryStream('job-orchestrator');
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 1 }));
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 2, occurredAt: 2_000 }));
    expect(stream.signals.length).toBe(2);
    expect(Object.isFrozen(stream)).toBe(true);
    expect(() => {
      (stream as unknown as { signals: unknown[] }).signals.push('x');
    }).toThrow();
    verifyTelemetryStream(stream);
  });

  it('rejects sequence gaps (adversarial)', () => {
    let stream = createTelemetryStream('job-orchestrator');
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 1 }));
    const error = errorOf(() => appendTelemetrySignal(stream, metricSignal({ sequence: 3 })));
    expect(error.code).toBe(OBS_ERROR_CODES.SEQUENCE_GAP);
  });

  it('rejects sequence regressions / duplicates (adversarial)', () => {
    let stream = createTelemetryStream('job-orchestrator');
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 1 }));
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 2 }));
    const error = errorOf(() => appendTelemetrySignal(stream, metricSignal({ sequence: 1 })));
    expect(error.code).toBe(OBS_ERROR_CODES.SEQUENCE_DUPLICATE);
  });

  it('rejects replayed signal ids (adversarial)', () => {
    const first = metricSignal({ signalId: 'm-1', sequence: 1 });
    let stream = createTelemetryStream('job-orchestrator');
    stream = appendTelemetrySignal(stream, first);
    const replay = metricSignal({ signalId: 'm-1', sequence: 2, occurredAt: 5_000 });
    expect(errorOf(() => appendTelemetrySignal(stream, replay)).code).toBe(
      OBS_ERROR_CODES.SEQUENCE_DUPLICATE,
    );
  });

  it('rejects cross-stream signals (adversarial)', () => {
    const stream = createTelemetryStream('job-orchestrator');
    const foreign = metricSignal({ sequence: 1, sourceService: 'certification-fabric' });
    expect(errorOf(() => appendTelemetrySignal(stream, foreign)).code).toBe(
      OBS_ERROR_CODES.STREAM_MISMATCH,
    );
  });

  it('rejects timestamp regressions within a stream (adversarial)', () => {
    let stream = createTelemetryStream('job-orchestrator');
    stream = appendTelemetrySignal(stream, metricSignal({ sequence: 1, occurredAt: 5_000 }));
    expect(
      errorOf(() => appendTelemetrySignal(stream, metricSignal({ sequence: 2, occurredAt: 4_999 })))
        .code,
    ).toBe(OBS_ERROR_CODES.SAMPLES_UNORDERED);
  });

  it('rejects invalid stream source names (adversarial)', () => {
    expect(() => createTelemetryStream('Bad Source')).toThrow(ObservabilityError);
  });

  it('describes signals compactly (positive)', () => {
    expect(describeTelemetrySignal(metricSignal({ sequence: 3 }))).toBe('metric#3@job-orchestrator');
  });
});
