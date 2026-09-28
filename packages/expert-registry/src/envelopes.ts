/**
 * Envelope wiring for the expert-registry protocol (Work Order A006 gate 9;
 * architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and
 * digest-verifiable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Commands describe INTENT (the inputs of a transition, addressed by the
 * current state's digest — the orchestrating service applies the pure
 * transition functions and emits the matching event). Events carry the
 * RESULTING profile state plus the lifecycle event, so downstream
 * consumers never need to re-derive state.
 *
 * Payload schemas are versioned as SchemaRefs in the `expert` namespace
 * (arena:schema/expert/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/expert/ (see
 * packages/expert-registry/scripts/generate-contracts.mjs; parity is
 * asserted by contracts.parity.test.ts).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import type { ExpertProfile } from './profile.js';
import { isExpertProfile } from './profile.js';
import type { ExpertLifecycleEvent } from './lifecycle.js';
import type { PrincipalRefLike } from './shared.js';
import { isPrincipalRefView } from './shared.js';
import type { ExpertVersionRefLike } from './identity.js';
import { isExpertVersionRef } from './identity.js';
import type { TaskRecordRefLike } from './task-history.js';
import { isTaskRecordRefView, toTaskRecordRefView } from './task-history.js';
import type { EvidenceRefLike } from './shared.js';
import { isEvidenceRef } from './shared.js';
import type { ExpertDomainPack } from './domain-pack.js';
import { isExpertDomainPack } from './domain-pack.js';

export const EXPERT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/expert-registry. Mirrored by the
 * generated contract expert/schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const EXPERT_SCHEMAS = {
  'expert/expert-ref': EXPERT_SCHEMA_VERSION,
  'expert/evidence-ref': EXPERT_SCHEMA_VERSION,
  'expert/principal': EXPERT_SCHEMA_VERSION,
  'expert/identity-ref': EXPERT_SCHEMA_VERSION,
  'expert/credential-ref': EXPERT_SCHEMA_VERSION,
  'expert/competency': EXPERT_SCHEMA_VERSION,
  'expert/qualification': EXPERT_SCHEMA_VERSION,
  'expert/jurisdiction': EXPERT_SCHEMA_VERSION,
  'expert/limitation': EXPERT_SCHEMA_VERSION,
  'expert/domain-scope': EXPERT_SCHEMA_VERSION,
  'expert/task-record-ref': EXPERT_SCHEMA_VERSION,
  'expert/reliability-entry': EXPERT_SCHEMA_VERSION,
  'expert/reliability-metrics': EXPERT_SCHEMA_VERSION,
  'expert/availability': EXPERT_SCHEMA_VERSION,
  'expert/privacy-policy': EXPERT_SCHEMA_VERSION,
  'expert/domain-pack': EXPERT_SCHEMA_VERSION,
  'expert/public-view': EXPERT_SCHEMA_VERSION,
  'expert/profile': EXPERT_SCHEMA_VERSION,
  'expert/lifecycle-event': EXPERT_SCHEMA_VERSION,
  'expert/registration-record': EXPERT_SCHEMA_VERSION,
  'expert/error': EXPERT_SCHEMA_VERSION,
  'expert/register-expert-command': EXPERT_SCHEMA_VERSION,
  'expert/publish-profile-command': EXPERT_SCHEMA_VERSION,
  'expert/suspend-profile-command': EXPERT_SCHEMA_VERSION,
  'expert/reinstate-profile-command': EXPERT_SCHEMA_VERSION,
  'expert/retire-profile-command': EXPERT_SCHEMA_VERSION,
  'expert/supersede-profile-command': EXPERT_SCHEMA_VERSION,
  'expert/attach-evidence-command': EXPERT_SCHEMA_VERSION,
  'expert/record-task-command': EXPERT_SCHEMA_VERSION,
  'expert/record-reliability-command': EXPERT_SCHEMA_VERSION,
  'expert/expert-registered-event': EXPERT_SCHEMA_VERSION,
  'expert/profile-published-event': EXPERT_SCHEMA_VERSION,
  'expert/profile-suspended-event': EXPERT_SCHEMA_VERSION,
  'expert/profile-reinstated-event': EXPERT_SCHEMA_VERSION,
  'expert/profile-retired-event': EXPERT_SCHEMA_VERSION,
  'expert/profile-superseded-event': EXPERT_SCHEMA_VERSION,
  'expert/evidence-attached-event': EXPERT_SCHEMA_VERSION,
  'expert/task-recorded-event': EXPERT_SCHEMA_VERSION,
  'expert/reliability-recorded-event': EXPERT_SCHEMA_VERSION,
  'expert/domain-pack-published-event': EXPERT_SCHEMA_VERSION,
  'expert/schema-registry': EXPERT_SCHEMA_VERSION,
} as const;

export type ExpertSchemaName = keyof typeof EXPERT_SCHEMAS;

/** Resolve an expert schema name to its SchemaRef. */
export function expertSchemaRef(name: ExpertSchemaName): SchemaRef {
  const version = EXPERT_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown expert-registry protocol schema: ${String(name)}`,
      details: { known: Object.keys(EXPERT_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an expert schema at the registered version. */
export function isKnownExpertSchema(ref: SchemaRef): boolean {
  const registered = (EXPERT_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Register a fresh expert profile (the resulting registry admission). */
export interface RegisterExpertCommandPayload {
  readonly profile: ExpertProfile;
  readonly registrar: PrincipalRefLike;
}

/**
 * Apply a lifecycle transition to the profile state addressed by
 * `currentStateDigest` (the service resolves the state, applies the pure
 * transition function and emits the matching event).
 */
export interface TransitionCommandPayload {
  readonly currentStateDigest: string;
  readonly at: string;
  readonly actor: PrincipalRefLike;
  readonly note?: string;
}

/** Retire a profile: carries the REQUIRED rationale note. */
export interface RetireProfileCommandPayload extends TransitionCommandPayload {
  readonly note: string;
}

/** Supersede a profile version: carries the superseding version ref. */
export interface SupersedeProfileCommandPayload extends TransitionCommandPayload {
  readonly superseding: ExpertVersionRefLike;
}

/** Attach evidence: carries the evidence refs to append (>= 1). */
export interface AttachEvidenceCommandPayload extends TransitionCommandPayload {
  readonly evidence: readonly EvidenceRefLike[];
}

/** Record task history: carries the task record refs to append (>= 1). */
export interface RecordTaskCommandPayload extends TransitionCommandPayload {
  readonly records: readonly TaskRecordRefLike[];
}

/** Record a reliability outcome: carries the outcome entry (sequence-less). */
export interface RecordReliabilityCommandPayload extends TransitionCommandPayload {
  readonly entry: {
    kind: string;
    occurredAt: string;
    recordedBy: PrincipalRefLike;
    taskRecord?: TaskRecordRefLike;
    note?: string;
    evidence?: readonly EvidenceRefLike[];
  };
}

/** A profile state changed: carries the resulting state + the lifecycle event. */
export interface ProfileTransitionedEventPayload {
  readonly profile: ExpertProfile;
  readonly event: ExpertLifecycleEvent;
}

/** A domain pack was published: carries the content-addressed pack. */
export interface DomainPackPublishedEventPayload {
  readonly pack: ExpertDomainPack;
  readonly publishedBy: PrincipalRefLike;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface ExpertEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireIdempotencyKey(context: ExpertEnvelopeContext): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message:
        'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

function requirePrincipal(principal: unknown, what: string): asserts principal is PrincipalRefLike {
  if (!isPrincipalRefView(principal)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${what} requires a valid principal`,
    });
  }
}

function requireDigest(digest: unknown, what: string): string {
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DIGEST, {
      message: `${what} requires a valid sha256 state digest`,
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return digest;
}

export function makeRegisterExpertCommand(
  payload: RegisterExpertCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<RegisterExpertCommandPayload> {
  if (!isExpertProfile(payload.profile)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: 'register-expert command payload requires a structurally valid profile',
    });
  }
  requirePrincipal(payload.registrar, 'register-expert command payload');
  return makeEnvelope({
    kind: 'command',
    schema: expertSchemaRef('expert/register-expert-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

function makeTransitionCommand<T extends TransitionCommandPayload>(
  schemaName: ExpertSchemaName,
  payload: T,
  context: ExpertEnvelopeContext,
): Envelope<T> {
  requireDigest(payload.currentStateDigest, 'transition command payload');
  requirePrincipal(payload.actor, 'transition command payload');
  if (payload.note !== undefined && payload.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: 'transition command notes, when present, must be non-empty',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: expertSchemaRef(schemaName),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makePublishProfileCommand(
  payload: TransitionCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  return makeTransitionCommand('expert/publish-profile-command', payload, context);
}

export function makeSuspendProfileCommand(
  payload: TransitionCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  return makeTransitionCommand('expert/suspend-profile-command', payload, context);
}

export function makeReinstateProfileCommand(
  payload: TransitionCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  return makeTransitionCommand('expert/reinstate-profile-command', payload, context);
}

export function makeRetireProfileCommand(
  payload: RetireProfileCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<RetireProfileCommandPayload> {
  if (typeof payload.note !== 'string' || payload.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TRANSITION, {
      message: 'retire command requires a non-empty rationale note',
    });
  }
  return makeTransitionCommand('expert/retire-profile-command', payload, context);
}

export function makeSupersedeProfileCommand(
  payload: SupersedeProfileCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<SupersedeProfileCommandPayload> {
  if (!isExpertVersionRef(payload.superseding)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_SUPERSESSION, {
      message: 'supersede command requires a valid superseding profile version ref',
    });
  }
  return makeTransitionCommand('expert/supersede-profile-command', payload, context);
}

export function makeAttachEvidenceCommand(
  payload: AttachEvidenceCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<AttachEvidenceCommandPayload> {
  if (
    !Array.isArray(payload.evidence) ||
    payload.evidence.length === 0 ||
    !payload.evidence.every((ref) => isEvidenceRef(ref))
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'attach-evidence command requires at least one valid evidence ref',
    });
  }
  return makeTransitionCommand('expert/attach-evidence-command', payload, context);
}

export function makeRecordTaskCommand(
  payload: RecordTaskCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<RecordTaskCommandPayload> {
  if (!Array.isArray(payload.records) || payload.records.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: 'record-task command requires at least one valid task record ref',
    });
  }
  // Records may arrive in the validated (refVersion-carrying) view form OR
  // the plain structural form (TaskRecordRefLike); normalize through the
  // strict validator and reject anything invalid.
  try {
    for (const record of payload.records) {
      if (!isTaskRecordRefView(record)) toTaskRecordRefView(record);
    }
  } catch {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: 'record-task command requires at least one valid task record ref',
    });
  }
  return makeTransitionCommand('expert/record-task-command', payload, context);
}

export function makeRecordReliabilityCommand(
  payload: RecordReliabilityCommandPayload,
  context: ExpertEnvelopeContext,
): Envelope<RecordReliabilityCommandPayload> {
  const entry = payload.entry;
  if (
    typeof entry !== 'object' ||
    entry === null ||
    typeof entry.kind !== 'string' ||
    !['task-completed', 'task-failed', 'no-response'].includes(entry.kind) ||
    (entry as { sequence?: unknown }).sequence !== undefined
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message:
        'record-reliability command requires a sequence-less outcome entry of kind task-completed | task-failed | no-response (the ledger assigns sequences itself)',
    });
  }
  requirePrincipal(entry.recordedBy, 'record-reliability command payload');
  return makeTransitionCommand('expert/record-reliability-command', payload, context);
}

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

function makeProfileTransitionedEvent(
  schemaName: ExpertSchemaName,
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  if (!isExpertProfile(payload.profile)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: `${schemaName} payload requires a structurally valid resulting profile`,
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: expertSchemaRef(schemaName),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeExpertRegisteredEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/expert-registered-event', payload, context);
}

export function makeProfilePublishedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/profile-published-event', payload, context);
}

export function makeProfileSuspendedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/profile-suspended-event', payload, context);
}

export function makeProfileReinstatedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/profile-reinstated-event', payload, context);
}

export function makeProfileRetiredEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/profile-retired-event', payload, context);
}

export function makeProfileSupersededEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/profile-superseded-event', payload, context);
}

export function makeEvidenceAttachedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/evidence-attached-event', payload, context);
}

export function makeTaskRecordedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/task-recorded-event', payload, context);
}

export function makeReliabilityRecordedEvent(
  payload: ProfileTransitionedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<ProfileTransitionedEventPayload> {
  return makeProfileTransitionedEvent('expert/reliability-recorded-event', payload, context);
}

export function makeDomainPackPublishedEvent(
  payload: DomainPackPublishedEventPayload,
  context: ExpertEnvelopeContext,
): Envelope<DomainPackPublishedEventPayload> {
  if (!isExpertDomainPack(payload.pack)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DOMAIN_PACK, {
      message: 'domain-pack-published event requires a structurally valid pack',
    });
  }
  requirePrincipal(payload.publishedBy, 'domain-pack-published event payload');
  return makeEnvelope({
    kind: 'event',
    schema: expertSchemaRef('expert/domain-pack-published-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an expert schema.
 * The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseExpertEnvelope<T>(
  raw: string,
  expectedSchema?: ExpertSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? expertSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an expert envelope. */
export async function expertEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid expert envelope whose canonical
 * digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any
 * mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyExpertEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
