/**
 * Publication model (architecture-lock rules 12 and 6; requirements R23, R24).
 *
 *   - An artifact is private to its tenant namespace BY DEFAULT; no record,
 *     no visibility.
 *   - Making an artifact public requires an explicit, immutable
 *     PublicationRecord (versioned shape, never rewritten).
 *   - Retraction NEVER edits the original record: it appends a NEW record
 *     (action `retract`) whose `supersedes` field carries the record digest
 *     of the original publication — the ledger is append-only.
 *   - Identity immutability across the ledger: once an identity has been
 *     bound to a digest by any publication record, publishing the SAME
 *     identity with a DIFFERENT digest is rejected
 *     (ARTIFACT_IDENTITY_CONFLICT) — even after a retraction.
 *   - Publishing a tampered artifact (claimed digest not matching content)
 *     fails closed at record construction (ARTIFACT_TAMPERED).
 */

import { digestCanonical } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import type { ArtifactRef, MaterialArtifact } from './artifact.js';
import { artifactRefKey, isArtifactRef, verifyArtifact } from './artifact.js';
import type { PrincipalRef } from './principal.js';
import { isPrincipalRef, toPrincipalRef } from './principal.js';
import type { RightsMetadata } from './rights.js';
import { isRightsMetadata, toRightsMetadata } from './rights.js';
import type { Timestamp } from './timestamp.js';
import { isTimestamp, nowTimestamp, toTimestamp } from './timestamp.js';
import type { ContentDigest } from './content-digest.js';
import { toContentDigest } from './content-digest.js';

export const PUBLICATION_ACTIONS = ['publish', 'retract'] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

/** Wire version of the publication record shape. */
export const PUBLICATION_RECORD_VERSION = 1 as const;

export interface PublicationRecord {
  readonly recordVersion: typeof PUBLICATION_RECORD_VERSION;
  readonly action: PublicationAction;
  /** The artifact made public (publish) or whose publication ends (retract). */
  readonly artifact: ArtifactRef;
  /** The tenant-scoped principal that performed the action. */
  readonly publisher: PrincipalRef;
  /** Explicit rights metadata carried on the public record (lock rule 23). */
  readonly rights: RightsMetadata;
  /** When the action was recorded (UTC, millisecond precision). */
  readonly publishedAt: Timestamp;
  /** Retract only: record digest of the publication being superseded. */
  readonly supersedes?: ContentDigest;
}

/** Append-only publication history. */
export interface PublicationLedger {
  readonly records: readonly PublicationRecord[];
}

export type ArtifactVisibility = 'private' | 'public';

export interface ActivePublication {
  readonly visibility: 'public';
  readonly publication: PublicationRecord;
}

export interface PrivateArtifact {
  readonly visibility: 'private';
}

export type PublicationStatus = ActivePublication | PrivateArtifact;

export function isPublicationAction(value: unknown): value is PublicationAction {
  return (
    typeof value === 'string' && (PUBLICATION_ACTIONS as readonly string[]).includes(value)
  );
}

export function isPublicationRecord(value: unknown): value is PublicationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === PUBLICATION_RECORD_VERSION &&
    isPublicationAction(candidate['action']) &&
    isArtifactRef(candidate['artifact']) &&
    isPrincipalRef(candidate['publisher']) &&
    isRightsMetadata(candidate['rights']) &&
    isTimestamp(candidate['publishedAt']) &&
    (candidate['supersedes'] === undefined ||
      (typeof candidate['supersedes'] === 'string' && candidate['action'] === 'retract'))
  );
}

/**
 * sha256 digest over the canonical serialization of a publication record
 * (all fields). Publication records are themselves content-addressed — the
 * retraction `supersedes` field references this digest.
 */
export async function publicationRecordDigest(
  record: PublicationRecord,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      recordVersion: record.recordVersion,
      action: record.action,
      artifact: record.artifact,
      publisher: record.publisher,
      rights: record.rights,
      publishedAt: record.publishedAt,
      ...(record.supersedes !== undefined ? { supersedes: record.supersedes } : {}),
    }),
  );
}

function toPublisherRef(
  value: PrincipalRef | { type: string; tenant: string; principalId: string },
): PrincipalRef {
  if (isPrincipalRef(value)) return value;
  return toPrincipalRef(value);
}

export interface PublishArtifactInput {
  readonly artifact: MaterialArtifact<unknown>;
  readonly publisher:
    | PrincipalRef
    | { type: string; tenant: string; principalId: string };
  readonly rights: RightsMetadata | unknown;
  readonly publishedAt?: string;
}

/**
 * Create the publication record for an artifact. Fails closed when:
 *   - the artifact is structurally invalid or its claimed digest does not
 *     match its content (ARTIFACT_TAMPERED — "publishing a digest-mismatched
 *     artifact fails");
 *   - rights metadata is missing (ARTIFACT_MISSING_RIGHTS) or malformed
 *     (ARTIFACT_INVALID_RIGHTS);
 *   - the publisher or timestamp is invalid.
 * The record is frozen; publishing never mutates the artifact.
 */
export async function publishArtifact(
  input: PublishArtifactInput,
): Promise<PublicationRecord> {
  const publisher = toPublisherRef(input.publisher);
  const rights = toRightsMetadata(input.rights);
  const publishedAt =
    input.publishedAt === undefined ? nowTimestamp() : toTimestamp(input.publishedAt);

  // Fail closed on a tampered / digest-mismatched artifact.
  await verifyArtifact(input.artifact);

  const record: PublicationRecord = Object.freeze({
    recordVersion: PUBLICATION_RECORD_VERSION,
    action: 'publish',
    artifact: Object.freeze({
      namespace: input.artifact.identity.namespace,
      name: input.artifact.identity.name,
      version: input.artifact.identity.version,
      digest: input.artifact.digest,
    }),
    publisher,
    rights,
    publishedAt,
  });
  return record;
}

export interface RetractPublicationInput {
  readonly publication: PublicationRecord;
  readonly publisher:
    | PrincipalRef
    | { type: string; tenant: string; principalId: string };
  readonly retractedAt?: string;
}

/**
 * Create a retraction record for an existing publication. This NEVER edits
 * the original record — it produces a NEW append-only record whose
 * `supersedes` field carries the original record's digest. Only `publish`
 * records can be retracted.
 */
export async function retractPublication(
  input: RetractPublicationInput,
): Promise<PublicationRecord> {
  const original = input.publication;
  if (!isPublicationRecord(original)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'not a structurally valid publication record',
    });
  }
  if (original.action !== 'publish') {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'only publish records can be retracted (a retraction cannot be retracted)',
    });
  }
  const publisher = toPublisherRef(input.publisher);
  const publishedAt =
    input.retractedAt === undefined ? nowTimestamp() : toTimestamp(input.retractedAt);

  const record: PublicationRecord = Object.freeze({
    recordVersion: PUBLICATION_RECORD_VERSION,
    action: 'retract',
    artifact: original.artifact,
    publisher,
    rights: original.rights,
    publishedAt,
    supersedes: await publicationRecordDigest(original),
  });
  return record;
}

export const EMPTY_PUBLICATION_LEDGER: PublicationLedger = Object.freeze({ records: [] });

function recordEquals(a: PublicationRecord, b: PublicationRecord): boolean {
  return (
    a.recordVersion === b.recordVersion &&
    a.action === b.action &&
    isSameRef(a.artifact, b.artifact) &&
    a.publisher.type === b.publisher.type &&
    a.publisher.tenant === b.publisher.tenant &&
    a.publisher.principalId === b.publisher.principalId &&
    rightsEqual(a.rights, b.rights) &&
    a.publishedAt === b.publishedAt &&
    a.supersedes === b.supersedes
  );
}

function rightsEqual(a: RightsMetadata, b: RightsMetadata): boolean {
  if (
    a.license !== b.license ||
    a.commercialUse !== b.commercialUse ||
    a.redistribution !== b.redistribution ||
    a.customerData !== b.customerData
  ) {
    return false;
  }
  const aLimits = a.professionalLimitations ?? [];
  const bLimits = b.professionalLimitations ?? [];
  return (
    aLimits.length === bLimits.length && aLimits.every((item, i) => item === bLimits[i])
  );
}

function isSameRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return (
    a.namespace === b.namespace &&
    a.name === b.name &&
    a.version === b.version &&
    a.digest === b.digest
  );
}

/**
 * Append a record to a ledger (pure + async): returns a NEW ledger, the
 * input ledger is never modified. Enforces the append-only invariants:
 *   - a publish record for an identity already bound to a DIFFERENT digest
 *     (anywhere in history, even retracted) → ARTIFACT_IDENTITY_CONFLICT
 *     ("publishing an already-published-but-modified artifact fails");
 *   - an exact duplicate of the ACTIVE publish record is idempotent (the
 *     ledger is returned unchanged);
 *   - a publish record conflicting with the active publication's metadata
 *     → ARTIFACT_ALREADY_PUBLISHED (append-only history is never rewritten);
 *   - a retract record must supersede an existing, still-active publish
 *     record for the same artifact → ARTIFACT_INVALID_PUBLICATION otherwise.
 */
export async function appendPublicationRecord(
  ledger: PublicationLedger,
  record: PublicationRecord,
): Promise<PublicationLedger> {
  if (!isPublicationRecord(record)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'not a structurally valid publication record',
    });
  }

  const identityKey = `${record.artifact.namespace}/${record.artifact.name}@${record.artifact.version}`;

  if (record.action === 'publish') {
    const superseded = new Set<ContentDigest>();
    for (const existing of ledger.records) {
      if (existing.action === 'retract' && existing.supersedes !== undefined) {
        superseded.add(existing.supersedes);
      }
    }
    let activePublish: PublicationRecord | undefined;
    for (const existing of ledger.records) {
      const existingIdentity = `${existing.artifact.namespace}/${existing.artifact.name}@${existing.artifact.version}`;
      if (
        existingIdentity === identityKey &&
        existing.artifact.digest !== record.artifact.digest
      ) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `identity ${identityKey} is already bound to digest ${existing.artifact.digest}; publishing a different digest for the same identity is forbidden (artifacts are immutable)`,
          details: {
            identity: identityKey,
            bound: existing.artifact.digest,
            attempted: record.artifact.digest,
          },
        });
      }
      if (
        existing.action === 'publish' &&
        artifactRefKey(existing.artifact) === artifactRefKey(record.artifact)
      ) {
        const digest = await publicationRecordDigest(existing);
        // Retracted publications do not block republication (append-only
        // history keeps the superseded record; a new record re-publishes).
        if (!superseded.has(digest)) {
          activePublish = existing;
        }
      }
    }
    if (activePublish !== undefined) {
      if (recordEquals(activePublish, record)) {
        // Idempotent re-assertion of the exact same immutable publication.
        return ledger;
      }
      throw new ArtifactError(ARTIFACT_ERROR_CODES.ALREADY_PUBLISHED, {
        message: `artifact ${artifactRefKey(record.artifact)} is already actively published; publication records are never rewritten (retract first, or re-assert the identical record)`,
      });
    }
    return { records: Object.freeze([...ledger.records, record]) };
  }

  // Retraction: supersedes must reference an existing, still-active publish
  // record for the same artifact.
  if (record.supersedes === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'retract records must carry a supersedes digest',
    });
  }
  const superseded = new Set<ContentDigest>();
  for (const existing of ledger.records) {
    if (existing.action === 'retract' && existing.supersedes !== undefined) {
      superseded.add(existing.supersedes);
    }
  }
  let target: PublicationRecord | undefined;
  for (const existing of ledger.records) {
    if (existing.action !== 'publish') continue;
    if (artifactRefKey(existing.artifact) !== artifactRefKey(record.artifact)) continue;
    const digest = await publicationRecordDigest(existing);
    if (digest === record.supersedes) {
      target = existing;
      break;
    }
  }
  if (target === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: `retraction does not match any publication of ${artifactRefKey(record.artifact)} (unknown publication digest ${record.supersedes})`,
      details: { supersedes: record.supersedes },
    });
  }
  if (superseded.has(record.supersedes)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_PUBLICATION, {
      message: `publication digest ${record.supersedes} has already been retracted; a publication cannot be retracted twice`,
      details: { supersedes: record.supersedes },
    });
  }
  return { records: Object.freeze([...ledger.records, record]) };
}

/**
 * Resolve the visibility of an artifact identity from the ledger. Artifacts
 * are PRIVATE by default (lock rule 12); an identity is public exactly while
 * it has a publish record that has not been superseded by a retraction.
 */
export async function resolvePublication(
  ledger: PublicationLedger,
  identity: { namespace: string; name: string; version: string },
): Promise<PublicationStatus> {
  const identityKey = `${identity.namespace}/${identity.name}@${identity.version}`;
  const superseded = new Set<ContentDigest>();
  const publishes: { record: PublicationRecord; digest: ContentDigest }[] = [];

  for (const record of ledger.records) {
    if (record.action === 'retract' && record.supersedes !== undefined) {
      superseded.add(record.supersedes);
    }
  }
  for (const record of ledger.records) {
    if (record.action !== 'publish') continue;
    const recordIdentity = `${record.artifact.namespace}/${record.artifact.name}@${record.artifact.version}`;
    if (recordIdentity !== identityKey) continue;
    publishes.push({ record, digest: await publicationRecordDigest(record) });
  }

  // The active publication is the most recent publish not superseded by any
  // retraction (ledger order is append-only and therefore causal).
  for (let i = publishes.length - 1; i >= 0; i -= 1) {
    const entry = publishes[i];
    if (entry !== undefined && !superseded.has(entry.digest)) {
      return { visibility: 'public', publication: entry.record };
    }
  }
  return { visibility: 'private' };
}
