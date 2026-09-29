/**
 * @arena/task-spec — the ARENA TASK SPECIFICATION PROTOCOL (Work Order
 * A008; requirement R6 "Compile Capability Cases into reproducible
 * TaskSpecs"; docs/architecture.md §6 "Task — the reproducible unit of
 * work"; spec/task-spec.md TS1.0; architecture-lock rules 5, 6, 11, 17,
 * 18, 22, 24).
 *
 * THE TASKSPEC IS THE REPRODUCIBLE UNIT OF WORK: versioned,
 * content-addressed (sha256 canonical via @arena/protocol-core), immutable
 * + deep-frozen, carrying EVERY TS1.0 structure field — identity/version,
 * capability labels, difficulty (declared scale), domain, initial state
 * reference, instructions, objectives, constraints, permitted tools,
 * PROHIBITED SHORTCUTS (first-class — shortcut resistance is a TS1.0
 * quality dimension), expected outputs, completion criteria, evidence
 * criteria, environment requirements (A009 ENV1.0-shaped declarations),
 * evaluator bindings (A012 descriptor digests), verifier bindings (A013
 * descriptor digests), expert qualification requirements (A007 shapes) and
 * MANDATORY data-rights metadata (R24 posture: private-tenant by default).
 *
 * Core objects (all pure data; no mutation API anywhere):
 *   - TaskSpec + guards — the pure validation layer (field completeness
 *     per TS1.0, closed vocabularies, cross-field consistency: long-horizon
 *     class ⇒ intermediate-state evidence REQUIRED; binding digests
 *     well-formed; difficulty in a declared scale; pinned initial state ∈
 *     required environments; private-tenant forbids cross-tenant reuse);
 *   - the CLOSED eleven-class task vocabulary (TS1.0) + difficulty scale;
 *   - the seven DECLARED quality/leakage dimensions with structured
 *     provenance (realistic-context, discriminative-difficulty,
 *     observable-success, reproducible-evaluation, low-leakage,
 *     clear-provenance, declared-limitations);
 *   - TaskDiff + task versioning — new version = new content-addressed
 *     object; supersession by append (never rewrite); pure taskIdentity
 *     (id + semver) resolution;
 *   - CompilationPolicy — the versioned, content-addressed rule set the
 *     compiler runs under (eligibility, class selection, difficulty
 *     derivation, field mapping, environment selection, identity
 *     derivation, expert-qualification posture, quality posture,
 *     long-horizon evidence, data rights);
 *   - CompilationRecord — the append-only, idempotency-keyed run record
 *     (lock rule 17);
 *   - Envelope<T> wiring — run-compilation-command (REQUIRED idempotency
 *     key) / compilation-recorded-event.
 *
 * The COMPILER (the R6 bridge) lives in services/task-compiler
 * (@arena/task-compiler-fabric) — in-process, zero external runtime
 * dependencies. This package deliberately contains NO compilation logic:
 * compiling never mutates cases, and specs are PROPOSALS until pinned.
 *
 * Generated contracts live in ../../contracts/task (repo root — A008
 * owned surface; see scripts/generate-contracts.mjs). Drift is checked by
 * the drift suite and governance G9 (which auto-discovers package-level
 * generators), and parity is asserted against this TS surface by
 * contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './task-class.js';
export * from './difficulty.js';
export * from './quality.js';
export * from './bindings.js';
export * from './expert-qualification.js';
export * from './environment.js';
export * from './data-rights.js';
export * from './identity.js';
export * from './guards.js';
export * from './spec.js';
export * from './diff.js';
export * from './compilation-policy.js';
export * from './compilation-record.js';
export * from './envelopes.js';

import { TASK_SPEC_ERROR_CODES } from './errors.js';
import { TASK_SPEC_SCHEMA_VERSION, TASK_SPEC_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const TASK_SPEC_PROTOCOL_VERSION = TASK_SPEC_SCHEMA_VERSION;

/** The task-spec error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_TASK_SPEC_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(TASK_SPEC_ERROR_CODES),
);

/** The task-spec schema registry (parity-checked against contracts). */
export const TASK_SPEC_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...TASK_SPEC_SCHEMAS,
});
