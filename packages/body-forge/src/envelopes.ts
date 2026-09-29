/**
 * Envelope wiring for the body-forge protocol (architecture-lock
 * rules 17, 18, 22; Work Order A021 — mirrors @arena/skill-extraction's
 * and @arena/learning's envelope patterns exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages
 * carry a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `body-forge`
 * namespace (arena:schema/body-forge/<name>@<major.minor.patch>).
 *
 * CONTRACTS DISCLOSURE (A021): Work Order A021 owns NO contracts/
 * surface (spec/work-items.md: packages/body-forge/*,
 * services/body-forge/* only), following the A019 precedent. The
 * choice made here: schemas live INSIDE the package as
 * SchemaRef-referenced data — the registry below is the authority for
 * the body-forge namespace, and existing contracts are NOT
 * redeclared. There is deliberately no scripts/generate-contracts.mjs
 * and no contracts/body-forge/ directory (governance G9 auto-discovers
 * package-level generators; this package ships none, so it contributes
 * no contract surface).
 *
 * Wire messages:
 *   - submit-forge-command / forge-completed-event
 *     (running one forge: the command carries the digest refs of the
 *     manifest and the policy to compose — the fabric resolves the
 *     refs, validates, composes and emits the event carrying the
 *     fabric's authoritative, content-addressed ForgeRecord plus the
 *     emitted BodyVersion digest; the command's idempotency key + ref
 *     tuple is the idempotent forge address).
 */

import { envelopeDigest, makeEnvelope, parseEnvelopeAs } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { BODY_FORGE_ERROR_CODES, BodyForgeError } from './errors.js';

export const BODY_FORGE_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/body-forge (in-package
 * SchemaRef-referenced data — see the contracts disclosure above).
 */
export const BODY_FORGE_SCHEMAS = Object.freeze({
  'body-forge/body-manifest': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/forge-policy': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/forge-recipe': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/forge-record': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/forge-error': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/submit-forge-command': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/forge-completed-event': BODY_FORGE_SCHEMA_VERSION,
  'body-forge/schema-registry': BODY_FORGE_SCHEMA_VERSION,
} as const);

export type BodyForgeSchemaName = keyof typeof BODY_FORGE_SCHEMAS;

/** Resolve a body-forge schema name to its SchemaRef. */
export function bodyForgeSchemaRef(name: BodyForgeSchemaName): SchemaRef {
  const version = BODY_FORGE_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown body-forge protocol schema: ${String(name)}`,
      details: { known: Object.keys(BODY_FORGE_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a body-forge schema at the registered version. */
export function isKnownBodyForgeSchema(ref: SchemaRef): boolean {
  const registered = (BODY_FORGE_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The digest refs of one forge request. */
export interface SubmitForgeCommandPayload {
  /** Digest of the BodyManifest to compose. */
  readonly manifestDigest: string;
  /** Digest of the ForgePolicy to apply. */
  readonly policyDigest: string;
}

/** The fabric's authoritative result: the frozen, content-addressed forge record (digest) + emitted version. */
export interface ForgeCompletedEventPayload {
  readonly forgeRecordDigest: string;
  readonly bodyVersionDigest: string;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface BodyForgeEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(context: BodyForgeEnvelopeContext): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function makeSubmitForgeCommand(
  payload: SubmitForgeCommandPayload,
  context: BodyForgeEnvelopeContext,
): Envelope<SubmitForgeCommandPayload> {
  if (typeof payload.manifestDigest !== 'string' || !DIGEST_PATTERN.test(payload.manifestDigest)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_DIGEST, {
      message: 'submit-forge command payload requires a valid content digest in manifestDigest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (typeof payload.policyDigest !== 'string' || !DIGEST_PATTERN.test(payload.policyDigest)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_DIGEST, {
      message: 'submit-forge command payload requires a valid content digest in policyDigest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: bodyForgeSchemaRef('body-forge/submit-forge-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeForgeCompletedEvent(
  payload: ForgeCompletedEventPayload,
  context: BodyForgeEnvelopeContext,
): Envelope<ForgeCompletedEventPayload> {
  if (typeof payload.forgeRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.forgeRecordDigest)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_DIGEST, {
      message: 'forge-completed event payload requires a valid forge-record digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (typeof payload.bodyVersionDigest !== 'string' || !DIGEST_PATTERN.test(payload.bodyVersionDigest)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_DIGEST, {
      message: 'forge-completed event payload requires a valid body-version digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: bodyForgeSchemaRef('body-forge/forge-completed-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors the
    // sibling protocols' event wiring).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a body-forge
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseBodyForgeEnvelope<T>(
  raw: string,
  expectedSchema?: BodyForgeSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref = typeof expectedSchema === 'string' ? bodyForgeSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a body-forge envelope. */
export async function bodyForgeEnvelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a body-forge envelope and assert that its canonical
 * digest equals `expectedDigest` — the tamper tripwire for wire
 * messages. Throws BODY_FORGE_TAMPERED on any mismatch.
 */
export async function checkBodyForgeEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.TAMPERED, {
      message: `body-forge envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
