/**
 * Envelope wiring for the body-registry protocol (architecture-lock
 * rules 17, 18, 22; Work Order A024 — mirrors the sibling envelope
 * patterns: @arena/body-forge, @arena/certification).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages
 * carry a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `body-registry`
 * namespace (arena:schema/body-registry/<name>@<major.minor.patch>).
 *
 * CONTRACTS DISCLOSURE (A024): Work Order A024 owns NO contracts/
 * surface (spec/work-items.md: packages/body-registry/*,
 * services/body-registry/* only), following the A019/A021/A022
 * precedent. The choice made here: schemas live INSIDE the package as
 * SchemaRef-referenced data — the registry below is the authority for
 * the body-registry namespace, and existing contracts are NOT
 * redeclared. There is deliberately no scripts/generate-contracts.mjs
 * and no contracts/body-registry/ directory (governance G9
 * auto-discovers package-level generators; this package ships none, so
 * it contributes no contract surface).
 *
 * Wire messages:
 *   - register-release-command / release-registered-event
 *     (registering one release: the command carries the release
 *     candidate + version assignment + channel/tags; the event carries
 *     the registry's authoritative, content-addressed ReleaseRecord
 *     digest plus the citable release artifact ref; the command's
 *     idempotency key + candidate tuple is the idempotent registration
 *     address);
 *   - publish-release-command / release-published-event
 *     (publishing one registered release: the command carries the
 *     registration record digest + publisher + rights + timestamp; the
 *     event carries the content-addressed publication record digest
 *     plus the citable release artifact ref).
 */

import { envelopeDigest, makeEnvelope, parseEnvelopeAs } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';
import { isReleaseChannel } from './gate.js';
import { isReleaseArtifactRef } from './record.js';
import { isContentDigest, isReleaseTag } from './shared.js';

export const BODY_REGISTRY_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/body-registry (in-package
 * SchemaRef-referenced data — see the contracts disclosure above).
 */
export const BODY_REGISTRY_SCHEMAS = Object.freeze({
  'body-registry/release-record': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/release-publication': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/release-gate-rejection': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/release-error': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/register-release-command': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/release-registered-event': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/publish-release-command': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/release-published-event': BODY_REGISTRY_SCHEMA_VERSION,
  'body-registry/schema-registry': BODY_REGISTRY_SCHEMA_VERSION,
} as const);

export type BodyRegistrySchemaName = keyof typeof BODY_REGISTRY_SCHEMAS;

/** Resolve a body-registry schema name to its SchemaRef. */
export function bodyRegistrySchemaRef(name: BodyRegistrySchemaName): SchemaRef {
  const version = BODY_REGISTRY_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown body-registry protocol schema: ${String(name)}`,
      details: { known: Object.keys(BODY_REGISTRY_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a body-registry schema at the registered version. */
export function isKnownBodyRegistrySchema(ref: SchemaRef): boolean {
  const registered = (BODY_REGISTRY_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The release candidate + version assignment one registration carries. */
export interface RegisterReleaseCommandPayload {
  /** The body version to register for release (A003 content-addressed ref). */
  readonly bodyVersionRef: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The assigned release version (semver, no build metadata). */
  readonly releaseVersion: string;
  /** The release channel (closed vocabulary). */
  readonly channel: string;
  /** Immutable release tags. */
  readonly tags: readonly string[];
  /** Digests of the cited A023 CertificationRecords. */
  readonly certificationRefs: readonly string[];
  /** Digests of the cited A022 CompatibilityRecords. */
  readonly compatibilityRefs: readonly string[];
  /** Optional digest of the cited A021 ForgeRecord (provenance). */
  readonly forgeRecordDigest: string | null;
}

/** The registry's authoritative result: the frozen registration record. */
export interface ReleaseRegisteredEventPayload {
  /** Digest of the authoritative, content-addressed ReleaseRecord. */
  readonly releaseRecordDigest: string;
  /** The citable, content-addressed release artifact ref. */
  readonly release: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
}

/** The publication request: which registration becomes citable. */
export interface PublishReleaseCommandPayload {
  /** Digest of the registration record being published. */
  readonly releaseRecordDigest: string;
  /** The tenant-scoped principal performing the publication. */
  readonly publisher: {
    readonly type: string;
    readonly tenant: string;
    readonly principalId: string;
  };
  /** MANDATORY rights metadata (lock rule 23). */
  readonly rights: unknown;
  /** The publication timestamp (caller-supplied; reproducible). */
  readonly publishedAt: string;
}

/** The publication result: the content-addressed publication record. */
export interface ReleasePublishedEventPayload {
  /** Digest of the content-addressed ReleasePublicationRecord. */
  readonly publicationRecordDigest: string;
  /** The citable, content-addressed release artifact ref. */
  readonly release: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface BodyRegistryEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(context: BodyRegistryEnvelopeContext): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function requireDigestList(
  values: readonly string[],
  field: string,
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: `register-release command payload: ${field} must be an array of content digests`,
    });
  }
  for (const value of values) {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
        message: `register-release command payload: ${field} entry is not a valid content digest: ${JSON.stringify(value)}`,
        details: { pattern: '^[0-9a-f]{64}$' },
      });
    }
  }
  return values;
}

function requireArtifactRef(
  value: { namespace: string; name: string; version: string; digest: string },
  context: string,
): void {
  if (!isReleaseArtifactRef(value)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_REF, {
      message: `${context}: not a valid release artifact ref: ${JSON.stringify(value)}`,
    });
  }
}

export function makeRegisterReleaseCommand(
  payload: RegisterReleaseCommandPayload,
  context: BodyRegistryEnvelopeContext,
): Envelope<RegisterReleaseCommandPayload> {
  const ref = payload.bodyVersionRef;
  if (
    typeof ref !== 'object' ||
    ref === null ||
    typeof ref.tenant !== 'string' ||
    typeof ref.name !== 'string' ||
    typeof ref.version !== 'string' ||
    typeof ref.digest !== 'string' ||
    !DIGEST_PATTERN.test(ref.digest)
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_REF, {
      message: 'register-release command payload requires a valid body-version ref',
    });
  }
  if (typeof payload.releaseVersion !== 'string' || payload.releaseVersion.length === 0) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'register-release command payload requires a release version',
    });
  }
  if (!isReleaseChannel(payload.channel)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CHANNEL, {
      message: `register-release command payload requires a known release channel, got: ${JSON.stringify(payload.channel)}`,
      details: { channels: ['development', 'candidate', 'stable'] },
    });
  }
  if (!Array.isArray(payload.tags) || !payload.tags.every((tag) => isReleaseTag(tag))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
      message: 'register-release command payload tags must be valid release tags',
    });
  }
  if (!Array.isArray(payload.certificationRefs) || payload.certificationRefs.length === 0) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload requires at least one certification citation (the gate is never a rubber stamp)',
    });
  }
  requireDigestList(payload.certificationRefs, 'certificationRefs');
  if (!Array.isArray(payload.compatibilityRefs) || payload.compatibilityRefs.length === 0) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload requires at least one compatibility citation (the gate is never a rubber stamp)',
    });
  }
  requireDigestList(payload.compatibilityRefs, 'compatibilityRefs');
  if (
    payload.forgeRecordDigest !== null &&
    (typeof payload.forgeRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.forgeRecordDigest))
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload forgeRecordDigest must be a valid content digest or null',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: bodyRegistrySchemaRef('body-registry/register-release-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeReleaseRegisteredEvent(
  payload: ReleaseRegisteredEventPayload,
  context: BodyRegistryEnvelopeContext,
): Envelope<ReleaseRegisteredEventPayload> {
  if (typeof payload.releaseRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.releaseRecordDigest)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_DIGEST, {
      message: 'release-registered event payload requires a valid release-record digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  requireArtifactRef(payload.release, 'release-registered event payload release');
  return makeEnvelope({
    kind: 'event',
    schema: bodyRegistrySchemaRef('body-registry/release-registered-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makePublishReleaseCommand(
  payload: PublishReleaseCommandPayload,
  context: BodyRegistryEnvelopeContext,
): Envelope<PublishReleaseCommandPayload> {
  if (typeof payload.releaseRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.releaseRecordDigest)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_DIGEST, {
      message: 'publish-release command payload requires a valid release-record digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (
    typeof payload.publisher !== 'object' ||
    payload.publisher === null ||
    typeof payload.publisher.type !== 'string' ||
    typeof payload.publisher.tenant !== 'string' ||
    typeof payload.publisher.principalId !== 'string'
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
      message: 'publish-release command payload requires a valid publisher principal',
    });
  }
  if (typeof payload.publishedAt !== 'string' || Number.isNaN(Date.parse(payload.publishedAt))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'publish-release command payload requires a valid publication timestamp',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: bodyRegistrySchemaRef('body-registry/publish-release-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeReleasePublishedEvent(
  payload: ReleasePublishedEventPayload,
  context: BodyRegistryEnvelopeContext,
): Envelope<ReleasePublishedEventPayload> {
  if (typeof payload.publicationRecordDigest !== 'string' || !DIGEST_PATTERN.test(payload.publicationRecordDigest)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_DIGEST, {
      message: 'release-published event payload requires a valid publication-record digest',
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  requireArtifactRef(payload.release, 'release-published event payload release');
  return makeEnvelope({
    kind: 'event',
    schema: bodyRegistrySchemaRef('body-registry/release-published-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a body-registry
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseBodyRegistryEnvelope<T>(
  raw: string,
  expectedSchema?: BodyRegistrySchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref = typeof expectedSchema === 'string' ? bodyRegistrySchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/**
 * Parse and validate a register-release command envelope (schema-pinned,
 * payload-shape-checked, command idempotency key REQUIRED by the core).
 */
export function parseRegisterReleaseCommand(
  raw: string,
): Envelope<RegisterReleaseCommandPayload> {
  const envelope = parseEnvelopeAs<RegisterReleaseCommandPayload>(
    raw,
    bodyRegistrySchemaRef('body-registry/register-release-command'),
  );
  makeRegisterReleaseCommandShapeCheck(envelope.payload);
  return envelope;
}

function makeRegisterReleaseCommandShapeCheck(payload: unknown): void {
  const candidate = payload as Record<string, unknown>;
  const ref = candidate['bodyVersionRef'];
  if (
    typeof ref !== 'object' ||
    ref === null ||
    typeof (ref as Record<string, unknown>)['tenant'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['name'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['version'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['digest'] !== 'string' ||
    !DIGEST_PATTERN.test((ref as Record<string, unknown>)['digest'] as string)
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_REF, {
      message: 'register-release command payload requires a valid body-version ref',
    });
  }
  if (typeof candidate['releaseVersion'] !== 'string' || (candidate['releaseVersion'] as string).length === 0) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'register-release command payload requires a release version',
    });
  }
  if (!isReleaseChannel(candidate['channel'])) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CHANNEL, {
      message: `register-release command payload requires a known release channel, got: ${JSON.stringify(candidate['channel'])}`,
    });
  }
  const tags = candidate['tags'];
  if (!Array.isArray(tags) || !tags.every((tag) => isReleaseTag(tag))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
      message: 'register-release command payload tags must be valid release tags',
    });
  }
  const certs = candidate['certificationRefs'];
  if (!Array.isArray(certs) || certs.length === 0 || !certs.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload requires at least one valid certification citation',
    });
  }
  const comps = candidate['compatibilityRefs'];
  if (!Array.isArray(comps) || comps.length === 0 || !comps.every((entry) => typeof entry === 'string' && DIGEST_PATTERN.test(entry))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload requires at least one valid compatibility citation',
    });
  }
  const forge = candidate['forgeRecordDigest'];
  if (forge !== null && (typeof forge !== 'string' || !DIGEST_PATTERN.test(forge))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_CITATION, {
      message: 'register-release command payload forgeRecordDigest must be a valid content digest or null',
    });
  }
}

/** Parse and validate a release-registered event envelope. */
export function parseReleaseRegisteredEvent(
  raw: string,
): Envelope<ReleaseRegisteredEventPayload> {
  const envelope = parseEnvelopeAs<ReleaseRegisteredEventPayload>(
    raw,
    bodyRegistrySchemaRef('body-registry/release-registered-event'),
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.releaseRecordDigest !== 'string' ||
    !DIGEST_PATTERN.test(payload.releaseRecordDigest) ||
    !isReleaseArtifactRef(payload.release) ||
    !isContentDigest(payload.release.digest)
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'release-registered event payload failed validation',
    });
  }
  return envelope;
}

/**
 * Parse and validate a publish-release command envelope (schema-pinned,
 * payload-shape-checked, command idempotency key REQUIRED by the core).
 */
export function parsePublishReleaseCommand(
  raw: string,
): Envelope<PublishReleaseCommandPayload> {
  const envelope = parseEnvelopeAs<PublishReleaseCommandPayload>(
    raw,
    bodyRegistrySchemaRef('body-registry/publish-release-command'),
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.releaseRecordDigest !== 'string' ||
    !DIGEST_PATTERN.test(payload.releaseRecordDigest)
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_DIGEST, {
      message: 'publish-release command payload requires a valid release-record digest',
    });
  }
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const publisher = payloadRecord['publisher'];
  if (
    typeof publisher !== 'object' ||
    publisher === null ||
    typeof (publisher as Record<string, unknown>)['type'] !== 'string' ||
    typeof (publisher as Record<string, unknown>)['tenant'] !== 'string' ||
    typeof (publisher as Record<string, unknown>)['principalId'] !== 'string'
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
      message: 'publish-release command payload requires a valid publisher principal',
    });
  }
  const publishedAt = (payload as unknown as Record<string, unknown>)['publishedAt'];
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'publish-release command payload requires a valid publication timestamp',
    });
  }
  return envelope;
}

/** Parse and validate a release-published event envelope. */
export function parseReleasePublishedEvent(
  raw: string,
): Envelope<ReleasePublishedEventPayload> {
  const envelope = parseEnvelopeAs<ReleasePublishedEventPayload>(
    raw,
    bodyRegistrySchemaRef('body-registry/release-published-event'),
  );
  const payload = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.publicationRecordDigest !== 'string' ||
    !DIGEST_PATTERN.test(payload.publicationRecordDigest) ||
    !isReleaseArtifactRef(payload.release) ||
    !isContentDigest(payload.release.digest)
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'release-published event payload failed validation',
    });
  }
  return envelope;
}

/** sha256 digest over the canonical serialization of a body-registry envelope. */
export async function bodyRegistryEnvelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a body-registry envelope and assert that its canonical
 * digest equals `expectedDigest` — the tamper tripwire for wire
 * messages. Throws BODY_REGISTRY_TAMPERED on any mismatch.
 */
export async function checkBodyRegistryEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.TAMPERED, {
      message: `body-registry envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
