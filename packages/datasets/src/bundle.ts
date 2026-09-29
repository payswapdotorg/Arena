/**
 * DatasetBundle (Work Order A014) — the resolution of a DatasetManifest
 * into a verifiable bundle (requirements R14, R23; architecture-lock rule
 * 18).
 *
 * `resolveDatasetBundle(manifest, resolver)`:
 *   1. verifies the manifest (digest chain: manifest digest + entries
 *      checksum) — fail closed with DATASET_TAMPERED;
 *   2. resolves EVERY declared entry through the resolver (the A002
 *      ArtifactResolver type — an (artifact store) or a plain test map);
 *   3. checks each resolved artifact carries the entry's EXACT identity and
 *      digest and re-verifies its content through the REUSED A002
 *      verifyArtifact (tamper → ARTIFACT_TAMPERED from A002, propagated);
 *   4. any missing entry (resolver returns null) fails closed with
 *      DATASET_UNRESOLVED_ENTRY; any identity/digest mismatch fails closed
 *      with DATASET_TAMPERED;
 *   5. computes the bundle digest over the canonical view
 *      { bundleVersion, manifestDigest, entries (sorted entry keys) } —
 *      DETERMINISTIC: the same manifest always resolves to the same bundle
 *      digest, whatever the resolver's iteration order.
 *
 * `verifyDatasetBundle(bundle, resolver)` re-runs the whole chain.
 *
 * Bundles are deep-frozen; there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { ContentDigest } from '@arena/artifact-protocol';
import type { ArtifactRef, MaterialArtifact } from '@arena/artifact-protocol';
import {
  artifactRefKey,
  toContentDigest,
  verifyArtifact,
} from '@arena/artifact-protocol';
import { DATASET_ERROR_CODES, DatasetError } from './errors.js';
import type { DatasetManifest } from './manifest.js';
import { verifyDatasetManifest } from './manifest.js';

/** Wire version of the dataset bundle shape. */
export const DATASET_BUNDLE_VERSION = 1 as const;

/** Field list of the bundle (parity-checked against the contracts). */
export const DATASET_BUNDLE_FIELDS = Object.freeze(['bundleVersion', 'manifest', 'bundleDigest'] as const);

/**
 * A resolved, fully verified dataset bundle: the frozen manifest it was
 * resolved from plus the deterministic bundle digest. Bundle resolution
 * verified every entry digest against the resolved artifacts.
 */
export interface DatasetBundle {
  readonly bundleVersion: typeof DATASET_BUNDLE_VERSION;
  readonly manifest: DatasetManifest;
  readonly bundleDigest: ContentDigest;
}

/** Digest-free view of a bundle — exactly what the bundle digest covers. */
export interface DatasetBundleView {
  readonly bundleVersion: typeof DATASET_BUNDLE_VERSION;
  readonly manifestDigest: ContentDigest;
  readonly entries: readonly { readonly role: string; readonly artifact: ArtifactRef }[];
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

/** The bundle's entries view: the manifest entries in canonical sorted order. */
function bundleEntriesView(
  manifest: DatasetManifest,
): readonly { readonly role: string; readonly artifact: ArtifactRef }[] {
  return [...manifest.entries].sort((a, b) => {
    const ka = `${a.role}|${artifactRefKey(a.artifact)}`;
    const kb = `${b.role}|${artifactRefKey(b.artifact)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Compute the deterministic bundle digest over the canonical bundle view. */
export async function computeDatasetBundleDigest(
  view: DatasetBundleView,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      bundleVersion: view.bundleVersion,
      manifestDigest: view.manifestDigest,
      entries: [...view.entries],
    }),
  );
}

/** The digest-free view of a bundle (what the bundle digest commits to). */
export function datasetBundleView(bundle: DatasetBundle): DatasetBundleView {
  return {
    bundleVersion: bundle.bundleVersion,
    manifestDigest: bundle.manifest.digest,
    entries: bundleEntriesView(bundle.manifest),
  };
}

/**
 * Resolve a manifest into a verifiable bundle: verify the manifest digest
 * chain, resolve + verify every entry, then compute the deterministic
 * bundle digest. Fail-closed on any missing or unverifiable entry.
 */
export async function resolveDatasetBundle(
  manifest: DatasetManifest,
  resolver: (
    ref: ArtifactRef,
  ) => MaterialArtifact<unknown> | null | Promise<MaterialArtifact<unknown> | null>,
): Promise<DatasetBundle> {
  await verifyDatasetManifest(manifest);

  for (const entry of manifest.entries) {
    const resolved = await resolver(entry.artifact);
    if (resolved === null || resolved === undefined) {
      throw new DatasetError(DATASET_ERROR_CODES.UNRESOLVED_ENTRY, {
        message: `dataset entry ${entry.role}:${artifactRefKey(entry.artifact)} could not be resolved (fail-closed: every entry must be resolvable)`,
        details: { entry: `${entry.role}|${artifactRefKey(entry.artifact)}` },
      });
    }
    if (
      resolved.identity.namespace !== entry.artifact.namespace ||
      resolved.identity.name !== entry.artifact.name ||
      resolved.identity.version !== entry.artifact.version
    ) {
      throw new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
        message: `resolved artifact identity does not match the dataset entry: expected ${entry.artifact.namespace}/${entry.artifact.name}@${entry.artifact.version}, got ${resolved.identity.namespace}/${resolved.identity.name}@${resolved.identity.version}`,
        details: {
          entry: `${entry.role}|${artifactRefKey(entry.artifact)}`,
          expected: artifactRefKey(entry.artifact),
          actual: `${resolved.identity.namespace}/${resolved.identity.name}@${resolved.identity.version}#${resolved.digest}`,
        },
      });
    }
    if (resolved.digest !== entry.artifact.digest) {
      throw new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
        message: `resolved artifact digest does not match the dataset entry: expected ${entry.artifact.digest}, got ${resolved.digest}`,
        details: {
          entry: `${entry.role}|${artifactRefKey(entry.artifact)}`,
          expected: entry.artifact.digest,
          actual: resolved.digest,
        },
      });
    }
    // Content verification through the REUSED A002 guard — a tampered
    // artifact (claimed digest not matching content) fails closed with
    // ARTIFACT_TAMPERED (propagated unchanged).
    await verifyArtifact(resolved);
  }

  const bundleDigest = await computeDatasetBundleDigest({
    bundleVersion: DATASET_BUNDLE_VERSION,
    manifestDigest: manifest.digest,
    entries: bundleEntriesView(manifest),
  });
  const bundle: DatasetBundle = deepFreeze({
    bundleVersion: DATASET_BUNDLE_VERSION,
    manifest,
    bundleDigest,
  });
  return bundle;
}

export function isDatasetBundle(value: unknown): value is DatasetBundle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['bundleVersion'] === DATASET_BUNDLE_VERSION &&
    typeof candidate['manifest'] === 'object' &&
    candidate['manifest'] !== null &&
    typeof candidate['bundleDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['bundleDigest'])
  );
}

/**
 * Verify a resolved bundle end to end: the bundle digest, the embedded
 * manifest (digest chain) and every entry resolution + digest again.
 * Fail-closed; returns the verified bundle digest.
 */
export async function verifyDatasetBundle(
  bundle: DatasetBundle,
  resolver: (
    ref: ArtifactRef,
  ) => MaterialArtifact<unknown> | null | Promise<MaterialArtifact<unknown> | null>,
): Promise<ContentDigest> {
  if (!isDatasetBundle(bundle)) {
    throw new DatasetError(DATASET_ERROR_CODES.UNKNOWN_ERROR, {
      message: 'not a structurally valid dataset bundle',
    });
  }
  const actual = await computeDatasetBundleDigest(datasetBundleView(bundle));
  if (actual !== bundle.bundleDigest) {
    throw new DatasetError(DATASET_ERROR_CODES.TAMPERED, {
      message: `dataset bundle digest mismatch: expected ${bundle.bundleDigest}, recomputed ${actual}`,
      details: { expected: bundle.bundleDigest, actual },
    });
  }
  // Re-verify the manifest + every entry resolution (fail closed).
  await resolveDatasetBundle(bundle.manifest, resolver);
  return actual;
}
