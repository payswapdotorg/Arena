/**
 * Envelope wiring tests (Work Order A035): positive + adversarial
 * (idempotency discipline, schema pinning, tamper tripwire, fail-closed
 * ingestion parsing).
 */

import { describe, expect, it } from 'vitest';
import { ProtocolError } from '@arena/protocol-core';
import {
  OBSERVABILITY_SCHEMAS,
  OBSERVABILITY_SCHEMA_VERSION,
  makeAlertEvaluationResponse,
  makeEvaluateAlertsQuery,
  makeEvaluateSloQuery,
  makeHealthReportResponse,
  makeIngestTelemetryCommand,
  makeSloEvaluationResponse,
  makeTelemetryIngestedEvent,
  observabilityEnvelopeDigest,
  observabilitySchemaRef,
  parseIngestTelemetryCommand,
  parseObservabilityEnvelope,
  verifyObservabilityEnvelope,
} from './envelopes.js';
import type { TelemetryIngestedEvent } from './envelopes.js';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import { evaluateSlo } from './slo.js';
import { toHealthReport } from './health.js';
import { corr, idem, healthComponent, metricSignal, sloDefinition, windowOf } from './test-support.js';

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('schema registry (in-package SchemaRef data)', () => {
  it('resolves every registered schema to a versioned ref (positive)', () => {
    for (const name of Object.keys(OBSERVABILITY_SCHEMAS)) {
      const ref = observabilitySchemaRef(name as keyof typeof OBSERVABILITY_SCHEMAS);
      expect(ref.namespace).toBe('observability');
      expect(ref.version).toBe(OBSERVABILITY_SCHEMA_VERSION);
    }
  });

  it('rejects unknown schema names (adversarial)', () => {
    expect(() => observabilitySchemaRef('observability/nope' as keyof typeof OBSERVABILITY_SCHEMAS)).toThrow(
      ObservabilityError,
    );
  });
});

describe('ingest-telemetry command envelopes', () => {
  it('creates a command with a REQUIRED idempotency key (positive)', () => {
    const signal = metricSignal();
    const envelope = makeIngestTelemetryCommand(signal, {
      correlationId: corr('corr-1'),
      idempotencyKey: idem('idem-1'),
      id: '0b399e8d-b62f-4862-bcbe-92baabe48a7b',
      issuedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(envelope.kind).toBe('command');
    expect(envelope.schema).toBe('arena:schema/observability/ingest-telemetry-command@1.0.0');
    expect(envelope.idempotencyKey).toBe('idem-1');
    expect(envelope.payload).toEqual(signal);
  });

  it('REFUSES commands without an idempotency key (adversarial, lock rule 17)', () => {
    const signal = metricSignal();
    const error = errorOf(() =>
      makeIngestTelemetryCommand(signal, { correlationId: corr('corr-1') }),
    );
    expect(error).toBeInstanceOf(ObservabilityError);
    expect((error as ObservabilityError).code).toBe(OBS_ERROR_CODES.INVALID_SIGNAL);
  });

  it('REFUSES structurally invalid signal payloads (adversarial)', () => {
    const error = errorOf(() =>
      makeIngestTelemetryCommand({ kind: 'garbage' } as unknown as ReturnType<typeof metricSignal>, {
        correlationId: corr('corr-1'),
        idempotencyKey: idem('idem-1'),
      }),
    );
    expect(error).toBeInstanceOf(ObservabilityError);
  });

  it('round-trips through the wire with fail-closed payload validation (positive)', () => {
    const envelope = makeIngestTelemetryCommand(metricSignal(), {
      correlationId: corr('corr-2'),
      idempotencyKey: idem('idem-2'),
    });
    const raw = JSON.stringify(envelope);
    const parsed = parseIngestTelemetryCommand(raw);
    expect(parsed.id).toBe(envelope.id);
    expect(parsed.payload.kind).toBe('metric');
  });

  it('rejects malformed telemetry payloads at parse time FAIL-CLOSED (adversarial)', () => {
    const envelope = makeIngestTelemetryCommand(metricSignal(), {
      correlationId: corr('corr-3'),
      idempotencyKey: idem('idem-3'),
    });
    const tampered = JSON.parse(JSON.stringify(envelope));
    tampered.payload = { ...tampered.payload, kind: 'not-a-kind' };
    const error = errorOf(() => parseIngestTelemetryCommand(JSON.stringify(tampered)));
    expect(error).toBeInstanceOf(ObservabilityError);
    expect((error as ObservabilityError).code).toBe(OBS_ERROR_CODES.UNKNOWN_EVENT);
  });

  it('rejects non-command kinds pinned to the ingest schema (adversarial)', () => {
    // A well-formed envelope whose schema is the ingest-command schema
    // but whose KIND is 'event' (kind discipline is closed):
    const command = makeIngestTelemetryCommand(metricSignal(), {
      correlationId: corr('corr-4'),
      idempotencyKey: idem('idem-4'),
    });
    const disguised = JSON.parse(JSON.stringify(command));
    disguised.kind = 'event';
    const error = errorOf(() => parseIngestTelemetryCommand(JSON.stringify(disguised)));
    expect(error).toBeInstanceOf(ObservabilityError);
    expect((error as ObservabilityError).code).toBe(OBS_ERROR_CODES.INVALID_SIGNAL);
  });

  it('detects TAMPERED envelopes via canonical digests (adversarial)', async () => {
    const envelope = makeIngestTelemetryCommand(metricSignal(), {
      correlationId: corr('corr-5'),
      idempotencyKey: idem('idem-5'),
    });
    const digest = await observabilityEnvelopeDigest(envelope);
    const ok = await verifyObservabilityEnvelope(JSON.stringify(envelope), digest);
    expect(ok.id).toBe(envelope.id);
    const tampered = JSON.parse(JSON.stringify(envelope));
    tampered.payload = { ...tampered.payload, value: 999 };
    await expect(
      verifyObservabilityEnvelope(JSON.stringify(tampered), digest),
    ).rejects.toMatchObject({ code: 'PROTOCOL_ENVELOPE_TAMPERED' });
  });

  it('schema pinning rejects envelopes carrying a foreign schema (adversarial)', () => {
    const foreign = makeTelemetryIngestedEvent(
      { signalId: 's-2', sourceService: 'job-orchestrator', sequence: 1, ingestedAt: 5 },
      { correlationId: corr('corr-6') },
    );
    const error = errorOf(() =>
      parseObservabilityEnvelope(JSON.stringify(foreign), 'observability/ingest-telemetry-command'),
    );
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe('PROTOCOL_SCHEMA_MISMATCH');
  });
});

describe('query/response envelopes', () => {
  it('creates evaluate-slo / evaluate-alerts queries and validates payloads (positive)', () => {
    const query = makeEvaluateSloQuery(
      { sloId: 'slo-job-completion', windowEnd: 1_000_000 },
      { correlationId: corr('corr-q1') },
    );
    expect(query.kind).toBe('query');
    expect(query.schema).toBe('arena:schema/observability/evaluate-slo-query@1.0.0');
    const alertsQuery = makeEvaluateAlertsQuery({ now: 1_000 }, { correlationId: corr('corr-q2') });
    expect(alertsQuery.kind).toBe('query');
  });

  it('rejects malformed query payloads (adversarial)', () => {
    expect(() =>
      makeEvaluateSloQuery({ sloId: '', windowEnd: 1 } as { sloId: string; windowEnd: number }, { correlationId: corr('c') }),
    ).toThrow(ObservabilityError);
    expect(() =>
      makeEvaluateAlertsQuery({ now: -1 }, { correlationId: corr('c') }),
    ).toThrow(ObservabilityError);
  });

  it('wraps SLO / alert / health responses (positive)', () => {
    const definition = sloDefinition({ minSampleCount: 1 });
    const evaluation = evaluateSlo({
      definition,
      window: windowOf(definition.windowMs),
      samples: [metricSignal({ occurredAt: 1_000_000, value: 1 })],
    });
    const response = makeSloEvaluationResponse(evaluation, { correlationId: corr('corr-r1') });
    expect(response.kind).toBe('response');
    expect(response.schema).toBe('arena:schema/observability/slo-evaluation@1.0.0');
    const alertResponse = makeAlertEvaluationResponse(
      {
        ruleId: 'rule-1' as ReturnType<typeof sloDefinition>['sloId'],
        severity: 'low',
        evaluatedAt: 1 as ReturnType<typeof toHealthReport>['reportedAt'],
        conditionMet: false,
        state: 'inactive',
        reason: { kind: 'condition-not-met', detail: 'x' },
        stateChanged: false,
      },
      { correlationId: corr('corr-r2') },
    );
    expect(alertResponse.kind).toBe('response');
    const report = toHealthReport([healthComponent('healthy')], 2);
    const healthResponse = makeHealthReportResponse(report, { correlationId: corr('corr-r3') });
    expect(healthResponse.schema).toBe('arena:schema/observability/health-report@1.0.0');
  });
});

describe('telemetry-ingested event envelopes', () => {
  it('round-trips acknowledgement events (positive)', () => {
    const payload: TelemetryIngestedEvent = {
      signalId: 's-9',
      sourceService: 'environment-runner',
      sequence: 4,
      ingestedAt: 1_234,
    };
    const envelope = makeTelemetryIngestedEvent(payload, { correlationId: corr('corr-e1') });
    const raw = JSON.stringify(envelope);
    const parsed = parseObservabilityEnvelope<TelemetryIngestedEvent>(
      raw,
      'observability/telemetry-ingested-event',
    );
    expect(parsed.payload).toEqual(payload);
    expect(parsed.kind).toBe('event');
  });
});
