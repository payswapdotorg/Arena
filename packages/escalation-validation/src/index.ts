/**
 * @arena/escalation-validation — the ARENA ESCALATION VALIDATION /
 * ADJUDICATION domain core (Work Order C009; issue #116; the trust gate
 * of the escalation loop: spec/expert-escalation-api.md ES1.0
 * VALIDATING → ACCEPTED | REVISION_REQUIRED | REJECTED, spec/evaluation.md
 * EV1.0, spec/escalation-reference-flow.md steps 11-12).
 *
 * This package implements the real engine behind C007's labelled
 * validation seam (the C002 precedent: C002 implemented the engine
 * behind C001's routing seam):
 *
 *   - Validation-plan derivation — the EscalationRequest's DECLARED
 *     validation condition compiles into a typed, versioned,
 *     content-addressed ValidationPlan selecting the EV1.0 evaluator
 *     (kind, criteria, threshold, output schema, minimum evidence,
 *     limitations) and verifier (method, required evidence with claims,
 *     declared pass/fail/unknown semantics), plus the versioned
 *     revision policy. Deterministic given identical inputs; the
 *     derivation outcome is the TYPED CLOSED union
 *     plan-derivable | under-specified-with-reasons — never a bare
 *     boolean, and NEVER a silently-invented default condition.
 *
 *   - Adjudication — a C007 SUBMITTED payload is judged through
 *     EXPLICITLY DISTINCT evaluation (A012: judgment against criteria)
 *     and verification (A013: evidence supports claims) stages
 *     (architecture-lock rule 7 — never collapsed) into the verdict
 *     ACCEPTED | REVISION_REQUIRED | REJECTED | NEEDS_MORE_EVIDENCE
 *     with machine-readable reasons (closed code vocabulary), evidence
 *     refs and evaluator/verifier outcome refs. A validation verdict is
 *     NEVER an authorization or certification (lock rules 9/35 —
 *     exact-field validation rejects smuggled authority fields).
 *
 *   - The bounded revision loop — REVISION_REQUIRED becomes a typed
 *     revision request (what must change, resubmission deadline,
 *     attempt number); exhausted attempts REJECT with reasons; every
 *     round appends (lock rule 6). The revision-limit bypass is
 *     impossible by construction.
 *
 *   - Expert replacement — typed triggers (validation-failure-beyond-
 *     revision | validation-failure | timeout | withdrawal) guarded
 *     against the C001 explicit replacement funnel (result_rejected /
 *     in-flight states → EXPERT_REPLACED → MATCHING through the C002
 *     routing seam). Replaced-expert evidence and history are RETAINED;
 *     no silent state mutation.
 *
 *   - Validator selection — C005 dimensional evidence (competency by
 *     skill, agreement patterns) as INPUT to deterministic selection,
 *     never authorization (lock rule 35); conflict-of-interest
 *     exclusion is an explicit tested filter with a full exclusion
 *     ledger.
 *
 *   - Append-only validation history per escalation (supersession house
 *     pattern; tenant isolation at the domain level).
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * (@arena/escalation — the C001 lifecycle/result/event vocabulary,
 * @arena/intervention — the C007 result-contract seam input,
 * @arena/evaluation + @arena/verification — the A012/A013 EV1.0
 * vocabularies, @arena/expert-performance's dimensional vocabulary via
 * host-wired candidates, @arena/protocol-core — canonical digests).
 * Zero service imports. The REFERENCE SERVICE (lifecycle binding, event
 * emission, the C007 seam implementation) lives in
 * services/escalation-validation.
 */

export * from './errors.js';
export * from './shared.js';
export * from './plan.js';
export * from './adjudication.js';
export * from './revision.js';
export * from './replacement.js';
export * from './validator-selection.js';
export * from './history.js';

import { ESCALATION_VALIDATION_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const ESCALATION_VALIDATION_PROTOCOL_VERSION = 1 as const;

/** The escalation-validation error codes this build understands. */
export const SUPPORTED_ESCALATION_VALIDATION_ERROR_CODES: readonly string[] = Object.freeze([
  ...Object.values(ESCALATION_VALIDATION_ERROR_CODES),
]);
