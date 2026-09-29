/**
 * Envelope wiring for the skill-extraction protocol (architecture-lock
 * rules 17, 18, 22; Work Order A019 — mirrors @arena/trajectory's,
 * @arena/evaluation's and @arena/verification's envelope patterns
 * exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages
 * carry a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `skill-extraction`
 * namespace (arena:schema/skill-extraction/<name>@<major.minor.patch>).
 *
 * CONTRACTS DISCLOSURE (A019): Work Order A019 owns NO contracts/
 * surface (spec/work-items.md: packages/skill-extraction/*,
 * services/skill-extraction/* only). The choice made here: schemas live
 * INSIDE the package as SchemaRef-referenced data — the registry below
 * is the authority for the skill-extraction namespace, and existing
 * contracts are NOT redeclared. There is deliberately no
 * scripts/generate-contracts.mjs and no contracts/skill-extraction/
 * directory (governance G9 auto-discovers package-level generators;
 * this package ships none, so it contributes no contract surface).
 *
 * Wire messages:
 *   - run-extraction-command / extraction-completed-event
 *     (running one extraction: the command carries the digest refs of
 *     the policy and the validated trajectory refs to mine — the
 *     fabric resolves refs, runs the mining core and emits the event
 *     carrying the fabric's authoritative, content-addressed
 *     ExtractionRunRecord; the command's idempotency key + ref tuple
 *     is the idempotent run address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';

export const SKILL_EXTRACTION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/skill-extraction (in-package
 * SchemaRef-referenced data — see the contracts disclosure above).
 */
export const SKILL_EXTRACTION_SCHEMAS = Object.freeze({
  'skill-extraction/validated-trajectory-ref': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/extraction-policy': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/skill-candidate': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/skill-draft': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/extraction-error': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/run-extraction-command': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/extraction-completed-event': SKILL_EXTRACTION_SCHEMA_VERSION,
  'skill-extraction/schema-registry': SKILL_EXTRACTION_SCHEMA_VERSION,
} as const);

export type SkillExtractionSchemaName = keyof typeof SKILL_EXTRACTION_SCHEMAS;

/** Resolve a skill-extraction schema name to its SchemaRef. */
export function skillExtractionSchemaRef(name: SkillExtractionSchemaName): SchemaRef {
  const version = SKILL_EXTRACTION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown skill-extraction protocol schema: ${String(name)}`,
      details: { known: Object.keys(SKILL_EXTRACTION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a skill-extraction schema at the registered version. */
export function isKnownSkillExtractionSchema(ref: SchemaRef): boolean {
  const registered = (SKILL_EXTRACTION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The digest refs of one extraction run request. */
export interface RunExtractionCommandPayload {
  /** Digest of the ExtractionPolicy to run. */
  readonly policyRef: string;
  /** Digests of the ValidatedTrajectoryRefs to mine (the run's inputs). */
  readonly inputs: readonly string[];
}

/** The fabric's authoritative result: the frozen, content-addressed run record (digest). */
export interface ExtractionCompletedEventPayload {
  readonly runRecordDigest: string;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface SkillExtractionEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: SkillExtractionEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function makeRunExtractionCommand(
  payload: RunExtractionCommandPayload,
  context: SkillExtractionEnvelopeContext,
): Envelope<RunExtractionCommandPayload> {
  if (typeof payload.policyRef !== 'string' || !DIGEST_PATTERN.test(payload.policyRef)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST, {
      message: 'run-extraction command payload requires a valid content digest in policyRef',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (!Array.isArray(payload.inputs) || payload.inputs.length === 0) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: 'run-extraction command payload requires a non-empty inputs array',
    });
  }
  for (const input of payload.inputs) {
    if (typeof input !== 'string' || !DIGEST_PATTERN.test(input)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST, {
        message: 'run-extraction command payload inputs must be content digests',
        details: { pattern: '^[0-9a-f]{64}$' },
      });
    }
  }
  return makeEnvelope({
    kind: 'command',
    schema: skillExtractionSchemaRef('skill-extraction/run-extraction-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeExtractionCompletedEvent(
  payload: ExtractionCompletedEventPayload,
  context: SkillExtractionEnvelopeContext,
): Envelope<ExtractionCompletedEventPayload> {
  if (typeof payload.runRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.runRecordDigest)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST, {
      message: 'extraction-completed event payload requires a valid run-record digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: skillExtractionSchemaRef('skill-extraction/extraction-completed-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors the
    // sibling protocols' event wiring; the completed event carries the
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
 * skill-extraction schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseSkillExtractionEnvelope<T>(
  raw: string,
  expectedSchema?: SkillExtractionSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? skillExtractionSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a skill-extraction envelope. */
export async function skillExtractionEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a skill-extraction envelope and assert that its
 * canonical digest equals `expectedDigest` — the tamper tripwire for
 * wire messages. Throws SKILL_EXTRACTION_TAMPERED on any mismatch.
 */
export async function checkSkillExtractionEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TAMPERED, {
      message: `skill-extraction envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
