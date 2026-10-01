/**
 * Envelope wiring for the entitlements package (Work Order A033;
 * requirements R34, R48; architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and digest-
 * verifiable, and unknown envelope versions are rejected by the core
 * parser (PROTOCOL_UNSUPPORTED_VERSION) — mirroring
 * @arena/job-protocol's envelope patterns exactly (the A015 discipline
 * these usage-meter events ride).
 *
 * Payload schemas are versioned SchemaRefs in the `entitlements`
 * namespace (arena:schema/entitlements/<name>@<major.minor.patch>).
 *
 * CONTRACTS DISCLOSURE (A033, following the A034/A019/A022 precedent):
 * Work Order A033 owns NO contracts/ surface (spec/work-items.md:
 * services/billing/*, packages/entitlements/* only). The choice made here:
 * schemas live INSIDE the package as SchemaRef-referenced data — the
 * registry below is the authority for the entitlements namespace, and
 * existing contracts are NOT redeclared. There is deliberately no
 * scripts/generate-contracts.mjs and no contracts/entitlements directory
 * (governance G9 auto-discovers package-level generators; this package
 * ships none, so it contributes no contract surface).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { ENTITLEMENT_ERROR_CODES, EntitlementError } from './errors.js';
import type { UsageMeterEvent, UsageRecordedEvent, UsageRevisedEvent } from './usage-meter.js';
import { isUsageMeterEvent } from './usage-meter.js';
import {
  isFeatureKey,
  isPositiveInteger,
  isTenantId,
  isUsageId,
} from './shared.js';
import { MAX_METER_UNITS } from './shared.js';

export const ENTITLEMENT_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/entitlements. The authority for
 * the entitlements namespace (see the CONTRACTS DISCLOSURE above).
 */
export const ENTITLEMENT_SCHEMAS = Object.freeze({
  'entitlements/entitlement-grant': ENTITLEMENT_SCHEMA_VERSION,
  'entitlements/usage-recorded-event': ENTITLEMENT_SCHEMA_VERSION,
  'entitlements/usage-revised-event': ENTITLEMENT_SCHEMA_VERSION,
  'entitlements/record-usage-command': ENTITLEMENT_SCHEMA_VERSION,
  'entitlements/schema-registry': ENTITLEMENT_SCHEMA_VERSION,
} as const);

export type EntitlementSchemaName = keyof typeof ENTITLEMENT_SCHEMAS;

/** Resolve an entitlements schema name to its SchemaRef. */
export function entitlementSchemaRef(name: EntitlementSchemaName): SchemaRef {
  const version = ENTITLEMENT_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown entitlements schema: ${String(name)}`,
      details: { known: Object.keys(ENTITLEMENT_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an entitlements schema at the registered version. */
export function isKnownEntitlementSchema(ref: SchemaRef): boolean {
  const registered = (ENTITLEMENT_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

/** Map a usage-meter event kind to its payload schema name. */
export function usageMeterSchemaName(kind: 'usage-recorded' | 'usage-revised'): EntitlementSchemaName {
  switch (kind) {
    case 'usage-recorded':
      return 'entitlements/usage-recorded-event';
    case 'usage-revised':
      return 'entitlements/usage-revised-event';
    default:
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.UNKNOWN_ERROR, {
        message: `unknown usage meter event kind: ${String(kind)}`,
      });
  }
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Payload of the record-usage command (the billing ingestion command). */
export interface RecordUsageCommandPayload {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly units: number;
  readonly jobId?: string;
}

/** Structural (non-throwing) check for the record-usage command payload. */
export function isRecordUsageCommandPayload(value: unknown): value is RecordUsageCommandPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantId(candidate['tenantId']) &&
    isFeatureKey(candidate['featureKey']) &&
    isPositiveInteger(candidate['units']) &&
    (candidate['units'] as number) <= MAX_METER_UNITS &&
    (candidate['jobId'] === undefined || isUsageId(candidate['jobId']))
  );
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface EntitlementEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
  /** Explicit envelope instance id (tests inject deterministic ids). */
  readonly id?: string;
  /** Explicit issuance timestamp (the billing service injects clock time). */
  readonly issuedAt?: string;
}

/**
 * Create the record-usage command envelope (rule 17: idempotent commands).
 * The payload is validated structurally first; the command REQUIRES a
 * non-null idempotency key.
 */
export function makeRecordUsageCommand(
  payload: RecordUsageCommandPayload,
  context: EntitlementEnvelopeContext,
): Envelope<RecordUsageCommandPayload> {
  if (!isRecordUsageCommandPayload(payload)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_COMMAND, {
      message: `record-usage command payload requires a structurally valid tenant id, feature key and units (1..${String(MAX_METER_UNITS)})`,
      details: { maxUnits: MAX_METER_UNITS },
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_COMMAND, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: entitlementSchemaRef('entitlements/record-usage-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/**
 * Wrap a usage-meter event in a versioned event Envelope carrying the
 * flow's correlation id and (optionally) idempotency key. The payload is
 * validated structurally first.
 */
export function makeUsageMeterEventEnvelope(
  event: UsageMeterEvent,
  context: EntitlementEnvelopeContext,
): Envelope<UsageMeterEvent> {
  if (!isUsageMeterEvent(event)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: 'usage meter event envelopes require a structurally valid usage meter event payload',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: entitlementSchemaRef(usageMeterSchemaName(event.kind)),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload: event,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to an entitlements
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseEntitlementEnvelope<T>(
  raw: string,
  expectedSchema?: EntitlementSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string' ? entitlementSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of an entitlements envelope. */
export async function entitlementEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid entitlements envelope whose canonical
 * digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on any
 * mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyEntitlementEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}

/** Extract a usage-recorded event from an envelope (typed accessor). */
export function asUsageRecordedEnvelope(
  envelope: Envelope<UsageMeterEvent>,
): Envelope<UsageRecordedEvent> {
  if (envelope.payload.kind !== 'usage-recorded') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: `expected a usage-recorded envelope, got ${String(envelope.payload.kind)}`,
    });
  }
  return envelope as Envelope<UsageRecordedEvent>;
}

/** Extract a usage-revised event from an envelope (typed accessor). */
export function asUsageRevisedEnvelope(
  envelope: Envelope<UsageMeterEvent>,
): Envelope<UsageRevisedEvent> {
  if (envelope.payload.kind !== 'usage-revised') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: `expected a usage-revised envelope, got ${String(envelope.payload.kind)}`,
    });
  }
  return envelope as Envelope<UsageRevisedEvent>;
}
