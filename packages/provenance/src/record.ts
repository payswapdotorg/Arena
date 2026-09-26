/**
 * ProvenanceRecord — full provenance for a material artifact
 * (docs/architecture.md §15): stable identity + version + digest,
 * source/creator (tenant-scoped principal, NEVER a raw provider identity),
 * timestamps (UTC, exactly millisecond precision), parent refs (lineage
 * edges), rights metadata (mandatory — lock rule 23), transformation
 * lineage and verification refs.
 *
 * Construction validates every component and rejects, among others:
 *   - missing rights metadata (PROVENANCE_MISSING_RIGHTS);
 *   - unknown principal types (PROVENANCE_INVALID_PRINCIPAL);
 *   - malformed timestamps (PROVENANCE_INVALID_TIMESTAMP);
 *   - self-references (PROVENANCE_CYCLE_DETECTED);
 *   - duplicate parent edges and transformation inputs that are not parents
 *     (PROVENANCE_INVALID_RECORD);
 *   - unsupported record wire versions (PROVENANCE_UNSUPPORTED_RECORD_VERSION).
 *
 * Records are deep-frozen; there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';
import type { ArtifactRefView, PrincipalRefView, RightsMetadataView } from './shared.js';
import {
  artifactRefViewKey,
  toArtifactRefView,
  toPrincipalRefView,
  toRightsMetadataView,
  toTimestampView,
} from './shared.js';

/** Wire version of the provenance record shape. */
export const PROVENANCE_RECORD_VERSION = 1 as const;

/** Closed set of lineage relations for parent edges. */
export const LINEAGE_RELATIONS = [
  'adapted-from',
  'composed-of',
  'derived-from',
  'extracted-from',
] as const;
export type LineageRelation = (typeof LINEAGE_RELATIONS)[number];

/** Closed set of verification evidence kinds. */
export const VERIFICATION_KINDS = [
  'attestation',
  'certification',
  'evaluation',
  'verification',
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** One parent edge: the parent artifact plus the lineage relation. */
export interface LineageEdge {
  readonly parent: ArtifactRefView;
  readonly relation: LineageRelation;
}

/** What transform produced this artifact from which parents. */
export interface TransformationLineage {
  readonly transform: ArtifactRefView;
  readonly inputs: readonly ArtifactRefView[];
}

/** A reference to verification evidence about the artifact. */
export interface VerificationRef {
  readonly kind: VerificationKind;
  readonly evidence: ArtifactRefView;
}

export interface ProvenanceRecord {
  readonly recordVersion: typeof PROVENANCE_RECORD_VERSION;
  readonly artifact: ArtifactRefView;
  readonly creator: PrincipalRefView;
  readonly createdAt: string;
  readonly recordedAt: string;
  readonly parents: readonly LineageEdge[];
  readonly transformation: TransformationLineage;
  readonly rights: RightsMetadataView;
  readonly verification: readonly VerificationRef[];
}

export function isLineageRelation(value: unknown): value is LineageRelation {
  return (
    typeof value === 'string' && (LINEAGE_RELATIONS as readonly string[]).includes(value)
  );
}

export function isVerificationKind(value: unknown): value is VerificationKind {
  return (
    typeof value === 'string' && (VERIFICATION_KINDS as readonly string[]).includes(value)
  );
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

export interface CreateProvenanceRecordInput {
  readonly artifact: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  };
  readonly creator: { type: string; tenant: string; principalId: string };
  readonly createdAt: string;
  readonly recordedAt?: string;
  readonly parents: readonly {
    parent: { namespace: string; name: string; version: string; digest: string };
    relation: string;
  }[];
  readonly transformation: {
    transform: { namespace: string; name: string; version: string; digest: string };
    inputs: readonly { namespace: string; name: string; version: string; digest: string }[];
  };
  readonly rights: unknown;
  readonly verification?: readonly {
    kind: string;
    evidence: { namespace: string; name: string; version: string; digest: string };
  }[];
}

/**
 * Create a validated, deep-frozen provenance record. Fails closed on every
 * invariant listed in the module doc.
 */
export function createProvenanceRecord(input: CreateProvenanceRecordInput): ProvenanceRecord {
  const artifact = toArtifactRefView(input.artifact);
  const creator = toPrincipalRefView(input.creator);
  const createdAt = toTimestampView(input.createdAt);
  const recordedAt = toTimestampView(input.recordedAt ?? input.createdAt);
  const rights = toRightsMetadataView(input.rights);

  if (input.parents === undefined || !Array.isArray(input.parents)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'provenance record requires a parents array (it may be empty)',
    });
  }
  if (input.transformation === undefined || input.transformation === null) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
      message: 'provenance record requires transformation lineage',
    });
  }
  const transform = toArtifactRefView(input.transformation.transform);
  const inputs = input.transformation.inputs.map((ref) => toArtifactRefView(ref));

  const artifactKey = artifactRefViewKey(artifact);
  const seenParents = new Set<string>();
  const parentKeys = new Set<string>();
  const parents: LineageEdge[] = input.parents.map((edge) => {
    if (!isLineageRelation(edge.relation)) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
        message: `unknown lineage relation: ${JSON.stringify(edge.relation)} (known: ${LINEAGE_RELATIONS.join(', ')})`,
        details: { known: [...LINEAGE_RELATIONS] },
      });
    }
    const parent = toArtifactRefView(edge.parent);
    const parentKey = artifactRefViewKey(parent);
    if (parentKey === artifactKey) {
      // Self-reference: the artifact cannot be its own parent.
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
        message: `provenance record lists its own artifact as a parent (self-reference): ${parentKey}`,
        details: { ref: parentKey },
      });
    }
    if (seenParents.has(parentKey)) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
        message: `duplicate parent edge for ${parentKey} (an artifact has at most one edge per parent)`,
        details: { ref: parentKey },
      });
    }
    seenParents.add(parentKey);
    parentKeys.add(parentKey);
    return { parent, relation: edge.relation };
  });

  // Every transformation input must be one of the declared parents.
  for (const inputRef of inputs) {
    if (!parentKeys.has(artifactRefViewKey(inputRef))) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
        message: `transformation input ${artifactRefViewKey(inputRef)} is not among the record parents`,
        details: { ref: artifactRefViewKey(inputRef) },
      });
    }
  }

  const verification: VerificationRef[] = (input.verification ?? []).map((ref) => {
    if (!isVerificationKind(ref.kind)) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
        message: `unknown verification kind: ${JSON.stringify(ref.kind)} (known: ${VERIFICATION_KINDS.join(', ')})`,
        details: { known: [...VERIFICATION_KINDS] },
      });
    }
    return { kind: ref.kind, evidence: toArtifactRefView(ref.evidence) };
  });

  const record: ProvenanceRecord = deepFreeze({
    recordVersion: PROVENANCE_RECORD_VERSION,
    artifact,
    creator,
    createdAt,
    recordedAt,
    parents: Object.freeze(parents.map((edge) => Object.freeze({ ...edge }))),
    transformation: Object.freeze({
      transform,
      inputs: Object.freeze([...inputs]),
    }),
    rights,
    verification: Object.freeze(
      verification.map((ref) => Object.freeze({ ...ref })),
    ),
  });
  return record;
}

export function isProvenanceRecord(value: unknown): value is ProvenanceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === PROVENANCE_RECORD_VERSION &&
    typeof candidate['artifact'] === 'object' &&
    candidate['artifact'] !== null &&
    typeof candidate['creator'] === 'object' &&
    candidate['creator'] !== null &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['recordedAt'] === 'string' &&
    Array.isArray(candidate['parents']) &&
    typeof candidate['transformation'] === 'object' &&
    candidate['transformation'] !== null &&
    typeof candidate['rights'] === 'object' &&
    candidate['rights'] !== null &&
    Array.isArray(candidate['verification'])
  );
}

/** sha256 digest over the canonical serialization of the record. */
export async function provenanceRecordDigest(record: ProvenanceRecord): Promise<string> {
  return digestCanonical(record);
}
