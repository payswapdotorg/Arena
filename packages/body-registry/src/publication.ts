/**
 * Release publication semantics (Work Order A024; requirements R23/R24;
 * architecture-lock rules 5, 6, 12, 16, 17, 18, 23 — mirrors the A002
 * PublicationRecord discipline applied to releases).
 *
 * A REGISTERED release becomes a CITABLE, CONTENT-ADDRESSED artifact
 * identity by explicit publication:
 *
 *   - `publishRelease` binds a validated registration record to a
 *     deterministic ReleasePublicationRecord. PUBLICATION IS
 *     REPRODUCIBLE: the record is content-addressed over the full
 *     publication view with a CALLER-SUPPLIED timestamp (no hidden
 *     clock reads — same inputs ⇒ same digest, byte-identical record);
 *   - PUBLICATION IS IDEMPOTENT: appending the identical publish record
 *     to a ledger returns the ledger unchanged; re-asserting the same
 *     publication under the same inputs mints the same record;
 *   - retraction NEVER edits the original record: it appends a NEW
 *     record (action 'retract') whose `supersedes` carries the digest
 *     of the publication being ended — the ledger is append-only;
 *   - identity immutability across the ledger: once a release identity
 *     (namespace/name/version) is bound to a digest by any publication
 *     record, publishing the SAME identity with a DIFFERENT digest is
 *     rejected (BODY_REGISTRY_IDENTITY_CONFLICT) — even after a
 *     retraction (A002 publication law);
 *   - only REGISTRATION records can be published (a supersession or
 *     retirement record is not publishable material);
 *   - publication carries MANDATORY rights metadata (lock rule 23,
 *     A003 RightsMetadataView) — a release without rights is
 *     unrepresentable.
 *
 * A release is UNPUBLISHED (private to its tenant) by default; it is
 * citable exactly while it has a publish record not superseded by a
 * retraction (resolveReleasePublication).
 */

import { digestCanonical } from '@arena/protocol-core';
import { isRightsMetadataView, toRightsMetadataView } from '@arena/agent-body';
import type { PrincipalRefView, RightsMetadataView } from '@arena/agent-body';
import { toPrincipalRefView } from '@arena/agent-body';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';
import type { ReleaseRecord } from './record.js';
import {
  isReleaseRecord,
  releaseArtifactIdentityKey,
  releaseArtifactRefKey,
  verifyReleaseRecord,
} from './record.js';
import type { ReleaseArtifactRef } from './record.js';
import { toContentDigest } from './shared.js';

/** The closed publication-action vocabulary. */
export const RELEASE_PUBLICATION_ACTIONS = Object.freeze(['publish', 'retract'] as const);

export type ReleasePublicationAction = (typeof RELEASE_PUBLICATION_ACTIONS)[number];

/** Structural (non-throwing) check for the action vocabulary. */
export function isReleasePublicationAction(
  value: unknown,
): value is ReleasePublicationAction {
  return (
    typeof value === 'string' &&
    (RELEASE_PUBLICATION_ACTIONS as readonly string[]).includes(value)
  );
}

/** Wire version of the release-publication shape. */
export const RELEASE_PUBLICATION_VERSION = 1 as const;

/** The digest-free view — exactly what the publication digest commits to. */
export interface ReleasePublicationView {
  readonly publicationVersion: typeof RELEASE_PUBLICATION_VERSION;
  readonly action: ReleasePublicationAction;
  /** The release made citable (publish) / whose publication ends (retract). */
  readonly release: ReleaseArtifactRef;
  /** Digest of the registration record being published. */
  readonly releaseRecordDigest: string;
  /** The tenant-scoped principal that performed the action. */
  readonly publisher: PrincipalRefView;
  /** MANDATORY rights metadata carried on the publication (lock rule 23). */
  readonly rights: RightsMetadataView;
  /** When the action was recorded (caller-supplied UTC timestamp). */
  readonly publishedAt: string;
  /** Retract only: digest of the publication record being superseded. */
  readonly supersedes: string | null;
}

/** A frozen, content-addressed publication record: the view plus its sha256 digest. */
export interface ReleasePublicationRecord extends ReleasePublicationView {
  readonly digest: string;
}

/** Stable field list for the publication view (tests mirror it). */
export const RELEASE_PUBLICATION_FIELDS = Object.freeze([
  'publicationVersion',
  'action',
  'release',
  'releaseRecordDigest',
  'publisher',
  'rights',
  'publishedAt',
  'supersedes',
] as const) as readonly string[];

/** Append-only publication history. */
export interface ReleasePublicationLedger {
  readonly records: readonly ReleasePublicationRecord[];
}

export const EMPTY_RELEASE_PUBLICATION_LEDGER: ReleasePublicationLedger = Object.freeze({
  records: [],
});

/** Structural (non-throwing) check for the publication view. */
export function isReleasePublicationView(value: unknown): value is ReleasePublicationView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const release = candidate['release'];
  if (
    typeof release !== 'object' ||
    release === null ||
    typeof (release as Record<string, unknown>)['namespace'] !== 'string' ||
    typeof (release as Record<string, unknown>)['name'] !== 'string' ||
    typeof (release as Record<string, unknown>)['version'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(String((release as Record<string, unknown>)['digest']))
  ) {
    return false;
  }
  return (
    candidate['publicationVersion'] === RELEASE_PUBLICATION_VERSION &&
    isReleasePublicationAction(candidate['action']) &&
    typeof candidate['releaseRecordDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['releaseRecordDigest']) &&
    isRightsMetadataView(candidate['rights']) &&
    typeof candidate['publishedAt'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(candidate['publishedAt']) &&
    (candidate['supersedes'] === null ||
      (typeof candidate['supersedes'] === 'string' &&
        candidate['action'] === 'retract' &&
        /^[0-9a-f]{64}$/.test(candidate['supersedes'])))
  );
}

/** Structural (non-throwing) check for the full publication record. */
export function isReleasePublicationRecord(
  value: unknown,
): value is ReleasePublicationRecord {
  if (!isReleasePublicationView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/**
 * Compute the content digest of a publication view: sha256 over the
 * canonical JSON of the digest-free view (the reproducibility anchor —
 * identical publication inputs commit to the identical digest).
 */
export async function releasePublicationDigest(
  view: ReleasePublicationView,
): Promise<string> {
  return toContentDigest(
    await digestCanonical({
      publicationVersion: view.publicationVersion,
      action: view.action,
      release: view.release,
      releaseRecordDigest: view.releaseRecordDigest,
      publisher: view.publisher,
      rights: view.rights,
      publishedAt: view.publishedAt,
      supersedes: view.supersedes,
    }),
    'release publication digest',
  );
}

// ---------------------------------------------------------------------------
// Publication constructors (deterministic, reproducible)
// ---------------------------------------------------------------------------

export interface PublishReleaseInput {
  /** The registration record whose release becomes citable. */
  readonly registration: ReleaseRecord;
  /** The tenant-scoped principal performing the publication. */
  readonly publisher: PrincipalRefView | { type: string; tenant: string; principalId: string };
  /** MANDATORY rights metadata (lock rule 23). */
  readonly rights: RightsMetadataView | unknown;
  /** The publication timestamp — caller-supplied, never a clock read. */
  readonly publishedAt: string;
}

/**
 * Create the PUBLISH record for a registered release. Fails closed when:
 *   - the registration record is not a structurally valid
 *     release-registration (BODY_REGISTRY_INVALID_PUBLICATION);
 *   - the registration record is tampered (BODY_REGISTRY_TAMPERED —
 *     digest recomputation fails closed);
 *   - rights metadata is missing/malformed (BODY_REGISTRY_INVALID_RIGHTS);
 *   - the publisher or timestamp is invalid.
 *
 * The output is deterministic: identical inputs mint the byte-identical
 * content-addressed record (publication is reproducible).
 */
export async function publishRelease(input: PublishReleaseInput): Promise<ReleasePublicationRecord> {
  const registration = input.registration;
  if (!isReleaseRecord(registration)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'publication requires a structurally valid release record',
    });
  }
  if (registration.kind !== 'release-registration' || registration.release === null) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: `only release-registration records can be published (got kind '${registration.kind}')`,
    });
  }
  await verifyReleaseRecord(registration); // fail closed on tampering

  const publisher = wrapValidation(
    BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION,
    () => toPrincipalRefView(input.publisher as Parameters<typeof toPrincipalRefView>[0]),
  );
  const rights = wrapValidation(BODY_REGISTRY_ERROR_CODES.INVALID_RIGHTS, () =>
    toRightsMetadataView(input.rights),
  );
  const publishedAt = input.publishedAt;
  if (
    typeof publishedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(publishedAt) ||
    Number.isNaN(Date.parse(publishedAt))
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: `publication timestamp must be canonical ms-precision UTC: ${JSON.stringify(publishedAt)}`,
    });
  }

  const view: ReleasePublicationView = {
    publicationVersion: RELEASE_PUBLICATION_VERSION,
    action: 'publish',
    release: registration.release,
    releaseRecordDigest: registration.digest,
    publisher,
    rights,
    publishedAt,
    supersedes: null,
  };
  const digest = await releasePublicationDigest(view);
  return Object.freeze({ ...view, digest }) as ReleasePublicationRecord;
}

export interface RetractReleaseInput {
  /** The publication record being ended (never mutated). */
  readonly publication: ReleasePublicationRecord;
  /** The tenant-scoped principal performing the retraction. */
  readonly publisher: PrincipalRefView | { type: string; tenant: string; principalId: string };
  /** The retraction timestamp — caller-supplied, never a clock read. */
  readonly retractedAt: string;
}

/**
 * Create a RETRACT record ending an existing publication. This NEVER
 * edits the original record — it produces a NEW append-only record
 * whose `supersedes` field carries the original's digest. Only 'publish'
 * records can be retracted (a retraction cannot be retracted).
 */
export async function retractRelease(input: RetractReleaseInput): Promise<ReleasePublicationRecord> {
  const original = input.publication;
  if (!isReleasePublicationRecord(original)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'retraction requires a structurally valid publication record',
    });
  }
  if (original.action !== 'publish') {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'only publish records can be retracted (a retraction cannot be retracted)',
    });
  }
  const publisher = wrapValidation(
    BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION,
    () => toPrincipalRefView(input.publisher as Parameters<typeof toPrincipalRefView>[0]),
  );
  const retractedAt = input.retractedAt;
  if (
    typeof retractedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(retractedAt) ||
    Number.isNaN(Date.parse(retractedAt))
  ) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: `retraction timestamp must be canonical ms-precision UTC: ${JSON.stringify(retractedAt)}`,
    });
  }

  const view: ReleasePublicationView = {
    publicationVersion: RELEASE_PUBLICATION_VERSION,
    action: 'retract',
    release: original.release,
    releaseRecordDigest: original.releaseRecordDigest,
    publisher,
    rights: original.rights,
    publishedAt: retractedAt,
    supersedes: original.digest,
  };
  const digest = await releasePublicationDigest(view);
  return Object.freeze({ ...view, digest }) as ReleasePublicationRecord;
}

function wrapValidation<T>(
  code: (typeof BODY_REGISTRY_ERROR_CODES)[keyof typeof BODY_REGISTRY_ERROR_CODES],
  fn: () => T,
): T {
  try {
    return fn();
  } catch (cause) {
    throw new BodyRegistryError(code, {
      message: `publication validation failed: ${(cause as Error).message}`,
      cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Ledger semantics (append-only, idempotent, identity-immutable)
// ---------------------------------------------------------------------------

function publicationEquals(a: ReleasePublicationRecord, b: ReleasePublicationRecord): boolean {
  return a.digest === b.digest;
}

/**
 * Append a publication record to a ledger (pure + async): returns a NEW
 * ledger; the input ledger is never modified. Enforces the append-only
 * publication invariants:
 *   - a publish record for an identity already bound to a DIFFERENT
 *     digest (anywhere in history, even retracted) →
 *     BODY_REGISTRY_IDENTITY_CONFLICT;
 *   - an exact duplicate of the ACTIVE publish record is IDEMPOTENT
 *     (the ledger is returned unchanged — publication is idempotent);
 *   - a publish record conflicting with the active publication's
 *     metadata → BODY_REGISTRY_PUBLICATION_CONFLICT (history is never
 *     rewritten; retract first or re-assert the identical record);
 *   - a retract record must supersede an existing, still-active publish
 *     record for the same release → BODY_REGISTRY_INVALID_PUBLICATION
 *     otherwise; a publication cannot be retracted twice.
 */
export async function appendReleasePublication(
  ledger: ReleasePublicationLedger,
  record: ReleasePublicationRecord,
): Promise<ReleasePublicationLedger> {
  if (!isReleasePublicationRecord(record)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'not a structurally valid release publication record',
    });
  }

  const identityKey = releaseArtifactIdentityKey(record.release);

  if (record.action === 'publish') {
    const superseded = new Set<string>();
    for (const existing of ledger.records) {
      if (existing.action === 'retract' && existing.supersedes !== null) {
        superseded.add(existing.supersedes);
      }
    }
    let activePublish: ReleasePublicationRecord | undefined;
    for (const existing of ledger.records) {
      const existingIdentity = releaseArtifactIdentityKey(existing.release);
      if (existingIdentity === identityKey && existing.release.digest !== record.release.digest) {
        throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `release identity ${identityKey} is already bound to digest ${existing.release.digest}; publishing a different digest for the same identity is forbidden (releases are immutable)`,
          details: {
            identity: identityKey,
            bound: existing.release.digest,
            attempted: record.release.digest,
          },
        });
      }
      if (
        existing.action === 'publish' &&
        releaseArtifactRefKey(existing.release) === releaseArtifactRefKey(record.release)
      ) {
        // Retracted publications do not block republication (append-only
        // history keeps the superseded record; a new record re-publishes).
        if (!superseded.has(existing.digest)) {
          activePublish = existing;
        }
      }
    }
    if (activePublish !== undefined) {
      if (publicationEquals(activePublish, record)) {
        // Idempotent re-assertion of the exact same immutable publication.
        return ledger;
      }
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.PUBLICATION_CONFLICT, {
        message: `release ${releaseArtifactRefKey(record.release)} is already actively published; publication records are never rewritten (retract first, or re-assert the identical record)`,
        details: {
          active: activePublish.digest,
          attempted: record.digest,
        },
      });
    }
    return { records: Object.freeze([...ledger.records, record]) };
  }

  // Retraction: supersedes must reference an existing, still-active publish
  // record for the same release.
  if (record.supersedes === null) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: 'retract records must carry a supersedes digest',
    });
  }
  const superseded = new Set<string>();
  for (const existing of ledger.records) {
    if (existing.action === 'retract' && existing.supersedes !== null) {
      superseded.add(existing.supersedes);
    }
  }
  let target: ReleasePublicationRecord | undefined;
  for (const existing of ledger.records) {
    if (existing.action !== 'publish') continue;
    if (releaseArtifactRefKey(existing.release) !== releaseArtifactRefKey(record.release)) continue;
    if (existing.digest === record.supersedes) {
      target = existing;
      break;
    }
  }
  if (target === undefined) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: `retraction does not match any publication of ${releaseArtifactRefKey(record.release)} (unknown publication digest ${record.supersedes})`,
      details: { supersedes: record.supersedes },
    });
  }
  if (superseded.has(record.supersedes)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_PUBLICATION, {
      message: `publication digest ${record.supersedes} has already been retracted; a publication cannot be retracted twice`,
      details: { supersedes: record.supersedes },
    });
  }
  return { records: Object.freeze([...ledger.records, record]) };
}

// ---------------------------------------------------------------------------
// Visibility projection
// ---------------------------------------------------------------------------

export type ReleaseVisibility = 'published' | 'unpublished';

export interface ActiveReleasePublication {
  readonly visibility: 'published';
  readonly publication: ReleasePublicationRecord;
}

export interface UnpublishedRelease {
  readonly visibility: 'unpublished';
}

export type ReleasePublicationStatus = ActiveReleasePublication | UnpublishedRelease;

/**
 * Resolve the visibility of a release identity from the ledger. A
 * release is UNPUBLISHED by default (tenant-private, lock rule 12); an
 * identity is citable exactly while it has a publish record that has
 * not been superseded by a retraction.
 */
export function resolveReleasePublication(
  ledger: ReleasePublicationLedger,
  identity: { namespace: string; name: string; version: string },
): ReleasePublicationStatus {
  const identityKey = releaseArtifactIdentityKey(identity);
  const superseded = new Set<string>();
  for (const record of ledger.records) {
    if (record.action === 'retract' && record.supersedes !== null) {
      superseded.add(record.supersedes);
    }
  }
  const publishes: ReleasePublicationRecord[] = [];
  for (const record of ledger.records) {
    if (record.action !== 'publish') continue;
    if (releaseArtifactIdentityKey(record.release) !== identityKey) continue;
    publishes.push(record);
  }
  // The active publication is the most recent publish not superseded by
  // any retraction (ledger order is append-only and therefore causal).
  for (let i = publishes.length - 1; i >= 0; i -= 1) {
    const entry = publishes[i];
    if (entry !== undefined && !superseded.has(entry.digest)) {
      return { visibility: 'published', publication: entry };
    }
  }
  return { visibility: 'unpublished' };
}
