/**
 * Envelope wiring for the trajectory protocol (architecture-lock rules
 * 17, 18, 22; Work Order A011 gate 5 — mirrors @arena/artifact-protocol's
 * and @arena/job-protocol's envelope patterns exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-verifiable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `trajectory`
 * namespace (arena:schema/trajectory/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/trajectory/ (see
 * packages/trajectory/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - open-trajectory-command / trajectory-opened-event
 *     (opening a trajectory against a validated header — the store
 *     treats the command's idempotency key + trajectory id as the
 *     idempotent open address);
 *   - append-trajectory-entry-command / trajectory-entry-appended-event
 *     (appending one entry — the command carries the DIGEST-FREE entry
 *     view so the store computes the chained stepDigest itself and never
 *     trusts caller-side digests; the event carries the store's
 *     authoritative entry WITH its computed stepDigest plus the
 *     resulting chain head, giving downstream consumers the trajectory
 *     digest for ENV1.0 run addressability).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import type { TrajectoryEntry, TrajectoryEntryKind } from './entry.js';
import { isTrajectoryEntry } from './entry.js';
import type { TrajectoryHeader } from './header.js';
import { isTrajectoryHeader } from './header.js';
import type { ContentDigest, TrajectoryId, TrajectoryTimestamp } from './shared.js';
import { isContentDigest, isTrajectoryId } from './shared.js';

export const TRAJECTORY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/trajectory. Mirrored by the
 * generated contract trajectory-schema-registry.v1.json (parity asserted
 * in contracts.parity.test.ts).
 */
export const TRAJECTORY_SCHEMAS = Object.freeze({
  'trajectory/trajectory-run-ref': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-header': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-entry': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-record': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-error': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/open-trajectory-command': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-opened-event': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/append-trajectory-entry-command': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/trajectory-entry-appended-event': TRAJECTORY_SCHEMA_VERSION,
  'trajectory/schema-registry': TRAJECTORY_SCHEMA_VERSION,
} as const);

export type TrajectorySchemaName = keyof typeof TRAJECTORY_SCHEMAS;

/** Resolve a trajectory-protocol schema name to its SchemaRef. */
export function trajectorySchemaRef(name: TrajectorySchemaName): SchemaRef {
  const version = TRAJECTORY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown trajectory protocol schema: ${String(name)}`,
      details: { known: Object.keys(TRAJECTORY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a trajectory-protocol schema at the registered version. */
export function isKnownTrajectorySchema(ref: SchemaRef): boolean {
  const registered = (TRAJECTORY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface OpenTrajectoryCommandPayload {
  readonly header: TrajectoryHeader;
}

export interface TrajectoryOpenedEventPayload {
  readonly header: TrajectoryHeader;
}

/** The digest-free entry view + the target trajectory id. */
export interface AppendTrajectoryEntryCommandPayload {
  readonly trajectoryId: TrajectoryId;
  readonly sequence: number;
  readonly kind: TrajectoryEntryKind;
  readonly payload: unknown;
  readonly occurredAt: TrajectoryTimestamp;
}

/** The store's authoritative append result. */
export interface TrajectoryEntryAppendedEventPayload {
  readonly trajectoryId: TrajectoryId;
  readonly entry: TrajectoryEntry;
  readonly chainHead: ContentDigest;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface TrajectoryEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: TrajectoryEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_ENTRY, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

export function makeOpenTrajectoryCommand(
  payload: OpenTrajectoryCommandPayload,
  context: TrajectoryEnvelopeContext,
): Envelope<OpenTrajectoryCommandPayload> {
  if (!isTrajectoryHeader(payload.header)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, {
      message:
        'open-trajectory command payload requires a structurally valid trajectory header',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: trajectorySchemaRef('trajectory/open-trajectory-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeTrajectoryOpenedEvent(
  payload: TrajectoryOpenedEventPayload,
  context: TrajectoryEnvelopeContext,
): Envelope<TrajectoryOpenedEventPayload> {
  if (!isTrajectoryHeader(payload.header)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, {
      message:
        'trajectory-opened event payload requires a structurally valid trajectory header',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: trajectorySchemaRef('trajectory/trajectory-opened-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors
    // @arena/job-protocol's event wiring).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeAppendTrajectoryEntryCommand(
  payload: AppendTrajectoryEntryCommandPayload,
  context: TrajectoryEnvelopeContext,
): Envelope<AppendTrajectoryEntryCommandPayload> {
  if (!isTrajectoryId(payload.trajectoryId)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_IDENTITY, {
      message:
        'append-trajectory-entry command payload requires a valid trajectory id',
    });
  }
  if (
    typeof payload.sequence !== 'number' ||
    !Number.isInteger(payload.sequence) ||
    payload.sequence <= 0
  ) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_ENTRY, {
      message:
        'append-trajectory-entry command payload requires a positive integer sequence',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: trajectorySchemaRef('trajectory/append-trajectory-entry-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeTrajectoryEntryAppendedEvent(
  payload: TrajectoryEntryAppendedEventPayload,
  context: TrajectoryEnvelopeContext,
): Envelope<TrajectoryEntryAppendedEventPayload> {
  if (!isTrajectoryId(payload.trajectoryId)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_IDENTITY, {
      message:
        'trajectory-entry-appended event payload requires a valid trajectory id',
    });
  }
  if (!isTrajectoryEntry(payload.entry)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_ENTRY, {
      message:
        'trajectory-entry-appended event payload requires a structurally valid trajectory entry',
    });
  }
  if (!isContentDigest(payload.chainHead)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_DIGEST, {
      message:
        'trajectory-entry-appended event payload requires a valid chain head digest',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: trajectorySchemaRef('trajectory/trajectory-entry-appended-event'),
    correlationId: context.correlationId,
    // The entry-appended event carries the append command's idempotency
    // key when provided, so replays of the event stream are
    // idempotency-addressable (Work Order A011 gate 5 — idempotency
    // keys for append commands AND entry-appended events; mirrors
    // @arena/job-protocol's event wiring).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a
 * trajectory-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseTrajectoryEnvelope<T>(
  raw: string,
  expectedSchema?: TrajectorySchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? trajectorySchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a trajectory-protocol envelope. */
export async function trajectoryEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid trajectory-protocol envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED
 * on any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyTrajectoryEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
