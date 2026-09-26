/**
 * @arena/artifact-protocol — artifact identity, versioning, content
 * addressing, publication and lineage envelope wiring (Work Order A002;
 * architecture-lock rules 5, 6, 12, 18, 22, 23).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256, branded identifiers, Envelope<T>,
 * SchemaRef, ProtocolError) are reused throughout. Zero model/provider
 * surface: no provider names, no substrate details, no access material
 * (architecture-lock rule 10, docs/architecture.md §17).
 *
 * Generated contracts: contracts/artifacts/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and parity is asserted against this TS surface by contracts.parity.test.ts).
 */

export * from './artifact.js';
export * from './content-digest.js';
export * from './envelopes.js';
export * from './errors.js';
export * from './identity.js';
export * from './principal.js';
export * from './publication.js';
export * from './rights.js';
export * from './timestamp.js';

import { ARTIFACT_ERROR_CODES } from './errors.js';
import { ARTIFACT_SCHEMAS, ARTIFACT_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const ARTIFACT_PROTOCOL_VERSION = ARTIFACT_SCHEMA_VERSION;

/** The artifact protocol error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_ARTIFACT_ERROR_CODES: readonly string[] = Object.values(
  ARTIFACT_ERROR_CODES,
);

/** The artifact-protocol schema registry (parity-checked against contracts). */
export const ARTIFACT_SCHEMA_REGISTRY: Readonly<Record<string, string>> = { ...ARTIFACT_SCHEMAS };
