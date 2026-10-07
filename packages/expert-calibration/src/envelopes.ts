/**
 * Envelope wiring for the expert-calibration protocol (Work Order C004;
 * architecture-lock rules 17, 18, 22 — mirrors the sibling envelope
 * conventions).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (register-program /
 * record-outcome / run-program / derive-pre-training-track /
 * complete-pre-training-assignment / schedule-requalification-check /
 * run-requalification-check), QUERIES carry none (get-demonstrated-
 * performance is a pure read — the C002 routing input port). Events
 * carry the causal command's key when provided. Payload schemas are
 * versioned SchemaRefs in the `expert-calibration` namespace.
 */

import { makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';

export const EXPERT_CALIBRATION_SCHEMA_VERSION = '1.0.0' as const;

/** Registry of the schemas owned by @arena/expert-calibration. */
export const EXPERT_CALIBRATION_SCHEMAS = Object.freeze({
  'expert-calibration/register-program-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/record-outcome-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/run-program-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/derive-pre-training-track-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/complete-pre-training-assignment-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/schedule-requalification-check-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/run-requalification-check-command': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/program-registered-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/outcome-recorded-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/verdict-derived-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/pre-training-completed-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/qualification-update-proposed-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/requalification-proposed-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/requalification-check-scheduled-event': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/get-demonstrated-performance-query': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/get-demonstrated-performance-response': EXPERT_CALIBRATION_SCHEMA_VERSION,
  'expert-calibration/error': EXPERT_CALIBRATION_SCHEMA_VERSION,
} as const);

export type ExpertCalibrationSchemaName = keyof typeof EXPERT_CALIBRATION_SCHEMAS;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ExpertCalibrationEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
}

function requireId(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a valid ${field}`,
      details: { field, pattern: 'lowercase-kebab, <= 63 chars' },
    });
  }
  return value;
}

function requireTimestamp(value: unknown, context: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context} payload requires an ms-precision UTC timestamp`,
    });
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_REF, {
      message: `${field} requires a sha256 content digest`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function requireNonEmpty(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a non-empty ${field}`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Commands (idempotency key REQUIRED)
// ---------------------------------------------------------------------------

export interface RegisterProgramCommandPayload {
  readonly programId: string;
  readonly tenant: string;
  readonly seed: string;
  readonly at: string;
}

export function makeRegisterProgramCommand(
  payload: RegisterProgramCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RegisterProgramCommandPayload> {
  requireId(payload.programId, 'register-program', 'programId');
  requireNonEmpty(payload.tenant, 'register-program', 'tenant');
  requireNonEmpty(payload.seed, 'register-program', 'seed');
  requireTimestamp(payload.at, 'register-program');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/register-program-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface RecordOutcomeCommandPayload {
  readonly programId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeRecordOutcomeCommand(
  payload: RecordOutcomeCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RecordOutcomeCommandPayload> {
  requireId(payload.programId, 'record-outcome', 'programId');
  requireNonEmpty(payload.tenant, 'record-outcome', 'tenant');
  requireNonEmpty(payload.expertId, 'record-outcome', 'expertId');
  requireTimestamp(payload.at, 'record-outcome');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/record-outcome-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface RunProgramCommandPayload {
  readonly programId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeRunProgramCommand(
  payload: RunProgramCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RunProgramCommandPayload> {
  requireId(payload.programId, 'run-program', 'programId');
  requireNonEmpty(payload.tenant, 'run-program', 'tenant');
  requireNonEmpty(payload.expertId, 'run-program', 'expertId');
  requireTimestamp(payload.at, 'run-program');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/run-program-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface DerivePreTrainingTrackCommandPayload {
  readonly trackId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly intakeSessionId: string;
  readonly at: string;
}

export function makeDerivePreTrainingTrackCommand(
  payload: DerivePreTrainingTrackCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<DerivePreTrainingTrackCommandPayload> {
  requireId(payload.trackId, 'derive-pre-training-track', 'trackId');
  requireNonEmpty(payload.tenant, 'derive-pre-training-track', 'tenant');
  requireNonEmpty(payload.expertId, 'derive-pre-training-track', 'expertId');
  requireNonEmpty(payload.intakeSessionId, 'derive-pre-training-track', 'intakeSessionId');
  requireTimestamp(payload.at, 'derive-pre-training-track');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/derive-pre-training-track-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface CompletePreTrainingAssignmentCommandPayload {
  readonly trackId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly assignmentId: string;
  readonly at: string;
}

export function makeCompletePreTrainingAssignmentCommand(
  payload: CompletePreTrainingAssignmentCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<CompletePreTrainingAssignmentCommandPayload> {
  requireId(payload.trackId, 'complete-pre-training-assignment', 'trackId');
  requireNonEmpty(payload.tenant, 'complete-pre-training-assignment', 'tenant');
  requireNonEmpty(payload.expertId, 'complete-pre-training-assignment', 'expertId');
  requireNonEmpty(payload.assignmentId, 'complete-pre-training-assignment', 'assignmentId');
  requireTimestamp(payload.at, 'complete-pre-training-assignment');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/complete-pre-training-assignment-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface ScheduleRequalificationCheckCommandPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly programId: string;
  readonly at: string;
}

export function makeScheduleRequalificationCheckCommand(
  payload: ScheduleRequalificationCheckCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<ScheduleRequalificationCheckCommandPayload> {
  requireNonEmpty(payload.tenant, 'schedule-requalification-check', 'tenant');
  requireNonEmpty(payload.expertId, 'schedule-requalification-check', 'expertId');
  requireId(payload.programId, 'schedule-requalification-check', 'programId');
  requireTimestamp(payload.at, 'schedule-requalification-check');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/schedule-requalification-check-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface RunRequalificationCheckCommandPayload {
  readonly jobId: string;
  readonly tenant: string;
  readonly at: string;
}

export function makeRunRequalificationCheckCommand(
  payload: RunRequalificationCheckCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RunRequalificationCheckCommandPayload> {
  requireNonEmpty(payload.jobId, 'run-requalification-check', 'jobId');
  requireNonEmpty(payload.tenant, 'run-requalification-check', 'tenant');
  requireTimestamp(payload.at, 'run-requalification-check');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-calibration/run-requalification-check-command@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ProgramRegisteredEventPayload {
  readonly programId: string;
  readonly programDigest: string;
  readonly probeCount: number;
  readonly at: string;
}

export function makeProgramRegisteredEvent(
  payload: ProgramRegisteredEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<ProgramRegisteredEventPayload> {
  requireId(payload.programId, 'program-registered', 'programId');
  requireDigest(payload.programDigest, 'programDigest');
  if (typeof payload.probeCount !== 'number' || !Number.isInteger(payload.probeCount) || payload.probeCount < 1) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, {
      message: 'program-registered payload requires a positive integer probeCount',
    });
  }
  requireTimestamp(payload.at, 'program-registered');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/program-registered-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface OutcomeRecordedEventPayload {
  readonly calibrationId: string;
  readonly programDigest: string;
  readonly expertId: string;
  readonly outcome: string;
  readonly at: string;
}

export function makeOutcomeRecordedEvent(
  payload: OutcomeRecordedEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<OutcomeRecordedEventPayload> {
  requireId(payload.calibrationId, 'outcome-recorded', 'calibrationId');
  requireDigest(payload.programDigest, 'programDigest');
  requireNonEmpty(payload.expertId, 'outcome-recorded', 'expertId');
  const outcomes = ['correct', 'incorrect', 'inconclusive'];
  if (!outcomes.includes(payload.outcome)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message: `outcome-recorded payload outcome must be one of ${outcomes.join(', ')}`,
    });
  }
  requireTimestamp(payload.at, 'outcome-recorded');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/outcome-recorded-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface VerdictDerivedEventPayload {
  readonly verdictId: string;
  readonly programDigest: string;
  readonly expertId: string;
  readonly verdict: string;
  readonly freshDecidedCount: number;
  readonly at: string;
}

export function makeVerdictDerivedEvent(
  payload: VerdictDerivedEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<VerdictDerivedEventPayload> {
  requireId(payload.verdictId, 'verdict-derived', 'verdictId');
  requireDigest(payload.programDigest, 'programDigest');
  requireNonEmpty(payload.expertId, 'verdict-derived', 'expertId');
  const verdicts = ['calibrated', 'overconfident', 'underconfident', 'insufficient-sample', 'stale'];
  if (!verdicts.includes(payload.verdict)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: `verdict-derived payload verdict must be one of ${verdicts.join(', ')}`,
    });
  }
  if (typeof payload.freshDecidedCount !== 'number' || !Number.isInteger(payload.freshDecidedCount) || payload.freshDecidedCount < 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'verdict-derived payload requires a non-negative integer freshDecidedCount',
    });
  }
  requireTimestamp(payload.at, 'verdict-derived');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/verdict-derived-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface PreTrainingCompletedEventPayload {
  readonly trackId: string;
  readonly trackDigest: string;
  readonly expertId: string;
  readonly assignmentCount: number;
  readonly at: string;
}

export function makePreTrainingCompletedEvent(
  payload: PreTrainingCompletedEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<PreTrainingCompletedEventPayload> {
  requireId(payload.trackId, 'pre-training-completed', 'trackId');
  requireDigest(payload.trackDigest, 'trackDigest');
  requireNonEmpty(payload.expertId, 'pre-training-completed', 'expertId');
  if (typeof payload.assignmentCount !== 'number' || !Number.isInteger(payload.assignmentCount) || payload.assignmentCount < 1) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
      message: 'pre-training-completed payload requires a positive integer assignmentCount',
    });
  }
  requireTimestamp(payload.at, 'pre-training-completed');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/pre-training-completed-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface QualificationUpdateProposedEventPayload {
  readonly trackDigest: string;
  readonly proposalDigest: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeQualificationUpdateProposedEvent(
  payload: QualificationUpdateProposedEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<QualificationUpdateProposedEventPayload> {
  requireDigest(payload.trackDigest, 'trackDigest');
  requireDigest(payload.proposalDigest, 'proposalDigest');
  requireNonEmpty(payload.expertId, 'qualification-update-proposed', 'expertId');
  requireTimestamp(payload.at, 'qualification-update-proposed');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/qualification-update-proposed-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface RequalificationProposedEventPayload {
  readonly proposalDigest: string;
  readonly expertId: string;
  readonly trigger: string;
  readonly proposedStatus: string;
  readonly at: string;
}

export function makeRequalificationProposedEvent(
  payload: RequalificationProposedEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<RequalificationProposedEventPayload> {
  requireDigest(payload.proposalDigest, 'proposalDigest');
  requireNonEmpty(payload.expertId, 'requalification-proposed', 'expertId');
  const triggers = ['time-window-elapsed', 'drift-verdict', 'domain-pack-change', 'dispute-raised'];
  if (!triggers.includes(payload.trigger)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: `requalification-proposed payload trigger must be one of ${triggers.join(', ')}`,
    });
  }
  const statuses = ['expired', 'stale', 'revoked'];
  if (!statuses.includes(payload.proposedStatus)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROPOSAL, {
      message: `requalification-proposed payload proposedStatus must be one of ${statuses.join(', ')}`,
    });
  }
  requireTimestamp(payload.at, 'requalification-proposed');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/requalification-proposed-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface RequalificationCheckScheduledEventPayload {
  readonly jobId: string;
  readonly expertId: string;
  readonly scheduledAt: string;
  readonly at: string;
}

export function makeRequalificationCheckScheduledEvent(
  payload: RequalificationCheckScheduledEventPayload,
  context: ExpertCalibrationEnvelopeContext,
): Envelope<RequalificationCheckScheduledEventPayload> {
  requireNonEmpty(payload.jobId, 'requalification-check-scheduled', 'jobId');
  requireNonEmpty(payload.expertId, 'requalification-check-scheduled', 'expertId');
  requireTimestamp(payload.scheduledAt, 'requalification-check-scheduled');
  requireTimestamp(payload.at, 'requalification-check-scheduled');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-calibration/requalification-check-scheduled-event@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Queries (pure reads — no idempotency key; the C002 routing input port)
// ---------------------------------------------------------------------------

export interface GetDemonstratedPerformanceQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly capabilityId: string;
}

export function makeGetDemonstratedPerformanceQuery(
  payload: GetDemonstratedPerformanceQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetDemonstratedPerformanceQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-demonstrated-performance', 'tenant');
  requireNonEmpty(payload.expertId, 'get-demonstrated-performance', 'expertId');
  requireNonEmpty(payload.capabilityId, 'get-demonstrated-performance', 'capabilityId');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-calibration/get-demonstrated-performance-query@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetDemonstratedPerformanceResponsePayload {
  readonly expertId: string;
  readonly verdict: string;
  readonly freshSampleCount: number;
  readonly totalSampleCount: number;
  readonly inForce: boolean;
  readonly performanceDigest: string;
}

export function makeGetDemonstratedPerformanceResponse(
  payload: GetDemonstratedPerformanceResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetDemonstratedPerformanceResponsePayload> {
  requireNonEmpty(payload.expertId, 'get-demonstrated-performance-response', 'expertId');
  const verdicts = ['calibrated', 'overconfident', 'underconfident', 'insufficient-sample', 'stale'];
  if (!verdicts.includes(payload.verdict)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: `get-demonstrated-performance-response payload verdict must be one of ${verdicts.join(', ')}`,
    });
  }
  for (const field of ['freshSampleCount', 'totalSampleCount']) {
    const value = (payload as unknown as Record<string, unknown>)[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
        message: `get-demonstrated-performance-response payload requires a non-negative integer ${field}`,
      });
    }
  }
  requireDigest(payload.performanceDigest, 'performanceDigest');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-calibration/get-demonstrated-performance-response@${EXPERT_CALIBRATION_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}
