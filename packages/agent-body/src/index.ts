/**
 * @arena/agent-body — Agent Body, BodyVersion, Cognitive Substrate,
 * Possession and Agent Instance protocol (Work Order A003; spec AB1.0;
 * architecture-lock rules 1-5, 17, 22, 23; requirements R1, R2, R18, R19,
 * R20, R43, R45, R46).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256 digests, branded identifiers,
 * Envelope<T>, SchemaRef, ProtocolError) are reused throughout — never
 * reimplemented. Zero model/provider surface: no provider names, no
 * substrate credentials, no access material (architecture-lock rule 10,
 * docs/architecture.md §17).
 *
 * Core invariants (spec AB1.0):
 *   - an AgentBody is a first-class persistent object with immutable,
 *     content-addressed BodyVersions (lock rules 1, 5);
 *   - a CognitiveSubstrate is a provider-neutral model/runtime capability
 *     reference — distinct from the body, and NEVER equal to it (lock rule 2);
 *   - a Possession is a versioned, digest-bearing binding of BodyVersion +
 *     Substrate + Runtime + Environment + Policies (+ optional model-specific
 *     artifacts) — not an alias for the model (lock rule 3);
 *   - certification claims apply to the tested composition, never to the
 *     base model alone (lock rule 4; requirements R43, R46);
 *   - model-specific artifacts are versioned and can never silently mutate
 *     a certified binding (lock rule 22);
 *   - an AgentInstance is an ephemeral, append-only execution of a
 *     possession with terminal-final lifecycle.
 *
 * Generated contracts: contracts/agent-body/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and governance G9, and parity is asserted against this TS surface by
 * contracts.parity.test.ts).
 */

export * from './body.js';
export * from './compatibility.js';
export * from './envelopes.js';
export * from './errors.js';
export * from './instance.js';
export * from './possession.js';
export * from './shared.js';
export * from './substrate.js';

import { AGENT_BODY_ERROR_CODES } from './errors.js';
import { AGENT_BODY_SCHEMAS, AGENT_BODY_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const AGENT_BODY_PROTOCOL_VERSION = AGENT_BODY_SCHEMA_VERSION;

/** The agent body error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_AGENT_BODY_ERROR_CODES: readonly string[] = Object.values(
  AGENT_BODY_ERROR_CODES,
);

/** The agent-body schema registry (parity-checked against contracts). */
export const AGENT_BODY_SCHEMA_REGISTRY: Readonly<Record<string, string>> = {
  ...AGENT_BODY_SCHEMAS,
};
