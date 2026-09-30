/**
 * Typed telemetry core (Work Order A035; requirements R33, R27, R28).
 *
 * Metrics, traces, logs and security audit events are PROTOCOL OBJECTS,
 * not unstructured strings: every signal is a closed, frozen, strictly
 * validated record riding the A015 envelope discipline —
 *
 *   - every signal carries a REQUIRED correlation id and an optional
 *     causation id (the envelope id of the command that caused the
 *     observation — causation/correlation addressability);
 *   - every signal carries a 1-based sequence, contiguous within its
 *     emitting source's stream: gaps, duplicates and regressions are
 *     REJECTED at append time (OBS_SEQUENCE_* — the job-event-log
 *     discipline, applied per source);
 *   - audit signals (A034) are FIRST-CLASS telemetry: they reference a
 *     structurally valid @arena/security audit event and are the
 *     operational bridge between the security audit trail and the
 *     observability layer;
 *   - unknown signal kinds and unsupported wire versions are rejected
 *     FAIL-CLOSED (OBS_UNKNOWN_EVENT / OBS_UNSUPPORTED_SIGNAL_VERSION).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';
import type { SecurityAuditEvent } from '@arena/security';
import { isSecurityAuditEvent } from '@arena/security';
import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import {
  checkAttributes,
  deepFreeze,
  isEnumMember,
  isFiniteNonNegativeNumber,
  isNeutralId,
  isNeutralText,
  isObservabilityTimestamp,
  isTelemetryId,
  LOG_LEVELS,
  METRIC_TYPES,
  METRIC_UNITS,
  TRACE_STATUSES,
} from './shared.js';
import type {
  LogLevel,
  MetricType,
  MetricUnit,
  NeutralId,
  ObservabilityTimestamp,
  TelemetryId,
  TraceStatus,
} from './shared.js';

/** Wire version of every telemetry signal payload. */
export const TELEMETRY_SIGNAL_VERSION = 1 as const;

/** The closed telemetry-signal vocabulary. */
export const TELEMETRY_SIGNAL_KINDS = Object.freeze([
  'metric',
  'trace',
  'log',
  'audit',
] as const);
export type TelemetrySignalKind = (typeof TELEMETRY_SIGNAL_KINDS)[number];

export function isTelemetrySignalKind(value: unknown): value is TelemetrySignalKind {
  return isEnumMember(value, TELEMETRY_SIGNAL_KINDS);
}

const CAUSATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------------------
// Signal payloads (discriminated union)
// ---------------------------------------------------------------------------

interface SignalCommon {
  readonly signalVersion: typeof TELEMETRY_SIGNAL_VERSION;
  /** The closed signal kind (discriminator). */
  readonly kind: TelemetrySignalKind;
  /** Unique id within the emitting source's stream. */
  readonly signalId: TelemetryId;
  /** 1-based monotonic sequence within the emitting source's stream. */
  readonly sequence: number;
  /** Epoch-ms UTC instant the observation refers to. */
  readonly occurredAt: ObservabilityTimestamp;
  /** The emitting service (neutral id, e.g. "job-orchestrator"). */
  readonly sourceService: NeutralId;
  /** REQUIRED correlation id (A015 envelope discipline). */
  readonly correlationId: CorrelationId;
  /** The envelope id of the command that caused this observation, or null. */
  readonly causationId: string | null;
  /** Owning tenant, or null for platform-level signals. */
  readonly tenantId: string | null;
}

export interface MetricSignal extends SignalCommon {
  readonly kind: 'metric';
  readonly metricName: NeutralId;
  readonly metricType: MetricType;
  readonly unit: MetricUnit;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface TraceSignal extends SignalCommon {
  readonly kind: 'trace';
  readonly spanId: TelemetryId;
  readonly parentSpanId: TelemetryId | null;
  readonly operation: NeutralId;
  readonly status: TraceStatus;
  /** Duration in ms; REQUIRED unless status is 'open'. */
  readonly durationMs: number | null;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface LogSignal extends SignalCommon {
  readonly kind: 'log';
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * A034 integration: security audit events are first-class telemetry. The
 * payload references a STRUCTURALLY VALID @arena/security audit event
 * (verified at construction time — fail-closed).
 */
export interface AuditSignal extends SignalCommon {
  readonly kind: 'audit';
  readonly auditEvent: SecurityAuditEvent;
}

export type TelemetrySignal = MetricSignal | TraceSignal | LogSignal | AuditSignal;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

export function isTelemetrySignal(value: unknown): value is TelemetrySignal {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['signalVersion'] !== TELEMETRY_SIGNAL_VERSION) return false;
  if (!isTelemetrySignalKind(record['kind'])) return false;
  if (!isTelemetryId(record['signalId'])) return false;
  if (typeof record['sequence'] !== 'number' || !Number.isSafeInteger(record['sequence']) || record['sequence'] < 1) return false;
  if (!isObservabilityTimestamp(record['occurredAt'])) return false;
  if (!isNeutralId(record['sourceService'])) return false;
  if (!isCorrelationId(record['correlationId'])) return false;
  switch (record['kind']) {
    case 'metric':
      return (
        isNeutralId(record['metricName']) &&
        isEnumMember(record['metricType'], METRIC_TYPES) &&
        isEnumMember(record['unit'], METRIC_UNITS) &&
        typeof record['value'] === 'number' &&
        Number.isFinite(record['value'])
      );
    case 'trace':
      return (
        isTelemetryId(record['spanId']) &&
        (record['parentSpanId'] === null || isTelemetryId(record['parentSpanId'])) &&
        isNeutralId(record['operation']) &&
        isEnumMember(record['status'], TRACE_STATUSES)
      );
    case 'log':
      return isEnumMember(record['level'], LOG_LEVELS) && typeof record['message'] === 'string';
    case 'audit':
      return isSecurityAuditEvent(record['auditEvent']);
    default:
      return false;
  }
}

/** Validate + freeze a raw value into a TelemetrySignal (throws closed OBS errors). */
export function toTelemetrySignal(value: unknown): TelemetrySignal {
  if (typeof value !== 'object' || value === null) {
    throw invalidSignal('signal must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (record['signalVersion'] !== TELEMETRY_SIGNAL_VERSION) {
    throw new ObservabilityError(OBS_ERROR_CODES.UNSUPPORTED_SIGNAL_VERSION, {
      message: `unsupported signal wire version: ${String(record['signalVersion'])} (expected ${String(TELEMETRY_SIGNAL_VERSION)})`,
    });
  }
  const kind = record['kind'];
  if (!isTelemetrySignalKind(kind)) {
    // FAIL-CLOSED on unknown event kinds.
    throw new ObservabilityError(OBS_ERROR_CODES.UNKNOWN_EVENT, {
      message: `unknown telemetry signal kind: ${String(kind)} (closed vocabulary: ${TELEMETRY_SIGNAL_KINDS.join(', ')})`,
      details: { knownKinds: [...TELEMETRY_SIGNAL_KINDS] },
    });
  }
  const common = checkCommon(record);
  switch (kind) {
    case 'metric':
      return deepFreeze(toMetricSignal(record, common));
    case 'trace':
      return deepFreeze(toTraceSignal(record, common));
    case 'log':
      return deepFreeze(toLogSignal(record, common));
    case 'audit':
      return deepFreeze(toAuditSignal(record, common));
  }
}

function invalidSignal(reason: string): ObservabilityError {
  return new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
    message: `malformed telemetry signal: ${reason}`,
  });
}

function checkCommon(record: Record<string, unknown>): SignalCommon {
  if (!isTelemetryId(record['signalId'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid signalId: ${JSON.stringify(record['signalId'])}`,
    });
  }
  const sequence = record['sequence'];
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
      message: `sequence must be a positive integer, got ${String(sequence)}`,
    });
  }
  if (!isObservabilityTimestamp(record['occurredAt'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `occurredAt must be an epoch-ms integer >= 0, got ${String(record['occurredAt'])}`,
    });
  }
  if (!isNeutralId(record['sourceService'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
      message: `sourceService must be a neutral id (lowercase, 2..63 chars), got ${JSON.stringify(record['sourceService'])}`,
    });
  }
  if (!isCorrelationId(record['correlationId'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
      message: `correlationId is REQUIRED on every telemetry signal (A015 envelope discipline)`,
    });
  }
  const causationId = record['causationId'];
  if (causationId !== null && causationId !== undefined) {
    if (typeof causationId !== 'string' || !CAUSATION_PATTERN.test(causationId)) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
        message: `causationId must match ${CAUSATION_PATTERN.source} or be null`,
      });
    }
  }
  const tenantId = record['tenantId'];
  if (tenantId !== null && tenantId !== undefined && typeof tenantId !== 'string') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
      message: 'tenantId must be a string or null',
    });
  }
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: record['kind'] as TelemetrySignalKind,
    signalId: record['signalId'] as TelemetryId,
    sequence,
    occurredAt: record['occurredAt'] as ObservabilityTimestamp,
    sourceService: record['sourceService'] as NeutralId,
    correlationId: record['correlationId'] as CorrelationId,
    causationId: (causationId ?? null) as string | null,
    tenantId: (tenantId ?? null) as string | null,
  };
}

function toMetricSignal(
  record: Record<string, unknown>,
  common: SignalCommon,
): MetricSignal {
  if (!isNeutralId(record['metricName'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_METRIC, {
      message: `metricName must be a neutral id, got ${JSON.stringify(record['metricName'])}`,
    });
  }
  if (!isEnumMember(record['metricType'], METRIC_TYPES)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_METRIC, {
      message: `metricType must be one of ${METRIC_TYPES.join(', ')}, got ${String(record['metricType'])}`,
    });
  }
  if (!isEnumMember(record['unit'], METRIC_UNITS)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_METRIC, {
      message: `unit must be one of ${METRIC_UNITS.join(', ')}, got ${String(record['unit'])}`,
    });
  }
  const value = record['value'];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_METRIC, {
      message: `metric value must be a finite number, got ${String(value)}`,
    });
  }
  if (!isFiniteNonNegativeNumber(Math.abs(value))) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_METRIC, {
      message: 'metric value magnitude is not representable',
    });
  }
  const labels = wrapAttributes(() => checkAttributes(record['labels'], 'metric labels'), OBS_ERROR_CODES.INVALID_METRIC);
  return {
    ...common,
    kind: 'metric',
    metricName: record['metricName'] as NeutralId,
    metricType: record['metricType'] as MetricType,
    unit: record['unit'] as MetricUnit,
    value,
    labels,
  };
}

function toTraceSignal(
  record: Record<string, unknown>,
  common: SignalCommon,
): TraceSignal {
  if (!isTelemetryId(record['spanId'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
      message: `spanId must be a telemetry id, got ${JSON.stringify(record['spanId'])}`,
    });
  }
  const parent = record['parentSpanId'];
  if (parent !== null && parent !== undefined && !isTelemetryId(parent)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
      message: `parentSpanId must be a telemetry id or null, got ${JSON.stringify(parent)}`,
    });
  }
  if (!isNeutralId(record['operation'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
      message: `operation must be a neutral id, got ${JSON.stringify(record['operation'])}`,
    });
  }
  if (!isEnumMember(record['status'], TRACE_STATUSES)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
      message: `trace status must be one of ${TRACE_STATUSES.join(', ')}, got ${String(record['status'])}`,
    });
  }
  const status = record['status'] as TraceStatus;
  const duration = record['durationMs'];
  if (status === 'open') {
    if (duration !== null && duration !== undefined) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
        message: 'an open span must not carry durationMs',
      });
    }
  } else if (typeof duration !== 'number' || !isFiniteNonNegativeNumber(duration)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TRACE, {
      message: `a closed span (${status}) REQUIRES a finite non-negative durationMs, got ${String(duration)}`,
    });
  }
  const attributes = wrapAttributes(() => checkAttributes(record['attributes'], 'trace attributes'), OBS_ERROR_CODES.INVALID_TRACE);
  return {
    ...common,
    kind: 'trace',
    spanId: record['spanId'] as TelemetryId,
    parentSpanId: (parent ?? null) as TelemetryId | null,
    operation: record['operation'] as NeutralId,
    status,
    durationMs: (duration ?? null) as number | null,
    attributes,
  };
}

function toLogSignal(record: Record<string, unknown>, common: SignalCommon): LogSignal {
  if (!isEnumMember(record['level'], LOG_LEVELS)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_LOG, {
      message: `log level must be one of ${LOG_LEVELS.join(', ')}, got ${String(record['level'])}`,
    });
  }
  if (!isNeutralText(record['message'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_LOG, {
      message: 'log message must be neutral text (printable ASCII, 1..4096 chars)',
    });
  }
  const fields = wrapAttributes(() => checkAttributes(record['fields'], 'log fields'), OBS_ERROR_CODES.INVALID_LOG);
  return {
    ...common,
    kind: 'log',
    level: record['level'] as LogLevel,
    message: record['message'],
    fields,
  };
}

function toAuditSignal(record: Record<string, unknown>, common: SignalCommon): AuditSignal {
  const auditEvent = record['auditEvent'];
  if (!isSecurityAuditEvent(auditEvent)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_AUDIT, {
      message: 'audit signals require a structurally valid @arena/security audit event (A034 integration — fail-closed)',
    });
  }
  return {
    ...common,
    kind: 'audit',
    auditEvent,
  };
}

/** Wrap a plain attribute-validation error into the closed taxonomy. */
function wrapAttributes(
  check: () => Readonly<Record<string, string>>,
  code: typeof OBS_ERROR_CODES.INVALID_METRIC | typeof OBS_ERROR_CODES.INVALID_TRACE | typeof OBS_ERROR_CODES.INVALID_LOG,
): Readonly<Record<string, string>> {
  try {
    return check();
  } catch (cause) {
    if (cause instanceof Error) {
      throw new ObservabilityError(code, { message: cause.message, cause });
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Per-source append-only signal streams (the A015 event-log discipline)
// ---------------------------------------------------------------------------

/** The telemetry stream of ONE emitting source (append-only, ordered). */
export interface TelemetryStream {
  readonly sourceService: NeutralId;
  readonly signals: readonly TelemetrySignal[];
}

export function createTelemetryStream(sourceService: string): TelemetryStream {
  if (!isNeutralId(sourceService)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid source service for telemetry stream: ${JSON.stringify(sourceService)}`,
    });
  }
  return Object.freeze({ sourceService, signals: Object.freeze([]) });
}

/** Validate + append: returns a NEW frozen stream; the input is never modified. */
export function appendTelemetrySignal(
  stream: TelemetryStream,
  signal: TelemetrySignal,
): TelemetryStream {
  if (signal.sourceService !== stream.sourceService) {
    throw new ObservabilityError(OBS_ERROR_CODES.STREAM_MISMATCH, {
      message: `signal belongs to source ${signal.sourceService}, not ${stream.sourceService} (per-source streams are isolated)`,
      details: { streamSource: stream.sourceService, signalSource: signal.sourceService },
    });
  }
  const expected = stream.signals.length + 1;
  if (signal.sequence < expected) {
    throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_DUPLICATE, {
      message: `signal sequence ${String(signal.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only streams never rewrite history)`,
      details: { expected, actual: signal.sequence, kind: signal.kind },
    });
  }
  if (signal.sequence > expected) {
    throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_GAP, {
      message: `signal sequence ${String(signal.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-source sequences must be contiguous)`,
      details: { expected, actual: signal.sequence, kind: signal.kind },
    });
  }
  const last =
    stream.signals.length > 0 ? stream.signals[stream.signals.length - 1] : undefined;
  if (last !== undefined && last.occurredAt > signal.occurredAt) {
    throw new ObservabilityError(OBS_ERROR_CODES.SAMPLES_UNORDERED, {
      message: `signal timestamps must be monotonically non-decreasing within a source (last: ${String(last.occurredAt)}, attempted: ${String(signal.occurredAt)})`,
      details: { last: last.occurredAt, attempted: signal.occurredAt },
    });
  }
  for (const existing of stream.signals) {
    if (existing.signalId === signal.signalId) {
      throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_DUPLICATE, {
        message: `signalId ${signal.signalId} already exists in the ${stream.sourceService} stream (replayed ingestion rejected)`,
      });
    }
  }
  return Object.freeze({
    sourceService: stream.sourceService,
    signals: Object.freeze([...stream.signals, signal]),
  });
}

/** Re-validate an entire stream (contiguity, ordering, identity). Throws on any violation. */
export function verifyTelemetryStream(stream: TelemetryStream): void {
  let reconstructed = createTelemetryStream(stream.sourceService);
  for (const signal of stream.signals) {
    reconstructed = appendTelemetrySignal(reconstructed, signal);
  }
  if (reconstructed.signals.length !== stream.signals.length) {
    throw new ObservabilityError(OBS_ERROR_CODES.UNKNOWN_ERROR, {
      message: 'telemetry stream revalidation mismatch',
    });
  }
}

/** Human-readable summary (kind + sequence + source). */
export function describeTelemetrySignal(signal: TelemetrySignal): string {
  return `${signal.kind}#${String(signal.sequence)}@${signal.sourceService}`;
}
