/**
 * DatasetVersioning (Work Order A014) — dataset identity and version
 * pinning on top of the A002 ArtifactIdentity (requirements R14, R23;
 * architecture-lock rules 5, 12, 18, 22).
 *
 *   - A DATASET version is an A002 ArtifactIdentity (namespace/name/semver;
 *     `public` reserved, else tenant scope) PINNED to exactly one manifest
 *     digest. The pin is immutable: a DatasetVersion is frozen data, and the
 *     DatasetVersionRegistry enforces binding permanence — re-pinning the
 *     same identity to a DIFFERENT manifest digest is REJECTED with
 *     DATASET_IDENTITY_CONFLICT (never overwritten); re-pinning the exact
 *     same digest is idempotent.
 *   - A new dataset version is a NEW manifest (no in-place mutation — see
 *     manifest.ts); versioning only records which manifest digest each
 *     identity+version is pinned to.
 *   - Split/subset derivations are LINEAGE-RECORDED TRANSFORMATIONS: the
 *     child manifest carries parent refs (the parent manifest's
 *     content-addressed ref, relation `extracted-from` for splits/subsets or
 *     `derived-from` for general derivations), so the derivation is
 *     auditable through the ordinary manifest provenance (§15) and through
 *     the A014 lineage service. Derivations stay INSIDE the parent's tenant
 *     namespace (R24: no silent cross-tenant dataset derivation).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { ContentDigest } from '@arena/artifact-protocol';
import {
  artifactRefKey,
  toArtifactIdentity,
  toContentDigest,
} from '@arena/artifact-protocol';
import type { ArtifactIdentity, ArtifactRef } from '@arena/artifact-protocol';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import type { DatasetManifest } from './manifest.js';
import { createDatasetManifest } from './manifest.js';

/** Field list of a dataset version pin (parity-checked against the contracts). */
export const DATASET_VERSION_FIELDS = Object.freeze(['identity', 'manifestDigest'] as const);

/** Relations allowed for dataset derivation edges (subset of the provenance vocabulary). */
export const DATASET_DERIVATION_RELATIONS = Object.freeze(['derived-from', 'extracted-from', 'composed-of'] as const);
export type DatasetDerivationRelation = (typeof DATASET_DERIVATION_RELATIONS)[number];

/**
 * A pinned dataset version: the dataset identity (including the semver
 * version) and the manifest digest it is permanently bound to.
 */
export interface DatasetVersion {
  readonly identity: ArtifactIdentity;
  readonly manifestDigest: ContentDigest;
}

export function isDatasetVersion(value: unknown): value is DatasetVersion {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['identity'] === 'object' &&
    candidate['identity'] !== null &&
    typeof (candidate['identity'] as Record<string, unknown>)['namespace'] === 'string' &&
    typeof (candidate['identity'] as Record<string, unknown>)['name'] === 'string' &&
    typeof (candidate['identity'] as Record<string, unknown>)['version'] === 'string' &&
    typeof candidate['manifestDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['manifestDigest'])
  );
}

/** Validate and freeze a dataset version pin. */
export function toDatasetVersion(value: {
  identity: { namespace: string; name: string; version: string };
  manifestDigest: string;
}): DatasetVersion {
  const identity = toArtifactIdentity(value.identity);
  const manifestDigest = toContentDigest(value.manifestDigest);
  return Object.freeze({ identity, manifestDigest });
}

/** Stable key for a version pin: `<namespace>/<name>@<version>`. */
export function datasetVersionKey(version: DatasetVersion): string {
  return `${version.identity.namespace}/${version.identity.name}@${version.identity.version}`;
}

/**
 * The in-process reference registry of dataset version pins (pure Maps —
 * the house in-process reference-store style; durable persistence is a
 * deployment-tier concern, deliberately NOT modeled here).
 *
 * Binding permanence: once an identity+version is pinned to a manifest
 * digest, pinning it to a DIFFERENT digest is rejected (artifacts are
 * immutable — a version pins exactly one manifest forever); pinning the
 * exact same digest is idempotent.
 */
export class DatasetVersionRegistry {
  private readonly pins = new Map<string, DatasetVersion>();

  /**
   * Pin a dataset version to a manifest digest. Idempotent for the exact
   * same (identity, manifestDigest) pair; an identity re-pinned to a
   * different digest fails closed with DATASET_IDENTITY_CONFLICT.
   */
  async pin(version: DatasetVersion): Promise<DatasetVersion> {
    if (!isDatasetVersion(version)) {
      throw new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'not a structurally valid dataset version pin',
      });
    }
    const key = datasetVersionKey(version);
    const existing = this.pins.get(key);
    if (existing !== undefined) {
      if (existing.manifestDigest === version.manifestDigest) {
        return existing; // idempotent re-pin
      }
      throw new DatasetError(DATASET_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `dataset version ${key} is already pinned to manifest ${existing.manifestDigest}; pinning a different manifest for the same version is forbidden (dataset versions are immutable)`,
        details: {
          identity: key,
          pinned: existing.manifestDigest,
          attempted: version.manifestDigest,
        },
      });
    }
    this.pins.set(key, version);
    return version;
  }

  /** The pinned version for an exact identity (undefined when unknown). */
  async resolve(identity: {
    namespace: string;
    name: string;
    version: string;
  }): Promise<DatasetVersion | undefined> {
    const candidate = toArtifactIdentity(identity);
    return this.pins.get(`${candidate.namespace}/${candidate.name}@${candidate.version}`);
  }

  /**
   * Every version of one dataset NAME within a namespace, deterministically
   * ordered by semver precedence (A002 compareArtifactVersions), lowest
   * first.
   */
  async listVersions(namespace: string, name: string): Promise<readonly DatasetVersion[]> {
    const prefix = `${namespace}/${name}@`;
    const found: DatasetVersion[] = [];
    for (const pin of this.pins.values()) {
      if (datasetVersionKey(pin).startsWith(prefix)) found.push(pin);
    }
    return Object.freeze(
      found.sort((a, b) => compareSemver(a.identity.version, b.identity.version)),
    );
  }

  /** Every pin in the registry (deterministic order by pin key). */
  async list(): Promise<readonly DatasetVersion[]> {
    return Object.freeze(
      [...this.pins.values()].sort((a, b) =>
        datasetVersionKey(a) < datasetVersionKey(b) ? -1 : 1,
      ),
    );
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number[], string[] | null] => {
    const [core, pre] = v.split('-', 2) as [string, string | undefined];
    const coreParts = core.split('.').map((part) => Number.parseInt(part, 10));
    if (pre === undefined) return [coreParts, null];
    return [coreParts, pre.split('.')];
  };
  const [aCore, aPre] = parse(a);
  const [bCore, bPre] = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const aPart = aCore[i] ?? 0;
    const bPart = bCore[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  if (aPre === null && bPre === null) return 0;
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return aPre.join('.') < bPre.join('.') ? -1 : aPre.join('.') > bPre.join('.') ? 1 : 0;
}

export interface DeriveDatasetInput {
  /** The parent manifest this dataset is derived/split from. */
  readonly parent: DatasetManifest;
  /** The child dataset identity (its own version). */
  readonly identity: { namespace: string; name: string; version: string };
  /**
   * The declared entries of the child (a subset of the parent's entries for
   * splits/subsets, or a new entry list for general derivations).
   */
  readonly entries: readonly {
    role: string;
    artifact: { namespace: string; name: string; version: string; digest: string };
  }[];
  readonly provenance: {
    readonly creator: { type: string; tenant: string; principalId: string };
    readonly createdAt: string;
    readonly rights: unknown;
    readonly verification?: readonly {
      kind: string;
      evidence: { namespace: string; name: string; version: string; digest: string };
    }[];
  };
  /** The lineage relation for the parent edge (default: extracted-from). */
  readonly relation?: string;
}

/** The content-addressed ref of a manifest: its dataset identity + manifest digest. */
export function datasetManifestRef(manifest: DatasetManifest): ArtifactRef {
  return {
    namespace: manifest.identity.namespace,
    name: manifest.identity.name,
    version: manifest.identity.version,
    digest: manifest.digest,
  };
}

/**
 * Derive a child dataset manifest from a parent manifest as a
 * lineage-recorded transformation: the child manifest carries a parent ref
 * (the parent manifest, content-addressed) with the derivation relation.
 * The child MUST live in the parent's namespace (tenant scoping — R24).
 */
export async function deriveDatasetManifest(
  input: DeriveDatasetInput,
): Promise<DatasetManifest> {
  const relation: string = input.relation ?? 'extracted-from';
  if (
    !(DATASET_DERIVATION_RELATIONS as readonly string[]).includes(relation)
  ) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_PROVENANCE, {
      message: `unknown dataset derivation relation: ${JSON.stringify(relation)} (known: ${DATASET_DERIVATION_RELATIONS.join(', ')})`,
      details: { relation },
    });
  }
  if (input.identity.namespace !== input.parent.identity.namespace) {
    throw new DatasetError(DATASET_ERROR_CODES.INVALID_IDENTITY, {
      message: `derived dataset namespace ${input.identity.namespace} differs from the parent namespace ${input.parent.identity.namespace} (tenant scoping: derivations stay inside the parent's tenant scope)`,
      details: {
        parentNamespace: input.parent.identity.namespace,
        childNamespace: input.identity.namespace,
      },
    });
  }
  const parentRef = datasetManifestRef(input.parent);
  return createDatasetManifest({
    identity: input.identity,
    entries: input.entries,
    provenance: {
      creator: input.provenance.creator,
      createdAt: input.provenance.createdAt,
      parents: [{ parent: parentRef, relation }],
      rights: input.provenance.rights,
      ...(input.provenance.verification !== undefined
        ? { verification: input.provenance.verification }
        : {}),
    },
  });
}

/**
 * Compute the digest of a parent manifest as used inside child parent refs
 * (helper for lineage bookkeeping; the ref itself already carries it).
 */
export async function datasetParentRefDigest(manifest: DatasetManifest): Promise<string> {
  return digestCanonical({
    namespace: manifest.identity.namespace,
    name: manifest.identity.name,
    version: manifest.identity.version,
    digest: manifest.digest,
  });
}

/** Stable key helper mirroring the A002 artifact ref key for manifest refs. */
export function datasetManifestRefKey(manifest: DatasetManifest): string {
  return artifactRefKey(datasetManifestRef(manifest));
}
