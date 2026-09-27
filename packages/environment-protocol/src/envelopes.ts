/**
 * Envelope wiring for the environment protocol (architecture-lock rules
 * 17, 18, 22; Work Order A009 gate 8 — mirrors @arena/artifact-protocol's
 * envelope patterns exactly).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-verifiable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned as SchemaRefs in the `environment`
 * namespace (arena:schema/environment/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/environment/ (see
 * packages/environment-protocol/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - register-environment-command / environment-registered-event
 *     (registering a versioned, content-addressed environment definition);
 *   - admit-workload-command / workload-admitted-event
 *     (admitting a workload declaration against a registered environment
 *     version — the runner performs assertLeastPrivilege before emitting
 *     the event).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { EnvironmentDefinition } from './definition.js';
import { isEnvironmentDefinition } from './definition.js';
import type { EnvironmentVersionRef } from './definition.js';
import { isEnvironmentVersionRef } from './definition.js';
import type { WorkloadDeclaration } from './workload.js';
import { isWorkloadDeclaration } from './workload.js';

export const ENVIRONMENT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/environment-protocol. Mirrored
 * by the generated contract environment-schema-registry.v1.json (parity
 * asserted in contracts.parity.test.ts).
 */
export const ENVIRONMENT_SCHEMAS = Object.freeze({
  'environment/environment-definition': ENVIRONMENT_SCHEMA_VERSION,
  'environment/environment-version-ref': ENVIRONMENT_SCHEMA_VERSION,
  'environment/environment-image': ENVIRONMENT_SCHEMA_VERSION,
  'environment/state-snapshot': ENVIRONMENT_SCHEMA_VERSION,
  'environment/seed-policy': ENVIRONMENT_SCHEMA_VERSION,
  'environment/reproducibility-profile': ENVIRONMENT_SCHEMA_VERSION,
  'environment/action-surface': ENVIRONMENT_SCHEMA_VERSION,
  'environment/observation-surface': ENVIRONMENT_SCHEMA_VERSION,
  'environment/resource-limits': ENVIRONMENT_SCHEMA_VERSION,
  'environment/network-policy': ENVIRONMENT_SCHEMA_VERSION,
  'environment/filesystem-policy': ENVIRONMENT_SCHEMA_VERSION,
  'environment/secret-policy': ENVIRONMENT_SCHEMA_VERSION,
  'environment/time-limits': ENVIRONMENT_SCHEMA_VERSION,
  'environment/reset-semantics': ENVIRONMENT_SCHEMA_VERSION,
  'environment/checkpoint-semantics': ENVIRONMENT_SCHEMA_VERSION,
  'environment/evidence-outputs': ENVIRONMENT_SCHEMA_VERSION,
  'environment/evaluation-hooks': ENVIRONMENT_SCHEMA_VERSION,
  'environment/run-address': ENVIRONMENT_SCHEMA_VERSION,
  'environment/task-version-ref': ENVIRONMENT_SCHEMA_VERSION,
  'environment/workload-declaration': ENVIRONMENT_SCHEMA_VERSION,
  'environment/environment-error': ENVIRONMENT_SCHEMA_VERSION,
  'environment/register-environment-command': ENVIRONMENT_SCHEMA_VERSION,
  'environment/environment-registered-event': ENVIRONMENT_SCHEMA_VERSION,
  'environment/admit-workload-command': ENVIRONMENT_SCHEMA_VERSION,
  'environment/workload-admitted-event': ENVIRONMENT_SCHEMA_VERSION,
  'environment/schema-registry': ENVIRONMENT_SCHEMA_VERSION,
} as const);

export type EnvironmentSchemaName = keyof typeof ENVIRONMENT_SCHEMAS;

/** Resolve an environment-protocol schema name to its SchemaRef. */
export function environmentSchemaRef(name: EnvironmentSchemaName): SchemaRef {
  const version = ENVIRONMENT_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown environment protocol schema: ${String(name)}`,
      details: { known: Object.keys(ENVIRONMENT_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an environment-protocol schema at the registered version. */
export function isKnownEnvironmentSchema(ref: SchemaRef): boolean {
  const registered = (ENVIRONMENT_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface RegisterEnvironmentCommandPayload {
  readonly environment: EnvironmentDefinition;
}

export interface EnvironmentRegisteredEventPayload {
  readonly environment: EnvironmentVersionRef;
}

export interface AdmitWorkloadCommandPayload {
  readonly environment: EnvironmentVersionRef;
  readonly workload: WorkloadDeclaration;
}

export interface WorkloadAdmittedEventPayload {
  readonly environment: EnvironmentVersionRef;
  readonly workload: WorkloadDeclaration;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface EnvironmentEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

export function makeRegisterEnvironmentCommand(
  payload: RegisterEnvironmentCommandPayload,
  context: EnvironmentEnvelopeContext,
): Envelope<RegisterEnvironmentCommandPayload> {
  if (!isEnvironmentDefinition(payload.environment)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, {
      message:
        'register-environment command payload requires a structurally valid environment definition',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: environmentSchemaRef('environment/register-environment-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeAdmitWorkloadCommand(
  payload: AdmitWorkloadCommandPayload,
  context: EnvironmentEnvelopeContext,
): Envelope<AdmitWorkloadCommandPayload> {
  if (!isEnvironmentVersionRef(payload.environment)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message:
        'admit-workload command payload requires a structurally valid environment version ref',
    });
  }
  if (!isWorkloadDeclaration(payload.workload)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message:
        'admit-workload command payload requires a structurally valid workload declaration',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: environmentSchemaRef('environment/admit-workload-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
  });
}

export function makeEnvironmentRegisteredEvent(
  payload: EnvironmentRegisteredEventPayload,
  context: EnvironmentEnvelopeContext,
): Envelope<EnvironmentRegisteredEventPayload> {
  if (!isEnvironmentVersionRef(payload.environment)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message:
        'environment-registered event payload requires a structurally valid environment version ref',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: environmentSchemaRef('environment/environment-registered-event'),
    correlationId: context.correlationId,
    payload,
  });
}

export function makeWorkloadAdmittedEvent(
  payload: WorkloadAdmittedEventPayload,
  context: EnvironmentEnvelopeContext,
): Envelope<WorkloadAdmittedEventPayload> {
  if (!isEnvironmentVersionRef(payload.environment)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message:
        'workload-admitted event payload requires a structurally valid environment version ref',
    });
  }
  if (!isWorkloadDeclaration(payload.workload)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_WORKLOAD, {
      message: 'workload-admitted event payload requires a structurally valid workload declaration',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: environmentSchemaRef('environment/workload-admitted-event'),
    correlationId: context.correlationId,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an
 * environment-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseEnvironmentEnvelope<T>(
  raw: string,
  expectedSchema?: EnvironmentSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? environmentSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an environment-protocol envelope. */
export async function environmentEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid environment-protocol envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on
 * any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyEnvironmentEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}
