/**
 * Envelope wiring for the certification protocol (architecture-lock rules
 * 17, 18, 22; Work Order A023 — mirrors the sibling protocols' envelope
 * patterns exactly (@arena/verification, @arena/evaluation,
 * @arena/trajectory, @arena/artifact-protocol).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry
 * a correlation id, payloads are canonical-JSON serializable and
 * digest-checkable, and unknown envelope versions are rejected by the
 * core parser (PROTOCOL_UNSUPPORTED_VERSION).
 *
 * Payload schemas are versioned SchemaRefs in the `certification`
 * namespace (arena:schema/certification/<name>@<major.minor.patch>) and
 * mirrored by the generated contracts in contracts/certification/ (see
 * packages/certification/scripts/generate-contracts.mjs).
 *
 * Wire messages:
 *   - run-certification-command / certification-recorded-event
 *     (running one certification: the command carries the digest ref of
 *     the suite descriptor, the possession digest, the flattened scope
 *     refs (body/substrate/environment/runtime-profile) and the
 *     component-verdict summary — the engine derives the verdict,
 *     unknown cause, constraints and scoped statement, and emits the
 *     event carrying the ledger's authoritative, content-addressed
 *     CertificationRecord; the command's idempotency key + input tuple
 *     is the idempotent run address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
} from '@arena/protocol-core';
import type {
  CorrelationId,
  Envelope,
  IdempotencyKey,
  SchemaRef,
} from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { ComponentVerdictSummary } from './verdict.js';
import { toComponentVerdictSummary } from './verdict.js';
import type { CertificationRecord } from './record.js';
import { isCertificationRecord } from './record.js';

export const CERTIFICATION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/certification. Mirrored by the
 * generated contract certification-schema-registry.v1.json (parity
 * asserted in contracts.parity.test.ts).
 */
export const CERTIFICATION_SCHEMAS = Object.freeze({
  'certification/certification-suite': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-record': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-statement': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-verdict': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-error': CERTIFICATION_SCHEMA_VERSION,
  'certification/run-certification-command': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-recorded-event': CERTIFICATION_SCHEMA_VERSION,
  'certification/schema-registry': CERTIFICATION_SCHEMA_VERSION,
} as const);

export type CertificationSchemaName = keyof typeof CERTIFICATION_SCHEMAS;

/** Resolve a certification-protocol schema name to its SchemaRef. */
export function certificationSchemaRef(name: CertificationSchemaName): SchemaRef {
  const version = CERTIFICATION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown certification protocol schema: ${String(name)}`,
      details: { known: Object.keys(CERTIFICATION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a certification-protocol schema at the registered version. */
export function isKnownCertificationSchema(ref: SchemaRef): boolean {
  const registered = (CERTIFICATION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** The inputs of one certification run request. */
export interface RunCertificationCommandPayload {
  /** Digest of the CertificationSuiteDescriptor to run. */
  readonly suiteRef: string;
  /** Digest of the A003 Possession binding the composition under test. */
  readonly possessionRef: string;
  /** The design-law "Body B, version V" — digest of the A003 BodyVersion. */
  readonly bodyVersionRef: string;
  /** The design-law "Cognitive Substrate M" — digest of the A003 substrate. */
  readonly substrateRef: string;
  /** The design-law "Environment E" — digest of the A009 environment. */
  readonly environmentRef: string;
  /** The design-law "Runtime Profile R" — digest of the A003 runtime profile. */
  readonly runtimeProfileRef: string;
  /** The per-component summary the engine will aggregate. */
  readonly componentVerdicts: ReadonlyArray<{
    readonly refKind: string;
    readonly refDigest: string;
    readonly verdict: string;
    readonly constraints: readonly string[] | null;
    readonly notes: string | null;
  }>;
}

/** The fabric's authoritative result: the frozen, content-addressed record. */
export interface CertificationRecordedEventPayload {
  readonly record: CertificationRecord;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface CertificationEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: CertificationEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function makeRunCertificationCommand(
  payload: RunCertificationCommandPayload,
  context: CertificationEnvelopeContext,
): Envelope<RunCertificationCommandPayload> {
  for (const [field, value] of Object.entries({
    suiteRef: payload.suiteRef,
    possessionRef: payload.possessionRef,
    bodyVersionRef: payload.bodyVersionRef,
    substrateRef: payload.substrateRef,
    environmentRef: payload.environmentRef,
    runtimeProfileRef: payload.runtimeProfileRef,
  })) {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
      throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_DIGEST, {
        message: `run-certification command payload requires a valid content digest in '${field}'`,
        details: { field, pattern: '^[0-9a-f]{64}$' },
      });
    }
  }
  // Full component-verdict summary validation (structure, set-equality
  // checked against the suite descriptor at the engine level; here we
  // validate structure + duplicate-free + verdict closed enum).
  toComponentVerdictSummary(payload.componentVerdicts as ComponentVerdictSummary);
  return makeEnvelope({
    kind: 'command',
    schema: certificationSchemaRef('certification/run-certification-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeCertificationRecordedEvent(
  payload: CertificationRecordedEventPayload,
  context: CertificationEnvelopeContext,
): Envelope<CertificationRecordedEventPayload> {
  if (!isCertificationRecord(payload.record)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification-recorded event payload requires a structurally valid certification record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: certificationSchemaRef('certification/certification-recorded-event'),
    correlationId: context.correlationId,
    // Events MAY carry an idempotency key when the emitter wants the
    // event stream itself to be idempotency-addressable (mirrors
    // sibling protocols; the recorded event carries the run command's
    // idempotency key when provided).
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Parsing / integrity
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a
 * certification-protocol schema. The core parser rejects unknown envelope
 * versions (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes
 * (PROTOCOL_INVALID_ENVELOPE) and commands without an idempotency key.
 */
export function parseCertificationEnvelope<T>(
  raw: string,
  expectedSchema?: CertificationSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref =
    typeof expectedSchema === 'string'
      ? certificationSchemaRef(expectedSchema)
      : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a certification-protocol envelope. */
export async function certificationEnvelopeDigest(
  envelope: Envelope<unknown>,
): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Parse `raw` as a certification-protocol envelope and assert that its
 * canonical digest equals `expectedDigest` — the tamper tripwire for
 * wire messages. Throws CERTIFICATION_TAMPERED on any mismatch.
 */
export async function checkCertificationEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  const envelope = parseEnvelopeAs<unknown>(raw);
  const actual = await envelopeDigest(envelope);
  if (actual !== expectedDigest) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.TAMPERED, {
      message: `certification envelope digest mismatch: expected ${expectedDigest}, got ${actual}`,
      details: { expected: expectedDigest, actual },
    });
  }
  return envelope;
}
