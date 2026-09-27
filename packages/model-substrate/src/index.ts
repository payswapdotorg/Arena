/**
 * @arena/model-substrate — the provider-neutral Cognitive Substrate /
 * model adapter protocol (Work Order A016; spec AB1.0; architecture-lock
 * rules 2, 10; requirements R19, R20, R45).
 *
 * Pure TypeScript. The ONLY runtime workspace dependency is
 * @arena/protocol-core, whose primitives (canonical JSON + sha256 digests,
 * branded identifiers, Envelope<T>, SchemaRef, ProtocolError) are reused
 * throughout — never reimplemented. @arena/agent-body is used EXCLUSIVELY
 * through type-only imports: the substrate records this package
 * materializes ARE the agent-body CognitiveSubstrate shape (byte-identical
 * integrity digests — same canonicalization primitive, same digest-free
 * view; pinned by a golden cross-implementation digest in
 * substrate.test.ts), and the agent-body view types are re-exported below
 * so adapter implementors never need to import @arena/agent-body directly.
 *
 * Surface map (acceptance gates 2-8):
 *   - SubstrateAdapter protocol + AdapterDescriptor (content-addressed,
 *     registry-style dedup) + capability probing + health/integrity
 *     reporting + adapter version identity — ./adapter.ts;
 *   - substrate records (agent-body CognitiveSubstrate shape) + neutral
 *     registration descriptors — ./substrate.ts;
 *   - SubstrateRegistry (in-memory, append-only, digest/neutral-id keyed,
 *     idempotent, conflict-rejecting) — ./registry.ts;
 *   - SubstrateCompatibilityTest / SubstrateCompatibilityResult (pure data
 *     contracts; the compatibility ENGINE is A022) — ./compatibility.ts;
 *   - SubstrateUpgrade (R45: recertification always required; an upgrade
 *     NEVER silently rebinds a Possession — a new possession version is
 *     required) — ./upgrade.ts;
 *   - Envelope<T> wiring with idempotency keys for commands/events —
 *     ./envelopes.ts.
 *
 * Zero provider surface: no provider names, no substrate credentials, no
 * access material (architecture-lock rule 10, docs/architecture.md §17) —
 * enforced by the vendored screening tripwires and the hygiene suite.
 *
 * Generated contracts: contracts/model-substrate/*.json (see
 * scripts/generate-contracts.mjs; drift is checked by the drift test suite
 * and governance G9, and parity is asserted against this TS surface by
 * contracts.parity.test.ts).
 */

export * from './adapter.js';
export * from './compatibility.js';
export * from './envelopes.js';
export * from './errors.js';
export * from './registry.js';
export * from './shared.js';
export * from './substrate.js';
export * from './upgrade.js';
export * from './version.js';

// Type-only re-exports of the @arena/agent-body shapes this protocol is
// built on (domain purity gate 10: runtime imports from @arena/agent-body
// are forbidden; the shapes below are re-exported so adapter implementors
// and consumers never need to depend on @arena/agent-body directly).
export type {
  BodyVersionRef,
  CognitiveSubstrate,
  CognitiveSubstrateView,
  SubstrateCondition,
  SubstrateContextLimits,
  SubstrateIntegrity,
  SubstrateModality,
  ToolCallingLevel,
  VersionedArtifactRef,
} from '@arena/agent-body';

import { MODEL_SUBSTRATE_ERROR_CODES } from './errors.js';
import { MODEL_SUBSTRATE_SCHEMAS } from './envelopes.js';

/** The model-substrate error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_MODEL_SUBSTRATE_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(MODEL_SUBSTRATE_ERROR_CODES),
);

/** The model-substrate schema registry (parity-checked against contracts). */
export const MODEL_SUBSTRATE_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...MODEL_SUBSTRATE_SCHEMAS,
});
