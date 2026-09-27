/**
 * Envelope wiring for the capability-case protocol (Work Order A005 gate 8;
 * architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and digest-
 * verifiable, and unknown envelope versions are rejected by the core parser
 * (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Commands describe INTENT (the inputs of a transition, addressed by the
 * current state's digest — the orchestrating service applies the pure
 * transition functions and emits the matching event). Events carry the
 * RESULTING case state plus the lifecycle event, so downstream consumers
 * never need to re-derive state.
 *
 * Payload schemas are versioned as SchemaRefs in the `capability-case`
 * namespace (arena:schema/capability-case/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/capability-case/ (see
 * packages/capability-case/scripts/generate-contracts.mjs; parity is
 * asserted by contracts.parity.test.ts).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import type { CapabilityCase } from './case.js';
import { isCapabilityCase } from './case.js';
import type { CaseLifecycleEvent } from './lifecycle.js';
import type { EvidenceRefLike, PrincipalRefLike } from './shared.js';
import { isEvidenceRef } from './shared.js';
import { isPrincipalRefView } from './shared.js';
import type { CaseVersionRefLike } from './identity.js';
import { isCaseVersionRef } from './identity.js';
import type { TaskCompilationTarget } from './compilation.js';
import { isTaskCompilationTarget } from './compilation.js';

export const CAPABILITY_CASE_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/capability-case. Mirrored by the
 * generated contract capability-case/schema-registry.v1.json (parity
 * asserted in contracts.parity.test.ts).
 */
export const CAPABILITY_CASE_SCHEMAS = {
  'capability-case/case-ref': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/evidence-ref': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/principal': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/observed-failure': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/expert-requirements': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/environment-requirements': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/task-requirements': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/evaluation-requirements': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/verification-requirements': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/lifecycle-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/compilation-target': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/error': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/register-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/submit-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/triage-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/activate-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/resolve-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/supersede-case-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/attach-evidence-command': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-registered-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-submitted-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-triaged-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-activated-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-resolved-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/case-superseded-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/evidence-attached-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/compilation-target-derived-event': CAPABILITY_CASE_SCHEMA_VERSION,
  'capability-case/schema-registry': CAPABILITY_CASE_SCHEMA_VERSION,
} as const;

export type CapabilityCaseSchemaName = keyof typeof CAPABILITY_CASE_SCHEMAS;

/** Resolve a capability-case schema name to its SchemaRef. */
export function capabilityCaseSchemaRef(name: CapabilityCaseSchemaName): SchemaRef {
  const version = CAPABILITY_CASE_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown capability-case protocol schema: ${String(name)}`,
      details: { known: Object.keys(CAPABILITY_CASE_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a capability-case schema at the registered version. */
export function isKnownCapabilityCaseSchema(ref: SchemaRef): boolean {
  const registered = (CAPABILITY_CASE_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Register a fresh case (the resulting registry admission). */
export interface RegisterCaseCommandPayload {
  readonly caseRecord: CapabilityCase;
  readonly registrar: PrincipalRefLike;
}

/**
 * Apply a lifecycle transition to the case state addressed by
 * `currentStateDigest` (the service resolves the state, applies the pure
 * transition function and emits the matching event).
 */
export interface TransitionCommandPayload {
  readonly currentStateDigest: string;
  readonly at: string;
  readonly actor: PrincipalRefLike;
  readonly note?: string;
}

/** Resolve a case: carries the REQUIRED resolution statement. */
export interface ResolveCaseCommandPayload extends TransitionCommandPayload {
  readonly resolution: string;
}

/** Supersede a case version: carries the superseding version ref. */
export interface SupersedeCaseCommandPayload extends TransitionCommandPayload {
  readonly superseding: CaseVersionRefLike;
}

/** Attach evidence: carries the evidence refs to append (>= 1). */
export interface AttachEvidenceCommandPayload extends TransitionCommandPayload {
  readonly evidence: readonly EvidenceRefLike[];
}

/** A case state changed: carries the resulting state + the lifecycle event. */
export interface CaseTransitionedEventPayload {
  readonly caseRecord: CapabilityCase;
  readonly event: CaseLifecycleEvent;
}

/** A compilation target was derived from a case state. */
export interface CompilationTargetDerivedEventPayload {
  readonly target: TaskCompilationTarget;
  readonly derivedBy: PrincipalRefLike;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface CapabilityCaseEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireIdempotencyKey(context: CapabilityCaseEnvelopeContext): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

function requirePrincipal(
  principal: unknown,
  what: string,
): asserts principal is PrincipalRefLike {
  if (!isPrincipalRefView(principal)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `${what} requires a valid principal`,
    });
  }
}

function requireDigest(digest: unknown, what: string): string {
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_DIGEST, {
      message: `${what} requires a valid sha256 state digest`,
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return digest;
}

export function makeRegisterCaseCommand(
  payload: RegisterCaseCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<RegisterCaseCommandPayload> {
  if (!isCapabilityCase(payload.caseRecord)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: 'register-case command payload requires a structurally valid case',
    });
  }
  requirePrincipal(payload.registrar, 'register-case command payload');
  return makeEnvelope({
    kind: 'command',
    schema: capabilityCaseSchemaRef('capability-case/register-case-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

function makeTransitionCommand<T extends TransitionCommandPayload>(
  schemaName: CapabilityCaseSchemaName,
  payload: T,
  context: CapabilityCaseEnvelopeContext,
): Envelope<T> {
  requireDigest(payload.currentStateDigest, 'transition command payload');
  requirePrincipal(payload.actor, 'transition command payload');
  if (payload.note !== undefined && payload.note.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
      message: 'transition command notes, when present, must be non-empty',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: capabilityCaseSchemaRef(schemaName),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makeSubmitCaseCommand(
  payload: TransitionCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  return makeTransitionCommand('capability-case/submit-case-command', payload, context);
}

export function makeTriageCaseCommand(
  payload: TransitionCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  if (typeof payload.note !== 'string' || payload.note.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
      message: 'triage command requires a non-empty rationale note (the selection rationale remains inspectable)',
    });
  }
  return makeTransitionCommand('capability-case/triage-case-command', payload, context);
}

export function makeActivateCaseCommand(
  payload: TransitionCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<TransitionCommandPayload> {
  return makeTransitionCommand('capability-case/activate-case-command', payload, context);
}

export function makeResolveCaseCommand(
  payload: ResolveCaseCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<ResolveCaseCommandPayload> {
  if (typeof payload.resolution !== 'string' || payload.resolution.length === 0) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_TRANSITION, {
      message: 'resolve command requires a non-empty resolution statement',
    });
  }
  return makeTransitionCommand(
    'capability-case/resolve-case-command',
    payload,
    context,
  );
}

export function makeSupersedeCaseCommand(
  payload: SupersedeCaseCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<SupersedeCaseCommandPayload> {
  if (!isCaseVersionRef(payload.superseding)) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_SUPERSESSION,
      {
        message: 'supersede command requires a valid superseding case version ref',
      },
    );
  }
  return makeTransitionCommand(
    'capability-case/supersede-case-command',
    payload,
    context,
  );
}

export function makeAttachEvidenceCommand(
  payload: AttachEvidenceCommandPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<AttachEvidenceCommandPayload> {
  if (
    !Array.isArray(payload.evidence) ||
    payload.evidence.length === 0 ||
    !payload.evidence.every((ref) => isEvidenceRef(ref))
  ) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'attach-evidence command requires at least one valid evidence ref',
    });
  }
  return makeTransitionCommand(
    'capability-case/attach-evidence-command',
    payload,
    context,
  );
}

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

function makeCaseTransitionedEvent(
  schemaName: CapabilityCaseSchemaName,
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  if (!isCapabilityCase(payload.caseRecord)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_CASE, {
      message: `${schemaName} payload requires a structurally valid resulting case`,
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: capabilityCaseSchemaRef(schemaName),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeCaseRegisteredEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-registered-event', payload, context);
}

export function makeCaseSubmittedEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-submitted-event', payload, context);
}

export function makeCaseTriagedEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-triaged-event', payload, context);
}

export function makeCaseActivatedEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-activated-event', payload, context);
}

export function makeCaseResolvedEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-resolved-event', payload, context);
}

export function makeCaseSupersededEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/case-superseded-event', payload, context);
}

export function makeEvidenceAttachedEvent(
  payload: CaseTransitionedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CaseTransitionedEventPayload> {
  return makeCaseTransitionedEvent('capability-case/evidence-attached-event', payload, context);
}

export function makeCompilationTargetDerivedEvent(
  payload: CompilationTargetDerivedEventPayload,
  context: CapabilityCaseEnvelopeContext,
): Envelope<CompilationTargetDerivedEventPayload> {
  if (!isTaskCompilationTarget(payload.target)) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_COMPILATION_TARGET,
      {
        message: 'compilation-target-derived event requires a structurally valid target',
      },
    );
  }
  requirePrincipal(payload.derivedBy, 'compilation-target-derived event payload');
  return makeEnvelope({
    kind: 'event',
    schema: capabilityCaseSchemaRef(
      'capability-case/compilation-target-derived-event',
    ),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a capability-case
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseCapabilityCaseEnvelope<T>(
  raw: string,
  expectedSchema?: CapabilityCaseSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? capabilityCaseSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a case envelope. */
export async function capabilityCaseEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid capability-case envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on
 * any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyCapabilityCaseEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
