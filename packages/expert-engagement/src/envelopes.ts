/**
 * Envelope wiring for the expert-engagement protocol (Work Order C011;
 * architecture-lock rules 17, 18, 22 — mirrors the sibling envelope
 * conventions).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (issue-offer /
 * accept / decline / expire / activate / complete / withdraw / replace /
 * declare-availability — the write commands), QUERIES carry none
 * (get-availability / get-sla-evaluation / get-engagement are pure
 * reads). Events carry the causal command's key when provided. Payload
 * schemas are versioned SchemaRefs in the `expert-engagement` namespace.
 */

import { makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';
import { isEngagementContentDigest, isEngagementId, isEngagementTenant, isEngagementTimestamp, isSlaUrgencyClass } from './shared.js';

export const EXPERT_ENGAGEMENT_SCHEMA_VERSION = '1.0.0' as const;

/** Registry of the schemas owned by @arena/expert-engagement. */
export const EXPERT_ENGAGEMENT_SCHEMAS = Object.freeze({
  'expert-engagement/issue-offer-command': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/offer-issued-event': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/engagement-transition-command': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/engagement-transitioned-event': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/declare-availability-command': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/availability-declared-event': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-availability-query': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-availability-response': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-sla-evaluation-query': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-sla-evaluation-response': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-engagement-query': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/get-engagement-response': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
  'expert-engagement/error': EXPERT_ENGAGEMENT_SCHEMA_VERSION,
} as const);

export type ExpertEngagementSchemaName = keyof typeof EXPERT_ENGAGEMENT_SCHEMAS;

function requireNonEmpty(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a non-empty ${field}`,
    });
  }
  return value;
}

function requireTimestamp(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || !isEngagementTimestamp(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context} payload ${field} requires an ms-precision UTC timestamp`,
    });
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isEngagementContentDigest(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_REF, {
      message: `${field} requires a sha256 content digest`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function requireEngagementId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !isEngagementId(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires an 'eng-<lowercase-kebab>' engagementId`,
    });
  }
  return value;
}

function requireTenant(value: unknown, context: string): string {
  if (typeof value !== 'string' || !isEngagementTenant(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a tenant scope`,
    });
  }
  return value;
}

export interface ExpertEngagementEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
}

// ---------------------------------------------------------------------------
// Commands (idempotency key REQUIRED — lock rule 17)
// ---------------------------------------------------------------------------

export interface IssueOfferCommandPayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly escalationRef: string;
  readonly expertId: string;
  readonly commercialOfferRef: string;
  readonly budgetHoldRef: string;
  readonly routingVerdictRef: string;
  readonly availabilityRef: string;
  readonly urgency: string;
  readonly requestDeadline: string;
  readonly offerExpiresAt: string;
  readonly at: string;
}

export function makeIssueOfferCommand(
  payload: IssueOfferCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<IssueOfferCommandPayload> {
  requireEngagementId(payload.engagementId, 'issue-offer');
  requireTenant(payload.tenant, 'issue-offer');
  requireNonEmpty(payload.escalationRef, 'issue-offer', 'escalationRef');
  requireNonEmpty(payload.expertId, 'issue-offer', 'expertId');
  requireDigest(payload.commercialOfferRef, 'issue-offer.commercialOfferRef');
  requireDigest(payload.budgetHoldRef, 'issue-offer.budgetHoldRef');
  requireDigest(payload.routingVerdictRef, 'issue-offer.routingVerdictRef');
  requireDigest(payload.availabilityRef, 'issue-offer.availabilityRef');
  if (!isSlaUrgencyClass(payload.urgency)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_POLICY, {
      message: 'issue-offer payload urgency must be a closed urgency class (mirrors C001)',
    });
  }
  requireTimestamp(payload.requestDeadline, 'issue-offer', 'requestDeadline');
  requireTimestamp(payload.offerExpiresAt, 'issue-offer', 'offerExpiresAt');
  requireTimestamp(payload.at, 'issue-offer', 'at');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-engagement/issue-offer-command@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface EngagementTransitionCommandPayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly transition: string;
  readonly successorEngagementId?: string;
  readonly at: string;
}

export function makeEngagementTransitionCommand(
  payload: EngagementTransitionCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<EngagementTransitionCommandPayload> {
  requireEngagementId(payload.engagementId, 'engagement-transition');
  requireTenant(payload.tenant, 'engagement-transition');
  const transitions = [
    'accept',
    'decline',
    'expire',
    'activate',
    'complete',
    'withdraw',
    'replace',
  ];
  if (typeof payload.transition !== 'string' || !transitions.includes(payload.transition)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION, {
      message: `engagement-transition payload transition must be one of ${transitions.join('|')}`,
    });
  }
  if (
    payload.successorEngagementId !== undefined &&
    !isEngagementId(payload.successorEngagementId)
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: 'engagement-transition payload successorEngagementId requires an eng- id',
    });
  }
  requireTimestamp(payload.at, 'engagement-transition', 'at');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-engagement/engagement-transition-command@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface DeclareAvailabilityCommandPayload {
  readonly declarationId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly version: number;
  readonly at: string;
}

export function makeDeclareAvailabilityCommand(
  payload: DeclareAvailabilityCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<DeclareAvailabilityCommandPayload> {
  requireNonEmpty(payload.declarationId, 'declare-availability', 'declarationId');
  requireTenant(payload.tenant, 'declare-availability');
  requireNonEmpty(payload.expertId, 'declare-availability', 'expertId');
  if (
    typeof payload.version !== 'number' ||
    !Number.isInteger(payload.version) ||
    payload.version < 1
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'declare-availability payload version must be a positive integer',
    });
  }
  requireTimestamp(payload.at, 'declare-availability', 'at');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/expert-engagement/declare-availability-command@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Events (carry the causal command's key when provided)
// ---------------------------------------------------------------------------

export interface OfferIssuedEventPayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly engagementDigest: string;
  readonly at: string;
}

export function makeOfferIssuedEvent(
  payload: OfferIssuedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<OfferIssuedEventPayload> {
  requireEngagementId(payload.engagementId, 'offer-issued');
  requireTenant(payload.tenant, 'offer-issued');
  requireNonEmpty(payload.expertId, 'offer-issued', 'expertId');
  requireDigest(payload.engagementDigest, 'offer-issued.engagementDigest');
  requireTimestamp(payload.at, 'offer-issued', 'at');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-engagement/offer-issued-event@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface EngagementTransitionedEventPayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly transition: string;
  readonly from: string;
  readonly to: string;
  readonly engagementDigest: string;
  readonly at: string;
}

export function makeEngagementTransitionedEvent(
  payload: EngagementTransitionedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<EngagementTransitionedEventPayload> {
  requireEngagementId(payload.engagementId, 'engagement-transitioned');
  requireTenant(payload.tenant, 'engagement-transitioned');
  requireNonEmpty(payload.transition, 'engagement-transitioned', 'transition');
  requireNonEmpty(payload.from, 'engagement-transitioned', 'from');
  requireNonEmpty(payload.to, 'engagement-transitioned', 'to');
  requireDigest(payload.engagementDigest, 'engagement-transitioned.engagementDigest');
  requireTimestamp(payload.at, 'engagement-transitioned', 'at');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-engagement/engagement-transitioned-event@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface AvailabilityDeclaredEventPayload {
  readonly declarationId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly version: number;
  readonly declarationDigest: string;
  readonly at: string;
}

export function makeAvailabilityDeclaredEvent(
  payload: AvailabilityDeclaredEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<AvailabilityDeclaredEventPayload> {
  requireNonEmpty(payload.declarationId, 'availability-declared', 'declarationId');
  requireTenant(payload.tenant, 'availability-declared');
  requireNonEmpty(payload.expertId, 'availability-declared', 'expertId');
  if (
    typeof payload.version !== 'number' ||
    !Number.isInteger(payload.version) ||
    payload.version < 1
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'availability-declared payload version must be a positive integer',
    });
  }
  requireDigest(payload.declarationDigest, 'availability-declared.declarationDigest');
  requireTimestamp(payload.at, 'availability-declared', 'at');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/expert-engagement/availability-declared-event@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Queries + responses (pure reads)
// ---------------------------------------------------------------------------

export interface GetAvailabilityQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly at: string;
}

export function makeGetAvailabilityQuery(
  payload: GetAvailabilityQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetAvailabilityQueryPayload> {
  requireTenant(payload.tenant, 'get-availability');
  requireNonEmpty(payload.expertId, 'get-availability', 'expertId');
  requireTimestamp(payload.at, 'get-availability', 'at');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-engagement/get-availability-query@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetAvailabilityResponsePayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: string;
  readonly declarationDigest: string | null;
  readonly declarationVersion: number | null;
  readonly availableWindowCount: number;
  readonly fullyCommittedWindows: number;
}

export function makeGetAvailabilityResponse(
  payload: GetAvailabilityResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetAvailabilityResponsePayload> {
  requireTenant(payload.tenant, 'get-availability-response');
  requireNonEmpty(payload.expertId, 'get-availability-response', 'expertId');
  requireTimestamp(payload.asOf, 'get-availability-response', 'asOf');
  if (
    payload.declarationDigest !== null &&
    !isEngagementContentDigest(payload.declarationDigest)
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_REF, {
      message: 'get-availability-response declarationDigest must be a digest or null',
    });
  }
  if (
    typeof payload.availableWindowCount !== 'number' ||
    !Number.isInteger(payload.availableWindowCount) ||
    payload.availableWindowCount < 0
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'get-availability-response availableWindowCount must be a non-negative integer',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-engagement/get-availability-response@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetSlaEvaluationQueryPayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly at: string;
}

export function makeGetSlaEvaluationQuery(
  payload: GetSlaEvaluationQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetSlaEvaluationQueryPayload> {
  requireEngagementId(payload.engagementId, 'get-sla-evaluation');
  requireTenant(payload.tenant, 'get-sla-evaluation');
  requireTimestamp(payload.at, 'get-sla-evaluation', 'at');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-engagement/get-sla-evaluation-query@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetSlaEvaluationResponsePayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly at: string;
  readonly acceptClockState: string;
  readonly startClockState: string;
  readonly submitClockState: string;
  readonly totalBreaches: number;
}

export function makeGetSlaEvaluationResponse(
  payload: GetSlaEvaluationResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetSlaEvaluationResponsePayload> {
  requireEngagementId(payload.engagementId, 'get-sla-evaluation-response');
  requireTenant(payload.tenant, 'get-sla-evaluation-response');
  requireTimestamp(payload.at, 'get-sla-evaluation-response', 'at');
  for (const field of ['acceptClockState', 'startClockState', 'submitClockState'] as const) {
    if (!['satisfied', 'on-track', 'at-risk', 'breached'].includes(payload[field])) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
        message: `get-sla-evaluation-response ${field} must be a closed SLA clock state`,
      });
    }
  }
  if (
    typeof payload.totalBreaches !== 'number' ||
    !Number.isInteger(payload.totalBreaches) ||
    payload.totalBreaches < 0
  ) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'get-sla-evaluation-response totalBreaches must be a non-negative integer',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-engagement/get-sla-evaluation-response@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetEngagementQueryPayload {
  readonly engagementId: string;
  readonly tenant: string;
}

export function makeGetEngagementQuery(
  payload: GetEngagementQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetEngagementQueryPayload> {
  requireEngagementId(payload.engagementId, 'get-engagement');
  requireTenant(payload.tenant, 'get-engagement');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/expert-engagement/get-engagement-query@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetEngagementResponsePayload {
  readonly engagementId: string;
  readonly tenant: string;
  readonly status: string;
  readonly engagementDigest: string;
}

export function makeGetEngagementResponse(
  payload: GetEngagementResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetEngagementResponsePayload> {
  requireEngagementId(payload.engagementId, 'get-engagement-response');
  requireTenant(payload.tenant, 'get-engagement-response');
  requireNonEmpty(payload.status, 'get-engagement-response', 'status');
  requireDigest(payload.engagementDigest, 'get-engagement-response.engagementDigest');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/expert-engagement/get-engagement-response@${EXPERT_ENGAGEMENT_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}
