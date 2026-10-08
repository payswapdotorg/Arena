/**
 * @arena/capability-learning — the ARENA CAPABILITY LEARNING COMPILER
 * (Work Order C022; issue #128; spec/learning.md LE1.0;
 * spec/quality-model.md Q1.0 "Capability lift"; architecture-lock rules
 * 5, 6, 16, 17, 18, 31, 32).
 *
 * The compiler that turns validated intervention-derived improvement
 * candidates (C008 tool-gap + knowledge capture, C009
 * escalation-validation evidence, C013 adversarial-evaluation research
 * material, C014 body-marketplace pretraining candidates — bound BY
 * DIGEST through the closed source-kind vocabulary, never redefined)
 * into typed ImprovementPrograms — ONE PER LE1.0 INTERVENTION CLASS,
 * the changed surface EXPLICIT on every program.
 *
 *   - compilation is DETERMINISTIC given identical candidates and emits
 *     typed closed outcomes (compilable / blocked-with-reasons:
 *     rights-insufficient, evidence-insufficient, scope-conflict);
 *   - each compilable program assembles to an A020 ExperimentDescriptor
 *     carrying EVERY LE1.0 minimum field, built through @arena/learning's
 *     REAL constructor, executed through the A020 engine's public ports;
 *   - adoption happens ONLY through the Q1.0 five-condition
 *     capability-lift gate over the A020 run record — typed verdicts
 *     (adopted-with-evidence / rejected-with-reasons /
 *     unknown-insufficient-sample), NEVER a bare boolean;
 *   - adopted improvements become GATED PROPOSALS into A021 (new
 *     immutable BodyVersions), A022 (substrate-affecting compatibility
 *     re-tests) and A023 (recertification triggers) — adoption of an
 *     ungated improvement is STRUCTURALLY IMPOSSIBLE;
 *   - the LE1.0 learning boundary is enforced and tested: compiler
 *     outputs are NEW versioned content-addressed artifacts with full
 *     lineage; historical trajectories, task/environment versions,
 *     certification evidence and original customer records are NEVER
 *     rewritten;
 *   - the append-only feedback record links interventions →
 *     improvements → measured lift and ranks future selection by
 *     expected information value with an inspectable rationale (CC1.0
 *     active-learning law).
 *
 * Pure TypeScript. Runtime dependencies: @arena/protocol-core
 * (canonical JSON + sha256 digests) + @arena/learning (the REAL LE1.0
 * experiment protocol this compiler compiles INTO — ExperimentDescriptor,
 * run records, verdicts, intervention-surface vocabulary, boundary
 * precedent — consumed, never redefined).
 *
 * The REFERENCE COMPILER SERVICE (candidate ingestion → program
 * compilation → experiment orchestration → gated proposal dispatch on
 * the A015 fabric) lives in services/capability-learning.
 */

export * from './errors.js';
export * from './candidate.js';
export * from './program.js';
export * from './experiment.js';
export * from './boundary.js';
export * from './gate.js';
export * from './proposal.js';
export * from './feedback.js';

import { CAPABILITY_LEARNING_ERROR_CODES } from './errors.js';
import { CANDIDATE_SOURCE_KINDS } from './candidate.js';
import { COMPILE_BLOCK_REASONS } from './program.js';
import { ADOPTION_GATE_VERDICTS, ADOPTION_GATE_REJECT_REASONS } from './gate.js';
import { PROPOSAL_DESTINATIONS } from './proposal.js';

/** Version of this package's protocol surface. */
export const CAPABILITY_LEARNING_PROTOCOL_VERSION = 1 as const;

/** The candidate source kinds this build understands. */
export const SUPPORTED_CANDIDATE_SOURCE_KINDS: readonly string[] = Object.freeze([
  ...CANDIDATE_SOURCE_KINDS,
]);

/** The compile block reasons this build understands. */
export const SUPPORTED_COMPILE_BLOCK_REASONS: readonly string[] = Object.freeze([
  ...COMPILE_BLOCK_REASONS,
]);

/** The adoption-gate verdict kinds this build understands. */
export const SUPPORTED_ADOPTION_GATE_VERDICTS: readonly string[] = Object.freeze([
  ...ADOPTION_GATE_VERDICTS,
]);

/** The adoption-gate reject reasons this build understands. */
export const SUPPORTED_ADOPTION_GATE_REJECT_REASONS: readonly string[] = Object.freeze([
  ...ADOPTION_GATE_REJECT_REASONS,
]);

/** The proposal destinations this build understands. */
export const SUPPORTED_PROPOSAL_DESTINATIONS: readonly string[] = Object.freeze([
  ...PROPOSAL_DESTINATIONS,
]);

/** The capability-learning error codes this build understands. */
export const SUPPORTED_CAPABILITY_LEARNING_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(CAPABILITY_LEARNING_ERROR_CODES),
]);
