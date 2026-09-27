/**
 * @arena/capability-graph — the Capability Graph and skill taxonomy
 * (Work Order A004; docs/architecture.md §3, §4; requirements R4, R17, R32,
 * R37; architecture-lock rules 6, 21, 23).
 *
 * Pure TypeScript. The ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256 digests, branded identifiers,
 * Envelope<T>, SchemaRef, ProtocolError) are reused throughout — never
 * reimplemented. Zero model/provider surface: no provider names, no
 * substrate details, no access material (architecture-lock rule 10,
 * docs/architecture.md §17).
 *
 * Core model:
 *   - eleven node kinds (domain; capability; sub-capability; skill; tool;
 *     task family; evaluator; verifier; expert competency; observed
 *     failure; body version), each a versioned, digest-addressed,
 *     deep-frozen node with a kind-specific payload and SchemaRef-style
 *     payload-schema addressing;
 *   - nine typed, provenance-bearing edge kinds (decomposes-into, requires,
 *     produces, evaluates, verifies, observes-failure-of, competent-in,
 *     exercised-by, extends-domain) with a per-kind endpoint matrix;
 *   - the skill taxonomy is a DAG: cycle insertions throw
 *     CAPABILITY_GRAPH_CYCLE_DETECTED with the offending path;
 *   - the graph is append-only and descriptive — it does not replace object
 *     authority (§4); supersession happens by append (the original stays
 *     immutable and addressable);
 *   - domain packs extend skills/environments/evaluators without forking
 *     the Arena lifecycle (lock rule 21): packs only append, and can never
 *     supersede/rewrite nodes they do not own;
 *   - pure, deterministic queries (descendants/ancestors, subgraph by
 *     kinds, reachable skills for a domain, simple paths, dependents of a
 *     skill, supersession chains);
 *   - commands and events travel inside @arena/protocol-core's Envelope<T>
 *     with REQUIRED idempotency keys on commands (lock rule 17).
 *
 * Generated contracts: contracts/capability/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and governance G9, and parity is asserted against this TS surface by
 * contracts.parity.test.ts).
 */

export * from './edges.js';
export * from './errors.js';
export * from './identifiers.js';
export * from './payload.js';
export * from './queries.js';
export * from './shared.js';
export * from './timestamp.js';

export {
  appendEdge,
  appendNode,
  buildCapabilityGraph,
  capabilityGraphDigest,
  edgesOfKind,
  emptyCapabilityGraph,
  getNode,
  getNodeByDigest,
  incomingEdgesOf,
  isCapabilityGraph,
  isNodeSuperseded,
  latestNodeVersion,
  nodeDeclaredBy,
  nodeVersionsOf,
  outgoingEdgesOf,
  supersedingNodeOf,
  verifyCapabilityGraph,
} from './graph.js';
export type { CapabilityGraph, CapabilityGraphElement } from './graph.js';
export * from './nodes.js';
export * from './domain-pack.js';
export * from './envelopes.js';

import { CAPABILITY_GRAPH_ERROR_CODES } from './errors.js';
import { CAPABILITY_SCHEMA_VERSION, CAPABILITY_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const CAPABILITY_GRAPH_VERSION = CAPABILITY_SCHEMA_VERSION;

/** The capability-graph error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_CAPABILITY_GRAPH_ERROR_CODES: readonly string[] =
  Object.values(CAPABILITY_GRAPH_ERROR_CODES);

/** The capability-graph schema registry (parity-checked against contracts). */
export const CAPABILITY_SCHEMA_REGISTRY: Readonly<Record<string, string>> = {
  ...CAPABILITY_SCHEMAS,
};
