/**
 * Envelope wiring for the evaluation protocol (architecture-lock rules
 * 17, 18, 22; Work Order A012 gate 5 — mirrors @arena/artifact-protocol's,
 * @arena/job-protocol's and @arena/trajectory's envelope patterns
 * exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `evaluation`
 * namespace (arena:schema/evaluation/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/evaluation/ (see
 * packages/evaluation/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - run-evaluation-command / evaluation-recorded-event
 *     (running one evaluation: the command carries the digest refs of
 *     the evaluator descriptor, the case, the trajectory and the run
 *     seed — the fabric resolves refs, runs the evaluator hook and
 *     emits the event carrying the store's authoritative, content-
 *     addressed EvaluationRecord; the command's idempotency key + ref
 *     tuple is the idempotent run address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import type { EvaluationRecord } from './record.js';
import { isEvaluationRecord } from './record.js';

export const EVALUATION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/evaluation. Mirrored by the
 * generated contract evaluation-schema-registry.v1.json (parity asserted
 * in contracts.parity.test.ts).
 */
export const EVALUATION_SCHEMAS = Object.freeze({
  'evaluation/evaluator-descriptor': EVALUATION_SCHEMA_VERSION,
  'evaluation/evaluation-criteria': EVALUATION_SCHEMA_VERSION,
  'evaluation/evaluation-record': EVALUATION_SCHEMA_VERSION,
  'evaluation/evaluation-error': EVALUATION_SCHEMA_VERSION,
  'evaluation/run-evaluation-command': EVALUATION_SCHEMA_VERSION,
  'evaluation/evaluation-recorded-event': EVALUATION_SCHEMA_VERSION,
  'evaluation/schema-registry': EVALUATION_SCHEMA_VERSION,
} as const);

export type EvaluationSchemaName = keyof typeof EVALUATION_SCHEMAS;

/** Resolve an evaluation-protocol schema name to its SchemaRef. */
export function evaluationSchemaRef(name: EvaluationSchemaName): SchemaRef {
  const version = EVALUATION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown evaluation protocol schema: ${String(name)}`,
      details: { known: Object.keys(EVALUATION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an evaluation-protocol schema at the registered version. */
export function isKnownEvaluationSchema(ref: SchemaRef): boolean {
  const registered = (EVALUATION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The digest refs of one evaluation run request. */
export interface RunEvaluationCommandPayload {
  /** Digest of the EvaluatorDescriptor to run. */
  readonly evaluatorRef: string;
  /** Digest of the A005 CapabilityCase to judge. */
  readonly caseRef: string;
  /** Digest of the A011 TrajectoryRecord to judge (chain head). */
  readonly trajectoryRef: string;
  /** The run's seed (null when the evaluator is unseeded). */
  readonly seed: string | null;
}

/** The fabric's authoritative result: the frozen, content-addressed record. */
export interface EvaluationRecordedEventPayload {
  readonly record: EvaluationRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface EvaluationEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: EvaluationEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function makeRunEvaluationCommand(
  payload: RunEvaluationCommandPayload,
  context: EvaluationEnvelopeContext,
): Envelope<RunEvaluationCommandPayload> {
  for (const [field, value] of Object.entries({
    evaluatorRef: payload.evaluatorRef,
    caseRef: payload.caseRef,
    trajectoryRef: payload.trajectoryRef,
  })) {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_DIGEST, {
        message: `run-evaluation command payload requires a valid content digest in '${field}'`,
        details: { field, pattern: '^[0-9a-f]{64}$' },
      });
    }
  }
  if (payload.seed !== null && (typeof payload.seed !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payload.seed))) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'run-evaluation command payload seed must be a neutral seed string or null',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: evaluationSchemaRef('evaluation/run-evaluation-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeEvaluationRecordedEvent(
  payload: EvaluationRecordedEventPayload,
  context: EvaluationEnvelopeContext,
): Envelope<EvaluationRecordedEventPayload> {
  if (!isEvaluationRecord(payload.record)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'evaluation-recorded event payload requires a structurally valid evaluation record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: evaluationSchemaRef('evaluation/evaluation-recorded-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors
    // @arena/job-protocol's and @arena/trajectory's event wiring; the
    // recorded event carries the run command's idempotency key when
    // provided — Work Order A012 gate 5).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an
 * evaluation-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseEvaluationEnvelope<T>(
  raw: string,
  expectedSchema?: EvaluationSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? evaluationSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an evaluation-protocol envelope. */
export async function evaluationEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as an evaluation-protocol envelope and assert that its
 * canonical digest equals `expectedDigest` — the tamper tripwire for
 * wire messages. Throws EVALUATION_TAMPERED on any mismatch.
 */
export async function checkEvaluationEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: `evaluation envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
