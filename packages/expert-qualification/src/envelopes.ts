/**
 * Envelope wiring for the expert-qualification protocol (Work Order A007;
 * architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (qualify-claim /
 * record-qualification-expiry), QUERIES carry none (match-experts is a
 * pure query, not a mutation — lock rule 17's command discipline applies
 * to state-changing intents), events carry the causal command's key when
 * provided. All messages carry a correlation id; payloads are
 * canonical-JSON serializable and digest-verifiable; unknown envelope
 * versions are rejected by the core parser.
 *
 * Payload schemas are versioned SchemaRefs in the `expert-qualification`
 * namespace (arena:schema/expert-qualification/<name>@<major.minor.patch>)
 * and mirrored by the generated contracts in
 * contracts/expert-qualification/ (see
 * packages/expert-qualification/scripts/generate-contracts.mjs; parity is
 * asserted by contracts.parity.test.ts).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import { isQualificationRecord } from './qualification.js';
import type { QualificationRecord } from './qualification.js';
import { isMatchResult } from './match-result.js';
import type { MatchResult } from './match-result.js';
import { isMatchRequest } from './match-request.js';
import type { MatchRequest } from './match-request.js';
import { isMatchingPolicy } from './matching-policy.js';
import type { MatchingPolicy } from './matching-policy.js';

export const EXPERT_QUALIFICATION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/expert-qualification. Mirrored
 * by the generated contract expert-qualification/schema-registry.v1.json
 * (parity asserted in contracts.parity.test.ts).
 */
export const EXPERT_QUALIFICATION_SCHEMAS = Object.freeze({
  'expert-qualification/qualification-evidence': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/competency-claim': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/qualification-policy': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/qualification-record': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/qualified-expert': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/match-request': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/matching-policy': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/match-result': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/error': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/qualify-claim-command': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/record-qualification-expiry-command': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/qualification-recorded-event': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/match-experts-query': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/match-completed-response': EXPERT_QUALIFICATION_SCHEMA_VERSION,
  'expert-qualification/schema-registry': EXPERT_QUALIFICATION_SCHEMA_VERSION,
} as const);

export type ExpertQualificationSchemaName = keyof typeof EXPERT_QUALIFICATION_SCHEMAS;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** Resolve an expert-qualification schema name to its SchemaRef. */
export function expertQualificationSchemaRef(name: ExpertQualificationSchemaName): SchemaRef {
  const version = EXPERT_QUALIFICATION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown expert-qualification protocol schema: ${String(name)}`,
      details: { known: Object.keys(EXPERT_QUALIFICATION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an expert-qualification schema at the registered version. */
export function isKnownExpertQualificationSchema(ref: SchemaRef): boolean {
  const registered = (EXPERT_QUALIFICATION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Wire payloads
// ---------------------------------------------------------------------------

/** Command payload: evaluate one claim under one policy at one time. */
export interface QualifyClaimCommandPayload {
  /** The digest of the competency claim to evaluate. */
  readonly claimRef: string;
  /** The digest of the qualification policy to apply. */
  readonly policyRef: string;
  /** The fixed evaluation time (determinism anchor). */
  readonly evaluatedAt: string;
  /** True to renew, superseding the latest record of the claim. */
  readonly renew: boolean;
}

/** Command payload: append the decay record for a lapsed qualification. */
export interface RecordQualificationExpiryCommandPayload {
  /** The digest of the competency claim whose qualification decayed. */
  readonly claimRef: string;
  /** The fixed evaluation time (the decay observation time). */
  readonly evaluatedAt: string;
}

/** Event payload: a qualification record was appended (any status). */
export interface QualificationRecordedEventPayload {
  readonly record: QualificationRecord;
}

/** Query payload: match a request under a matching policy. */
export interface MatchExpertsQueryPayload {
  readonly request: MatchRequest;
  readonly policy: MatchingPolicy;
}

/** Response payload: the authoritative match result. */
export interface MatchCompletedResponsePayload {
  readonly result: MatchResult;
}

export interface ExpertQualificationEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: ExpertQualificationEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

// ---------------------------------------------------------------------------
// Command / event / query / response constructors
// ---------------------------------------------------------------------------

export function makeQualifyClaimCommand(
  payload: QualifyClaimCommandPayload,
  context: ExpertQualificationEnvelopeContext,
): Envelope<QualifyClaimCommandPayload> {
  if (typeof payload.claimRef !== 'string' || !DIGEST_PATTERN.test(payload.claimRef)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: "qualify-claim command payload requires a valid content digest in 'claimRef'",
      details: { field: 'claimRef', pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (typeof payload.policyRef !== 'string' || !DIGEST_PATTERN.test(payload.policyRef)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: "qualify-claim command payload requires a valid content digest in 'policyRef'",
      details: { field: 'policyRef', pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (typeof payload.evaluatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.evaluatedAt)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'qualify-claim command payload requires an ms-precision UTC evaluatedAt',
    });
  }
  if (typeof payload.renew !== 'boolean') {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: "qualify-claim command payload requires a boolean 'renew'",
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: expertQualificationSchemaRef('expert-qualification/qualify-claim-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeRecordQualificationExpiryCommand(
  payload: RecordQualificationExpiryCommandPayload,
  context: ExpertQualificationEnvelopeContext,
): Envelope<RecordQualificationExpiryCommandPayload> {
  if (typeof payload.claimRef !== 'string' || !DIGEST_PATTERN.test(payload.claimRef)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: "record-qualification-expiry command payload requires a valid content digest in 'claimRef'",
      details: { field: 'claimRef', pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (typeof payload.evaluatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.evaluatedAt)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'record-qualification-expiry command payload requires an ms-precision UTC evaluatedAt',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: expertQualificationSchemaRef(
      'expert-qualification/record-qualification-expiry-command',
    ),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeQualificationRecordedEvent(
  payload: QualificationRecordedEventPayload,
  context: ExpertQualificationEnvelopeContext,
): Envelope<QualificationRecordedEventPayload> {
  if (!isQualificationRecord(payload.record)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'qualification-recorded event payload requires a structurally valid qualification record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: expertQualificationSchemaRef('expert-qualification/qualification-recorded-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeMatchExpertsQuery(
  payload: MatchExpertsQueryPayload,
  context: ExpertQualificationEnvelopeContext,
): Envelope<MatchExpertsQueryPayload> {
  if (!isMatchRequest(payload.request)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'match-experts query payload requires a structurally valid match request',
    });
  }
  if (!isMatchingPolicy(payload.policy)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY, {
      message: 'match-experts query payload requires a structurally valid matching policy',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: expertQualificationSchemaRef('expert-qualification/match-experts-query'),
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export function makeMatchCompletedResponse(
  payload: MatchCompletedResponsePayload,
  context: ExpertQualificationEnvelopeContext,
): Envelope<MatchCompletedResponsePayload> {
  if (!isMatchResult(payload.result)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: 'match-completed response payload requires a structurally valid match result',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: expertQualificationSchemaRef('expert-qualification/match-completed-response'),
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an
 * expert-qualification schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseExpertQualificationEnvelope<T>(
  raw: string,
  expectedSchema?: ExpertQualificationSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? expertQualificationSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a protocol envelope. */
export async function expertQualificationEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as an expert-qualification envelope and assert that its
 * canonical digest equals `expectedDigest` — the tamper tripwire for
 * wire messages. Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function checkExpertQualificationEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `expert-qualification envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
