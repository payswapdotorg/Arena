/**
 * @arena/evaluation — the ARENA EVALUATION PROTOCOL (Work Order A012;
 * requirements R12, R23; spec EV1.0 "Evaluation"; spec/quality-model.md
 * "Evaluation quality"; architecture-lock rules 7, 12, 18; docs/
 * architecture.md §5, §18).
 *
 * Evaluation is JUDGMENT against explicit criteria — a score or judgment
 * about how a capability performed. It is NEVER an evidence claim: the
 * responsibility of establishing whether required evidence exists and
 * supports required claims belongs to a SEPARATE protocol
 * (architecture-lock rule 7). This package carries scores/judgments
 * ONLY, by construction.
 *
 * Pure TypeScript; the ONLY runtime dependency is @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * SchemaRef, ProtocolError) — reused throughout, never reimplemented.
 * The sibling objects evaluation judges — A005's CapabilityCase and
 * A011's TrajectoryRecord — are bound STRICTLY BY DIGEST REFS (sha256
 * content addresses), never redefined here, exactly like @arena/
 * trajectory binds A003's BodyVersion and A016's substrate by digest.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - EvaluationCriteria — the EXPLICIT, versioned, digest-addressed
 *     criteria set: ordered criterion entries (id, weight, description,
 *     target ref), a closed aggregation-policy enum (weighted-sum |
 *     pass-threshold | rubric-level) and thresholds (gate 3);
 *   - EvaluatorDescriptor — the content-addressed, versioned declaration
 *     of an evaluator: id, version, kind (the CLOSED EV1.0 enum:
 *     deterministic-test | model-based | expert | rubric | simulation |
 *     comparative | adversarial — unknown kinds rejected), input
 *     contract (digest refs to the CapabilityCase + TrajectoryRecord
 *     plus optional body/substrate refs), criteria ref, output schema
 *     ref, reproducibility characteristics (deterministic? seeded?
 *     requires-human?), confidence/limitations and provenance (gate 2);
 *   - EvaluationRecord — the APPEND-ONCE result record: evaluator
 *     descriptor digest, case ref, trajectory digest ref, per-criterion
 *     verdicts (criterion id, score, judgment, notes), the aggregate
 *     outcome computed PURELY per the aggregation policy, confidence,
 *     limitations, started/finished-at, provenance. Frozen on creation;
 *     pure replayable construction (gate 4);
 *   - Envelope<T> wiring — run-evaluation-command / evaluation-
 *     recorded-event with REQUIRED idempotency keys on commands
 *     (architecture-lock rule 17), mirroring artifact-protocol /
 *     job-protocol / trajectory exactly (gate 5).
 *
 * The REFERENCE FABRIC (evaluator registry, evaluation runner, the two
 * reference evaluator implementations) lives in services/evaluation
 * (@arena/evaluation-fabric) — in-process, zero external runtime
 * dependencies.
 *
 * Generated contracts live in ../../contracts/evaluation (repo root —
 * A012 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './evaluator-kind.js';
export * from './criteria.js';
export * from './descriptor.js';
export * from './record.js';
export * from './envelopes.js';

import { EVALUATION_ERROR_CODES } from './errors.js';
import { EVALUATION_SCHEMA_VERSION, EVALUATION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EVALUATION_PROTOCOL_VERSION = EVALUATION_SCHEMA_VERSION;

/** The evaluation error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_EVALUATION_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(EVALUATION_ERROR_CODES)],
);

/** The evaluation schema registry (parity-checked against contracts). */
export const EVALUATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...EVALUATION_SCHEMAS,
});
