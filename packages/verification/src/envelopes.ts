/**
 * Envelope wiring for the verification protocol (architecture-lock
 * rules 17, 18, 22; Work Order A013 — mirrors the sibling protocols'
 * envelope patterns exactly (@arena/trajectory, @arena/artifact-protocol).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `verification`
 * namespace (arena:schema/verification/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/verification/ (see
 * packages/verification/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - run-verification-command / verification-recorded-event
 *     (running one verification: the command carries the digest ref of
 *     the verifier descriptor and the run's evidence bundle — the
 *     fabric resolves and validates the evidence, runs the verifier
 *     hook, derives the outcome and emits the event carrying the
 *     ledger's authoritative, content-addressed VerificationRecord; the
 *     command's idempotency key + input tuple is the idempotent run
 *     address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import type { EvidenceReferenceInput } from './evidence.js';
import { toEvidenceBundle } from './evidence.js';
import type { VerificationRecord } from './record.js';
import { isVerificationRecord } from './record.js';

export const VERIFICATION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/verification. Mirrored by the
 * generated contract verification-schema-registry.v1.json (parity
 * asserted in contracts.parity.test.ts).
 */
export const VERIFICATION_SCHEMAS = Object.freeze({
  'verification/verifier-descriptor': VERIFICATION_SCHEMA_VERSION,
  'verification/verification-record': VERIFICATION_SCHEMA_VERSION,
  'verification/verification-outcome': VERIFICATION_SCHEMA_VERSION,
  'verification/verification-error': VERIFICATION_SCHEMA_VERSION,
  'verification/run-verification-command': VERIFICATION_SCHEMA_VERSION,
  'verification/verification-recorded-event': VERIFICATION_SCHEMA_VERSION,
  'verification/schema-registry': VERIFICATION_SCHEMA_VERSION,
} as const);

export type VerificationSchemaName = keyof typeof VERIFICATION_SCHEMAS;

/** Resolve a verification-protocol schema name to its SchemaRef. */
export function verificationSchemaRef(name: VerificationSchemaName): SchemaRef {
  const version = VERIFICATION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown verification protocol schema: ${String(name)}`,
      details: { known: Object.keys(VERIFICATION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a verification-protocol schema at the registered version. */
export function isKnownVerificationSchema(ref: SchemaRef): boolean {
  const registered = (VERIFICATION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The inputs of one verification run request. */
export interface RunVerificationCommandPayload {
  /** Digest of the VerifierDescriptor to run. */
  readonly verifierRef: string;
  /** The run's evidence bundle (provenance-bearing artifact references). */
  readonly evidence: readonly EvidenceReferenceInput[];
}

/** The fabric's authoritative result: the frozen, content-addressed record. */
export interface VerificationRecordedEventPayload {
  readonly record: VerificationRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface VerificationEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: VerificationEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function makeRunVerificationCommand(
  payload: RunVerificationCommandPayload,
  context: VerificationEnvelopeContext,
): Envelope<RunVerificationCommandPayload> {
  if (typeof payload.verifierRef !== 'string' || !DIGEST_PATTERN.test(payload.verifierRef)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `run-verification command payload requires a valid content digest in 'verifierRef'`,
      details: { field: 'verifierRef', pattern: '^[0-9a-f]{64}$' },
    });
  }
  // Full bundle validation (structure, provenance, artifact refs).
  toEvidenceBundle(payload.evidence);
  return makeEnvelope({
    kind: 'command',
    schema: verificationSchemaRef('verification/run-verification-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeVerificationRecordedEvent(
  payload: VerificationRecordedEventPayload,
  context: VerificationEnvelopeContext,
): Envelope<VerificationRecordedEventPayload> {
  if (!isVerificationRecord(payload.record)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'verification-recorded event payload requires a structurally valid verification record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: verificationSchemaRef('verification/verification-recorded-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors the
    // sibling protocols; the recorded event carries the run command's
    // idempotency key when provided).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a
 * verification-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseVerificationEnvelope<T>(
  raw: string,
  expectedSchema?: VerificationSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? verificationSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a verification-protocol envelope. */
export async function verificationEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a verification-protocol envelope and assert that its
 * canonical digest equals `expectedDigest` — the tamper tripwire for
 * wire messages. Throws VERIFICATION_TAMPERED on any mismatch.
 */
export async function checkVerificationEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.TAMPERED, {
      message: `verification envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
