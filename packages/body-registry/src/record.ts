/**
 * ReleaseRecord — the APPEND-ONLY, content-addressed record of the
 * RELEASE stage (Work Order A024; requirements R23/R24; architecture
 * -lock rules 5, 6, 12, 16, 17, 18, 23).
 *
 * KIND 'release-registration' binds:
 *   - `release` — the CITABLE, CONTENT-ADDRESSED release artifact
 *     identity (A002 discipline: namespace/name/version + digest; the
 *     digest is the released BodyVersion's content digest, so the
 *     release identity addresses immutable material — "same identity,
 *     different content" can only exist as a different release with a
 *     different digest);
 *   - `bodyVersionRef` — the exact A003 BodyVersion released;
 *   - `channel` — the release channel (closed vocabulary);
 *   - `tags` — immutable release tags (closed charset, no duplicates);
 *   - `gate` — the FROZEN admission evidence snapshot (the A023/A022
 *     citations that admitted the release; enough lineage to audit the
 *     gate decision — A002 provenance law);
 *   - `gateEvidenceDigest` — COMPUTED sha256 over the canonical
 *     evidence snapshot (the reproducibility anchor);
 *   - `releasedAt` — the release timestamp (caller-supplied; no hidden
 *     clock reads).
 *
 * KIND 'release-supersession' binds `supersedes` (the digest of the
 * registration record whose release is replaced) + `grounds` (the
 * recorded why). Supersession is APPEND-ONLY: the superseded record is
 * never mutated; the registry projects the effective state.
 *
 * KIND 'release-retirement' binds `retires` (the digest of the
 * registration record whose release ends) + `grounds`. Retirement is
 * append-only for the same reason (end-of-life with lineage retained).
 *
 * All kinds carry the protocol-core addressability pair
 * (correlationId + idempotencyKey, lock rule 17), tenant/workspace
 * scoping, and provenance. Construction is pure and DETERMINISTIC:
 * identical inputs yield the identical record digest (no clock reads,
 * no randomness). Records are deep-frozen on creation — no mutation
 * API exists anywhere in this package.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { bodyVersionRefKey, isAgentBodySemver, isBodyVersionRef, toBodyVersionRef } from '@arena/agent-body';
import type { BodyVersionRef } from '@arena/agent-body';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';
import type { ReleaseChannel, ReleaseGateEvidence } from './gate.js';
import { isReleaseChannel, isReleaseGateEvidence, releaseGateEvidenceDigest } from './gate.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isReleaseTag,
  toContentDigest,
  toReleaseTags,
  toReleaseTimestamp,
} from './shared.js';

/** Wire version of the release-record shape. */
export const RELEASE_RECORD_VERSION = 1 as const;

/** The closed record-kind vocabulary. */
export const RELEASE_RECORD_KINDS = Object.freeze([
  'release-registration',
  'release-supersession',
  'release-retirement',
] as const);

export type ReleaseRecordKind = (typeof RELEASE_RECORD_KINDS)[number];

/** Structural (non-throwing) check for the record-kind vocabulary. */
export function isReleaseRecordKind(value: unknown): value is ReleaseRecordKind {
  return (
    typeof value === 'string' &&
    (RELEASE_RECORD_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The citable release artifact identity (A002 discipline)
// ---------------------------------------------------------------------------

/**
 * The citable, content-addressed release artifact identity:
 * namespace/name/version + the digest of the released material (the
 * A003 BodyVersion content digest). Structurally the A002 ArtifactRef
 * family: `namespace` is the body tenant, `name` is the body name,
 * `version` is the RELEASE version (independent semver assignment),
 * `digest` addresses the immutable released content.
 */
export interface ReleaseArtifactRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** Stable field list for the artifact ref (tests mirror it). */
export const RELEASE_ARTIFACT_REF_FIELDS = Object.freeze([
  'namespace',
  'name',
  'version',
  'digest',
] as const) as readonly string[];

/** Structural (non-throwing) check for the artifact ref. */
export function isReleaseArtifactRef(value: unknown): value is ReleaseArtifactRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    candidate['namespace'].length > 0 &&
    typeof candidate['name'] === 'string' &&
    candidate['name'].length > 0 &&
    isAgentBodySemver(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Stable key for a release artifact ref: `<ns>/<name>@<version>#<digest>`. */
export function releaseArtifactRefKey(ref: ReleaseArtifactRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
}

/** Stable identity key (immutability binding): `<ns>/<name>@<version>`. */
export function releaseArtifactIdentityKey(
  ref: ReleaseArtifactRef | { namespace: string; name: string; version: string },
): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Provenance of one release action. */
export interface ReleaseProvenance {
  readonly releasedBy: string;
  readonly recordedAt: string;
  readonly notes: string | null;
}

/** Stable field list for release provenance (tests mirror it). */
export const RELEASE_RECORD_PROVENANCE_FIELDS = Object.freeze([
  'releasedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for release provenance. */
export function isReleaseProvenance(value: unknown): value is ReleaseProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['releasedBy']) &&
    isReleaseTagTimestamp(candidate['recordedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function isReleaseTagTimestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function toReleaseProvenance(value: unknown): ReleaseProvenance {
  const record = expectFields(
    value,
    ['releasedBy', 'recordedAt', 'notes'],
    [],
    BODY_REGISTRY_ERROR_CODES.INVALID_PROVENANCE,
    'release record provenance',
  );
  const notes = record['notes'];
  if (notes !== null && !isNeutralText(notes)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'release record provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    releasedBy: record['releasedBy'] as string,
    recordedAt: toReleaseTimestamp(
      typeof record['recordedAt'] === 'string' ? record['recordedAt'] : '',
      'release record provenance recordedAt',
    ),
    notes: notes as string | null,
  });
}

// ---------------------------------------------------------------------------
// ReleaseRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the record digest commits to. */
export interface ReleaseRecordView {
  readonly recordVersion: typeof RELEASE_RECORD_VERSION;
  readonly kind: ReleaseRecordKind;
  // --- registration fields (null on supersession/retirement) ---
  readonly release: ReleaseArtifactRef | null;
  readonly bodyVersionRef: BodyVersionRef | null;
  readonly channel: ReleaseChannel | null;
  readonly tags: readonly string[];
  readonly gate: ReleaseGateEvidence | null;
  readonly gateEvidenceDigest: string | null;
  readonly releasedAt: string | null;
  // --- supersession fields (null on registration/retirement) ---
  readonly supersedes: string | null;
  // --- retirement fields (null on registration/supersession) ---
  readonly retires: string | null;
  // --- shared by supersession/retirement ---
  readonly grounds: string | null;
  // --- common fields ---
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly tenantId: string | null;
  readonly workspaceId: string | null;
  readonly provenance: ReleaseProvenance;
}

/** A frozen, content-addressed release record: the view plus its sha256 digest. */
export interface ReleaseRecord extends ReleaseRecordView {
  readonly digest: string;
}

/** Stable field list for the record view (tests mirror it). */
export const RELEASE_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'kind',
  'release',
  'bodyVersionRef',
  'channel',
  'tags',
  'gate',
  'gateEvidenceDigest',
  'releasedAt',
  'supersedes',
  'retires',
  'grounds',
  'correlationId',
  'idempotencyKey',
  'tenantId',
  'workspaceId',
  'provenance',
] as const) as readonly string[];

const REGISTRATION_FIELDS = Object.freeze([
  'release',
  'bodyVersionRef',
  'channel',
  'tags',
  'gate',
  'gateEvidenceDigest',
  'releasedAt',
] as const);

const LINEAGE_FORBIDDEN_FIELDS = Object.freeze(['retires', 'supersedes', 'grounds'] as const);

function digestLike(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Structural (non-throwing) check for the digest-free view. */
export function isReleaseRecordView(value: unknown): value is ReleaseRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== RELEASE_RECORD_VERSION) return false;
  if (!isReleaseRecordKind(candidate['kind'])) return false;
  const kind = candidate['kind'];
  if (kind === 'release-registration') {
    if (forbiddenPresent(candidate, LINEAGE_FORBIDDEN_FIELDS)) return false;
    return (
      isReleaseArtifactRef(candidate['release']) &&
      isBodyVersionRef(candidate['bodyVersionRef']) &&
      isReleaseChannel(candidate['channel']) &&
      Array.isArray(candidate['tags']) &&
      (candidate['tags'] as unknown[]).every((tag) => isReleaseTag(tag)) &&
      isReleaseGateEvidence(candidate['gate']) &&
      digestLike(candidate['gateEvidenceDigest']) &&
      typeof candidate['releasedAt'] === 'string' &&
      isReleaseTagTimestamp(candidate['releasedAt'])
    );
  }
  if (kind === 'release-supersession') {
    // Supersession carries supersedes + grounds; everything else must be
    // absent (retires must not be present).
    if (forbiddenPresent(candidate, [...REGISTRATION_FIELDS, 'retires'])) return false;
    return digestLike(candidate['supersedes']) && typeof candidate['grounds'] === 'string';
  }
  // release-retirement: carries retires + grounds; supersedes must not be present.
  if (forbiddenPresent(candidate, [...REGISTRATION_FIELDS, 'supersedes'])) return false;
  return digestLike(candidate['retires']) && typeof candidate['grounds'] === 'string';
}

function forbiddenPresent(candidate: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => {
    const value = candidate[field];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isReleaseRecord(value: unknown): value is ReleaseRecord {
  if (!isReleaseRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return digestLike(candidate['digest']);
}

function validateCommonFields(
  record: Record<string, unknown>,
): {
  correlationId: CorrelationId;
  idempotencyKey: IdempotencyKey;
  tenantId: string | null;
  workspaceId: string | null;
  provenance: ReleaseProvenance;
} {
  const correlationId = record['correlationId'];
  if (!isCorrelationId(correlationId)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
      message: `release record: invalid correlation id: ${JSON.stringify(correlationId)}`,
    });
  }
  const idempotencyKey = record['idempotencyKey'];
  if (!isIdempotencyKey(idempotencyKey)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
      message: `release record: invalid idempotency key: ${JSON.stringify(idempotencyKey)}`,
    });
  }
  const tenantId =
    record['tenantId'] === null || record['tenantId'] === undefined
      ? null
      : (record['tenantId'] as string);
  const workspaceId =
    record['workspaceId'] === null || record['workspaceId'] === undefined
      ? null
      : (record['workspaceId'] as string);
  return {
    correlationId,
    idempotencyKey,
    tenantId,
    workspaceId,
    provenance: toReleaseProvenance(record['provenance']),
  };
}

function invalidRecord(message: string, details?: Record<string, unknown>): never {
  throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

// ---------------------------------------------------------------------------
// Registration constructor
// ---------------------------------------------------------------------------

export interface CreateReleaseRegistrationInput {
  /** The body version being released (A003 ref; must equal the gate evidence). */
  readonly bodyVersionRef: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The RELEASE version assigned to this release (semver, no build metadata). */
  readonly releaseVersion: string;
  /** The frozen gate evidence that admitted this candidate. */
  readonly gate: ReleaseGateEvidence;
  /** Immutable release tags. */
  readonly tags?: readonly string[];
  /** The release timestamp (caller-supplied; no hidden clock reads). */
  readonly releasedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  readonly provenance: {
    readonly releasedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/**
 * Create a validated, deep-frozen, content-addressed
 * RELEASE-REGISTRATION record. The release artifact ref is DERIVED
 * (namespace = the body tenant, name = the body name, version = the
 * assigned release version, digest = the released BodyVersion digest)
 * and the gate evidence must be structurally valid AND scoped to the
 * exact body version being released (the gate is the admission
 * authority; this constructor refuses inconsistent snapshots).
 */
export async function createReleaseRegistrationRecord(
  input: CreateReleaseRegistrationInput,
): Promise<ReleaseRecord> {
  const record = expectFields(
    input,
    [
      'bodyVersionRef',
      'releaseVersion',
      'gate',
      'releasedAt',
      'correlationId',
      'idempotencyKey',
      'tenantId',
      'workspaceId',
      'provenance',
    ],
    ['tags'],
    BODY_REGISTRY_ERROR_CODES.INVALID_RECORD,
    'release registration record',
  );

  const bodyVersionRef = toBodyVersionRef(
    record['bodyVersionRef'] as {
      tenant: string;
      name: string;
      version: string;
      digest: string;
    },
  );
  const releaseVersion = record['releaseVersion'];
  if (typeof releaseVersion !== 'string' || !isAgentBodySemver(releaseVersion)) {
    invalidRecord(
      `release version must be a semver version without build metadata: ${JSON.stringify(releaseVersion)}`,
    );
  }

  const gate = record['gate'];
  if (!isReleaseGateEvidence(gate)) {
    invalidRecord('release registration requires a structurally valid gate evidence snapshot');
  }
  if (!isBodyVersionRef(gate.bodyVersionRef)) {
    invalidRecord('gate evidence bodyVersionRef is not a valid A003 ref');
  }
  if (bodyVersionRefKey(gate.bodyVersionRef) !== bodyVersionRefKey(bodyVersionRef)) {
    invalidRecord(
      `gate evidence is scoped to ${bodyVersionRefKey(gate.bodyVersionRef)} but the registration releases ${bodyVersionRefKey(bodyVersionRef)} (the evidence must address the exact body version)`,
      { gate: bodyVersionRefKey(gate.bodyVersionRef), registration: bodyVersionRefKey(bodyVersionRef) },
    );
  }
  const tags = toReleaseTags(
    (record['tags'] as readonly string[] | undefined) ?? [],
    'release registration tags',
  );
  const releasedAt = toReleaseTimestamp(
    typeof record['releasedAt'] === 'string' ? record['releasedAt'] : '',
    'release registration releasedAt',
  );
  const gateEvidenceDigest = await releaseGateEvidenceDigest(gate);

  const release: ReleaseArtifactRef = Object.freeze({
    namespace: bodyVersionRef.tenant,
    name: bodyVersionRef.name,
    version: releaseVersion as string,
    digest: bodyVersionRef.digest,
  });

  const common = validateCommonFields(record);
  const view: ReleaseRecordView = {
    recordVersion: RELEASE_RECORD_VERSION,
    kind: 'release-registration',
    release,
    bodyVersionRef,
    channel: gate.channel,
    tags,
    gate,
    gateEvidenceDigest,
    releasedAt,
    supersedes: null,
    retires: null,
    grounds: null,
    correlationId: common.correlationId,
    idempotencyKey: common.idempotencyKey,
    tenantId: common.tenantId,
    workspaceId: common.workspaceId,
    provenance: common.provenance,
  };
  const digest = toContentDigest(await digestCanonical(view), 'release record digest');
  return deepFreeze({ ...view, digest }) as ReleaseRecord;
}

// ---------------------------------------------------------------------------
// Supersession / retirement constructors
// ---------------------------------------------------------------------------

export interface CreateReleaseLineageInput {
  /** Digest of the registration record being superseded / retired. */
  readonly target: string;
  /** The recorded why (neutral text, required). */
  readonly grounds: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly tenantId?: string | null;
  readonly workspaceId?: string | null;
  readonly provenance: {
    readonly releasedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

async function createLineageRecord(
  kind: 'release-supersession' | 'release-retirement',
  input: CreateReleaseLineageInput,
): Promise<ReleaseRecord> {
  const field = kind === 'release-supersession' ? 'supersedes' : 'retires';
  const record = expectFields(
    input,
    ['target', 'grounds', 'correlationId', 'idempotencyKey', 'tenantId', 'workspaceId', 'provenance'],
    [],
    BODY_REGISTRY_ERROR_CODES.INVALID_RECORD,
    `${kind} record`,
  );
  const target = toContentDigest(
    typeof record['target'] === 'string' ? record['target'] : '',
    `${kind} record ${field}`,
  );
  const grounds = record['grounds'];
  if (typeof grounds !== 'string' || !isNeutralText(grounds) || grounds.length === 0) {
    invalidRecord(`${kind} record requires neutral-text grounds (the recorded why)`);
  }
  const common = validateCommonFields(record);
  const view: ReleaseRecordView = {
    recordVersion: RELEASE_RECORD_VERSION,
    kind,
    release: null,
    bodyVersionRef: null,
    channel: null,
    tags: [],
    gate: null,
    gateEvidenceDigest: null,
    releasedAt: null,
    supersedes: kind === 'release-supersession' ? target : null,
    retires: kind === 'release-retirement' ? target : null,
    grounds,
    correlationId: common.correlationId,
    idempotencyKey: common.idempotencyKey,
    tenantId: common.tenantId,
    workspaceId: common.workspaceId,
    provenance: common.provenance,
  };
  const digest = toContentDigest(await digestCanonical(view), 'release record digest');
  return deepFreeze({ ...view, digest }) as ReleaseRecord;
}

/** Create a validated, deep-frozen, content-addressed SUPERSESSION record. */
export async function createReleaseSupersessionRecord(
  input: CreateReleaseLineageInput,
): Promise<ReleaseRecord> {
  return createLineageRecord('release-supersession', input);
}

/** Create a validated, deep-frozen, content-addressed RETIREMENT record. */
export async function createReleaseRetirementRecord(
  input: CreateReleaseLineageInput,
): Promise<ReleaseRecord> {
  return createLineageRecord('release-retirement', input);
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

/**
 * Re-compute a release record's digest and compare it with the claimed
 * one. FAILS CLOSED with BODY_REGISTRY_TAMPERED on any mismatch.
 */
export async function verifyReleaseRecord(record: ReleaseRecord): Promise<string> {
  if (!isReleaseRecord(record)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'release record verification requires a structurally valid record',
    });
  }
  const { digest: _claimed, ...view } = record as unknown as Record<string, unknown> & {
    digest: unknown;
  };
  const computed = await digestCanonical(view);
  if (computed !== record.digest) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.TAMPERED, {
      message: `release record digest mismatch: expected ${record.digest}, got ${computed}`,
      details: { expected: record.digest, actual: computed },
    });
  }
  return record.digest;
}

/** Re-verify the gate evidence digest of a registration record (belt and braces). */
export async function verifyReleaseGateEvidence(record: ReleaseRecord): Promise<void> {
  if (record.kind !== 'release-registration' || record.gate === null) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_RECORD, {
      message: 'gate evidence verification applies to release-registration records only',
    });
  }
  const computed = await releaseGateEvidenceDigest(record.gate);
  if (computed !== record.gateEvidenceDigest) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.TAMPERED, {
      message: `release gate evidence digest mismatch: expected ${record.gateEvidenceDigest}, got ${computed}`,
      details: { expected: record.gateEvidenceDigest, actual: computed },
    });
  }
}
