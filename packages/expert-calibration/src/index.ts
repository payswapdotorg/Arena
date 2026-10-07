/**
 * @arena/expert-calibration — EXPERT CALIBRATION, PRE-TRAINING AND
 * CONTINUOUS REQUALIFICATION (Work Order C004; issue #111; the quality
 * flywheel of the expert network).
 *
 * The package is PURE domain logic over the merged C003/A007 seams:
 *
 *   - CalibrationProgram — a versioned, content-addressed composition of
 *     calibration probes per capability (A004 vocabulary via
 *     CapabilityNodeRefView), each probe PINNED to evaluator/verifier
 *     criteria with a DECLARED minimum evidence requirement (EV1.0
 *     Certification Suite discipline); deterministic seeded ordering —
 *     reproducible given identical inputs;
 *   - CalibrationRecord — predicted confidence/score vs LATER-OBSERVED
 *     outcome per LE1.0 Calibration, applicability context (capability,
 *     domain, environment) PRESERVED, append-only and content-addressed;
 *     backdated outcome injection fails closed;
 *   - DriftVerdict — TYPED verdicts (calibrated / overconfident /
 *     underconfident / insufficient-sample / stale), never a bare score;
 *   - PreTrainingTrack — gap-filling assignments derived from the C003
 *     intake gap-list for the A017 workbench surface, with an EXPLICIT
 *     pre-trained / not-yet state; completion PROPOSES a qualification
 *     update to A007 (a proposal, never a write);
 *   - RequalificationPolicy + RequalificationProposal — freshness
 *     windows, closed triggers (time, drift verdict, domain-pack change,
 *     dispute), typed status-transition proposals in the A007 vocabulary
 *     (quality-model REVOKED law: revocation is a transition, history
 *     remains auditable); enforcement belongs to A007/routing consumers;
 *   - DemonstratedPerformance — the calibration read surface the C002
 *     routing engine consumes as its demonstrated-performance/freshness
 *     input (a port, not a write into routing).
 *
 * CALIBRATION IS DATA, NEVER AUTHORIZATION (lock rules 9/35):
 * consuming calibration output as an access grant fails closed
 * (`consumeCalibrationAsAuthorization` has no happy path); authority-
 * shaped field names are rejected at construction.
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests, Envelope<T>),
 * @arena/expert-qualification (the shared capability/evidence vocabulary
 * — consumed, never redefined) and @arena/expert-intake (the C003 typed
 * gap-list the pre-training track derives from — consumed, never
 * redefined). Zero service imports.
 *
 * The reference SERVICE (in-memory store + injected C003/A007/A017
 * ports + durable idempotent requalification jobs on the A015 job
 * fabric) lives in services/expert-calibration
 * (@arena/expert-calibration-service).
 */

export * from './errors.js';
export * from './shared.js';
export * from './program.js';
export * from './record.js';
export * from './verdict.js';
export * from './pretraining.js';
export * from './requalification.js';
export * from './performance.js';
export * from './envelopes.js';

import { EXPERT_CALIBRATION_ERROR_CODES } from './errors.js';
import { EXPERT_CALIBRATION_SCHEMA_VERSION, EXPERT_CALIBRATION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_CALIBRATION_PROTOCOL_VERSION = EXPERT_CALIBRATION_SCHEMA_VERSION;

/** The expert-calibration error codes this build understands. */
export const SUPPORTED_EXPERT_CALIBRATION_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(EXPERT_CALIBRATION_ERROR_CODES),
);

/** The expert-calibration schema registry. */
export const EXPERT_CALIBRATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...EXPERT_CALIBRATION_SCHEMAS,
  });
