/**
 * DatasetManifest (Work Order A014) — a versioned, content-addressed
 * packaging of a DATASET (requirements R14, R23; architecture-lock rules 5,
 * 12, 18, 23; docs/architecture.md §15).
 *
 * A manifest binds:
 *   - an A002 ArtifactIdentity (namespace/name/semver — `public` reserved,
 *     everything else tenant scope) — the DATASET's identity, not the
 *     entries' identities;
 *   - declared entries (A002 artifact refs by digest + closed role
 *     vocabulary — see entry.ts);
 *   - dataset-level provenance per docs/architecture.md §15: source/creator
 *     (tenant-scoped PrincipalRef), timestamps, parent refs (lineage edges
 *     carrying the REUSED @arena/provenance relation vocabulary), rights
 *     metadata (mandatory — lock rule 23) and verification refs (closed
 *     @arena/provenance kinds; kind `evaluation` carries A012 evaluation
 *     record digests, kind `verification`/`attestation` carries A013
 *     verification-record digests);
 *   - an entriesChecksum — a sha256 commitment over the canonically sorted
 *     entry list, independently verifiable from the manifest digest;
 *   - the manifest digest — sha256 over the canonical JSON of the
 *     digest-free view (canonicalization + hashing REUSED from
 *     @arena/protocol-core via @arena/artifact-protocol's digest primitives;
 *     never reimplemented here).
 *
 * Immutability: createDatasetManifest validates, computes the checksum and
 * digest and DEEP-FREEZES the result. There is no mutation API — a new
 * dataset version is a NEW manifest (see versioning.ts).
 *
 * Tenant scoping (R24 / lock rule 11): every referenced namespace (entries,
 * parent refs, verification evidence) must be the dataset's own namespace or
 * the reserved `public` namespace — a manifest cannot silently reference
 * another tenant's artifacts.
 *
 * Tamper detection: verifyDatasetManifest recomputes BOTH the entries
 * checksum and the digest and fails closed with DATASET_TAMPERED on any
 * mismatch.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { ContentDigest } from '@arena/artifact-protocol';
import {
  PUBLIC_NAMESPACE,
  artifactRefKey,
  isArtifactRef,
  toArtifactIdentity,
  toArtifactRef,
  toContentDigest,
  toPrincipalRef,
  toRightsMetadata,
  toTimestamp,
} from '@arena/artifact-protocol';
import type { ArtifactIdentity, ArtifactRef, PrincipalRef, RightsMetadata, Timestamp } from '@arena/artifact-protocol';
import { isLineageRelation, isVerificationKind } from '@arena/provenance';
import type { LineageRelation, VerificationKind } from '@arena/provenance';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import type { DatasetEntry } from './entry.js';
import { compareDatasetEntries, toDatasetEntries } from './entry.js';

/** Wire version of the dataset manifest shape. */
export const DATASET_MANIFEST_VERSION = 1 as const;

/** Field list of the manifest (parity-checked against the contracts). */
export const DATASET_MANIFEST_FIELDS = Object.freeze([
  'manifestVersion',
  'identity',
  'entries',
  'provenance',
  'entriesChecksum',
  'digest',
] as const);

/** Field list of dataset-level provenance (§15 parity). */
export const DATASET_PROVENANCE_FIELDS = Object.freeze([
  'creator',
  'createdAt',
  'parents',
  'rights',
  'verification',
] as const);

/** Field list of one lineage edge (parity-checked against the contracts). */
export const DATASET_LINEAGE_EDGE_FIELDS = Object.freeze(['parent', 'relation'] as const);

/** Field list of one verification ref (parity-checked against the contracts). */
export const DATASET_VERIFICATION_REF_FIELDS = Object.freeze(['kind', 'evidence'] as const);

/** One parent edge: the parent (manifest or artifact) reference plus the lineage relation. */
export interface DatasetLineageEdge {
  readonly parent: ArtifactRef;
  readonly relation: LineageRelation;
}

/**
 * A reference to verification/evaluation evidence about the dataset:
 * kind `evaluation` carries A012 evaluation-record digests; kinds
 * `verification`/`attestation` carry A013 verification-record digests.
 */
export interface DatasetVerificationRef {
  readonly kind: VerificationKind;
  readonly evidence: ArtifactRef;
}

/** Dataset-level provenance (docs/architecture.md §15, subset for packaging). */
export interface DatasetProvenance {
  readonly creator: PrincipalRef;
  readonly createdAt: Timestamp;
  readonly parents: readonly DatasetLineageEdge[];
  readonly rights: RightsMetadata;
  readonly verification: readonly DatasetVerificationRef[];
}

/** Digest-free view of a dataset manifest — exactly what the digest covers. */
export interface DatasetManifestView {
  readonly manifestVersion: typeof DATASET_MANIFEST_VERSION;
  readonly identity: ArtifactIdentity;
  readonly entries: readonly DatasetEntry[];
  readonly provenance: DatasetProvenance;
  readonly entriesChecksum: ContentDigest;
}

/** A frozen dataset manifest: the view plus its sha256 digest. */
export interface DatasetManifest extends DatasetManifestView {
  readonly digest: ContentDigest;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** The namespace scope guard: own namespace or the reserved public one. */
function requireScopedNamespace(
  datasetNamespace: string,
  refNamespace: string,
  what: string,
  key: string,
): void {
  if (refNamespace !== datasetNamespace && refNamespace !== PUBLIC_NAMESPACE) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
      message: `${what} ${key} references namespace ${refNamespace}, which is outside the dataset scope ${datasetNamespace} (tenant scoping: only the dataset's own namespace or the reserved public namespace may be referenced)`,
      details: { datasetNamespace, refNamespace, ref: key },
    });
  }
}

/**
 * Compute the sha256 entries checksum over the canonically sorted entry
 * list ({role, artifact} sorted by entry key). Deterministic: the same
 * entry SET always yields the same checksum regardless of declaration
 * order.
 */
export async function computeDatasetEntriesChecksum(
  entries: readonly DatasetEntry[],
): Promise<ContentDigest> {
  const sorted = [...entries].sort(compareDatasetEntries);
  return toContentDigest(
    await digestCanonical(sorted.map((entry) => ({ role: entry.role, artifact: entry.artifact }))),
  );
}

/** Compute the manifest digest over the canonical digest-free view. */
export async function computeDatasetManifestDigest(
  view: DatasetManifestView,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      manifestVersion: view.manifestVersion,
      identity: view.identity,
      entries: [...view.entries],
      provenance: view.provenance,
      entriesChecksum: view.entriesChecksum,
    }),
  );
}

export interface CreateDatasetManifestInput {
  readonly identity: { namespace: string; name: string; version: string };
  readonly entries: readonly {
    role: string;
    artifact: { namespace: string; name: string; version: string; digest: string };
  }[];
  readonly provenance: {
    readonly creator: { type: string; tenant: string; principalId: string };
    readonly createdAt: string;
    readonly parents?: readonly {
      parent: { namespace: string; name: string; version: string; digest: string };
      relation: string;
    }[];
    readonly rights: unknown;
    readonly verification?: readonly {
      kind: string;
      evidence: { namespace: string; name: string; version: string; digest: string };
    }[];
  };
}

/**
 * Create an immutable dataset manifest: validates the identity, entries and
 * §15 provenance through the REUSED A002/provenance guards, enforces tenant
 * scoping on every referenced namespace, computes the entries checksum and
 * the manifest digest, and deep-freezes the result.
 */
export async function createDatasetManifest(
  input: CreateDatasetManifestInput,
): Promise<DatasetManifest> {
  const identity = toArtifactIdentity(input.identity);
  const entries = toDatasetEntries(input.entries);
  for (const entry of entries) {
    requireScopedNamespace(
      identity.namespace,
      entry.artifact.namespace,
      'dataset entry',
      artifactRefKey(entry.artifact),
    );
  }

  if (input.provenance === undefined || input.provenance === null) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'a dataset manifest requires dataset-level provenance (§15)',
    });
  }
  const creator = toPrincipalRef(input.provenance.creator);
  const createdAt = toTimestamp(input.provenance.createdAt);
  const rights = toRightsMetadata(input.provenance.rights);

  const parentInput = input.provenance.parents ?? [];
  const seenParents = new Set<string>();
  const parents: DatasetLineageEdge[] = parentInput.map((edge) => {
    if (!isLineageRelation(edge.relation)) {
      throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
        message: `unknown lineage relation: ${JSON.stringify(edge.relation)} (known: derived-from, extracted-from, composed-of, adapted-from)`,
        details: { relation: edge.relation },
      });
    }
    const parent = toArtifactRef(edge.parent);
    const parentKey = artifactRefKey(parent);
    if (
      parent.namespace === identity.namespace &&
      parent.name === identity.name &&
      parent.version === identity.version
    ) {
      throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
        message: `dataset manifest lists itself as a parent (self-reference): ${parentKey}`,
        details: { ref: parentKey },
      });
    }
    if (seenParents.has(parentKey)) {
      throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
        message: `duplicate parent edge for ${parentKey} (at most one edge per parent)`,
        details: { ref: parentKey },
      });
    }
    seenParents.add(parentKey);
    requireScopedNamespace(identity.namespace, parent.namespace, 'parent ref', parentKey);
    return { parent, relation: edge.relation };
  });

  const verificationInput = input.provenance.verification ?? [];
  const verification: DatasetVerificationRef[] = verificationInput.map((ref) => {
    if (!isVerificationKind(ref.kind)) {
      throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
        message: `unknown verification kind: ${JSON.stringify(ref.kind)} (known: attestation, certification, evaluation, verification)`,
        details: { kind: ref.kind },
      });
    }
    const kind: VerificationKind = ref.kind;
    const evidence = toArtifactRef(ref.evidence);
    requireScopedNamespace(
      identity.namespace,
      evidence.namespace,
      'verification evidence ref',
      artifactRefKey(evidence),
    );
    return { kind, evidence };
  });

  const provenance: DatasetProvenance = deepFreeze({
    creator,
    createdAt,
    parents: Object.freeze(parents.map((edge) => Object.freeze({ ...edge }))),
    rights,
    verification: Object.freeze(verification.map((ref) => Object.freeze({ ...ref }))),
  });

  const entriesChecksum = await computeDatasetEntriesChecksum(entries);
  const view: DatasetManifestView = {
    manifestVersion: DATASET_MANIFEST_VERSION,
    identity,
    entries,
    provenance,
    entriesChecksum,
  };
  const digest = await computeDatasetManifestDigest(view);
  const manifest: DatasetManifest = deepFreeze({
    ...view,
    digest,
  });
  return manifest;
}

export function isDatasetManifest(value: unknown): value is DatasetManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['manifestVersion'] === DATASET_MANIFEST_VERSION &&
    typeof candidate['identity'] === 'object' &&
    candidate['identity'] !== null &&
    Array.isArray(candidate['entries']) &&
    candidate['entries'].length > 0 &&
    candidate['entries'].every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        isArtifactRef((entry as Record<string, unknown>)['artifact']) &&
        typeof (entry as Record<string, unknown>)['role'] === 'string',
    ) &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null &&
    typeof candidate['entriesChecksum'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['entriesChecksum']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a manifest (what the digest commits to). */
export function datasetManifestView(manifest: DatasetManifest): DatasetManifestView {
  return {
    manifestVersion: manifest.manifestVersion,
    identity: manifest.identity,
    entries: manifest.entries,
    provenance: manifest.provenance,
    entriesChecksum: manifest.entriesChecksum,
  };
}

/**
 * Re-compute a manifest's entries checksum and digest and compare them with
 * the claimed values (or explicitly expected ones). FAILS CLOSED with
 * DATASET_TAMPERED on any mismatch — a mutation of identity, entries or
 * provenance is always detected. Returns the verified digest.
 */
export async function verifyDatasetManifest(
  manifest: DatasetManifest,
  expectedDigest?: ContentDigest,
): Promise<ContentDigest> {
  if (!isDatasetManifest(manifest)) {
    const candidate = manifest as unknown;
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Record<string, unknown>)['manifestVersion'] !== undefined &&
      (candidate as Record<string, unknown>)['manifestVersion'] !== DATASET_MANIFEST_VERSION
    ) {
      throw new DatasetError(DATASET_ERROR_CODES.UNSUPPORTED_MANIFEST_VERSION, {
        message: `unsupported dataset manifest version: ${String((candidate as Record<string, unknown>)['manifestVersion'])} (this build understands version ${DATASET_MANIFEST_VERSION})`,
      });
    }
    throw new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
      message: 'not a structurally valid dataset manifest',
    });
  }

  const actualChecksum = await computeDatasetEntriesChecksum(manifest.entries);
  if (actualChecksum !== manifest.entriesChecksum) {
    throw new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
      message: `dataset entries checksum mismatch: expected ${manifest.entriesChecksum}, recomputed ${actualChecksum}`,
      details: { expected: manifest.entriesChecksum, actual: actualChecksum },
    });
  }

  const actual = await computeDatasetManifestDigest(datasetManifestView(manifest));
  const claimed = expectedDigest ?? manifest.digest;
  if (actual !== claimed) {
    throw new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
      message: `dataset manifest digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}
