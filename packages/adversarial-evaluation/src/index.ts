/**
 * @arena/adversarial-evaluation — the ARENA ADVERSARIAL EXPERT
 * EVALUATION / EXPERT ARENA COMPETITION domain core (Work Order C013;
 * issue #119; spec/adversarial-expert-evaluation.md AE1.0 — the
 * canonical spec; docs/LLM-ARCHITECT-FINAL-HANDOFF.md §7/§18).
 *
 * This is the ALTERNATE EVALUATION PATH: qualified experts compete by
 * independently solving a task and attempting to falsify one another's
 * solutions, with evidence-carrying challenges, qualification-aware
 * voting and evidence-weighted adjudication. It is an evaluation
 * method, NOT a replacement for Arena's Verification authority — the
 * raw upvote/downvote ratio is retained ONLY as a labelled discovery
 * signal and is structurally unable to drive a verdict.
 *
 *   - Competition lifecycle — the AE1.0 chain as a typed state machine
 *     (OPEN -> SOLICITING -> SUBMITTED -> CHALLENGE -> RESPONSE ->
 *     VOTING -> ADJUDICATION -> VERIFIED_RESULT, plus abandoned /
 *     insufficient-participation terminal states with typed reasons);
 *     append-only state history; terminal states accept no escape.
 *
 *   - The six AE1.0 judgment types — UPVOTE_WITH_PROOF /
 *     DOWNVOTE_WITH_PROOF / CHALLENGE / ACCEPT_CHALLENGE /
 *     REJECT_CHALLENGE / NEEDS_MORE_EVIDENCE — typed, evidence-carrying
 *     (>= 1 evidence item per judgment, a CONCRETE claim/step/artifact/
 *     outcome target), append-only.
 *
 *   - The structurally enforced guardrail battery — no self-voting,
 *     conflict-of-interest exclusion, duplicate-account protection,
 *     rate limiting, qualification-aware visibility and aggregation,
 *     minimum vote/evidence thresholds, small-sample status, explicit
 *     tie/unknown states — each a pure TESTED filter, never a
 *     convention comment.
 *
 *   - Evidence-weighted adjudication over the full AE1.0 input list
 *     (qualified expert votes, challenge validity, evidence quality,
 *     verifier outcome, task-specific evaluator, historical
 *     calibration, agreement/disagreement patterns) with deterministic,
 *     versioned Bradley-Terry-style pairwise aggregation and disclosed
 *     limitations. The AdjudicationInputs type EXCLUDES the community
 *     ratio by construction — the engine cannot read it.
 *
 *   - The certification boundary — results feed Evaluation/Verification/
 *     Certification as CANDIDATE inputs through public ports
 *     (candidateOnly: true, frozen boundary statement, no
 *     scope/authority field); `consumeResultAsCertification` has no
 *     happy path (architecture-lock rule 34).
 *
 *   - Byproduct records — adversarial trajectories, disagreement data
 *     and benchmark material projected into A030 research/benchmarks
 *     as candidates, rights/provenance-carrying.
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * (@arena/escalation-validation — the shared timestamp/value
 * conventions of the C009 adjudication fabric this package composes
 * with; @arena/evaluation + @arena/verification — the A012/A013
 * vocabularies whose outcome projections feed adjudication;
 * @arena/protocol-core — canonical digests). Zero service imports.
 * The REFERENCE SERVICE (lifecycle binding, submissions, challenges,
 * responses, votes as durable idempotent jobs, event emission) lives
 * in services/adversarial-evaluation.
 */

export * from './errors.js';
export * from './shared.js';
export * from './lifecycle.js';
export * from './judgments.js';
export * from './guardrails.js';
export * from './signals.js';
export * from './adjudication.js';
export * from './certification.js';
export * from './byproducts.js';

import { ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const ADVERSARIAL_EVALUATION_PROTOCOL_VERSION = 1 as const;

/** The adversarial-evaluation error codes this build understands. */
export const SUPPORTED_ADVERSARIAL_EVALUATION_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(ADVERSARIAL_EVALUATION_ERROR_CODES),
]);
