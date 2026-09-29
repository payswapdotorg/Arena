/**
 * @arena/verification — the ARENA VERIFICATION PROTOCOL (Work Order
 * A013; requirements R13, R14, R27, R28; spec EV1.0 "Verification";
 * spec/quality-model.md "verifier strength / verifier agreement /
 * false positive-negative evidence / reproducibility";
 * architecture-lock rules 6, 7, 16, 17, 18; docs/architecture.md §5,
 * §18).
 *
 * Verification ESTABLISHES EVIDENCE SUPPORTING A RESULT — whether
 * required evidence exists and supports required claims. It NEVER
 * emits a numerical or graded quality assessment: that is a separate
 * protocol's responsibility (architecture-lock rule 7), and this
 * package enforces the separation BY CONSTRUCTION:
 *
 *   - the outcome vocabulary is a CLOSED three-member enum
 *     (pass | fail | unknown);
 *   - the outcome is DERIVED from the evidence-support summary by the
 *     pure total function deriveVerificationOutcome — there is no API
 *     through which a caller could supply a quantitative outcome;
 *   - every protocol object is strict-shape validated (unknown fields
 *     rejected), so a hook verdict or record input carrying an extra
 *     quantitative field is rejected;
 *   - the hygiene suite scans sources, contracts, README and the
 *     canonical object forms for assessment vocabulary that belongs to
 *     the other protocol.
 *
 * Pure TypeScript; runtime dependencies are @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * correlation ids / idempotency keys, SchemaRef, ProtocolError) and
 * @arena/artifact-protocol (the A002 artifact protocol whose
 * MaterialArtifact / ArtifactRef / verifyArtifact / verifyArtifactTree
 * primitives ARE the evidence-addressing and provenance-validation
 * substrate — consumed, never reimplemented). The criteria-assessment
 * protocol (lock rule 7's other half) is deliberately NOT imported.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - VerifierDescriptor — the content-addressed, versioned declaration
 *     of a verifier: id, version, method (the CLOSED EV1.0 enum:
 *     unit_integration_test | deterministic_formal_check |
 *     constraint_check | simulation | measurement | inspection |
 *     expert_review | evidence_provenance_validation — unknown methods
 *     rejected), the REQUIRED-EVIDENCE declaration (kind, claim,
 *     optional artifact pin, optional producer pin per requirement),
 *     the declared pass/fail/unknown semantics (all three mandatory),
 *     the reproducibility policy (deterministic | seeded-stochastic |
 *     provider-dependent, with seed/parameters recorded when
 *     applicable), input/output schema refs and provenance;
 *   - VerificationRecord — the APPEND-ONCE record of one verification
 *     run: verifier descriptor digest, the evidence bundle
 *     (provenance-bearing, digest-addressed A002 artifact references),
 *     the evidence-support summary (per requirement: present-supported
 *     | present-unsupported | present-unverified |
 *     present-indeterminate | missing), the DERIVED outcome and
 *     DERIVED structured unknown cause, correlation id + idempotency
 *     key, the COMPUTED input digest (verifier + evidence), timestamps
 *     and run provenance;
 *   - Evidence validation primitives — evidence-kind matching,
 *     reference resolution, digest verification and provenance-chain
 *     validation (A002 verifyArtifact / verifyArtifactTree), composed
 *     by assessEvidenceForRequirements into per-requirement
 *     assessments;
 *   - VerificationError / closed vocabularies / guards — the typed
 *     error taxonomy, the frozen vocabularies (methods, outcomes,
 *     support statuses, unknown reasons, reproducibility policies,
 *     validation failures) and the structural guards;
 *   - Envelope<T> wiring — run-verification-command /
 *     verification-recorded-event with REQUIRED idempotency keys on
 *     commands (architecture-lock rule 17).
 *
 * The REFERENCE FABRIC (verifier registry, verification runner, the two
 * reference verifier implementations) lives in services/verification
 * (@arena/verification-fabric) — in-process, zero external runtime
 * dependencies.
 *
 * Generated contracts live in ../../contracts/verification (repo root —
 * A013 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './verifier-method.js';
export * from './outcome.js';
export * from './evidence.js';
export * from './evidence-validation.js';
export * from './descriptor.js';
export * from './record.js';
export * from './envelopes.js';

import { VERIFICATION_ERROR_CODES } from './errors.js';
import { VERIFICATION_SCHEMA_VERSION, VERIFICATION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const VERIFICATION_PROTOCOL_VERSION = VERIFICATION_SCHEMA_VERSION;

/** The verification error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_VERIFICATION_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(VERIFICATION_ERROR_CODES)],
);

/** The verification schema registry (parity-checked against contracts). */
export const VERIFICATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...VERIFICATION_SCHEMAS,
});
