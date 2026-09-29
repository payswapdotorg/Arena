/**
 * @arena/certification — the ARENA CERTIFICATION PROTOCOL (Work Order
 * A023; requirements R21, R22, R43, R45, R46; the README "Design law";
 * spec/quality-model.md "Certification levels" / "Professional
 * limitations"; architecture-lock rules 4, 12, 16, 17, 18, 23;
 * docs/architecture.md §10, §13, §14).
 *
 * Arena certifies statements of the form:
 *
 *   "Agent Body B, version V, possessed by Cognitive Substrate M,
 *    under Environment E and Runtime Profile R, satisfied
 *    Certification Suite S at revision X."
 *
 * Arena does NOT certify that M alone is a professional. The law is
 * enforced BY CONSTRUCTION:
 *
 *   - the subject (the composition under test) requires ALL FIVE
 *     components (body version, substrate, environment, runtime
 *     profile, suite) — a substrate-only subject is unrepresentable;
 *   - the CertificationStatement is DERIVED from the subject + suite +
 *     verdict by the record constructor — there is NO API through which
 *     a caller could supply an unscoped statement;
 *   - every statement carries the professional-limitations notice
 *     (lock rule 23; R46);
 *   - the hygiene suite scans sources, contracts, README and the
 *     canonical object forms for unscoped professional-attestation
 *     vocabulary.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - CertificationSuite — the content-addressed, versioned declaration
 *     of a certification suite: the ORDERED stage composition pinning
 *     the exact A012 evaluator+criteria digests, A013 verifier digests,
 *     A022 compatibility requirements, A014 dataset refs and
 *     environment/runtime composition requirements; the grant level
 *     (DEVELOPMENT | CANDIDATE | CERTIFIED), declared constraints (⇒
 *     CONDITIONAL), the professional-limitations notice, the supersedes
 *     lineage and provenance;
 *   - CertificationSubject — the composition under test (B/V × M × E ×
 *     R), every component required;
 *   - CertificationRecord — the APPEND-ONCE record of one run (or
 *     revocation): the DERIVED verdict (satisfied | not-satisfied |
 *     unknown — never a score), the DERIVED structured unknown cause
 *     (closed reason taxonomy, required iff unknown), the DERIVED
 *     granted level (a failed or indeterminate run grants NOTHING),
 *     the DERIVED scoped statement, the COMPUTED input digest (R22
 *     reproducibility anchor), per-stage results (closed machine
 *     reasons), correlation id + idempotency key, tenant/workspace
 *     scoping, the supersedes lineage and provenance;
 *   - CertificationEngine — evaluateCertificationRun: the DETERMINISTIC
 *     evaluation of one Body × Substrate × Environment × RuntimeProfile
 *     × Suite tuple over the consumed sibling-protocol evidence
 *     (A012/A013/A022/A014), fail-closed at every stage;
 *   - CertificationError / closed vocabularies / guards — the typed
 *     error taxonomy, the frozen vocabularies (verdicts, levels, stage
 *     kinds, stage reasons, unknown reasons) and the structural guards;
 *   - Envelope<T> wiring — run-certification-command /
 *     certification-recorded-event with REQUIRED idempotency keys on
 *     commands (architecture-lock rule 17).
 *
 * The REFERENCE FABRIC (suite registry, certification runner, evidence
 * ledger with supersession + revocation projections) lives in
 * services/certification (@arena/certification-fabric) — in-process,
 * zero external runtime dependencies.
 *
 * Generated contracts live in ../../contracts/certification (repo root
 * — A023 owned surface; see scripts/generate-contracts.mjs). Drift is
 * checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './level.js';
export * from './outcome.js';
export * from './subject.js';
export * from './suite.js';
export * from './statement.js';
export * from './record.js';
export * from './engine.js';
export * from './envelopes.js';

import { CERTIFICATION_ERROR_CODES } from './errors.js';
import { CERTIFICATION_SCHEMA_VERSION, CERTIFICATION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const CERTIFICATION_PROTOCOL_VERSION = CERTIFICATION_SCHEMA_VERSION;

/** The certification error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_CERTIFICATION_ERROR_CODES: readonly string[] = Object.freeze(
  [...Object.values(CERTIFICATION_ERROR_CODES)],
);

/** The schema registry of this package (parity-checked against contracts). */
export const CERTIFICATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...CERTIFICATION_SCHEMAS,
});
