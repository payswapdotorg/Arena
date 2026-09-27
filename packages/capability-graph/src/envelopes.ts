/**
 * Envelope wiring for the capability-graph protocol (Work Order A004;
 * architecture-lock rules 17, 18, 22). Every wire shape travels inside
 * @arena/protocol-core's Envelope<T>: commands carry a REQUIRED non-null
 * idempotency key, all messages carry a correlation id, payloads are
 * canonical-JSON serializable and digest-verifiable, and unknown envelope
 * versions are rejected by the core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `capability` namespace
 * (arena:schema/capability/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/capability/ (see
 * packages/capability-graph/scripts/generate-contracts.mjs).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';
import type { CapabilityEdge } from './edges.js';
import { isCapabilityEdge } from './edges.js';
import type { CapabilityNode } from './nodes.js';
import { isCapabilityNode } from './nodes.js';
import type { DomainPackDescriptor } from './domain-pack.js';
import { isDomainPack } from './domain-pack.js';

export const CAPABILITY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/capability-graph. Mirrored by the
 * generated contract capability-schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const CAPABILITY_SCHEMAS = {
  'capability/node-ref': CAPABILITY_SCHEMA_VERSION,
  'capability/node': CAPABILITY_SCHEMA_VERSION,
  'capability/edge': CAPABILITY_SCHEMA_VERSION,
  'capability/graph': CAPABILITY_SCHEMA_VERSION,
  'capability/domain-pack': CAPABILITY_SCHEMA_VERSION,
  'capability/capability-error': CAPABILITY_SCHEMA_VERSION,
  'capability/skill-payload': CAPABILITY_SCHEMA_VERSION,
  'capability/observed-failure-payload': CAPABILITY_SCHEMA_VERSION,
  'capability/node-payload': CAPABILITY_SCHEMA_VERSION,
  'capability/edge-payload': CAPABILITY_SCHEMA_VERSION,
  'capability/add-node-command': CAPABILITY_SCHEMA_VERSION,
  'capability/add-edge-command': CAPABILITY_SCHEMA_VERSION,
  'capability/supersede-node-command': CAPABILITY_SCHEMA_VERSION,
  'capability/apply-domain-pack-command': CAPABILITY_SCHEMA_VERSION,
  'capability/node-added-event': CAPABILITY_SCHEMA_VERSION,
  'capability/edge-added-event': CAPABILITY_SCHEMA_VERSION,
  'capability/domain-pack-applied-event': CAPABILITY_SCHEMA_VERSION,
  'capability/schema-registry': CAPABILITY_SCHEMA_VERSION,
} as const;

export type CapabilitySchemaName = keyof typeof CAPABILITY_SCHEMAS;

/** Resolve a capability-graph schema name to its SchemaRef. */
export function capabilitySchemaRef(name: CapabilitySchemaName): SchemaRef {
  const version = CAPABILITY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown capability-graph schema: ${String(name)}`,
      details: { known: Object.keys(CAPABILITY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a capability-graph schema at the registered version. */
export function isKnownCapabilitySchema(ref: SchemaRef): boolean {
  const registered = (CAPABILITY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface AddNodeCommandPayload {
  readonly node: CapabilityNode;
}

export interface AddEdgeCommandPayload {
  readonly edge: CapabilityEdge;
}

export interface SupersedeNodeCommandPayload {
  /** A node whose `supersedes` field carries the superseded node's digest. */
  readonly node: CapabilityNode;
}

export interface ApplyDomainPackCommandPayload {
  readonly pack: DomainPackDescriptor;
}

export interface NodeAddedEventPayload {
  readonly node: CapabilityNode;
}

export interface EdgeAddedEventPayload {
  readonly edge: CapabilityEdge;
}

export interface DomainPackAppliedEventPayload {
  readonly packId: string;
  readonly packVersion: string;
  readonly packDigest: string;
  readonly declaredNodeKeys: readonly string[];
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface CapabilityEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireIdempotencyKey(context: CapabilityEnvelopeContext): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

export function makeAddNodeCommand(
  payload: AddNodeCommandPayload,
  context: CapabilityEnvelopeContext,
): Envelope<AddNodeCommandPayload> {
  if (!isCapabilityNode(payload.node)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'add-node command payload requires a structurally valid capability node',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: capabilitySchemaRef('capability/add-node-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makeAddEdgeCommand(
  payload: AddEdgeCommandPayload,
  context: CapabilityEnvelopeContext,
): Envelope<AddEdgeCommandPayload> {
  if (!isCapabilityEdge(payload.edge)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: 'add-edge command payload requires a structurally valid capability edge',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: capabilitySchemaRef('capability/add-edge-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makeSupersedeNodeCommand(
  payload: SupersedeNodeCommandPayload,
  context: CapabilityEnvelopeContext,
): Envelope<SupersedeNodeCommandPayload> {
  if (!isCapabilityNode(payload.node)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'supersede-node command payload requires a structurally valid capability node',
    });
  }
  if (payload.node.supersedes === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION, {
      message: 'supersede-node command payload requires a node carrying a supersedes digest',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: capabilitySchemaRef('capability/supersede-node-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makeApplyDomainPackCommand(
  payload: ApplyDomainPackCommandPayload,
  context: CapabilityEnvelopeContext,
): Envelope<ApplyDomainPackCommandPayload> {
  if (!isDomainPack(payload.pack)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PACK, {
      message: 'apply-domain-pack command payload requires a structurally valid domain pack descriptor',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: capabilitySchemaRef('capability/apply-domain-pack-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context),
    payload,
  });
}

export function makeNodeAddedEvent(
  payload: NodeAddedEventPayload,
  context: CapabilityEnvelopeContext,
): Envelope<NodeAddedEventPayload> {
  if (!isCapabilityNode(payload.node)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'node-added event payload requires a structurally valid capability node',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: capabilitySchemaRef('capability/node-added-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeEdgeAddedEvent(
  payload: EdgeAddedEventPayload,
  context: CapabilityEnvelopeContext,
): Envelope<EdgeAddedEventPayload> {
  if (!isCapabilityEdge(payload.edge)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: 'edge-added event payload requires a structurally valid capability edge',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: capabilitySchemaRef('capability/edge-added-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeDomainPackAppliedEvent(
  payload: DomainPackAppliedEventPayload,
  context: CapabilityEnvelopeContext,
): Envelope<DomainPackAppliedEventPayload> {
  if (
    typeof payload.packId !== 'string' ||
    payload.packId.length === 0 ||
    typeof payload.packVersion !== 'string' ||
    payload.packVersion.length === 0 ||
    typeof payload.packDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(payload.packDigest) ||
    !Array.isArray(payload.declaredNodeKeys)
  ) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PACK, {
      message: 'domain-pack-applied event payload requires packId, packVersion, a sha256 packDigest and a declaredNodeKeys array',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: capabilitySchemaRef('capability/domain-pack-applied-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a capability-graph
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseCapabilityEnvelope<T>(
  raw: string,
  expectedSchema?: CapabilitySchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? capabilitySchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a capability-graph envelope. */
export async function capabilityEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid capability-graph envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on
 * any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyCapabilityEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
