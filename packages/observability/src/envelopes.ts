/**
 * Envelope wiring for the observability protocol (architecture-lock
 * rules 17, 18, 22; requirements R27, R33; Work Order A035 — mirrors
 * @arena/job-protocol's and @arena/security's envelope patterns exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-verifiable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * CONTRACTS DISCLOSURE (A035, following the A034 precedent): Work Order
 * A035 owns NO contracts/ surface (spec/work-items.md:
 * packages/observability/*, services/observability/*, docs/operations/*
 * only). The choice made here: schemas live INSIDE the package as
 * SchemaRef-referenced data — the registry below is the authority for
 * the `observability` namespace, and existing contracts are NOT
 * redeclared. There is deliberately no scripts/generate-contracts.mjs
 * and no contracts/observability/ directory (governance G9
 * auto-discovers package-level generators; this package ships none, so
 * it contributes no contract surface).
 *
 * Wire messages:
 *   - ingest-telemetry-command / telemetry-ingested-event
 *     (one telemetry signal ingestion; idempotent by command
 *     idempotency key — re-acknowledged, never double-appended);
 *   - evaluate-slo-query / slo-evaluation (response)
 *     (one SLO evaluation over its rolling window);
 *   - evaluate-alerts-query / alert-evaluation (response)
 *     (one alert-rule evaluation verdict);
 *   - health-report (response) (aggregate health snapshot).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import type { AlertEvaluation } from './alerts.js';
import type { SloEvaluation } from './slo.js';
import type { TelemetrySignal } from './telemetry.js';
import { isTelemetrySignal, toTelemetrySignal } from './telemetry.js';
import type { HealthReport } from './health.js';

export const OBSERVABILITY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/observability. The
 * `observability` namespace; in-package SchemaRef data is the authority
 * (A034 disclosure precedent — no contracts/ surface is owned).
 */
export const OBSERVABILITY_SCHEMAS = Object.freeze({
  'observability/telemetry-signal': OBSERVABILITY_SCHEMA_VERSION,
  'observability/ingest-telemetry-command': OBSERVABILITY_SCHEMA_VERSION,
  'observability/telemetry-ingested-event': OBSERVABILITY_SCHEMA_VERSION,
  'observability/evaluate-slo-query': OBSERVABILITY_SCHEMA_VERSION,
  'observability/slo-evaluation': OBSERVABILITY_SCHEMA_VERSION,
  'observability/evaluate-alerts-query': OBSERVABILITY_SCHEMA_VERSION,
  'observability/alert-evaluation': OBSERVABILITY_SCHEMA_VERSION,
  'observability/health-report': OBSERVABILITY_SCHEMA_VERSION,
  'observability/schema-registry': OBSERVABILITY_SCHEMA_VERSION,
} as const);

export type ObservabilitySchemaName = keyof typeof OBSERVABILITY_SCHEMAS;

/** Resolve an observability schema name to its SchemaRef. */
export function observabilitySchemaRef(name: ObservabilitySchemaName): SchemaRef {
  const version = OBSERVABILITY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ObservabilityError(OBS_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown observability schema: ${String(name)}`,
      details: { known: Object.keys(OBSERVABILITY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an observability schema at the registered version. */
export function isKnownObservabilitySchema(ref: SchemaRef): boolean {
  const registered = (OBSERVABILITY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Acknowledgement event for one ingested telemetry signal. */
export interface TelemetryIngestedEvent {
  readonly signalId: string;
  readonly sourceService: string;
  readonly sequence: number;
  readonly ingestedAt: number;
}

/** Query payload: evaluate one registered SLO as of `windowEnd`. */
export interface EvaluateSloQuery {
  readonly sloId: string;
  readonly windowEnd: number;
}

/** Query payload: evaluate all alert rules as of `now`. */
export interface EvaluateAlertsQuery {
  readonly now: number;
}

// ---------------------------------------------------------------------------
// Envelope context + constructors
// ---------------------------------------------------------------------------

export interface ObservabilityEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
  /** Explicit envelope instance id (tests inject deterministic ids). */
  readonly id?: string;
  /** Explicit issuance timestamp (services inject clock time). */
  readonly issuedAt?: string;
}

/**
 * Create the ingest-telemetry command envelope (R27: idempotent
 * commands). The payload signal must be structurally valid; the command
 * REQUIRES a non-null idempotency key.
 */
export function makeIngestTelemetryCommand(
  signal: TelemetrySignal,
  context: ObservabilityEnvelopeContext,
): Envelope<TelemetrySignal> {
  if (!isTelemetrySignal(signal)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
      message: 'ingest-telemetry commands require a structurally valid telemetry signal payload',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: observabilitySchemaRef('observability/ingest-telemetry-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload: signal,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Wrap a telemetry-ingested acknowledgement event in an envelope. */
export function makeTelemetryIngestedEvent(
  payload: TelemetryIngestedEvent,
  context: ObservabilityEnvelopeContext,
): Envelope<TelemetryIngestedEvent> {
  return makeEnvelope({
    kind: 'event',
    schema: observabilitySchemaRef('observability/telemetry-ingested-event'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Create the evaluate-slo query envelope. */
export function makeEvaluateSloQuery(
  payload: EvaluateSloQuery,
  context: ObservabilityEnvelopeContext,
): Envelope<EvaluateSloQuery> {
  if (typeof payload.sloId !== 'string' || payload.sloId.length === 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'evaluate-slo queries require a sloId',
    });
  }
  if (typeof payload.windowEnd !== 'number' || !Number.isSafeInteger(payload.windowEnd) || payload.windowEnd < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
      message: 'evaluate-slo queries require a windowEnd epoch-ms integer >= 0',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: observabilitySchemaRef('observability/evaluate-slo-query'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Wrap an SLO evaluation in a response envelope. */
export function makeSloEvaluationResponse(
  payload: SloEvaluation,
  context: ObservabilityEnvelopeContext,
): Envelope<SloEvaluation> {
  return makeEnvelope({
    kind: 'response',
    schema: observabilitySchemaRef('observability/slo-evaluation'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Create the evaluate-alerts query envelope. */
export function makeEvaluateAlertsQuery(
  payload: EvaluateAlertsQuery,
  context: ObservabilityEnvelopeContext,
): Envelope<EvaluateAlertsQuery> {
  if (typeof payload.now !== 'number' || !Number.isSafeInteger(payload.now) || payload.now < 0) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'evaluate-alerts queries require a now epoch-ms integer >= 0',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: observabilitySchemaRef('observability/evaluate-alerts-query'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Wrap an alert-rule evaluation verdict in a response envelope. */
export function makeAlertEvaluationResponse(
  payload: AlertEvaluation,
  context: ObservabilityEnvelopeContext,
): Envelope<AlertEvaluation> {
  return makeEnvelope({
    kind: 'response',
    schema: observabilitySchemaRef('observability/alert-evaluation'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/** Wrap a health report in a response envelope. */
export function makeHealthReportResponse(
  payload: HealthReport,
  context: ObservabilityEnvelopeContext,
): Envelope<HealthReport> {
  return makeEnvelope({
    kind: 'response',
    schema: observabilitySchemaRef('observability/health-report'),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an
 * observability-protocol schema. The core parser rejects unknown
 * envelope versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE), commands without an idempotency key and
 * schema mismatches (PROTOCOL_SCHEMA_MISMATCH).
 */
export function parseObservabilityEnvelope<T>(
  raw: string,
  expectedSchema?: ObservabilitySchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? observabilitySchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/**
 * Parse an ingest-telemetry command from the wire and structurally
 * validate its payload signal (fail-closed on malformed telemetry).
 */
export function parseIngestTelemetryCommand(
  raw: string,
): Envelope<TelemetrySignal> {
  const envelope = parseEnvelopeAs<TelemetrySignal>(
    raw,
    observabilitySchemaRef('observability/ingest-telemetry-command'),
  );
  if (envelope.kind !== 'command') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
      message: `ingest-telemetry payloads must travel as command envelopes, got ${envelope.kind}`,
    });
  }
  // Fail-closed payload validation (unknown kinds rejected here).
  toTelemetrySignal(envelope.payload);
  return envelope;
}

/** sha256 digest over the canonical serialization of an envelope. */
export async function observabilityEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid envelope whose canonical digest
 * equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any mismatch —
 * the core tamper tripwire, reused verbatim).
 */
export async function verifyObservabilityEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
