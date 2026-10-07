/**
 * Envelope wiring for the expert-performance protocol (Work Order C005;
 * architecture-lock rules 17, 18, 22 — mirrors the sibling envelope
 * conventions).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (append-evidence —
 * the single write command; ingestion is append-only), QUERIES carry none
 * (get-routing-input / get-capability-history / get-dimension-aggregate /
 * get-evidence-record are pure reads — the C002 routing lens and the
 * expert-facing lens are read ports, never writes). Events carry the
 * causal command's key when provided. Payload schemas are versioned
 * SchemaRefs in the `expert-performance` namespace.
 *
 * THE NO-SINGLE-GLOBAL-SCORE LAW AT THE WIRE BOUNDARY: there is NO
 * command, query, event or response schema for a global/overall score —
 * an envelope whose schema name carries 'global-score' or
 * 'overall-score' is rejected at construction (makeEnvelope validates the
 * schema ref pattern; this module additionally screens the closed schema
 * registry), so a single-score smuggling attempt through an aggregate
 * endpoint has no wire shape to travel in.
 */

import { makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import { isPerformanceDimension } from './dimensions.js';
import { isEvidenceSourceFamily } from './dimensions.js';
import { isPerformanceContentDigest } from './shared.js';

export const EXPERT_PERFORMANCE_SCHEMA_VERSION = '1.0.0' as const;

/** Registry of the schemas owned by @arena/expert-performance. */
export const EXPERT_PERFORMANCE_SCHEMAS = Object.freeze({
  'expert-performance/append-evidence-command': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/evidence-appended-event': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-routing-input-query': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-routing-input-response': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-capability-history-query': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-capability-history-response': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-dimension-aggregate-query': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-dimension-aggregate-response': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-evidence-record-query': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/get-evidence-record-response': EXPERT_PERFORMANCE_SCHEMA_VERSION,
  'expert-performance/error': EXPERT_PERFORMANCE_SCHEMA_VERSION,
} as const);

export type ExpertPerformanceSchemaName = keyof typeof EXPERT_PERFORMANCE_SCHEMAS;

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORD_ID_PATTERN = /^perf-[a-z0-9][a-z0-9-]{0,62}$/;

function requireNonEmpty(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a non-empty ${field}`,
    });
  }
  return value;
}

function requireTimestamp(value: unknown, context: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context} payload requires an ms-precision UTC timestamp`,
    });
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isPerformanceContentDigest(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF, {
      message: `${field} requires a sha256 content digest`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function requireRecordId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !RECORD_ID_PATTERN.test(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a 'perf-<lowercase-kebab>' recordId`,
    });
  }
  return value;
}

/** Screen a requested schema name against the closed registry (no score-shaped schemas exist). */
function requireSchema(name: string): string {
  const forbidden = ['global-score', 'overall-score', 'expert-rating'];
  for (const stem of forbidden) {
    if (name.includes(stem)) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
        message: `expert-performance schema '${name}' does not exist — no global/overall score wire shape exists (no-single-global-score law)`,
      });
    }
  }
  if (!(name in EXPERT_PERFORMANCE_SCHEMAS)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF, {
      message: `expert-performance schema '${name}' is not in the closed registry`,
      details: { known: Object.keys(EXPERT_PERFORMANCE_SCHEMAS) },
    });
  }
  return name;
}

export interface ExpertPerformanceEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
}

// ---------------------------------------------------------------------------
// Commands (idempotency key REQUIRED — lock rule 17)
// ---------------------------------------------------------------------------

export interface AppendEvidenceCommandPayload {
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  /** The dep source family the evidence accumulates from (closed). */
  readonly family: string;
  /** The dimension this evidence feeds (must be admissible for the family). */
  readonly dimension: string;
  /** The content digest of the dep record the evidence derives from. */
  readonly refDigest: string;
  readonly at: string;
}

export function makeAppendEvidenceCommand(
  payload: AppendEvidenceCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<AppendEvidenceCommandPayload> {
  requireRecordId(payload.recordId, 'append-evidence');
  requireNonEmpty(payload.tenant, 'append-evidence', 'tenant');
  requireNonEmpty(payload.expertId, 'append-evidence', 'expertId');
  if (!isEvidenceSourceFamily(payload.family)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
      message: `append-evidence payload family must be a closed evidence source family, got: ${JSON.stringify(payload.family)}`,
    });
  }
  if (!isPerformanceDimension(payload.dimension)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
      message: `append-evidence payload dimension must be a closed expert-quality dimension, got: ${JSON.stringify(payload.dimension)}`,
    });
  }
  requireDigest(payload.refDigest, 'append-evidence.refDigest');
  requireTimestamp(payload.at, 'append-evidence');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-performance/append-evidence-command@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EvidenceAppendedEventPayload {
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly dimension: string;
  readonly outcome: string;
  readonly attributionKind: string;
  readonly recordDigest: string;
  readonly at: string;
}

export function makeEvidenceAppendedEvent(
  payload: EvidenceAppendedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<EvidenceAppendedEventPayload> {
  requireRecordId(payload.recordId, 'evidence-appended');
  requireNonEmpty(payload.tenant, 'evidence-appended', 'tenant');
  requireNonEmpty(payload.expertId, 'evidence-appended', 'expertId');
  if (!isPerformanceDimension(payload.dimension)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
      message: `evidence-appended payload dimension must be a closed expert-quality dimension`,
    });
  }
  requireNonEmpty(payload.outcome, 'evidence-appended', 'outcome');
  if (!['expert-change', 'evaluator-change', 'measurement-variance'].includes(payload.attributionKind)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.ATTRIBUTION_VIOLATION, {
      message: `evidence-appended payload attributionKind must be the closed LE1.0 vocabulary`,
    });
  }
  requireDigest(payload.recordDigest, 'evidence-appended.recordDigest');
  requireTimestamp(payload.at, 'evidence-appended');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-performance/evidence-appended-event@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Queries + responses (pure reads — the two lenses + provenance reads)
// ---------------------------------------------------------------------------

export interface GetRoutingInputQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeGetRoutingInputQuery(
  payload: GetRoutingInputQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetRoutingInputQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-routing-input', 'tenant');
  requireNonEmpty(payload.expertId, 'get-routing-input', 'expertId');
  requireTimestamp(payload.at, 'get-routing-input');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-performance/get-routing-input-query@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetRoutingInputResponsePayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: string;
  readonly profileDigest: string;
  /** The eight dimension summaries in canonical quality-model order. */
  readonly dimensions: readonly {
    readonly dimension: string;
    readonly freshness: string;
    readonly recordCount: number;
    readonly totalSampleSize: number;
    readonly latestOutcome: string | null;
    readonly evaluatorVersionChanges: number;
  }[];
}

export function makeGetRoutingInputResponse(
  payload: GetRoutingInputResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetRoutingInputResponsePayload> {
  requireNonEmpty(payload.tenant, 'get-routing-input-response', 'tenant');
  requireNonEmpty(payload.expertId, 'get-routing-input-response', 'expertId');
  requireTimestamp(payload.asOf, 'get-routing-input-response');
  requireDigest(payload.profileDigest, 'get-routing-input-response.profileDigest');
  if (!Array.isArray(payload.dimensions) || payload.dimensions.length !== 8) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'get-routing-input-response payload requires all eight dimension summaries',
    });
  }
  for (const summary of payload.dimensions) {
    if (!isPerformanceDimension(summary.dimension)) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
        message: 'get-routing-input-response payload dimension summaries must use the closed vocabulary',
      });
    }
    if (!['fresh', 'stale', 'no-evidence'].includes(summary.freshness)) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD, {
        message: 'get-routing-input-response payload freshness must be fresh | stale | no-evidence',
      });
    }
  }
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-performance/get-routing-input-response@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetCapabilityHistoryQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeGetCapabilityHistoryQuery(
  payload: GetCapabilityHistoryQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetCapabilityHistoryQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-capability-history', 'tenant');
  requireNonEmpty(payload.expertId, 'get-capability-history', 'expertId');
  requireTimestamp(payload.at, 'get-capability-history');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-performance/get-capability-history-query@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetCapabilityHistoryResponsePayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: string;
  readonly profileDigest: string;
  readonly totalRecords: number;
}

export function makeGetCapabilityHistoryResponse(
  payload: GetCapabilityHistoryResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetCapabilityHistoryResponsePayload> {
  requireNonEmpty(payload.tenant, 'get-capability-history-response', 'tenant');
  requireNonEmpty(payload.expertId, 'get-capability-history-response', 'expertId');
  requireTimestamp(payload.asOf, 'get-capability-history-response');
  requireDigest(payload.profileDigest, 'get-capability-history-response.profileDigest');
  if (typeof payload.totalRecords !== 'number' || !Number.isInteger(payload.totalRecords) || payload.totalRecords < 0) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'get-capability-history-response payload requires a non-negative integer totalRecords',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-performance/get-capability-history-response@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetDimensionAggregateQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  /** EXACTLY ONE dimension — cross-dimension aggregate queries are rejected. */
  readonly dimension: string;
  readonly at: string;
}

export function makeGetDimensionAggregateQuery(
  payload: GetDimensionAggregateQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetDimensionAggregateQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-dimension-aggregate', 'tenant');
  requireNonEmpty(payload.expertId, 'get-dimension-aggregate', 'expertId');
  requireSchema('expert-performance/get-dimension-aggregate-query');
  if (!isPerformanceDimension(payload.dimension)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
      message: `get-dimension-aggregate payload dimension must be ONE closed expert-quality dimension — a cross-dimension/global aggregate query has no wire shape`,
    });
  }
  requireTimestamp(payload.at, 'get-dimension-aggregate');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-performance/get-dimension-aggregate-query@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetDimensionAggregateResponsePayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly dimension: string;
  readonly formula: string;
  readonly formulaVersion: string;
  readonly sampleSize: number;
  readonly aggregateDigest: string;
}

export function makeGetDimensionAggregateResponse(
  payload: GetDimensionAggregateResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetDimensionAggregateResponsePayload> {
  requireNonEmpty(payload.tenant, 'get-dimension-aggregate-response', 'tenant');
  requireNonEmpty(payload.expertId, 'get-dimension-aggregate-response', 'expertId');
  if (!isPerformanceDimension(payload.dimension)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
      message: 'get-dimension-aggregate-response payload dimension must be ONE closed dimension',
    });
  }
  if (payload.formula !== 'dimensional-outcome-frequency') {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
      message: `get-dimension-aggregate-response formula '${payload.formula}' is not the closed single-dimension formula — no other aggregate can travel on this wire`,
    });
  }
  requireNonEmpty(payload.formulaVersion, 'get-dimension-aggregate-response', 'formulaVersion');
  if (typeof payload.sampleSize !== 'number' || !Number.isInteger(payload.sampleSize) || payload.sampleSize < 0) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_AGGREGATE, {
      message: 'get-dimension-aggregate-response payload requires a non-negative integer sampleSize',
    });
  }
  requireDigest(payload.aggregateDigest, 'get-dimension-aggregate-response.aggregateDigest');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-performance/get-dimension-aggregate-response@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetEvidenceRecordQueryPayload {
  readonly tenant: string;
  readonly recordId: string;
}

export function makeGetEvidenceRecordQuery(
  payload: GetEvidenceRecordQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetEvidenceRecordQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-evidence-record', 'tenant');
  requireRecordId(payload.recordId, 'get-evidence-record');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-performance/get-evidence-record-query@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetEvidenceRecordResponsePayload {
  readonly tenant: string;
  readonly recordId: string;
  readonly recordDigest: string;
}

export function makeGetEvidenceRecordResponse(
  payload: GetEvidenceRecordResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetEvidenceRecordResponsePayload> {
  requireNonEmpty(payload.tenant, 'get-evidence-record-response', 'tenant');
  requireRecordId(payload.recordId, 'get-evidence-record-response');
  requireDigest(payload.recordDigest, 'get-evidence-record-response.recordDigest');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-performance/get-evidence-record-response@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface ExpertPerformanceErrorPayload {
  readonly code: string;
  readonly category: string;
  readonly message: string;
}

export function makeExpertPerformanceError(
  payload: ExpertPerformanceErrorPayload,
  context: { correlationId: CorrelationId },
): Envelope<ExpertPerformanceErrorPayload> {
  requireNonEmpty(payload.code, 'expert-performance-error', 'code');
  requireNonEmpty(payload.category, 'expert-performance-error', 'category');
  requireNonEmpty(payload.message, 'expert-performance-error', 'message');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-performance/error@${EXPERT_PERFORMANCE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}
