/**
 * Envelope wiring for the agent body protocol (architecture-lock rules 17,
 * 18, 22). Every wire shape travels inside @arena/protocol-core's
 * Envelope<T>: commands carry a REQUIRED non-null idempotency key (lock
 * rule 17 — long-running jobs are idempotent and correlation-addressable),
 * all messages carry a correlation id, payloads are canonical-JSON
 * serializable and digest-verifiable, and unknown envelope versions are
 * rejected by the core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `agent-body` namespace
 * (arena:schema/agent-body/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/agent-body/ (see
 * packages/agent-body/scripts/generate-contracts.mjs — the package-level
 * generator; governance G9 runs every package-level generator with
 * --check, so this package's contracts are governed centrally without any
 * root-file edit).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type { AgentBodyErrorCode } from './errors.js';
import type { CognitiveSubstrate } from './substrate.js';
import { isCognitiveSubstrate } from './substrate.js';
import type { Possession } from './possession.js';
import { isPossession } from './possession.js';
import type { AgentInstance, InstanceTerminationStatus } from './instance.js';
import { isInstanceTerminationStatus, isAgentInstance } from './instance.js';
import type { PrincipalRefView, TimestampView } from './shared.js';
import { isContentDigest, isPrincipalRefView, isTimestampView, toTimestampView } from './shared.js';

export const AGENT_BODY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/agent-body. Mirrored by the
 * generated contract agent-body/agent-body-schema-registry.v1.json (parity
 * asserted in contracts.parity.test.ts).
 */
export const AGENT_BODY_SCHEMAS = {
  'agent-body/agent-body': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/body-version': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/body-version-ref': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/cognitive-substrate': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/substrate-compatibility-profile': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/possession': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/model-specific-artifact': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/agent-instance': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/agent-instance-event': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/agent-body-error': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/register-substrate-command': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/create-possession-command': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/terminate-instance-command': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/substrate-registered-event': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/possession-created-event': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/agent-instance-terminated-event': AGENT_BODY_SCHEMA_VERSION,
  'agent-body/schema-registry': AGENT_BODY_SCHEMA_VERSION,
} as const;

export type AgentBodySchemaName = keyof typeof AGENT_BODY_SCHEMAS;

/** Resolve an agent-body schema name to its SchemaRef. */
export function agentBodySchemaRef(name: AgentBodySchemaName): SchemaRef {
  const version = AGENT_BODY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown agent body schema: ${String(name)}`,
      details: { known: Object.keys(AGENT_BODY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an agent-body schema at the registered version. */
export function isKnownAgentBodySchema(ref: SchemaRef): boolean {
  const registered = (AGENT_BODY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RegisterSubstrateCommandPayload {
  readonly substrate: CognitiveSubstrate;
  readonly registrant: PrincipalRefView;
}

export interface CreatePossessionCommandPayload {
  readonly possession: Possession;
  readonly creator: PrincipalRefView;
}

export interface TerminateAgentInstanceCommandPayload {
  readonly instanceId: string;
  readonly possessionDigest: string;
  readonly status: InstanceTerminationStatus;
  readonly reason: string;
  readonly terminatedAt: TimestampView;
}

export interface SubstrateRegisteredEventPayload {
  readonly substrate: CognitiveSubstrate;
}

export interface PossessionCreatedEventPayload {
  readonly possession: Possession;
}

export interface AgentInstanceTerminatedEventPayload {
  readonly instanceId: string;
  readonly possessionDigest: string;
  readonly termination: {
    readonly status: InstanceTerminationStatus;
    readonly terminatedAt: TimestampView;
    readonly reason: string;
  };
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface AgentBodyEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireIdempotencyKey(
  context: AgentBodyEnvelopeContext,
  code: AgentBodyErrorCode,
  surface: string,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new AgentBodyError(code, {
      message: `command envelopes require an idempotency key (architecture-lock rule 17): ${surface}`,
    });
  }
  return context.idempotencyKey;
}

export function makeRegisterSubstrateCommand(
  payload: RegisterSubstrateCommandPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<RegisterSubstrateCommandPayload> {
  if (!isCognitiveSubstrate(payload.substrate)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_SUBSTRATE, {
      message: 'register-substrate command payload requires a structurally valid cognitive substrate',
    });
  }
  if (!isPrincipalRefView(payload.registrant)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: 'register-substrate command payload requires a valid registrant principal',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: agentBodySchemaRef('agent-body/register-substrate-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(
      context,
      AGENT_BODY_ERROR_CODES.INVALID_SUBSTRATE,
      'register-substrate',
    ),
    payload,
  });
}

export function makeCreatePossessionCommand(
  payload: CreatePossessionCommandPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<CreatePossessionCommandPayload> {
  if (!isPossession(payload.possession)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: 'create-possession command payload requires a structurally valid possession',
    });
  }
  if (!isPrincipalRefView(payload.creator)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: 'create-possession command payload requires a valid creator principal',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: agentBodySchemaRef('agent-body/create-possession-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(
      context,
      AGENT_BODY_ERROR_CODES.INVALID_POSSESSION,
      'create-possession',
    ),
    payload,
  });
}

export function makeTerminateAgentInstanceCommand(
  payload: TerminateAgentInstanceCommandPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<TerminateAgentInstanceCommandPayload> {
  if (typeof payload.instanceId !== 'string' || payload.instanceId.length === 0) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'terminate-instance command payload requires an instance id',
    });
  }
  if (typeof payload.possessionDigest !== 'string' || !isContentDigest(payload.possessionDigest)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'terminate-instance command payload requires a valid possession digest',
    });
  }
  if (!isInstanceTerminationStatus(payload.status)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: `unknown termination status: ${JSON.stringify(payload.status)}`,
    });
  }
  if (typeof payload.reason !== 'string' || payload.reason.length === 0) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'terminate-instance command payload requires a non-empty reason',
    });
  }
  if (!isTimestampView(payload.terminatedAt)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'terminate-instance command payload requires a millisecond UTC timestamp',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: agentBodySchemaRef('agent-body/terminate-instance-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(
      context,
      AGENT_BODY_ERROR_CODES.INVALID_INSTANCE,
      'terminate-instance',
    ),
    payload,
  });
}

export function makeSubstrateRegisteredEvent(
  payload: SubstrateRegisteredEventPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<SubstrateRegisteredEventPayload> {
  if (!isCognitiveSubstrate(payload.substrate)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_SUBSTRATE, {
      message: 'substrate-registered event payload requires a structurally valid cognitive substrate',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: agentBodySchemaRef('agent-body/substrate-registered-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makePossessionCreatedEvent(
  payload: PossessionCreatedEventPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<PossessionCreatedEventPayload> {
  if (!isPossession(payload.possession)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: 'possession-created event payload requires a structurally valid possession',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: agentBodySchemaRef('agent-body/possession-created-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeAgentInstanceTerminatedEvent(
  payload: AgentInstanceTerminatedEventPayload,
  context: AgentBodyEnvelopeContext,
): Envelope<AgentInstanceTerminatedEventPayload> {
  if (typeof payload.instanceId !== 'string' || payload.instanceId.length === 0) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'agent-instance-terminated event payload requires an instance id',
    });
  }
  if (typeof payload.possessionDigest !== 'string' || !isContentDigest(payload.possessionDigest)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'agent-instance-terminated event payload requires a valid possession digest',
    });
  }
  if (
    !isInstanceTerminationStatus(payload.termination?.status) ||
    !isTimestampView(payload.termination?.terminatedAt) ||
    typeof payload.termination?.reason !== 'string' ||
    payload.termination.reason.length === 0
  ) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'agent-instance-terminated event payload requires a valid termination record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: agentBodySchemaRef('agent-body/agent-instance-terminated-event'),
    correlationId: context.correlationId,
    payload,
  });
}

/**
 * Build the agent-instance-terminated event payload from a TERMINATED
 * AgentInstance (terminal states are final — this helper refuses a live
 * instance).
 */
export function agentInstanceTerminatedPayload(
  instance: AgentInstance,
): AgentInstanceTerminatedEventPayload {
  if (!isAgentInstance(instance)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_INSTANCE, {
      message: 'not a structurally valid agent instance',
    });
  }
  if (instance.termination === null) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INSTANCE_TERMINATED, {
      message: 'agent-instance-terminated events describe TERMINATED instances; this instance is still live',
    });
  }
  return {
    instanceId: instance.instanceId,
    possessionDigest: instance.possessionDigest,
    termination: {
      status: instance.termination.status,
      terminatedAt: toTimestampView(instance.termination.terminatedAt),
      reason: instance.termination.reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an agent-body schema.
 * The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseAgentBodyEnvelope<T>(
  raw: string,
  expectedSchema?: AgentBodySchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? agentBodySchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an agent-body envelope. */
export async function agentBodyEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid envelope whose canonical digest equals
 * `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any mismatch — the core
 * tamper tripwire, reused verbatim).
 */
export async function verifyAgentBodyEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
