/**
 * MaterialArtifact — the immutable, content-addressed unit of Arena artifact
 * storage (architecture-lock rules 5, 6, 18; docs/architecture.md §15).
 *
 * A material artifact binds:
 *   - an ArtifactIdentity (namespace/name/version),
 *   - an ordered list of embedded artifact references (`refs`), and
 *   - an arbitrary plain-JSON `content`
 * to a sha256 `digest` computed over the canonical JSON serialization of the
 * digest-free view {identity, refs, content}. Hashing and canonical
 * serialization are REUSED from @arena/protocol-core (digestCanonical /
 * canonicalJson) — never reimplemented here.
 *
 * Immutability: `createMaterialArtifact` validates, computes the digest and
 * DEEP-FREEZES the result. There is no mutation API in this package — no
 * withVersion, no rename, no setContent — so "same identity, different
 * content" can only exist as a DIFFERENT artifact with a DIFFERENT digest,
 * and any object claiming an identity with a stale digest fails
 * `verifyArtifact` (fail-closed tamper detection, including nested refs via
 * `verifyArtifactTree`).
 */

import { digestCanonical } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';
import type { ArtifactIdentity } from './identity.js';
import {
  isArtifactIdentity,
  isArtifactName,
  isArtifactNamespace,
  isArtifactVersion,
  toArtifactIdentity,
} from './identity.js';
import type { ContentDigest } from './content-digest.js';
import { isContentDigest, toContentDigest } from './content-digest.js';

/** A content-addressed reference to another artifact (a lineage edge value). */
export interface ArtifactRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: ContentDigest;
}

/** Digest-free view of a material artifact — exactly what the digest covers. */
export interface ArtifactContentView<TContent = unknown> {
  readonly identity: ArtifactIdentity;
  readonly refs: readonly ArtifactRef[];
  readonly content: TContent;
}

/** A frozen artifact: the content view plus its sha256 content digest. */
export interface MaterialArtifact<TContent = unknown>
  extends ArtifactContentView<TContent> {
  readonly digest: ContentDigest;
}

/**
 * Resolves an artifact reference to the referenced artifact (or null when
 * unknown). Pure lookup — used by verifyArtifactTree for nested verification.
 */
export type ArtifactResolver = (
  ref: ArtifactRef,
) => MaterialArtifact<unknown> | null | Promise<MaterialArtifact<unknown> | null>;

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isArtifactNamespace(candidate['namespace']) &&
    isArtifactName(candidate['name']) &&
    isArtifactVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate (all parts) and freeze an artifact reference. */
export function toArtifactRef(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): ArtifactRef {
  // Validate the identity parts through the identity validators, then keep
  // the plain (structurally identical) fields in the frozen ref.
  toArtifactIdentity({
    namespace: value.namespace,
    name: value.name,
    version: value.version,
  });
  const ref: ArtifactRef = Object.freeze({
    namespace: value.namespace,
    name: value.name,
    version: value.version,
    digest: toContentDigest(value.digest),
  });
  return ref;
}

export function isSameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return (
    a.namespace === b.namespace &&
    a.name === b.name &&
    a.version === b.version &&
    a.digest === b.digest
  );
}

/** Stable key for a ref: `<namespace>/<name>@<version>#<digest>`. */
export function artifactRefKey(ref: ArtifactRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
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

/**
 * Compute the sha256 content digest over the canonical JSON serialization of
 * the digest-free view {identity, refs, content}.
 */
export async function computeArtifactDigest(
  view: ArtifactContentView<unknown>,
): Promise<ContentDigest> {
  const digest = await digestCanonical({
    identity: view.identity,
    refs: [...view.refs],
    content: view.content,
  });
  return toContentDigest(digest);
}

/** The digest-free view of an artifact (what the digest commits to). */
export function artifactContentView<TContent>(
  artifact: MaterialArtifact<TContent>,
): ArtifactContentView<TContent> {
  return { identity: artifact.identity, refs: artifact.refs, content: artifact.content };
}

export interface CreateMaterialArtifactInput<TContent> {
  readonly identity: {
    namespace: string;
    name: string;
    version: string;
  };
  readonly refs?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly content: TContent;
}

/**
 * Create an immutable material artifact: validates identity and refs,
 * computes the sha256 digest over the canonical serialization of the content
 * view, and deep-freezes the result. The returned object can never be
 * mutated in place.
 */
export async function createMaterialArtifact<TContent>(
  input: CreateMaterialArtifactInput<TContent>,
): Promise<MaterialArtifact<TContent>> {
  const identity = toArtifactIdentity(input.identity);
  const refs = Object.freeze(
    (input.refs ?? []).map((ref) => toArtifactRef(ref)),
  );
  const view: ArtifactContentView<TContent> = {
    identity,
    refs,
    content: input.content,
  };
  const digest = await computeArtifactDigest(view as ArtifactContentView<unknown>);
  const artifact: MaterialArtifact<TContent> = deepFreeze({
    identity,
    refs,
    content: input.content,
    digest,
  });
  return artifact;
}

export function isMaterialArtifact(value: unknown): value is MaterialArtifact<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isArtifactIdentity(candidate['identity']) &&
    Array.isArray(candidate['refs']) &&
    candidate['refs'].every((ref) => isArtifactRef(ref)) &&
    'content' in candidate &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Re-compute an artifact's digest and compare it with the claimed digest
 * (or an explicitly expected one). FAILS CLOSED with ARTIFACT_TAMPERED on any
 * mismatch — a mutation of identity, refs or content is always detected.
 * Returns the verified digest.
 */
export async function verifyArtifact<TContent>(
  artifact: MaterialArtifact<TContent>,
  expectedDigest?: ContentDigest,
): Promise<ContentDigest> {
  if (!isMaterialArtifact(artifact)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'not a structurally valid material artifact',
    });
  }
  const actual = await computeArtifactDigest(
    artifactContentView(artifact) as ArtifactContentView<unknown>,
  );
  const claimed = expectedDigest ?? artifact.digest;
  if (actual !== claimed) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
      message: `artifact digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}

/**
 * Verify an artifact AND every nested/embedded artifact reference, failing
 * closed:
 *   - the artifact's own digest must verify;
 *   - every embedded ref must resolve via `resolve`;
 *   - each resolved artifact must carry the ref's exact identity AND digest;
 *   - each resolved artifact is verified recursively.
 *
 * The traversal distinguishes DIAMONDS from CYCLES: a node already fully
 * verified through one branch is skipped (diamond-safe dedup), while a node
 * still on the CURRENT verification path is a back-edge and fails closed
 * with ARTIFACT_TAMPERED (cycle). For honestly-constructed artifacts a
 * fully-verifying cycle is cryptographically impossible (every embedded ref
 * commits to the child's content digest, so a cycle would require a sha256
 * fixed point); the path guard is defense-in-depth.
 */
export async function verifyArtifactTree(
  artifact: MaterialArtifact<unknown>,
  resolve: ArtifactResolver,
): Promise<void> {
  await verifyArtifact(artifact);
  await verifyRefsRecursive(artifact, resolve, new Set<string>(), new Set<string>());
}

async function verifyRefsRecursive(
  artifact: MaterialArtifact<unknown>,
  resolve: ArtifactResolver,
  path: Set<string>,
  verified: Set<string>,
): Promise<void> {
  const key = `${artifact.identity.namespace}/${artifact.identity.name}@${artifact.identity.version}#${artifact.digest}`;
  if (path.has(key)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
      message: `cycle detected in resolved artifact references at ${key}`,
      details: { ref: key },
    });
  }
  if (verified.has(key)) return; // diamond: already fully verified via another branch
  path.add(key);
  try {
    for (const ref of artifact.refs) {
      const resolved = await resolve(ref);
      if (resolved === null) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_REF, {
          message: `embedded artifact reference could not be resolved: ${artifactRefKey(ref)}`,
          details: { ref: artifactRefKey(ref) },
        });
      }
      if (
        resolved.identity.namespace !== ref.namespace ||
        resolved.identity.name !== ref.name ||
        resolved.identity.version !== ref.version
      ) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
          message: `resolved artifact identity does not match the reference: expected ${ref.namespace}/${ref.name}@${ref.version}, got ${resolved.identity.namespace}/${resolved.identity.name}@${resolved.identity.version}`,
          details: { ref: artifactRefKey(ref) },
        });
      }
      if (resolved.digest !== ref.digest) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
          message: `resolved artifact digest does not match the reference: expected ${ref.digest}, got ${resolved.digest}`,
          details: { ref: artifactRefKey(ref), expected: ref.digest, actual: resolved.digest },
        });
      }
      await verifyArtifact(resolved);
      await verifyRefsRecursive(resolved, resolve, path, verified);
    }
  } finally {
    path.delete(key);
  }
  verified.add(key);
}
