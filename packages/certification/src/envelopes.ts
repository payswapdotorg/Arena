/**
 * Envelope wiring for the certification protocol (architecture-lock
 * rules 17, 18, 22; Work Order A023 — mirrors the sibling protocols'
 * envelope patterns exactly (@arena/verification, @arena/evaluation)).
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
 *     the suite, the composition under test and the evidence bundle
 *     refs — the fabric resolves the suite, evaluates every stage,
 *     derives the verdict / level / scoped statement and emits the
 *     event carrying the ledger's authoritative, content-addressed
 *     CertificationRecord; the command's idempotency key + input tuple
 *     is the idempotent run address).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  parseSchemaRef,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationRecord } from './record.js';
import { isCertificationRecord } from './record.js';
import type { CertificationSubject } from './subject.js';
import { isCertificationSubject } from './subject.js';

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
  'certification/certification-outcome': CERTIFICATION_SCHEMA_VERSION,
  'certification/certification-level': CERTIFICATION_SCHEMA_VERSION,
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
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SCHEMA_REF, {
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
// run-certification-command
// ---------------------------------------------------------------------------

/** Payload of run-certification-command. */
export interface RunCertificationCommand {
  /** Digest of the CertificationSuite to run. */
  readonly suiteRef: string;
  /** The composition under test (all five scope components). */
  readonly subject: CertificationSubject;
  /** Digests of the evidence records the run may consume (resolved by the fabric). */
  readonly evidenceRefs: readonly string[];
}

/** Stable field list for the command payload (tests + contracts mirror it). */
export const RUN_CERTIFICATION_COMMAND_FIELDS = Object.freeze([
  'suiteRef',
  'subject',
  'evidenceRefs',
] as const) as readonly string[];

/** Structural (non-throwing) check for the command payload. */
export function isRunCertificationCommand(value: unknown): value is RunCertificationCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['suiteRef'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['suiteRef']) &&
    isCertificationSubject(candidate['subject']) &&
    Array.isArray(candidate['evidenceRefs']) &&
    (candidate['evidenceRefs'] as unknown[]).every(
      (entry) => typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry),
    )
  );
}

/** Build the run-certification-command envelope (idempotency key REQUIRED). */
export function makeRunCertificationCommand(
  payload: RunCertificationCommand,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<RunCertificationCommand> {
  if (!isRunCertificationCommand(payload)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'run-certification-command payload is structurally invalid (suiteRef digest, full subject and evidence digest refs required)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: certificationSchemaRef('certification/run-certification-command'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

/** Parse a run-certification-command envelope (strict payload check). */
export function parseRunCertificationCommand(
  raw: string,
): Envelope<RunCertificationCommand> {
  const envelope = parseEnvelopeAs<RunCertificationCommand>(
    raw,
    certificationSchemaRef('certification/run-certification-command'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'certification') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `expected a certification-protocol schema, got ${envelope.schema}`,
    });
  }
  if (envelope.idempotencyKey === null) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: 'run-certification-command requires a non-null idempotency key (architecture-lock rule 17)',
    });
  }
  if (!isRunCertificationCommand(envelope.payload)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'run-certification-command payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// certification-recorded-event
// ---------------------------------------------------------------------------

/** Payload of certification-recorded-event: the authoritative record. */
export interface CertificationRecordedEvent {
  readonly record: CertificationRecord;
}

/** Stable field list for the event payload (tests + contracts mirror it). */
export const CERTIFICATION_RECORDED_EVENT_FIELDS = Object.freeze(['record'] as const) as readonly string[];

/** Structural (non-throwing) check for the event payload. */
export function isCertificationRecordedEvent(value: unknown): value is CertificationRecordedEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isCertificationRecord(candidate['record']);
}

/** Build the certification-recorded-event envelope. */
export function makeCertificationRecordedEvent(
  payload: CertificationRecordedEvent,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey | null,
): Envelope<CertificationRecordedEvent> {
  if (!isCertificationRecordedEvent(payload)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification-recorded-event payload requires a structurally valid CertificationRecord',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: certificationSchemaRef('certification/certification-recorded-event'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

/** Parse a certification-recorded-event envelope (strict payload check). */
export function parseCertificationRecordedEvent(
  raw: string,
): Envelope<CertificationRecordedEvent> {
  const envelope = parseEnvelopeAs<CertificationRecordedEvent>(
    raw,
    certificationSchemaRef('certification/certification-recorded-event'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'certification') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `expected a certification-protocol schema, got ${envelope.schema}`,
    });
  }
  if (!isCertificationRecordedEvent(envelope.payload)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_RECORD, {
      message: 'certification-recorded-event payload is structurally invalid',
    });
  }
  return envelope;
}

/** The digest of any certification envelope (wire-integrity check). */
export async function certificationEnvelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return envelopeDigest(envelope);
}
