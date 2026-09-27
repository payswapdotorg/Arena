/**
 * @arena/environment-protocol — the ENV1.0 protocol layer for Arena
 * environments (Work Order A009; spec/environment.md; architecture §7,
 * §16; architecture-lock rules 8, 21, 23; requirements R9, R22, R23, R44).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256 digests, branded identifiers,
 * Envelope<T>, SchemaRef, ProtocolError) are reused throughout — never
 * reimplemented. Runtime-neutral by construction: the executable substrate
 * is addressed only through content digests; runner/provider strings and
 * secret material never enter canonical or digested objects.
 *
 * Core objects:
 *   - EnvironmentDefinition — the versioned, content-addressed
 *     declaration of an executable world carrying ALL fifteen ENV1.0
 *     declare fields (identity, image/build digest, initial state snapshot,
 *     seed policy, action/tool surface, observation surface, resource
 *     limits, network policy, filesystem policy, secret policy, time
 *     limits, reset semantics, checkpoint semantics, evidence outputs,
 *     evaluator/verifier hooks), deep-frozen, sha256-digested over the
 *     canonical digest-free view, registered through an append-only
 *     registry with content-address conflict detection;
 *   - ReproducibilityProfile / SeedPolicy — deterministic preferred;
 *     nondeterminism must capture seed, versions, external inputs and
 *     timing/context metadata;
 *   - RunAddress — every run addressable by task version, environment
 *     version, run id, initial snapshot digest, trajectory digest and
 *     evidence digests;
 *   - WorkloadDeclaration + assertLeastPrivilege — untrusted (and all)
 *     workloads must require nothing beyond the declared allows;
 *   - Envelope wiring with mandatory idempotency keys for commands.
 *
 * Generated contracts: contracts/environment/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and governance G9, which auto-discovers package-level generators, and
 * parity is asserted against this TS surface by contracts.parity.test.ts).
 */

export * from './definition.js';
export * from './envelopes.js';
export * from './errors.js';
export * from './evidence.js';
export * from './image.js';
export * from './isolation.js';
export * from './lifecycle.js';
export * from './reproducibility.js';
export * from './run-address.js';
export * from './shared.js';
export * from './snapshot.js';
export * from './surfaces.js';
export * from './workload.js';

import { ENVIRONMENT_ERROR_CODES } from './errors.js';
import { ENVIRONMENT_SCHEMAS, ENVIRONMENT_SCHEMA_VERSION } from './envelopes.js';

/** Version of this package's protocol surface. */
export const ENVIRONMENT_PROTOCOL_VERSION = ENVIRONMENT_SCHEMA_VERSION;

/** The environment error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_ENVIRONMENT_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(ENVIRONMENT_ERROR_CODES),
);

/** The environment-protocol schema registry (parity-checked against contracts). */
export const ENVIRONMENT_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...ENVIRONMENT_SCHEMAS,
});
