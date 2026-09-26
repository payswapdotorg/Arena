/**
 * @arena/provenance — provenance records and lineage queries for Arena
 * material artifacts (Work Order A002; docs/architecture.md §15;
 * architecture-lock rules 18, 23; requirement R14).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core
 * (canonical JSON + sha256, Envelope<T>, SchemaRef, branded identifiers).
 * The structural record components (artifact refs, principals, rights,
 * timestamps) are validated plain-string views defined in shared.ts and
 * kept structurally compatible with @arena/artifact-protocol by the
 * cross-package parity test (src/cross-parity.test.ts) — that package is a
 * devDependency precisely and only for that test.
 *
 * Generated contracts: contracts/artifacts/*.json via
 * packages/artifact-protocol/scripts/generate-contracts.mjs.
 */

export * from './envelopes.js';
export * from './errors.js';
export * from './lineage.js';
export * from './record.js';
export * from './shared.js';

import { PROVENANCE_ERROR_CODES } from './errors.js';
import { PROVENANCE_SCHEMAS, PROVENANCE_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const PROVENANCE_PROTOCOL_VERSION = PROVENANCE_SCHEMA_VERSION;

/** The provenance error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_PROVENANCE_ERROR_CODES: readonly string[] = Object.values(
  PROVENANCE_ERROR_CODES,
);

/** The provenance schema registry (parity-checked against contracts). */
export const PROVENANCE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = {
  ...PROVENANCE_SCHEMAS,
};
