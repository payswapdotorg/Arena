/**
 * Public dataset packaging for the research layer (Work Order A030;
 * requirement R23 "publish versioned bodies, datasets, evaluations and
 * environments" -- exercised through the REUSED A014 dataset
 * discipline, never reimplemented here).
 *
 * Helpers to package research objects (benchmark descriptors, scoring
 * methodologies, result records, leaderboard snapshots) as A014
 * DatasetManifests in the reserved PUBLIC namespace, and to resolve +
 * verify them as DatasetBundles. Every dataset therefore inherits:
 *
 *   - A002 content-addressed identity (namespace/name@version + digest);
 *   - the A014 manifest discipline (entries checksum, tenant-scope
 *     guard: only the dataset's own namespace or `public` may be
 *     referenced -- public research datasets reference public
 *     artifacts);
 *   - the A014 bundle discipline (fail-closed resolution of every
 *     entry, digest re-verification).
 */

import { PUBLIC_NAMESPACE } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import {
  createDatasetManifest,
  resolveDatasetBundle,
  toDatasetEntries,
  verifyDatasetBundle,
  verifyDatasetManifest,
} from '@arena/datasets';
import type { DatasetBundle, DatasetManifest } from '@arena/datasets';
import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';

/** The reserved public namespace (re-exported for consumers' convenience). */
export const RESEARCH_PUBLIC_NAMESPACE = PUBLIC_NAMESPACE;

export interface ResearchDatasetEntrySpec {
  /** The A014 dataset entry role: input | output | eval | split. */
  readonly role: 'input' | 'output' | 'eval' | 'split';
  /** A neutral artifact name for the packaged artifact. */
  readonly name: string;
  /** The semver version of the packaged artifact. */
  readonly version: string;
  /** The content to package (a research object view or literal). */
  readonly content: unknown;
}

export interface CreateResearchDatasetInput {
  /** Neutral dataset name (the artifact name of the manifest identity). */
  readonly name: string;
  /** Semver version of the dataset (no build metadata). */
  readonly version: string;
  /** The entries to package (at least one). */
  readonly entries: readonly ResearchDatasetEntrySpec[];
  /** Dataset-level provenance notes. */
  readonly notes: string;
  /** ms-precision UTC timestamp of packaging. */
  readonly createdAt: string;
  /** Neutral id of the packaging principal. */
  readonly creatorId: string;
}

/**
 * Package research content as a PUBLIC A014 dataset: each entry becomes
 * a in-public-namespace MaterialArtifact (content-addressed via A002),
 * and the manifest binds them with an `eval`-role verification entry
 * set. Returns the manifest plus the materialized artifacts so callers
 * can resolve the bundle.
 */
export async function createResearchDataset(
  input: CreateResearchDatasetInput,
): Promise<{ manifest: DatasetManifest; artifacts: readonly MaterialArtifact<unknown>[] }> {
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PINS, {
      message: 'research dataset: at least one entry is required',
    });
  }
  const artifacts: MaterialArtifact<unknown>[] = [];
  for (const entry of input.entries) {
    artifacts.push(
      await createMaterialArtifact({
        identity: { namespace: PUBLIC_NAMESPACE, name: entry.name, version: entry.version },
        content: entry.content,
      }),
    );
  }
  const manifest = await createDatasetManifest({
    identity: { namespace: PUBLIC_NAMESPACE, name: input.name, version: input.version },
    entries: artifacts.map((artifact, index) => ({
      role: input.entries[index]!.role,
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
    })),
    provenance: {
      creator: { type: 'service', tenant: PUBLIC_NAMESPACE, principalId: input.creatorId },
      createdAt: input.createdAt,
      parents: [],
      rights: {
        license: 'CC-BY-4.0',
        commercialUse: 'allowed',
        redistribution: 'allowed',
        customerData: 'none',
        professionalLimitations: [input.notes],
      },
      verification: [],
    },
  });
  return { manifest, artifacts };
}

/**
 * Resolve a research dataset bundle: every entry must resolve to the
 * exact content-addressed artifact (fail-closed), through the REUSED
 * A014 discipline.
 */
export async function resolveResearchDataset(
  manifest: DatasetManifest,
  artifacts: readonly MaterialArtifact<unknown>[],
): Promise<DatasetBundle> {
  const byRef = new Map(
    artifacts.map((artifact) => [
      `${artifact.identity.namespace}/${artifact.identity.name}@${artifact.identity.version}#${artifact.digest}`,
      artifact,
    ]),
  );
  return resolveDatasetBundle(manifest, (ref) => {
    const key = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    return byRef.get(key) ?? null;
  });
}

/**
 * Verify a research dataset bundle end-to-end: manifest digest,
 * entries checksum, per-entry resolution and bundle digest -- all
 * through the REUSED A014 verify chain.
 */
export async function verifyResearchDataset(
  bundle: DatasetBundle,
  artifacts: readonly MaterialArtifact<unknown>[],
): Promise<string> {
  await verifyDatasetManifest(bundle.manifest);
  const byRef = new Map(
    artifacts.map((artifact) => [
      `${artifact.identity.namespace}/${artifact.identity.name}@${artifact.identity.version}#${artifact.digest}`,
      artifact,
    ]),
  );
  return verifyDatasetBundle(bundle, (ref) => {
    const key = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    return byRef.get(key) ?? null;
  });
}

/**
 * The canonical entry list helper for research datasets (sorted, role-
 * validated) -- the A014 toDatasetEntries discipline reused.
 */
export function researchDatasetEntries(
  entries: readonly {
    role: string;
    artifact: { namespace: string; name: string; version: string; digest: string };
  }[],
): ReturnType<typeof toDatasetEntries> {
  return toDatasetEntries(entries as Parameters<typeof toDatasetEntries>[0]);
}
