/**
 * @arena/learning - the ARENA LEARNING EXPERIMENT PROTOCOL (Work Order
 * A020; requirements R15, R16, R14; spec LE1.0 "Learning and
 * Experiment"; spec/quality-model.md Q1.0 "Capability lift";
 * architecture-lock rules 5, 6, 16, 17, 18; docs/architecture.md §11).
 *
 * Learning experiments compare baseline and intervention and attribute
 * observed change. Learning can update skills, body composition,
 * retrieval/knowledge bindings, policies, evaluator/verifier assets or
 * model-specific adaptations. Learning NEVER rewrites historical facts
 * or evidence (lock rule 6) - the boundary guards enforce it and the
 * negative/adversarial suites prove it.
 *
 * Pure TypeScript; runtime dependencies are @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * SchemaRef, ProtocolError) plus four genuinely composed sibling
 * domains - @arena/trajectory (REAL A011 guards + the A009
 * TaskVersionRef guard), @arena/evaluation (REAL A012 record guard),
 * @arena/verification (REAL A013 record guard) and
 * @arena/capability-graph (REAL A004 CapabilityNodeRef guard). Every
 * sibling object is bound BY DIGEST, never redefined here.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - ExperimentDescriptor - the content-addressed, versioned
 *     declaration carrying EVERY LE1.0 minimum field (experiment
 *     id/version; target capability; baseline Body/Model/Runtime pins;
 *     intervention artifacts with EXPLICIT changed surfaces from the
 *     LE1.0 nine; pinned task population; evaluation + verification
 *     suite refs; environment versions; outcome metric declarations;
 *     uncertainty method; protected capabilities; provenance);
 *   - the PURE comparison computation (metric deltas per declared
 *     direction, protected-capability regression checks, uncertainty
 *     report);
 *   - the PURE attribution computation - the LE1.0 six distinguishable
 *     improvement sources, with evaluator-version-confound /
 *     verifier-version-confound surfaced whenever the evaluator or
 *     verifier digests differ between arms (a changed evaluator score
 *     is NOT automatically a capability improvement);
 *   - the PURE verdict computation - the Q1.0 five-condition
 *     CapabilityLiftVerdict, a CLOSED VOCABULARY, never a score;
 *   - ExperimentRunRecord - the append-only, content-addressed result
 *     record (descriptor digest, both arms' run refs, collected
 *     metrics, comparison, uncertainty, attribution, verdict);
 *   - LearningBoundary guards + LearningProposal - learning PROPOSES
 *     new content-addressed artifacts (e.g. A019 SkillDrafts, bound by
 *     digest) and NEVER rewrites historical records (rewrite attempts
 *     are rejected with LEARNING_REWRITE_ATTEMPT);
 *   - CalibrationRecord + summarizeCalibration - predicted confidence
 *     vs later-observed outcomes with preserved applicability context;
 *   - Envelope<T> wiring - run-experiment-command /
 *     experiment-completed-event with REQUIRED idempotency keys on
 *     commands (architecture-lock rule 17).
 *
 * The REFERENCE FABRIC (experiment registry + experiment engine) lives
 * in services/learning (@arena/learning-fabric) - in-process, zero
 * external runtime dependencies.
 *
 * Generated contracts live in ../../contracts/learning (repo root -
 * A020 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './intervention-surface.js';
export * from './attribution-source.js';
export * from './descriptor.js';
export * from './comparison.js';
export * from './attribution.js';
export * from './verdict.js';
export * from './run-record.js';
export * from './boundary.js';
export * from './calibration.js';
export * from './envelopes.js';

import { LEARNING_ERROR_CODES } from './errors.js';
import { LEARNING_SCHEMA_VERSION, LEARNING_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const LEARNING_PROTOCOL_VERSION = LEARNING_SCHEMA_VERSION;

/** The learning error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_LEARNING_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(LEARNING_ERROR_CODES),
]);

/** The learning schema registry (parity-checked against contracts). */
export const LEARNING_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...LEARNING_SCHEMAS,
});
