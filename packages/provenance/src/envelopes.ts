/**
 * Envelope wiring for the provenance protocol (architecture-lock rules 17,
 * 18, 22). All wire shapes travel inside @arena/protocol-core's Envelope<T>:
 * idempotency-keyed commands, correlation ids, canonical serialization and
 * digest verification; unknown envelope versions are rejected by the core
 * parser.
 *
 * Payload schemas are versioned SchemaRefs in the `provenance` namespace
 * (arena:schema/provenance/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/artifacts/ (see
 * packages/artifact-protocol/scripts/generate-contracts.mjs, which owns the
 * whole contracts/artifacts/ surface for Work Order A002).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';
import type { ProvenanceRecord } from './record.js';
import { isProvenanceRecord } from './record.js';

export const PROVENANCE_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/provenance. Mirrored by the
 * generated contract provenance-schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const PROVENANCE_SCHEMAS = {
  'provenance/lineage-edge': PROVENANCE_SCHEMA_VERSION,
  'provenance/provenance-record': PROVENANCE_SCHEMA_VERSION,
  'provenance/provenance-error': PROVENANCE_SCHEMA_VERSION,
  'provenance/provenance-recorded-event': PROVENANCE_SCHEMA_VERSION,
  'provenance/record-provenance-command': PROVENANCE_SCHEMA_VERSION,
  'provenance/schema-registry': PROVENANCE_SCHEMA_VERSION,
  'provenance/transformation-lineage': PROVENANCE_SCHEMA_VERSION,
  'provenance/verification-ref': PROVENANCE_SCHEMA_VERSION,
} as const;

export type ProvenanceSchemaName = keyof typeof PROVENANCE_SCHEMAS;

/** Resolve a provenance schema name to its SchemaRef. */
export function provenanceSchemaRef(name: ProvenanceSchemaName): SchemaRef {
  const version = PROVENANCE_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown provenance schema: ${String(name)}`,
      details: { known: Object.keys(PROVENANCE_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a provenance schema at the registered version. */
export function isKnownProvenanceSchema(ref: SchemaRef): boolean {
  const registered = (PROVENANCE_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RecordProvenanceCommandPayload {
  readonly record: ProvenanceRecord;
}

export interface ProvenanceRecordedEventPayload {
  readonly record: ProvenanceRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface ProvenanceEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

export function makeRecordProvenanceCommand(
  payload: RecordProvenanceCommandPayload,
  context: ProvenanceEnvelopeContext,
): Envelope<RecordProvenanceCommandPayload> {
  if (!isProvenanceRecord(payload.record)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'record-provenance command payload requires a structurally valid record',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: provenanceSchemaRef('provenance/record-provenance-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeProvenanceRecordedEvent(
  payload: ProvenanceRecordedEventPayload,
  context: ProvenanceEnvelopeContext,
): Envelope<ProvenanceRecordedEventPayload> {
  if (!isProvenanceRecord(payload.record)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'provenance-recorded event payload requires a structurally valid record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: provenanceSchemaRef('provenance/provenance-recorded-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a provenance schema.
 * The core parser rejects unknown envelope versions, malformed shapes and
 * commands without idempotency keys.
 */
export function parseProvenanceEnvelope<T>(
  raw: string,
  expectedSchema?: ProvenanceSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? provenanceSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a provenance envelope. */
export async function provenanceEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid provenance envelope whose canonical
 * digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on mismatch —
 * the core tamper tripwire, reused verbatim).
 */
export async function verifyProvenanceEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
