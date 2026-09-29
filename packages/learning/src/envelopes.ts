/**
 * Envelope wiring for the learning protocol (architecture-lock rules
 * 17, 18; Work Order A020 - mirrors @arena/evaluation's,
 * @arena/trajectory's and @arena/skill-extraction's envelope patterns
 * exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages
 * carry a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `learning`
 * namespace (arena:schema/learning/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/learning/ (see
 * packages/learning/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - run-experiment-command / experiment-completed-event
 *     (running one experiment: the command carries the digest ref of
 *     the experiment descriptor plus the arm run refs the engine
 *     should compare - the engine resolves refs, executes the pure
 *     comparison/attribution/verdict computation and emits the event
 *     carrying the store's authoritative, content-addressed
 *     ExperimentRunRecord; the command's idempotency key + refs tuple
 *     is the idempotent run address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import { isExperimentRunRecord } from './run-record.js';
import type { ExperimentRunRecord } from './run-record.js';

export const LEARNING_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/learning. Mirrored by the
 * generated contract learning-schema-registry.v1.json (parity asserted
 * in contracts.parity.test.ts).
 */
export const LEARNING_SCHEMAS = Object.freeze({
  'learning/experiment-descriptor': LEARNING_SCHEMA_VERSION,
  'learning/intervention': LEARNING_SCHEMA_VERSION,
  'learning/experiment-run-record': LEARNING_SCHEMA_VERSION,
  'learning/attribution-result': LEARNING_SCHEMA_VERSION,
  'learning/capability-lift-verdict': LEARNING_SCHEMA_VERSION,
  'learning/calibration-record': LEARNING_SCHEMA_VERSION,
  'learning/run-experiment-command': LEARNING_SCHEMA_VERSION,
  'learning/experiment-completed-event': LEARNING_SCHEMA_VERSION,
  'learning/schema-registry': LEARNING_SCHEMA_VERSION,
} as const);

export type LearningSchemaName = keyof typeof LEARNING_SCHEMAS;

/** Resolve a learning-protocol schema name to its SchemaRef. */
export function learningSchemaRef(name: LearningSchemaName): SchemaRef {
  const version = LEARNING_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown learning protocol schema: ${String(name)}`,
      details: { known: Object.keys(LEARNING_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a learning-protocol schema at the registered version. */
export function isKnownLearningSchema(ref: SchemaRef): boolean {
  const registered = (LEARNING_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The digest refs of one experiment run request. */
export interface RunExperimentCommandPayload {
  /** Digest of the ExperimentDescriptor to run. */
  readonly descriptorRef: string;
  /** The run's idempotency key - the experiment key (architecture-lock rule 17). */
  readonly experimentKey: string;
}

/** The engine's authoritative result: the frozen, content-addressed run record. */
export interface ExperimentCompletedEventPayload {
  readonly record: ExperimentRunRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface LearningEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: LearningEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function makeRunExperimentCommand(
  payload: RunExperimentCommandPayload,
  context: LearningEnvelopeContext,
): Envelope<RunExperimentCommandPayload> {
  if (typeof payload.descriptorRef !== 'string' || !DIGEST_PATTERN.test(payload.descriptorRef)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DIGEST, {
      message: 'run-experiment command payload requires a valid content digest in descriptorRef',
      details: { field: 'descriptorRef', pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (
    typeof payload.experimentKey !== 'string' ||
    !IDENTIFIER_PATTERN.test(payload.experimentKey)
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
      message:
        'run-experiment command payload requires a neutral experiment key (idempotency key charset)',
      details: { field: 'experimentKey', pattern: IDENTIFIER_PATTERN.source },
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: learningSchemaRef('learning/run-experiment-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeExperimentCompletedEvent(
  payload: ExperimentCompletedEventPayload,
  context: LearningEnvelopeContext,
): Envelope<ExperimentCompletedEventPayload> {
  if (!isExperimentRunRecord(payload.record)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment-completed event payload requires a structurally valid experiment run record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: learningSchemaRef('learning/experiment-completed-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors the
    // sibling packages' event wiring; the completed event carries the
    // run command's idempotency key when provided).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a
 * learning-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseLearningEnvelope<T>(
  raw: string,
  expectedSchema?: LearningSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? learningSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a learning-protocol envelope. */
export async function learningEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a learning-protocol envelope and assert that its
 * canonical digest equals `expectedDigest` - the tamper tripwire for
 * wire messages. Throws LEARNING_TAMPERED on any mismatch.
 */
export async function checkLearningEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new LearningError(LEARNING_ERROR_CODES.TAMPERED, {
      message: `learning envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
