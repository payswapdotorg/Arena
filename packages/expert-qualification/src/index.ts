/**
 * @arena/expert-qualification — the ARENA EXPERT QUALIFICATION AND
 * MATCHING PROTOCOL (Work Order A007; requirements R7 "Qualify experts
 * against evidence-backed competencies" and R8 "Match expert
 * requirements to qualified experts"; docs/architecture.md §8;
 * spec/quality-model.md expert-quality dimensions; architecture-lock
 * rules 6, 9, 11, 23, 24).
 *
 * QUALIFICATION IS DATA, NEVER AUTHORIZATION (lock rule 9 — the critical
 * gate): every object in this package is a typed DATA record about
 * evidence and evidence sufficiency. Nothing here grants, implies or
 * records a permission, a role or system authority; the qualification
 * record is an INPUT to matching and audit, never an access decision.
 *
 * Pure TypeScript; the ONLY runtime dependency is @arena/protocol-core,
 * whose primitives (canonical JSON + sha256 digests, Envelope<T>,
 * branded identifiers, SchemaRef, ProtocolError) are reused throughout —
 * never reimplemented. Cross-protocol objects (A006 credential refs and
 * expert-profile views, A013 verification-record refs, A012
 * evaluation-record refs, capability-graph node refs) are validated
 * plain-string VIEW types — the @arena/expert-registry convention — so
 * the profile DATA of A006 and the record digests of A012/A013 pass
 * through unchanged while this package stays dependency-minimal.
 *
 * Core objects (all deep-frozen, content-addressed, no mutation API):
 *   - QualificationEvidence — typed, digest-addressed evidence records
 *     over the CLOSED four-member kind vocabulary (credential-ref,
 *     work-product-ref, verification-ref, evaluation-ref), append-only
 *     with digest-chained supersession (lock rule 6);
 *   - CompetencyClaim — an expert's claim on a capability/skill node ref
 *     with a typed proficiency (A006's closed vocabulary) and its
 *     evidence set; tenant-scoped (lock rule 11);
 *   - QualificationPolicy — versioned, content-addressed rules stating
 *     what evidence kinds/counts/recency qualify (per-kind minimum
 *     counts, freshness window, validity window, conflict rules);
 *   - QualificationRecord — the COMPUTED qualification state of a claim
 *     under a declared policy at a fixed time: closed status vocabulary
 *     (qualified | unqualified | stale | expired | revoked), per-
 *     requirement sufficiency outcomes (counts + freshness, no scores),
 *     validity window (renewal/decay) and supersession chains — expiry
 *     APPENDS decay records, never rewrites history;
 *   - the pure engine — evaluateCompetencyClaim / recordQualificationExpiry
 *     / isQualificationInForce: deterministic, no clock reads, no hidden
 *     state, conflict evidence first (revocation), freshness next
 *     (staleness), sufficiency last;
 *   - MatchRequest / MatchingPolicy / MatchResult — the matching data
 *     contracts: per-requirement satisfaction evidence, explicit
 *     unmatched reasons from a closed vocabulary (no silent best-effort),
 *     deterministic digest tie-breaking, NO aggregate quality score and
 *     NO reputation input (spec/quality-model.md);
 *   - QualifiedExpertCard — the tenant-scoped matching-side view of an
 *     expert (domain/jurisdiction/availability metadata);
 *   - Envelope<T> wiring — qualify-claim-command /
 *     record-qualification-expiry-command (REQUIRED idempotency keys),
 *     qualification-recorded-event, match-experts-query /
 *     match-completed-response (pure queries carry none).
 *
 * The REFERENCE FABRIC (pool + matcher + command orchestration) lives in
 * services/expert-matching (@arena/expert-matching-fabric) — in-process,
 * zero external runtime dependencies.
 *
 * Generated contracts live in ../../contracts/expert-qualification (repo
 * root — A007 owned surface; see scripts/generate-contracts.mjs). Drift
 * is checked by the drift suite and governance G9 (which auto-discovers
 * package-level generators), and parity is asserted against this TS
 * surface by contracts.parity.test.ts.
 */

export * from './errors.js';
export * from './shared.js';
export * from './evidence.js';
export * from './claim.js';
export * from './policy.js';
export * from './qualification.js';
export * from './match-request.js';
export * from './matching-policy.js';
export * from './qualified-expert.js';
export * from './match-result.js';
export * from './envelopes.js';

import { EXPERT_QUALIFICATION_ERROR_CODES } from './errors.js';
import { EXPERT_QUALIFICATION_SCHEMA_VERSION, EXPERT_QUALIFICATION_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_QUALIFICATION_PROTOCOL_VERSION = EXPERT_QUALIFICATION_SCHEMA_VERSION;

/** The expert-qualification error codes this build understands (parity-checked against contracts). */
export const SUPPORTED_EXPERT_QUALIFICATION_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(EXPERT_QUALIFICATION_ERROR_CODES),
);

/** The expert-qualification schema registry (parity-checked against contracts). */
export const EXPERT_QUALIFICATION_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...EXPERT_QUALIFICATION_SCHEMAS,
  });
