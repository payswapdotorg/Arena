/**
 * Envelope<T> — the stable Arena wire shape (architecture-lock rules 17, 18,
 * 22).
 *
 * Every protocol message travels inside an envelope carrying:
 *   - the wire version `v` (currently 1; unknown versions are rejected);
 *   - a `kind` (command / event / query / response);
 *   - the payload's `schema` as a versioned SchemaRef string;
 *   - a unique `id` (UUIDv4);
 *   - the `correlationId` of the causal flow;
 *   - an `idempotencyKey` (REQUIRED non-null for commands — long-running jobs
 *     are idempotent and correlation-addressable);
 *   - `issuedAt` (RFC 3339);
 *   - the `payload`.
 *
 * Canonical serialization is canonical JSON; the envelope digest is sha256
 * over that canonical form. `verifyEnvelope` recomputes the digest and
 * rejects tampered content (PROTOCOL_ENVELOPE_TAMPERED).
 */

import {
  canonicalJson,
} from './canonical-json.js';
import { digestCanonical } from './digest.js';
import {
  isCorrelationId,
  isIdempotencyKey,
} from './identifiers.js';
import type { CorrelationId, IdempotencyKey } from './identifiers.js';
import { PROTOCOL_ERROR_CODES, ProtocolError } from './protocol-error.js';
import { formatSchemaRef, parseSchemaRef } from './schema-ref.js';
import type { SchemaRef } from './schema-ref.js';

export const ENVELOPE_VERSION = 1 as const;

export const ENVELOPE_KINDS = ['command', 'event', 'query', 'response'] as const;
export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface Envelope<T = unknown> {
  readonly v: typeof ENVELOPE_VERSION;
  readonly kind: EnvelopeKind;
  readonly schema: string;
  readonly id: string;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly issuedAt: string;
  readonly payload: T;
}

export interface MakeEnvelopeInput<T> {
  readonly kind: EnvelopeKind;
  readonly schema: SchemaRef | string;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey | null;
  readonly payload: T;
  readonly id?: string;
  readonly issuedAt?: string;
}

function isEnvelopeKind(value: unknown): value is EnvelopeKind {
  return (
    typeof value === 'string' && (ENVELOPE_KINDS as readonly string[]).includes(value)
  );
}

function invalid(detail: string): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE, { message: detail });
}

function validateEnvelopeShape(value: {
  v: unknown;
  kind: unknown;
  schema: unknown;
  id: unknown;
  correlationId: unknown;
  idempotencyKey: unknown;
  idempotencyKeyKnown: boolean;
  issuedAt: unknown;
  payloadKnown: boolean;
}): void {
  if (value.v !== ENVELOPE_VERSION) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION, {
      message: `unsupported envelope wire version: ${String(value.v)} (expected ${String(ENVELOPE_VERSION)})`,
    });
  }
  if (!isEnvelopeKind(value.kind)) {
    invalid(`invalid envelope kind: ${String(value.kind)}`);
  }
  if (typeof value.schema !== 'string') {
    invalid('envelope schema must be a SchemaRef string');
  }
  parseSchemaRef(value.schema); // throws INVALID_SCHEMA_REF on malformed refs
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    invalid(`envelope id must be a lowercase UUIDv4, got: ${String(value.id)}`);
  }
  if (!isCorrelationId(value.correlationId)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_CORRELATION_ID, {
      message: `invalid envelope correlationId: ${JSON.stringify(value.correlationId)}`,
    });
  }
  if (!value.idempotencyKeyKnown) {
    invalid('envelope requires an idempotencyKey field (use null when not applicable)');
  }
  if (value.idempotencyKey !== null && !isIdempotencyKey(value.idempotencyKey)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_IDEMPOTENCY_KEY, {
      message: `invalid envelope idempotencyKey: ${JSON.stringify(value.idempotencyKey)}`,
    });
  }
  if (value.kind === 'command' && value.idempotencyKey === null) {
    invalid('command envelopes require a non-null idempotencyKey');
  }
  if (
    typeof value.issuedAt !== 'string' ||
    !RFC3339_PATTERN.test(value.issuedAt) ||
    Number.isNaN(Date.parse(value.issuedAt))
  ) {
    invalid(`envelope issuedAt must be a valid RFC 3339 timestamp, got: ${String(value.issuedAt)}`);
  }
  if (!value.payloadKnown) {
    invalid('envelope requires a payload field (it may be null)');
  }
}

/** Create a validated envelope. Fills `id` (UUIDv4) and `issuedAt` (now) when absent. */
export function makeEnvelope<T>(input: MakeEnvelopeInput<T>): Envelope<T> {
  const ref = typeof input.schema === 'string' ? parseSchemaRef(input.schema) : input.schema;
  const id = input.id ?? globalThis.crypto.randomUUID();
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const idempotencyKey = input.idempotencyKey ?? null;
  validateEnvelopeShape({
    v: ENVELOPE_VERSION,
    kind: input.kind,
    schema: formatSchemaRef(ref),
    id,
    correlationId: input.correlationId,
    idempotencyKey,
    idempotencyKeyKnown: true,
    issuedAt,
    payloadKnown: true,
  });
  return {
    v: ENVELOPE_VERSION,
    kind: input.kind,
    schema: formatSchemaRef(ref),
    id,
    correlationId: input.correlationId,
    idempotencyKey,
    issuedAt,
    payload: input.payload,
  };
}

/** Canonical JSON serialization of an envelope (sorted keys, no whitespace). */
export function serializeEnvelope(envelope: Envelope<unknown>): string {
  return canonicalJson(envelope);
}

/** Strictly parse an envelope from a canonical (or any) JSON string. */
export function parseEnvelope(raw: string): Envelope<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_JSON, {
      message: 'envelope is not valid JSON',
      cause,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'envelope must be a JSON object',
    });
  }
  const record = parsed as Record<string, unknown>;
  validateEnvelopeShape({
    v: record['v'],
    kind: record['kind'],
    schema: record['schema'],
    id: record['id'],
    correlationId: record['correlationId'],
    idempotencyKey: record['idempotencyKey'],
    idempotencyKeyKnown: 'idempotencyKey' in record,
    issuedAt: record['issuedAt'],
    payloadKnown: 'payload' in record,
  });
  return {
    v: ENVELOPE_VERSION,
    kind: record['kind'] as EnvelopeKind,
    schema: record['schema'] as string,
    id: record['id'] as string,
    correlationId: record['correlationId'] as CorrelationId,
    idempotencyKey: record['idempotencyKey'] as IdempotencyKey | null,
    issuedAt: record['issuedAt'] as string,
    payload: record['payload'],
  };
}

/** Parse and optionally pin the payload schema (PROTOCOL_SCHEMA_MISMATCH otherwise). */
export function parseEnvelopeAs<T>(
  raw: string,
  expectedSchema?: SchemaRef | string,
): Envelope<T> {
  const envelope = parseEnvelope(raw);
  if (expectedSchema !== undefined) {
    const expected =
      typeof expectedSchema === 'string' ? parseSchemaRef(expectedSchema) : expectedSchema;
    const actual = parseSchemaRef(envelope.schema);
    if (
      actual.namespace !== expected.namespace ||
      actual.name !== expected.name ||
      actual.version !== expected.version
    ) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.SCHEMA_MISMATCH, {
        message: `payload schema ${envelope.schema} does not match expected ${formatSchemaRef(expected)}`,
      });
    }
  }
  return envelope as Envelope<T>;
}

/** sha256 hex digest over the canonical serialization of the envelope. */
export async function envelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return digestCanonical(envelope);
}

/**
 * Verify that `raw` parses as a valid envelope whose canonical digest equals
 * `expectedDigest`. Throws PROTOCOL_ENVELOPE_TAMPERED on any mismatch.
 */
export async function verifyEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelope(raw);
  const actual = await digestCanonical(envelope);
  if (actual !== expectedDigest) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED, {
      message: `envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
    });
  }
  return envelope;
}

/** Structural (non-throwing) check. */
export function isEnvelope(value: unknown): value is Envelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['v'] === ENVELOPE_VERSION &&
    isEnvelopeKind(record['kind']) &&
    typeof record['schema'] === 'string' &&
    typeof record['id'] === 'string' &&
    typeof record['correlationId'] === 'string' &&
    (record['idempotencyKey'] === null || typeof record['idempotencyKey'] === 'string') &&
    typeof record['issuedAt'] === 'string' &&
    'payload' in record
  );
}
