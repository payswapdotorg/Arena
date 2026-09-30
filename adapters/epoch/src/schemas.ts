/**
 * Epoch adapter envelope wiring + in-package schema registry
 * (Work Order A026; EPI1.0).
 *
 * CONTRACTS DISCLOSURE (A026): Work Order A026 owns NO contracts/
 * surface (spec/work-items.md: adapters/epoch/* only). Following the
 * A019/A021/A022/A024 precedent, schemas live INSIDE the package as
 * SchemaRef-referenced data — the registry below is the authority for
 * the 'epoch' namespace, and existing contracts are NOT redeclared.
 * There is deliberately no scripts/generate-contracts.mjs and no
 * contracts/epoch/ directory (governance G9 auto-discovers package-level
 * generators under packages/* only; this adapter ships none, so it
 * contributes no contract surface and contracts:generate is a no-op
 * for this package).
 *
 * Commands REQUIRE idempotency keys (architecture-lock rule 17); events
 * carry idempotencyKey: null. Both travel inside @arena/protocol-core's
 * Envelope<T> — never reimplemented.
 */

import {
  makeEnvelope,
  newIdempotencyKey,
  parseEnvelopeAs,
  parseSchemaRef,
  serializeEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { EPOCH_ADAPTER_ERROR_CODES, EpochAdapterError } from './errors.js';
import type { CausationId, EpochJobRecord } from './job.js';
import type { CapabilityDevelopmentRequest } from './request.js';

export const EPOCH_SCHEMA_VERSION = '1.0.0' as const;

export const EPOCH_SCHEMAS = Object.freeze({
  'epoch/capability-development-request': EPOCH_SCHEMA_VERSION,
  'epoch/epoch-job': EPOCH_SCHEMA_VERSION,
  'epoch/output-ref': EPOCH_SCHEMA_VERSION,
  'epoch/authorization-metadata': EPOCH_SCHEMA_VERSION,
  'epoch/error': EPOCH_SCHEMA_VERSION,
  'epoch/run-capability-development-command': EPOCH_SCHEMA_VERSION,
  'epoch/job-completed-event': EPOCH_SCHEMA_VERSION,
  'epoch/schema-registry': EPOCH_SCHEMA_VERSION,
} as const);

export type EpochSchemaName = keyof typeof EPOCH_SCHEMAS;

export function epochSchemaRef(name: EpochSchemaName): ReturnType<typeof parseSchemaRef> {
  return parseSchemaRef(`arena:schema/${name}@${EPOCH_SCHEMA_VERSION}`);
}

export function isKnownEpochSchema(ref: {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}): boolean {
  // Registry keys are '<namespace>/<name>' (the A019/A024 in-package
  // registry convention); a SchemaRef splits that into namespace + name.
  const key = `${ref.namespace}/${ref.name}`;
  return key in EPOCH_SCHEMAS && (EPOCH_SCHEMAS as Record<string, string>)[key] === ref.version;
}

// ---------------------------------------------------------------------------
// Command: run capability development (the EPI1.0 translation trigger)
// ---------------------------------------------------------------------------

export interface EpochCommandContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly causationId?: CausationId;
}

/**
 * Build the command envelope that carries a validated EPI1.0 request to
 * the Arena write surface. Commands REQUIRE an idempotency key — the
 * maker fails closed BEFORE envelope construction.
 */
export function makeRunCapabilityDevelopmentCommand(
  request: CapabilityDevelopmentRequest,
  context: EpochCommandContext,
): Envelope<CapabilityDevelopmentRequest> {
  if (context.idempotencyKey === null || context.idempotencyKey === undefined) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED, {
      message: 'run-capability-development commands REQUIRE an idempotency key',
      correlationId: context.correlationId,
    });
  }
  if (context.correlationId === null || context.correlationId === undefined) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'run-capability-development commands REQUIRE a correlation id',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: epochSchemaRef('epoch/run-capability-development-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload: request,
  });
}

// ---------------------------------------------------------------------------
// Event: job completed (the async outcome signal)
// ---------------------------------------------------------------------------

export function makeJobCompletedEvent(
  job: EpochJobRecord,
  context: { readonly correlationId: CorrelationId },
): Envelope<EpochJobRecord> {
  return makeEnvelope({
    kind: 'event',
    schema: epochSchemaRef('epoch/job-completed-event'),
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload: job,
  });
}

// ---------------------------------------------------------------------------
// Strict parsing (fail-closed: namespace + schema + envelope kind)
// ---------------------------------------------------------------------------

function expectEpochEnvelope<T>(
  raw: string,
  expectedSchema: EpochSchemaName,
  expectedKind: 'command' | 'event',
): Envelope<T> {
  const expectedFormatted = `arena:schema/${expectedSchema}@${EPOCH_SCHEMA_VERSION}`;
  let envelope: Envelope<T>;
  try {
    envelope = parseEnvelopeAs<T>(raw, expectedFormatted);
  } catch (error) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `envelope does not parse as ${expectedSchema}@${EPOCH_SCHEMA_VERSION}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const ref = parseSchemaRef(envelope.schema);
  if (!isKnownEpochSchema(ref)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `envelope schema ${envelope.schema} is not a known epoch schema`,
      details: { namespace: 'epoch', schemas: Object.keys(EPOCH_SCHEMAS) },
    });
  }
  if (envelope.schema !== expectedFormatted) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected schema ${expectedSchema} but envelope carries ${ref.namespace}/${ref.name}`,
      details: { expected: expectedSchema, received: `${ref.namespace}/${ref.name}` },
    });
  }
  if (envelope.kind !== expectedKind) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `epoch schema ${expectedSchema} must travel in a '${expectedKind}' envelope (received '${envelope.kind}')`,
      details: { expected: expectedKind, received: envelope.kind },
    });
  }
  return envelope;
}

export function parseRunCapabilityDevelopmentCommand(
  raw: string,
): Envelope<CapabilityDevelopmentRequest> {
  const envelope = expectEpochEnvelope<CapabilityDevelopmentRequest>(
    raw,
    'epoch/run-capability-development-command',
    'command',
  );
  if (envelope.idempotencyKey === null) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.IDEMPOTENCY_REQUIRED, {
      message: 'commands REQUIRE idempotency keys (architecture-lock rule 17)',
    });
  }
  return envelope;
}

export function parseJobCompletedEvent(raw: string): Envelope<EpochJobRecord> {
  return expectEpochEnvelope<EpochJobRecord>(
    raw,
    'epoch/job-completed-event',
    'event',
  );
}

/** Canonical serialized form (the wire format). */
export function serializeEpochEnvelope(envelope: Envelope<unknown>): string {
  return serializeEnvelope(envelope);
}

/** Mint a fresh idempotency key (for hosts that do not supply one). */
export function newEpochIdempotencyKey(): IdempotencyKey {
  return newIdempotencyKey();
}
