/**
 * @arena/datasets — dataset PACKAGING for Arena (Work Order A014;
 * requirements R14, R23; architecture-lock rules 5, 12, 18, 23;
 * docs/architecture.md §15).
 *
 * Pure TypeScript. Runtime dependencies are the REUSED A002 primitives —
 * @arena/artifact-protocol (identity, content addressing, verification,
 * principals, rights, timestamps) and @arena/provenance (the lineage
 * relation + verification-kind vocabularies) — over @arena/protocol-core
 * (canonical JSON + sha256, branded identifiers). This package NEVER
 * reimplements canonicalization, hashing, artifact validation or
 * publication semantics, and it is NOT object storage: bundles are
 * resolved through a caller-supplied resolver (the A014 artifact service
 * or any A002 ArtifactResolver).
 *
 *   - DatasetManifest — versioned, content-addressed packaging of a
 *     dataset: declared entries (artifact refs by digest + closed role
 *     vocabulary), §15 provenance (creator, timestamps, parent refs,
 *     rights, verification/evaluation refs), an entries checksum and the
 *     manifest digest. Immutable + deep-frozen; tamper detection.
 *   - DatasetBundle — resolution of a manifest into a verifiable bundle
 *     (every entry digest verified; fail-closed on any missing or
 *     unverifiable entry). Deterministic re-bundle: same manifest ⇒ same
 *     bundle digest.
 *   - DatasetVersioning — A002 ArtifactIdentity-based version pins with
 *     binding permanence; split/subset derivations as lineage-recorded
 *     child manifests carrying parent refs.
 *
 * Generated contracts: contracts/dataset/*.json via
 * scripts/generate-contracts.mjs (`pnpm contracts:generate`,
 * `pnpm contracts:check`). Parity with the TS surface is asserted by
 * src/contracts.parity.test.ts; drift by src/drift.test.ts.
 */

export * from './bundle.js';
export * from './entry.js';
export * from './errors.js';
export * from './manifest.js';
export * from './schemas.js';
export * from './versioning.js';

import { DATASET_ERROR_CODES } from './errors.js';
import { DATASET_SCHEMAS, DATASET_SCHEMA_VERSION } from './schemas.js';

/** Version of this package's protocol surface. */
export const DATASET_PROTOCOL_VERSION = DATASET_SCHEMA_VERSION;

/** The dataset error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_DATASET_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(DATASET_ERROR_CODES)],
);

/** The dataset schema registry (parity-checked against contracts). */
export const DATASET_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...DATASET_SCHEMAS,
});
