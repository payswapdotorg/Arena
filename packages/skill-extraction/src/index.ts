/**
 * @arena/skill-extraction — the ARENA SKILL-EXTRACTION PROTOCOL (Work
 * Order A019; requirement R17 — "Extract reusable Skills from validated
 * trajectories"; docs/architecture.md §3 Capability model, §9
 * Trajectory, §11 Learning; architecture-lock rules 5, 6, 12, 17, 18,
 * 23).
 *
 * Skill extraction mines REUSABLE SKILLS from VALIDATED trajectories.
 * It is the read-only bridge from Arena's evidence tier (A011
 * trajectories validated by A012 evaluation + A013 verification) to
 * Arena's capability tier (the A004 skill taxonomy):
 *
 *   - a trajectory is an extraction input ONLY when VALIDATED — the
 *     ValidatedTrajectoryRef guard enforces the R17 gate (no
 *     verification evidence ⇒ UNVALIDATED_TRAJECTORY, refused);
 *   - extraction is READ-ONLY over historical evidence (lock rule 6 —
 *     learning never rewrites trajectories or their validation
 *     records; enforced by the hygiene suite);
 *   - candidates are content-addressed, immutable propositions; drafts
 *     are A004-ready BY CONSTRUCTION (built through
 *     @arena/capability-graph's own node/edge constructors);
 *   - supersession is APPEND-ONLY (A004 supersession-by-append;
 *     extraction never edits graph history).
 *
 * Pure TypeScript. Runtime dependencies: @arena/protocol-core (digests,
 * envelopes, branded identifiers) + the four composed sibling domains —
 * @arena/trajectory (REAL A011 structural guards),
 * @arena/evaluation (REAL A012 record guard),
 * @arena/verification (REAL A013 record guard) and
 * @arena/capability-graph (REAL A004 node/edge constructors). Zero
 * external runtime dependencies.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - ValidatedTrajectoryRef — the typed reference bundle gating
 *     extraction: completed A011 TrajectoryRecord + the A012 evaluation
 *     records + the A013 verification records that VALIDATE it (each
 *     record digest-bound to the trajectory chain head);
 *   - ExtractionPolicy — the versioned, content-addressed rule set:
 *     minimum validation evidence, eligible entry kinds (actions +
 *     completions by default — Arena records observable work, never
 *     hidden chain-of-thought), dedup/thresholds, A004 taxonomy target;
 *   - SkillCandidate — the mined proposition: signature, taxonomy
 *     refs, declared inputs/outputs, prerequisites, evidence set,
 *     extraction provenance;
 *   - SkillDraft — the A004-ready packaging: REAL CapabilityNode
 *     (kind skill, §3 payload shape) + REAL provenance-bearing
 *     CapabilityEdges + append-only supersession;
 *   - mineSkillCandidates — the PURE, DETERMINISTIC mining core (same
 *     inputs + policy + context ⇒ byte-identical candidates);
 *   - Envelope<T> wiring — run-extraction-command /
 *     extraction-completed-event with REQUIRED idempotency keys on
 *     commands (lock rule 17).
 *
 * The REFERENCE FABRIC (policy registry, extraction runner, run-record
 * ledger) lives in services/skill-extraction (@arena/skill-extraction-fabric)
 * — in-process, zero external runtime dependencies.
 *
 * CONTRACTS DISCLOSURE (A019): this package owns NO contracts/ surface.
 * Its schemas live inside the package as SchemaRef-referenced data
 * (SKILL_EXTRACTION_SCHEMAS, envelopes.ts); existing contracts are not
 * redeclared. No generator ships, so governance G9 has nothing to
 * drift-check here.
 */

export * from './errors.js';
export * from './shared.js';
export * from './validated-ref.js';
export * from './policy.js';
export * from './candidate.js';
export * from './draft.js';
export * from './envelopes.js';

import { SKILL_EXTRACTION_ERROR_CODES } from './errors.js';
import { SKILL_EXTRACTION_SCHEMA_VERSION, SKILL_EXTRACTION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const SKILL_EXTRACTION_PROTOCOL_VERSION = SKILL_EXTRACTION_SCHEMA_VERSION;

/** The skill-extraction error codes this build understands. */
export const SUPPORTED_SKILL_EXTRACTION_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(SKILL_EXTRACTION_ERROR_CODES),
]);

/** The skill-extraction schema registry (in-package SchemaRef data). */
export const SKILL_EXTRACTION_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...SKILL_EXTRACTION_SCHEMAS,
});
