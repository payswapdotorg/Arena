/**
 * Envelope wiring for the network-quality protocol (Work Order C020;
 * architecture-lock rules 17, 18, 22 — mirrors the sibling envelope
 * conventions).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (open-dispute,
 * transition-dispute, register-coi, retract-coi), QUERIES carry none
 * (check-coi, get-reputation-family are pure reads — the COI-check read
 * port and the dimensional reputation read are read ports, never
 * writes). Events carry the causal command's key when provided. Payload
 * schemas are versioned SchemaRefs in the `network-quality` namespace.
 *
 * THE NO-SINGLE-GLOBAL-SCORE LAW AT THE WIRE BOUNDARY: there is NO
 * command, query, event or response schema for a global/overall
 * reputation score — a schema name carrying 'global-score' or
 * 'overall-score' is rejected at construction, so a single-score
 * smuggling attempt has no wire shape to travel in.
 *
 * THE PROPOSAL LAW AT THE WIRE BOUNDARY: the only write-shaped payloads
 * are dispute/COI/enforcement state transitions and append-only record
 * creation; a payload carrying a silent-adjustment field (e.g. an
 * 'adjustedScore') is rejected (screenFieldNames discipline).
 */

import { makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import { isNetworkQualityContentDigest } from './shared.js';
import { isCoiKind, isDisputeState, isFindingKind } from './vocabulary.js';

export const NETWORK_QUALITY_SCHEMA_VERSION = '1.0.0' as const;

/** Registry of the schemas owned by @arena/network-quality. */
export const NETWORK_QUALITY_SCHEMAS = Object.freeze({
  'network-quality/open-dispute-command': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/transition-dispute-command': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/dispute-transitioned-event': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/register-coi-command': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/retract-coi-command': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/coi-check-query': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/coi-check-response': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/finding-recorded-event': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/enforcement-updated-event': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/get-reputation-family-query': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/get-reputation-family-response': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/profile-evidence-proposal-event': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/requalification-proposal-event': NETWORK_QUALITY_SCHEMA_VERSION,
  'network-quality/error': NETWORK_QUALITY_SCHEMA_VERSION,
} as const);

export type NetworkQualitySchemaName = keyof typeof NETWORK_QUALITY_SCHEMAS;

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORD_ID_PATTERN = /^nq-[a-z0-9][a-z0-9-]{0,62}$/;

function requireNonEmpty(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a non-empty ${field}`,
    });
  }
  return value;
}

function requireTimestamp(value: unknown, context: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context} payload requires an ms-precision UTC timestamp`,
    });
  }
  return value;
}

function requireDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isNetworkQualityContentDigest(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_REF, {
      message: `${field} requires a sha256 content digest`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function requireRecordId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !RECORD_ID_PATTERN.test(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context} payload requires a 'nq-<lowercase-kebab>' recordId`,
    });
  }
  return value;
}

/** Screen a requested schema name against the closed registry (no score-shaped schemas exist). */
function requireSchema(name: string): string {
  const forbidden = ['global-score', 'overall-score', 'expert-rating'];
  for (const stem of forbidden) {
    if (name.includes(stem)) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
        message: `network-quality schema '${name}' does not exist — no global/overall score wire shape exists (no-single-global-score law)`,
      });
    }
  }
  if (!(name in NETWORK_QUALITY_SCHEMAS)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_REF, {
      message: `network-quality schema '${name}' is not in the closed registry`,
      details: { known: Object.keys(NETWORK_QUALITY_SCHEMAS) },
    });
  }
  return name;
}

export interface NetworkQualityEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
}

// ---------------------------------------------------------------------------
// Commands (idempotency key REQUIRED — lock rule 17)
// ---------------------------------------------------------------------------

export interface OpenDisputeCommandPayload {
  readonly disputeId: string;
  readonly tenant: string;
  readonly complainantParty: string;
  readonly respondentParty: string;
  readonly summary: string;
  readonly at: string;
}

export function makeOpenDisputeCommand(
  payload: OpenDisputeCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<OpenDisputeCommandPayload> {
  requireRecordId(payload.disputeId, 'open-dispute');
  requireNonEmpty(payload.tenant, 'open-dispute', 'tenant');
  requireNonEmpty(payload.complainantParty, 'open-dispute', 'complainantParty');
  requireNonEmpty(payload.respondentParty, 'open-dispute', 'respondentParty');
  requireNonEmpty(payload.summary, 'open-dispute', 'summary');
  requireTimestamp(payload.at, 'open-dispute');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/network-quality/open-dispute-command@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface TransitionDisputeCommandPayload {
  readonly disputeId: string;
  readonly to: string;
  readonly reasons: readonly string[];
  readonly reviewerParty?: string | null;
  readonly resolutionOutcome?: string | null;
  readonly note?: string | null;
  readonly at: string;
}

export function makeTransitionDisputeCommand(
  payload: TransitionDisputeCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<TransitionDisputeCommandPayload> {
  requireRecordId(payload.disputeId, 'transition-dispute');
  if (!isDisputeState(payload.to)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `transition-dispute payload 'to' must be a closed dispute state, got: ${JSON.stringify(payload.to)}`,
    });
  }
  if (!Array.isArray(payload.reasons) || payload.reasons.length === 0) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: 'transition-dispute payload requires >= 1 machine-readable reason codes',
    });
  }
  requireTimestamp(payload.at, 'transition-dispute');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/network-quality/transition-dispute-command@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface RegisterCoiCommandPayload {
  readonly coiId: string;
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly kind: string;
  readonly origin: string;
  readonly scope?: string;
  readonly observedAt: string;
  readonly recordedAt: string;
}

export function makeRegisterCoiCommand(
  payload: RegisterCoiCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RegisterCoiCommandPayload> {
  requireRecordId(payload.coiId, 'register-coi');
  requireNonEmpty(payload.tenant, 'register-coi', 'tenant');
  requireNonEmpty(payload.party, 'register-coi', 'party');
  requireNonEmpty(payload.counterparty, 'register-coi', 'counterparty');
  if (!isCoiKind(payload.kind)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: `register-coi payload kind must be a closed COI kind, got: ${JSON.stringify(payload.kind)}`,
    });
  }
  if (payload.origin !== 'declared' && payload.origin !== 'derived') {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: `register-coi payload origin must be declared | derived, got: ${JSON.stringify(payload.origin)}`,
    });
  }
  requireTimestamp(payload.observedAt, 'register-coi');
  requireTimestamp(payload.recordedAt, 'register-coi');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/network-quality/register-coi-command@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export interface RetractCoiCommandPayload {
  readonly coiId: string;
  readonly at: string;
  readonly reason: string;
}

export function makeRetractCoiCommand(
  payload: RetractCoiCommandPayload,
  context: { correlationId: CorrelationId; idempotencyKey: IdempotencyKey },
): Envelope<RetractCoiCommandPayload> {
  requireRecordId(payload.coiId, 'retract-coi');
  requireTimestamp(payload.at, 'retract-coi');
  requireNonEmpty(payload.reason, 'retract-coi', 'reason');
  return makeEnvelope({
    kind: 'command',
    schema: `arena:schema/network-quality/retract-coi-command@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface DisputeTransitionedEventPayload {
  readonly disputeId: string;
  readonly tenant: string;
  readonly from: string;
  readonly to: string;
  readonly resolutionOutcome: string | null;
  readonly disputeDigest: string;
  readonly at: string;
}

export function makeDisputeTransitionedEvent(
  payload: DisputeTransitionedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<DisputeTransitionedEventPayload> {
  requireRecordId(payload.disputeId, 'dispute-transitioned');
  requireNonEmpty(payload.tenant, 'dispute-transitioned', 'tenant');
  if (!isDisputeState(payload.from) || !isDisputeState(payload.to)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: 'dispute-transitioned payload states must use the closed vocabulary',
    });
  }
  requireDigest(payload.disputeDigest, 'dispute-transitioned.disputeDigest');
  requireTimestamp(payload.at, 'dispute-transitioned');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/dispute-transitioned-event@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface CoiCheckVerdictEventPayload {
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly verdict: string;
  readonly reasonCount: number;
  readonly examined: number;
  readonly at: string;
}

export function makeCoiCheckVerdictEvent(
  payload: CoiCheckVerdictEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<CoiCheckVerdictEventPayload> {
  requireNonEmpty(payload.tenant, 'coi-check-verdict', 'tenant');
  requireNonEmpty(payload.party, 'coi-check-verdict', 'party');
  requireNonEmpty(payload.counterparty, 'coi-check-verdict', 'counterparty');
  if (
    !['clear', 'conflicted-with-reasons', 'unknown-insufficient-data'].includes(payload.verdict)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: 'coi-check-verdict payload verdict must be the closed COI-check vocabulary',
    });
  }
  requireTimestamp(payload.at, 'coi-check-verdict');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/coi-check-response@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface FindingRecordedEventPayload {
  readonly findingId: string;
  readonly tenant: string;
  readonly subjectParty: string;
  readonly kind: string;
  readonly severity: string;
  readonly proposalCount: number;
  readonly findingDigest: string;
  readonly at: string;
}

export function makeFindingRecordedEvent(
  payload: FindingRecordedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<FindingRecordedEventPayload> {
  requireRecordId(payload.findingId, 'finding-recorded');
  requireNonEmpty(payload.tenant, 'finding-recorded', 'tenant');
  requireNonEmpty(payload.subjectParty, 'finding-recorded', 'subjectParty');
  if (!isFindingKind(payload.kind)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: `finding-recorded payload kind must be a closed finding kind, got: ${JSON.stringify(payload.kind)}`,
    });
  }
  requireDigest(payload.findingDigest, 'finding-recorded.findingDigest');
  requireTimestamp(payload.at, 'finding-recorded');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/finding-recorded-event@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface EnforcementUpdatedEventPayload {
  readonly caseId: string;
  readonly tenant: string;
  readonly subjectParty: string;
  readonly state: string;
  readonly action: string | null;
  readonly caseDigest: string;
  readonly at: string;
}

export function makeEnforcementUpdatedEvent(
  payload: EnforcementUpdatedEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<EnforcementUpdatedEventPayload> {
  requireRecordId(payload.caseId, 'enforcement-updated');
  requireNonEmpty(payload.tenant, 'enforcement-updated', 'tenant');
  requireNonEmpty(payload.subjectParty, 'enforcement-updated', 'subjectParty');
  if (
    !['OPEN', 'ACTION_PROPOSED', 'ACTION_ACTIVE', 'ACTION_RELEASED', 'CLOSED'].includes(
      payload.state,
    )
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: 'enforcement-updated payload state must use the closed vocabulary',
    });
  }
  requireDigest(payload.caseDigest, 'enforcement-updated.caseDigest');
  requireTimestamp(payload.at, 'enforcement-updated');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/enforcement-updated-event@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface ProfileEvidenceProposalEventPayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly targetFamily: string;
  readonly targetDimension: string;
  readonly refDigest: string;
  readonly at: string;
}

export function makeProfileEvidenceProposalEvent(
  payload: ProfileEvidenceProposalEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<ProfileEvidenceProposalEventPayload> {
  requireNonEmpty(payload.tenant, 'profile-evidence-proposal', 'tenant');
  requireNonEmpty(payload.expertId, 'profile-evidence-proposal', 'expertId');
  requireNonEmpty(payload.targetFamily, 'profile-evidence-proposal', 'targetFamily');
  requireNonEmpty(payload.targetDimension, 'profile-evidence-proposal', 'targetDimension');
  requireDigest(payload.refDigest, 'profile-evidence-proposal.refDigest');
  requireTimestamp(payload.at, 'profile-evidence-proposal');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/profile-evidence-proposal-event@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export interface RequalificationProposalEventPayload {
  readonly tenant: string;
  readonly expertRef: string;
  readonly trigger: string;
  readonly evidenceCount: number;
  readonly at: string;
}

export function makeRequalificationProposalEvent(
  payload: RequalificationProposalEventPayload,
  context: { correlationId: CorrelationId; idempotencyKey?: IdempotencyKey | null },
): Envelope<RequalificationProposalEventPayload> {
  requireNonEmpty(payload.tenant, 'requalification-proposal', 'tenant');
  requireNonEmpty(payload.expertRef, 'requalification-proposal', 'expertRef');
  if (
    !['anti-gaming-finding', 'fraud-finding', 'dispute-outcome', 'validation-outcome-trend'].includes(
      payload.trigger,
    )
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: 'requalification-proposal payload trigger must use the closed vocabulary',
    });
  }
  requireTimestamp(payload.at, 'requalification-proposal');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/requalification-proposal-event@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Queries + responses (pure reads — the COI read port + reputation reads)
// ---------------------------------------------------------------------------

export interface CoiCheckQueryPayload {
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly at: string;
}

export function makeCoiCheckQuery(
  payload: CoiCheckQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<CoiCheckQueryPayload> {
  requireNonEmpty(payload.tenant, 'coi-check', 'tenant');
  requireNonEmpty(payload.party, 'coi-check', 'party');
  requireNonEmpty(payload.counterparty, 'coi-check', 'counterparty');
  requireTimestamp(payload.at, 'coi-check');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/network-quality/coi-check-query@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface CoiCheckResponsePayload {
  readonly tenant: string;
  readonly party: string;
  readonly counterparty: string;
  readonly verdict: string;
  readonly reasonCount: number;
  readonly examined: number;
}

export function makeCoiCheckResponse(
  payload: CoiCheckResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<CoiCheckResponsePayload> {
  requireNonEmpty(payload.tenant, 'coi-check-response', 'tenant');
  requireNonEmpty(payload.party, 'coi-check-response', 'party');
  requireNonEmpty(payload.counterparty, 'coi-check-response', 'counterparty');
  if (
    !['clear', 'conflicted-with-reasons', 'unknown-insufficient-data'].includes(payload.verdict)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_COI, {
      message: 'coi-check-response payload verdict must use the closed vocabulary',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/network-quality/coi-check-response@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetReputationFamilyQueryPayload {
  readonly tenant: string;
  readonly expertId: string;
  /** EXACTLY ONE reputation family — cross-family queries are rejected. */
  readonly family: string;
  readonly at: string;
}

export function makeGetReputationFamilyQuery(
  payload: GetReputationFamilyQueryPayload,
  context: { correlationId: CorrelationId },
): Envelope<GetReputationFamilyQueryPayload> {
  requireNonEmpty(payload.tenant, 'get-reputation-family', 'tenant');
  requireNonEmpty(payload.expertId, 'get-reputation-family', 'expertId');
  requireSchema('network-quality/get-reputation-family-query');
  if (
    ![
      'dispute-outcome',
      'competition-agreement',
      'validation-outcome',
      'coi-record',
      'conduct-flag',
    ].includes(payload.family)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_FAMILY, {
      message: `get-reputation-family payload family must be ONE closed reputation family — a cross-family/global query has no wire shape`,
    });
  }
  requireTimestamp(payload.at, 'get-reputation-family');
  return makeEnvelope({
    kind: 'query',
    schema: `arena:schema/network-quality/get-reputation-family-query@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export interface GetReputationFamilyResponsePayload {
  readonly tenant: string;
  readonly expertId: string;
  readonly family: string;
  readonly recordCount: number;
  readonly totalSampleSize: number;
  readonly aggregateDigest: string;
}

export function makeGetReputationFamilyResponse(
  payload: GetReputationFamilyResponsePayload,
  context: { correlationId: CorrelationId },
): Envelope<GetReputationFamilyResponsePayload> {
  requireNonEmpty(payload.tenant, 'get-reputation-family-response', 'tenant');
  requireNonEmpty(payload.expertId, 'get-reputation-family-response', 'expertId');
  if (
    ![
      'dispute-outcome',
      'competition-agreement',
      'validation-outcome',
      'coi-record',
      'conduct-flag',
    ].includes(payload.family)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_FAMILY, {
      message: 'get-reputation-family-response payload family must be ONE closed family',
    });
  }
  requireDigest(payload.aggregateDigest, 'get-reputation-family-response.aggregateDigest');
  return makeEnvelope({
    kind: 'response',
    schema: `arena:schema/network-quality/get-reputation-family-response@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export interface NetworkQualityErrorPayload {
  readonly code: string;
  readonly category: string;
  readonly message: string;
}

export function makeNetworkQualityError(
  payload: NetworkQualityErrorPayload,
  context: { correlationId: CorrelationId },
): Envelope<NetworkQualityErrorPayload> {
  requireNonEmpty(payload.code, 'network-quality-error', 'code');
  requireNonEmpty(payload.category, 'network-quality-error', 'category');
  requireNonEmpty(payload.message, 'network-quality-error', 'message');
  return makeEnvelope({
    kind: 'event',
    schema: `arena:schema/network-quality/error@${NETWORK_QUALITY_SCHEMA_VERSION}`,
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}
