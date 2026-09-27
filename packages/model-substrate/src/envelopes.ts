/**
 * Envelope wiring for the model substrate protocol (architecture-lock
 * rules 17, 18, 22). Every wire shape travels inside @arena/protocol-core's
 * Envelope<T>: commands carry a REQUIRED non-null idempotency key (lock
 * rule 17 — long-running jobs are idempotent and correlation-addressable),
 * all messages carry a correlation id, payloads are canonical-JSON
 * serializable and digest-verifiable, and unknown envelope versions are
 * rejected by the core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `model-substrate`
 * namespace (arena:schema/model-substrate/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/model-substrate/ (see
 * packages/model-substrate/scripts/generate-contracts.mjs — the
 * package-level generator; governance G9 runs every package-level
 * generator with --check, so this package's contracts are governed
 * centrally without any root-file edit).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { MODEL_SUBSTRATE_ERROR_CODES, ModelSubstrateError } from './errors.js';
import type { SubstrateRegistration } from './registry.js';
import { isSubstrateRegistration } from './registry.js';
import type { SubstrateUpgrade } from './upgrade.js';
import { isSubstrateUpgrade } from './upgrade.js';
import type { SubstrateCompatibilityResult } from './compatibility.js';
import { isSubstrateCompatibilityResult } from './compatibility.js';
import { MODEL_SUBSTRATE_PROTOCOL_VERSION } from './version.js';

export const MODEL_SUBSTRATE_SCHEMA_VERSION = MODEL_SUBSTRATE_PROTOCOL_VERSION;

/**
 * Registry of the schemas owned by @arena/model-substrate. Mirrored by the
 * generated contract model-substrate/model-substrate-schema-registry.v1.json
 * (parity asserted in contracts.parity.test.ts).
 */
export const MODEL_SUBSTRATE_SCHEMAS = Object.freeze({
  'model-substrate/adapter-descriptor': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-registration-descriptor': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-record': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/capability-profile': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/adapter-health': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-registration': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-registry': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/compatibility-test': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/compatibility-result': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-upgrade': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/model-substrate-error': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/register-substrate-command': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/declare-substrate-upgrade-command': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/record-compatibility-result-command': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-registered-event': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/substrate-upgrade-declared-event': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/compatibility-result-recorded-event': MODEL_SUBSTRATE_SCHEMA_VERSION,
  'model-substrate/schema-registry': MODEL_SUBSTRATE_SCHEMA_VERSION,
} as const);

export type ModelSubstrateSchemaName = keyof typeof MODEL_SUBSTRATE_SCHEMAS;

/** Resolve a model-substrate schema name to its SchemaRef. */
export function modelSubstrateSchemaRef(name: ModelSubstrateSchemaName): SchemaRef {
  const version = MODEL_SUBSTRATE_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown model substrate schema: ${String(name)}`,
      details: { known: Object.keys(MODEL_SUBSTRATE_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a model-substrate schema at the registered version. */
export function isKnownModelSubstrateSchema(ref: SchemaRef): boolean {
  const registered = (MODEL_SUBSTRATE_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RegisterSubstrateCommandPayload {
  readonly registration: SubstrateRegistration;
}

export interface DeclareSubstrateUpgradeCommandPayload {
  readonly upgrade: SubstrateUpgrade;
}

export interface RecordCompatibilityResultCommandPayload {
  readonly result: SubstrateCompatibilityResult;
}

export interface SubstrateRegisteredEventPayload {
  readonly registration: SubstrateRegistration;
}

export interface SubstrateUpgradeDeclaredEventPayload {
  readonly upgrade: SubstrateUpgrade;
}

export interface CompatibilityResultRecordedEventPayload {
  readonly result: SubstrateCompatibilityResult;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface ModelSubstrateEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireIdempotencyKey(
  context: ModelSubstrateEnvelopeContext,
  surface: string,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_REGISTRATION, {
      message: `command envelopes require an idempotency key (architecture-lock rule 17): ${surface}`,
    });
  }
  return context.idempotencyKey;
}

export function makeRegisterSubstrateCommand(
  payload: RegisterSubstrateCommandPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<RegisterSubstrateCommandPayload> {
  if (!isSubstrateRegistration(payload.registration)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_REGISTRATION, {
      message: 'register-substrate command payload requires a structurally valid substrate registration',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: modelSubstrateSchemaRef('model-substrate/register-substrate-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context, 'register-substrate'),
    payload,
  });
}

export function makeDeclareSubstrateUpgradeCommand(
  payload: DeclareSubstrateUpgradeCommandPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<DeclareSubstrateUpgradeCommandPayload> {
  if (!isSubstrateUpgrade(payload.upgrade)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_UPGRADE, {
      message: 'declare-substrate-upgrade command payload requires a structurally valid substrate upgrade',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: modelSubstrateSchemaRef('model-substrate/declare-substrate-upgrade-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context, 'declare-substrate-upgrade'),
    payload,
  });
}

export function makeRecordCompatibilityResultCommand(
  payload: RecordCompatibilityResultCommandPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<RecordCompatibilityResultCommandPayload> {
  if (!isSubstrateCompatibilityResult(payload.result)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_COMPATIBILITY_RESULT, {
      message: 'record-compatibility-result command payload requires a structurally valid compatibility result',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: modelSubstrateSchemaRef('model-substrate/record-compatibility-result-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireIdempotencyKey(context, 'record-compatibility-result'),
    payload,
  });
}

export function makeSubstrateRegisteredEvent(
  payload: SubstrateRegisteredEventPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<SubstrateRegisteredEventPayload> {
  if (!isSubstrateRegistration(payload.registration)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_REGISTRATION, {
      message: 'substrate-registered event payload requires a structurally valid substrate registration',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: modelSubstrateSchemaRef('model-substrate/substrate-registered-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeSubstrateUpgradeDeclaredEvent(
  payload: SubstrateUpgradeDeclaredEventPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<SubstrateUpgradeDeclaredEventPayload> {
  if (!isSubstrateUpgrade(payload.upgrade)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_UPGRADE, {
      message: 'substrate-upgrade-declared event payload requires a structurally valid substrate upgrade',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: modelSubstrateSchemaRef('model-substrate/substrate-upgrade-declared-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeCompatibilityResultRecordedEvent(
  payload: CompatibilityResultRecordedEventPayload,
  context: ModelSubstrateEnvelopeContext,
): Envelope<CompatibilityResultRecordedEventPayload> {
  if (!isSubstrateCompatibilityResult(payload.result)) {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.INVALID_COMPATIBILITY_RESULT, {
      message: 'compatibility-result-recorded event payload requires a structurally valid compatibility result',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: modelSubstrateSchemaRef('model-substrate/compatibility-result-recorded-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a model-substrate
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseModelSubstrateEnvelope<T>(
  raw: string,
  expectedSchema?: ModelSubstrateSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? modelSubstrateSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a model-substrate envelope. */
export async function modelSubstrateEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid envelope whose canonical digest equals
 * `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any mismatch — the core
 * tamper tripwire, reused verbatim).
 */
export async function verifyModelSubstrateEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
