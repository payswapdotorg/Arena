/**
 * Shared cross-protocol view types (Work Order A004).
 *
 * @arena/capability-graph must stay runtime-independent beyond
 * @arena/protocol-core (domain-package purity), so it cannot import the
 * value surface of @arena/artifact-protocol or @arena/provenance. The
 * structural components the graph references — content-addressed artifact
 * references and provenance record references — are therefore defined HERE
 * as validated plain-string view types.
 *
 * These views are STRUCTURALLY COMPATIBLE with the corresponding
 * @arena/artifact-protocol / @arena/provenance types (plain strings accept
 * branded strings): an artifact-protocol ArtifactRef can be passed through
 * these validators unchanged, and a provenance record's digest (computed by
 * @arena/protocol-core digestCanonical) satisfies ProvenanceRefView. The
 * pattern sources are duplicated from the A002 surfaces and mirrored in the
 * generated contracts, so the duplication cannot drift silently (see
 * contracts.parity.test.ts).
 */

import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol constants
// (mirrored in the generated contracts; asserted by contracts.parity.test.ts).
// ---------------------------------------------------------------------------

export const ARTIFACT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ARTIFACT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const ARTIFACT_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const NAMESPACE_PATTERN = new RegExp(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(ARTIFACT_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(ARTIFACT_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Artifact reference view (evidence, tests, pack artifacts)
// ---------------------------------------------------------------------------

/** A content-addressed artifact reference (structurally ArtifactRef). */
export interface ArtifactRefView {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export function isArtifactRefView(value: unknown): value is ArtifactRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    NAME_PATTERN.test(candidate['name']) &&
    typeof candidate['version'] === 'string' &&
    VERSION_PATTERN.test(candidate['version']) &&
    typeof candidate['digest'] === 'string' &&
    DIGEST_PATTERN.test(candidate['digest'])
  );
}

/** Validate and freeze an artifact reference view; throws INVALID_REF. */
export function toArtifactRefView(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): ArtifactRefView {
  if (!isArtifactRefView(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: `invalid artifact reference view: ${JSON.stringify(value)}`,
      details: {
        namespacePattern: ARTIFACT_NAMESPACE_PATTERN_SOURCE,
        namePattern: ARTIFACT_NAME_PATTERN_SOURCE,
        versionPattern: ARTIFACT_VERSION_PATTERN_SOURCE,
        digestPattern: CONTENT_DIGEST_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Provenance reference view
// ---------------------------------------------------------------------------

/**
 * A reference to a provenance record: the sha256 digest of the record's
 * canonical serialization (computed by @arena/provenance /
 * @arena/protocol-core digestCanonical — never reimplemented here).
 * REQUIRED on every edge and on every skill node (architecture.md §3:
 * "A Skill is a versioned artifact with inputs, outputs, prerequisites,
 * evidence, tests and provenance").
 */
export interface ProvenanceRefView {
  readonly recordDigest: string;
}

export function isProvenanceRefView(value: unknown): value is ProvenanceRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['recordDigest'] === 'string' &&
    DIGEST_PATTERN.test(candidate['recordDigest'])
  );
}

/** Validate and freeze a provenance reference view; throws INVALID_REF. */
export function toProvenanceRefView(value: {
  recordDigest: string;
}): ProvenanceRefView {
  if (!isProvenanceRefView(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: `invalid provenance reference: ${JSON.stringify(value)} (recordDigest must be a lowercase sha256 hex digest)`,
      details: { digestPattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return Object.freeze({ recordDigest: value.recordDigest });
}
