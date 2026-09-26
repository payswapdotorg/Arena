/**
 * @arena/protocol-core — Arena base protocol primitives.
 *
 * Pure TypeScript, zero runtime dependencies (enforced by the governance
 * check). Everything protocol-visible is content-addressable and versioned:
 *
 *   - ProtocolError taxonomy (closed code set, strict parsing)
 *   - CorrelationId / IdempotencyKey branded identifiers
 *   - SchemaRef versioned addressing (arena:schema/<ns>/<name>@<version>)
 *   - Envelope<T> wire shape with canonical JSON + sha256 digests
 *
 * Generated contracts live in ../contracts (see scripts/generate-contracts.mjs;
 * drift is checked by pnpm governance).
 */

export * from './brand.js';
export * from './canonical-json.js';
export * from './digest.js';
export * from './envelope.js';
export * from './identifiers.js';
export * from './protocol-error.js';
export * from './schema-ref.js';

import { PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { CORE_SCHEMA_VERSION, CORE_SCHEMAS } from './schema-ref.js';

/** Version of this package's protocol surface. */
export const PROTOCOL_CORE_VERSION = CORE_SCHEMA_VERSION;

/** The protocol error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_ERROR_CODES: readonly string[] = Object.values(PROTOCOL_ERROR_CODES);

/** The core schema registry (parity-checked against contracts). */
export const CORE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = { ...CORE_SCHEMAS };
