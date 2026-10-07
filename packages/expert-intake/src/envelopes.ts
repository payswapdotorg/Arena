/**
 * Envelope wiring for the expert-intake protocol (Work Order C003;
 * architecture-lock rules 17, 18, 22 — mirrors the sibling envelope
 * conventions).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (start-interview /
 * submit-interview / abandon-interview / timeout-interview /
 * assess-interview), QUERIES carry none (get-interview-transcript is a
 * pure read). Events carry the causal command's key when provided.
 * Payload schemas are versioned SchemaRefs in the `expert-intake`
 * namespace.
 */

import { makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import { toIntakeSessionId } from './shared.js';

export const EXPERT_INTAKE_SCHEMA_VERSION = '1.0.0' as const;

/** Registry of the schemas owned by @arena/expert-intake. */
export const EXPERT_INTAKE_SCHEMAS = Object.freeze({
  'expert-intake/start-interview-command': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/submit-interview-command': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/abandon-interview-command': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/timeout-interview-command': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/assess-interview-command': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/intake-submitted-event': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/intake-assessed-event': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/intake-profile-proposed-event': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/get-interview-transcript-query': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/get-interview-transcript-response': EXPERT_INTAKE_SCHEMA_VERSION,
  'expert-intake/error': EXPERT_INTAKE_SCHEMA_VERSION,
} as const);

export type ExpertIntakeSchemaName = keyof typeof EXPERT_INTAKE_SCHEMAS;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SESSION_ID_PATTERN = /^intake-[a-z0-9][a-z0-9-]{0,62}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ExpertIntakeEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
}

function requireSessionId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: `${context} payload requires a valid intake session id`,
      details: { field: 'sessionId', pattern: 'intake-<lowercase-kebab>' },
    });
  }
  return value;
}

function requireTimestamp(value: unknown, context: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context} payload requires an ms-precision UTC timestamp`,
    });
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_REF, {
      message: `${field} requires a sha256 content digest`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Commands (idempotency key REQUIRED)
// ---------------------------------------------------------------------------

export interface StartInterviewCommandPayload {
  readonly sessionId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly selectionSeed: string;
  readonly demandProfileDigest?: string;
}

export function makeStartInterviewCommand(
  payload: StartInterviewCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<StartInterviewCommandPayload> {
  requireSessionId(payload.sessionId, 'start-interview');
  if (typeof payload.tenant !== 'string' || payload.tenant.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'start-interview payload requires a tenant',
    });
  }
  if (typeof payload.expertId !== 'string' || payload.expertId.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'start-interview payload requires an expertId',
    });
  }
  if (typeof payload.selectionSeed !== 'string' || payload.selectionSeed.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SEED, {
      message: 'start-interview payload requires a selectionSeed',
    });
  }
  if (payload.demandProfileDigest !== undefined) requireDigest(payload.demandProfileDigest, 'demandProfileDigest');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-intake/start-interview-command@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface SessionLifecycleCommandPayload {
  readonly sessionId: string;
  readonly at: string;
}

type LifecycleCommandName = 'submit-interview' | 'abandon-interview' | 'timeout-interview' | 'assess-interview';

function makeLifecycleCommand(
  name: LifecycleCommandName,
  payload: SessionLifecycleCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<SessionLifecycleCommandPayload> {
  requireSessionId(payload.sessionId, name);
  requireTimestamp(payload.at, name);
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-intake/${name}-command@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeSubmitInterviewCommand(
  payload: SessionLifecycleCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<SessionLifecycleCommandPayload> {
  return makeLifecycleCommand('submit-interview', payload, context);
}

export function makeAbandonInterviewCommand(
  payload: SessionLifecycleCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<SessionLifecycleCommandPayload> {
  return makeLifecycleCommand('abandon-interview', payload, context);
}

export function makeTimeoutInterviewCommand(
  payload: SessionLifecycleCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<SessionLifecycleCommandPayload> {
  return makeLifecycleCommand('timeout-interview', payload, context);
}

export function makeAssessInterviewCommand(
  payload: SessionLifecycleCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<SessionLifecycleCommandPayload> {
  return makeLifecycleCommand('assess-interview', payload, context);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface IntakeSubmittedEventPayload {
  readonly sessionId: string;
  readonly sessionDigest: string;
  readonly at: string;
}

export function makeIntakeSubmittedEvent(
  payload: IntakeSubmittedEventPayload,
  context: ExpertIntakeEnvelopeContext,
): Envelope<IntakeSubmittedEventPayload> {
  requireSessionId(payload.sessionId, 'intake-submitted');
  requireDigest(payload.sessionDigest, 'sessionDigest');
  requireTimestamp(payload.at, 'intake-submitted');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-intake/intake-submitted-event@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface IntakeAssessedEventPayload {
  readonly sessionId: string;
  readonly outcome: string;
  readonly at: string;
}

export function makeIntakeAssessedEvent(
  payload: IntakeAssessedEventPayload,
  context: ExpertIntakeEnvelopeContext,
): Envelope<IntakeAssessedEventPayload> {
  requireSessionId(payload.sessionId, 'intake-assessed');
  const outcomes = ['complete-with-claims', 'incomplete-with-gap-list', 'rejected-with-reasons'];
  if (!outcomes.includes(payload.outcome)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_OUTCOME, {
      message: `intake-assessed payload outcome must be one of ${outcomes.join(', ')}`,
    });
  }
  requireTimestamp(payload.at, 'intake-assessed');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-intake/intake-assessed-event@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface IntakeProfileProposedEventPayload {
  readonly sessionId: string;
  readonly profileDigest: string;
  readonly claimCandidateCount: number;
  readonly at: string;
}

export function makeIntakeProfileProposedEvent(
  payload: IntakeProfileProposedEventPayload,
  context: ExpertIntakeEnvelopeContext,
): Envelope<IntakeProfileProposedEventPayload> {
  requireSessionId(payload.sessionId, 'intake-profile-proposed');
  requireDigest(payload.profileDigest, 'profileDigest');
  if (typeof payload.claimCandidateCount !== 'number' || !Number.isInteger(payload.claimCandidateCount) || payload.claimCandidateCount < 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_PROFILE, {
      message: 'intake-profile-proposed payload requires a non-negative integer claimCandidateCount',
    });
  }
  requireTimestamp(payload.at, 'intake-profile-proposed');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-intake/intake-profile-proposed-event@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Queries (pure reads — no idempotency key)
// ---------------------------------------------------------------------------

export interface GetInterviewTranscriptQueryPayload {
  readonly sessionId: string;
  readonly tenant: string;
}

export function makeGetInterviewTranscriptQuery(
  payload: GetInterviewTranscriptQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetInterviewTranscriptQueryPayload> {
  requireSessionId(payload.sessionId, 'get-interview-transcript');
  if (typeof payload.tenant !== 'string' || payload.tenant.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: 'get-interview-transcript payload requires a tenant',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-intake/get-interview-transcript-query@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetInterviewTranscriptResponsePayload {
  readonly sessionId: string;
  readonly entries: number;
  readonly answered: number;
  readonly transcriptHead: string | null;
}

export function makeGetInterviewTranscriptResponse(
  payload: GetInterviewTranscriptResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetInterviewTranscriptResponsePayload> {
  requireSessionId(payload.sessionId, 'get-interview-transcript-response');
  if (payload.transcriptHead !== null) requireDigest(payload.transcriptHead, 'transcriptHead');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-intake/get-interview-transcript-response@${EXPERT_INTAKE_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export { toIntakeSessionId };
