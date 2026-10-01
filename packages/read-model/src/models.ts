/**
 * Canonical read models + pure projections (Work Order B005; issue #71).
 *
 * THE governing invariant: the read model is a PROJECTION over canonical
 * Arena objects — never a second authority. Accordingly:
 *   - every read shape carries the SOURCE record's own `version` (schema
 *     version) and `revision` (optimistic-concurrency revision) AS STORED,
 *     so consumers can detect reload drift (the UI survives reload by
 *     re-reading, never by trusting a cached copy);
 *   - provenance (`createdAt`/`updatedAt`) is carried as stored — NEVER
 *     recomputed, never re-derived;
 *   - `readAt` is INJECTED by callers (no clock reads inside the
 *     projection — the mappers are deterministic and side-effect-free);
 *   - outputs are deep-frozen (read discipline).
 *
 * Kind vocabulary (bounded, disclosed): the control-plane kinds that exist
 * today. `arena-session` and `arena-session-epoch` are written today by the
 * B004 ControlPlaneSessionStore; `capability-case`, `agent-body`,
 * `expert-qualification` and `certification` are the canonical domain
 * object kinds of the A-series domain packages that the control plane is
 * the authority for as B008+ product flows land. The vocabulary is CLOSED
 * and versioned here so read consumers share one inventory; unknown kinds
 * still project through the generic read shape (they are never silently
 * dropped) but are not part of the typed inventory.
 */

import type { ControlPlaneRecord } from '@arena/persistence';
import { deepFreeze, isJsonSafeValue } from '@arena/persistence';
import { READ_MODEL_ERROR_CODES, ReadModelError } from './errors.js';

/** Wire version of the read-model contract records. */
export const READ_MODEL_RECORD_VERSION = 1 as const;

/**
 * The bounded, disclosed control-plane kind vocabulary read models are
 * typed over (see the module doc). Adding a kind is a contract change.
 */
export const READ_MODEL_KINDS = Object.freeze([
  'arena-session',
  'arena-session-epoch',
  'capability-case',
  'agent-body',
  'expert-qualification',
  'certification',
] as const);

export type ReadModelKind = (typeof READ_MODEL_KINDS)[number];

/** True iff the value is one of the disclosed read-model kinds. */
export function isReadModelKind(value: unknown): value is ReadModelKind {
  return (
    typeof value === 'string' &&
    (READ_MODEL_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Provenance of a canonical read — the source record's stored timestamps,
 * carried verbatim (NEVER recomputed; no wall-clock reads inside the
 * projection).
 */
export interface ReadProvenance {
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * The canonical read shape: everything a consumer needs to render
 * control-plane state and detect staleness, and nothing that would make
 * this a second authority (no write path, no cached authority).
 */
export interface CanonicalRead {
  /** The read-model contract version (NOT the source record's version). */
  readonly recordVersion: typeof READ_MODEL_RECORD_VERSION;
  readonly recordId: string;
  readonly tenantId: string;
  readonly kind: string;
  /** The source record's schema version, AS STORED. */
  readonly sourceVersion: number;
  /** The source record's optimistic revision, AS STORED. */
  readonly sourceRevision: number;
  /** The source record's canonical-JSON payload, AS STORED. */
  readonly data: unknown;
  /** As-stored provenance refs (never recomputed). */
  readonly provenance: ReadProvenance;
  /** When the projection was materialized (INJECTED by the caller). */
  readonly readAt: number;
}

/** Typed canonical read for a specific disclosed kind. */
export interface KindedRead<K extends ReadModelKind = ReadModelKind>
  extends CanonicalRead {
  readonly kind: K;
}

/** Typed per-kind read shapes over the disclosed vocabulary. */
export type SessionRecordRead = KindedRead<'arena-session'>;
export type SessionEpochRead = KindedRead<'arena-session-epoch'>;
export type CapabilityCaseRead = KindedRead<'capability-case'>;
export type AgentBodyRead = KindedRead<'agent-body'>;
export type ExpertQualificationRead = KindedRead<'expert-qualification'>;
export type CertificationRead = KindedRead<'certification'>;

// ---------------------------------------------------------------------------
// Runtime record validation (fail closed)
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strict runtime validation of a control-plane record shape (fail closed:
 * `READ_MODEL_INVALID_RECORD`). Identity, tenancy, versioning, payload and
 * provenance fields are all required and type-checked; provenance must be
 * temporally coherent (updatedAt >= createdAt).
 */
export function isControlPlaneRecordLike(value: unknown): value is ControlPlaneRecord {
  if (!isPlainRecord(value)) return false;
  const record = value;
  if (typeof record['recordId'] !== 'string' || record['recordId'].length === 0) return false;
  if (typeof record['tenantId'] !== 'string' || record['tenantId'].length === 0) return false;
  if (typeof record['kind'] !== 'string' || record['kind'].length === 0) return false;
  if (!isPositiveInteger(record['version'])) return false;
  if (!isPositiveInteger(record['revision'])) return false;
  if (!isJsonSafeValue(record['data'])) return false;
  if (!isPositiveInteger(record['createdAt'])) return false;
  if (!isPositiveInteger(record['updatedAt'])) return false;
  if ((record['updatedAt'] as number) < (record['createdAt'] as number)) return false;
  return true;
}

function requireValidReadAt(readAt: number): number {
  if (typeof readAt !== 'number' || !Number.isInteger(readAt) || readAt < 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_READ_AT, {
      message: `readAt must be a non-negative integer epoch-ms timestamp (injected by the caller), got ${String(readAt)}`,
      details: { readAt },
    });
  }
  return readAt;
}

// ---------------------------------------------------------------------------
// Projections (pure, deterministic, side-effect-free)
// ---------------------------------------------------------------------------

/**
 * Project ANY well-formed control-plane record into the generic canonical
 * read shape. Pure: no state, no clock (readAt is injected), output frozen.
 * Fails closed with `READ_MODEL_INVALID_RECORD` on malformed records.
 */
export function toCanonicalRead(record: unknown, readAt: number): CanonicalRead {
  if (!isControlPlaneRecordLike(record)) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_RECORD, {
      message: 'the value is not a well-formed control-plane record (recordId, tenantId, kind, version, revision, data, createdAt, updatedAt all required)',
      details: { receivedType: typeof record },
    });
  }
  requireValidReadAt(readAt);
  const source = record as ControlPlaneRecord;
  return deepFreeze({
    recordVersion: READ_MODEL_RECORD_VERSION,
    recordId: source.recordId,
    tenantId: source.tenantId,
    kind: source.kind,
    sourceVersion: source.version,
    sourceRevision: source.revision,
    data: source.data,
    provenance: deepFreeze({
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    }),
    readAt,
  }) as CanonicalRead;
}

/**
 * Project a control-plane record into the typed read shape of an EXPECTED
 * kind. Fails closed with `READ_MODEL_KIND_MISMATCH` when the stored kind
 * is not the expected one (a caller that asks for a capability-case read
 * of an agent-body record gets a typed mismatch, never a coerced view).
 */
export function toKindedRead<K extends ReadModelKind>(
  record: unknown,
  readAt: number,
  expectedKind: K,
): KindedRead<K> {
  const generic = toCanonicalRead(record, readAt);
  if (generic.kind !== expectedKind) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.KIND_MISMATCH, {
      message: `expected a control-plane record of kind ${JSON.stringify(expectedKind)}, got ${JSON.stringify(generic.kind)}`,
      details: { expectedKind, actualKind: generic.kind, recordId: generic.recordId },
    });
  }
  return generic as KindedRead<K>;
}

/** Typed projection: the B004 per-session record (kind `arena-session`). */
export function toSessionRecordRead(record: unknown, readAt: number): SessionRecordRead {
  return toKindedRead(record, readAt, 'arena-session');
}

/** Typed projection: the B004 per-principal revocation-epoch record. */
export function toSessionEpochRead(record: unknown, readAt: number): SessionEpochRead {
  return toKindedRead(record, readAt, 'arena-session-epoch');
}

/** Typed projection: capability-case canonical records. */
export function toCapabilityCaseRead(record: unknown, readAt: number): CapabilityCaseRead {
  return toKindedRead(record, readAt, 'capability-case');
}

/** Typed projection: agent-body canonical records. */
export function toAgentBodyRead(record: unknown, readAt: number): AgentBodyRead {
  return toKindedRead(record, readAt, 'agent-body');
}

/** Typed projection: expert-qualification canonical records. */
export function toExpertQualificationRead(record: unknown, readAt: number): ExpertQualificationRead {
  return toKindedRead(record, readAt, 'expert-qualification');
}

/** Typed projection: certification canonical records. */
export function toCertificationRead(record: unknown, readAt: number): CertificationRead {
  return toKindedRead(record, readAt, 'certification');
}
