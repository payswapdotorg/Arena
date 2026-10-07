/**
 * @arena/expert-session-policy — the Arena ENTERPRISE SESSION POLICY
 * domain core (Work Order C018; issue #124; spec/expert-environment-
 * session.md EES1.0 privacy barrier + spec/security.md S1.0 data rights).
 *
 * Pure TypeScript domain package whose workspace imports are read-only
 * compositions of merged dependencies:
 *   - @arena/escalation        (C001 — the EscalationRequest policy
 *                               fields packs bind at request time);
 *   - @arena/expert-session    (C006 — the EES1.0 control set, privacy
 *                               barrier composition and session-mode
 *                               derivation; enforcement stays C006's);
 *   - @arena/intervention      (C007 — the mode vocabulary the
 *                               feasibility verdicts keep packs feasible
 *                               for);
 *   - @arena/security          (A034 — data-rights records and the typed
 *                               tenant model, composed not duplicated);
 *   - @arena/protocol-core     (canonical JSON + sha256 digests for the
 *                               audit chain — never reimplemented).
 *
 * Core objects (all deep-frozen, plain-JSON, append-only where history
 * is involved):
 *   - PolicyPack — versioned, tenant-scoped, composable bundles of
 *     EES1.0 privacy-barrier controls + a retention schedule per
 *     artifact class + security.md data-rights metadata +
 *     jurisdiction/residency declarations as explicit metadata;
 *   - Pack validation — typed CLOSED outcomes: valid /
 *     conflicting-controls-with-reasons / infeasible-for-session-modes
 *     (rejected packs are never silently weakened);
 *   - Retention engine — expiry → typed disposition transitions
 *     (RETAIN / ANONYMIZE / DELETE_PENDING / DELETED) with audit
 *     history retained after deletion; expert-withdrawal and
 *     customer-erasure are explicit state machines (deletion
 *     double-spend safe);
 *   - Cross-tenant pack reuse — explicit typed authorization with
 *     expiry and revocation (tenant data never silently cross-reused);
 *   - Effective session policy resolution — the pure monotone merge of
 *     the request's declared fields with the applicable pack into the
 *     C006 PrivacyBarrier + C006/C007 mode allowance handed to
 *     enforcement;
 *   - Policy audit trail — append-only, tamper-evident, sequenced and
 *     digest-chained (A015 discipline via @arena/protocol-core).
 */

export * from './errors.js';
export * from './shared.js';
export * from './controls.js';
export * from './pack.js';
export * from './retention.js';
export * from './tenancy.js';
export * from './audit.js';
export * from './resolution.js';

/** Version of this package's protocol surface. */
export const EXPERT_SESSION_POLICY_PACKAGE_VERSION = 1 as const;

export * from './test-support.js';
