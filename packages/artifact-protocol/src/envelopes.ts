/**
 * Envelope wiring for the artifact protocol (architecture-lock rules 17, 18,
 * 22). Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and digest-
 * verifiable, and unknown envelope versions are rejected by the core parser
 * (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned as SchemaRefs in the `artifacts` namespace
 * (arena:schema/artifacts/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/artifacts/ (see
 * packages/artifact-protocol/scripts/generate-contracts.mjs).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import type { MaterialArtifact } from './artifact.js';
import { isMaterialArtifact } from './artifact.js';
import type { PrincipalRef } from './principal.js';
import { isPrincipalRef } from './principal.js';
import type { PublicationRecord } from './publication.js';
import { isPublicationRecord } from './publication.js';
import type { RightsMetadata } from './rights.js';
import { isRightsMetadata } from './rights.js';
import type { ContentDigest } from './content-digest.js';
import { isContentDigest } from './content-digest.js';

export const ARTIFACT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/artifact-protocol. Mirrored by the
 * generated contract artifacts/schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const ARTIFACT_SCHEMAS = {
  'artifacts/artifact-identity': ARTIFACT_SCHEMA_VERSION,
  'artifacts/artifact-ref': ARTIFACT_SCHEMA_VERSION,
  'artifacts/content-digest': ARTIFACT_SCHEMA_VERSION,
  'artifacts/material-artifact': ARTIFACT_SCHEMA_VERSION,
  'artifacts/principal': ARTIFACT_SCHEMA_VERSION,
  'artifacts/rights': ARTIFACT_SCHEMA_VERSION,
  'artifacts/timestamp': ARTIFACT_SCHEMA_VERSION,
  'artifacts/publication': ARTIFACT_SCHEMA_VERSION,
  'artifacts/publication-ledger': ARTIFACT_SCHEMA_VERSION,
  'artifacts/artifact-error': ARTIFACT_SCHEMA_VERSION,
  'artifacts/publish-artifact-command': ARTIFACT_SCHEMA_VERSION,
  'artifacts/retract-publication-command': ARTIFACT_SCHEMA_VERSION,
  'artifacts/artifact-published-event': ARTIFACT_SCHEMA_VERSION,
  'artifacts/schema-registry': ARTIFACT_SCHEMA_VERSION,
} as const;

export type ArtifactSchemaName = keyof typeof ARTIFACT_SCHEMAS;

/** Resolve an artifact-protocol schema name to its SchemaRef. */
export function artifactSchemaRef(name: ArtifactSchemaName): SchemaRef {
  const version = ARTIFACT_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown artifact protocol schema: ${String(name)}`,
      details: { known: Object.keys(ARTIFACT_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an artifact-protocol schema at the registered version. */
export function isKnownArtifactSchema(ref: SchemaRef): boolean {
  const registered = (ARTIFACT_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PublishArtifactCommandPayload {
  readonly artifact: MaterialArtifact<unknown>;
  readonly publisher: PrincipalRef;
  readonly rights: RightsMetadata;
}

export interface RetractPublicationCommandPayload {
  readonly publicationDigest: ContentDigest;
  readonly publisher: PrincipalRef;
}

export interface ArtifactPublishedEventPayload {
  readonly publication: PublicationRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface ArtifactEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

export function makePublishArtifactCommand(
  payload: PublishArtifactCommandPayload,
  context: ArtifactEnvelopeContext,
): Envelope<PublishArtifactCommandPayload> {
  if (!isMaterialArtifact(payload.artifact)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'publish-artifact command payload requires a structurally valid artifact',
    });
  }
  if (!isPrincipalRef(payload.publisher)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: 'publish-artifact command payload requires a valid publisher principal',
    });
  }
  if (!isRightsMetadata(payload.rights)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.MISSING_RIGHTS, {
      message: 'publish-artifact command payload requires explicit rights metadata',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: artifactSchemaRef('artifacts/publish-artifact-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeRetractPublicationCommand(
  payload: RetractPublicationCommandPayload,
  context: ArtifactEnvelopeContext,
): Envelope<RetractPublicationCommandPayload> {
  if (!isContentDigest(payload.publicationDigest)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_DIGEST, {
      message: 'retract-publication command payload requires a valid publication record digest',
    });
  }
  if (!isPrincipalRef(payload.publisher)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: 'retract-publication command payload requires a valid publisher principal',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: artifactSchemaRef('artifacts/retract-publication-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeArtifactPublishedEvent(
  payload: ArtifactPublishedEventPayload,
  context: ArtifactEnvelopeContext,
): Envelope<ArtifactPublishedEventPayload> {
  if (!isPublicationRecord(payload.publication)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'artifact-published event payload requires a structurally valid publication record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: artifactSchemaRef('artifacts/artifact-published-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an artifact-protocol
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseArtifactEnvelope<T>(
  raw: string,
  expectedSchema?: ArtifactSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? artifactSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an artifact-protocol envelope. */
export async function artifactEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid artifact-protocol envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on
 * any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyArtifactEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
