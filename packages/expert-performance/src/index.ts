/**
 * @arena/expert-performance — EXPERT PERFORMANCE / MERIT-STYLE
 * LONGITUDINAL EVIDENCE PROFILE (Work Order C005; issue #112; the
 * long-term memory of expert quality).
 *
 * The package is PURE domain logic over the merged C004/A007/A019/A020
 * seams:
 *
 *   - PerformanceEvidenceRecord — the append-only, provenance-addressable
 *     evidence record; ONE record family per quality-model Expert quality
 *     dimension (skill-competency, task-family-outcome, agreement,
 *     review-outcome, consistency, domain-jurisdiction-fit, recency,
 *     conflict-limitation), each carrying its closed outcome vocabulary,
 *     applicability context, sample size and dep source provenance;
 *   - PerformanceProfile — the deterministic dimensional fold + the two
 *     read LENSES over the same canonical object (toRoutingLens for the
 *     C002 demonstrated-performance/historical-task-fit seam;
 *     toCapabilityHistoryLens for the expert-facing capability history);
 *   - DimensionalSummaryAggregate — the ONLY aggregate: typed, versioned,
 *     single-dimension, formula/sample-size/limitation-disclosing;
 *   - FreshnessPolicy — explicit versioned per-dimension staleness
 *     windows; stale evidence surfaces as stale with reasons, never
 *     silent decay;
 *   - mapSourceEvidence — the pure closed ingestion mapping from the dep
 *     public surfaces (C004 calibration verdicts, A007 qualification +
 *     match history, A019 skill-extraction outcomes, A020 attribution
 *     records) into evidence records — never direct writes into dep
 *     state.
 *
 * THE NO-SINGLE-GLOBAL-SCORE LAW IS STRUCTURAL (spec/quality-model.md):
 * no profile/lens/aggregate type carries a score field; exact-field
 * validation rejects smuggled score-shaped keys; the only aggregate is
 * single-dimension; `consumeProfileAsGlobalScore` /
 * `buildGlobalExpertScore` / `applyDimensionWeights` have NO happy paths.
 *
 * ATTRIBUTION DISCIPLINE (LE1.0 vocabulary via A020): every record
 * attributes expert-change vs evaluator-change vs measurement-variance,
 * and a record whose evaluator version digest changed can NEVER be
 * recorded as an expert performance change
 * (EXPERT_PERFORMANCE_ATTRIBUTION_VIOLATION).
 *
 * PERFORMANCE EVIDENCE IS DATA, NEVER AUTHORIZATION AND NEVER CORRECTNESS
 * VERIFICATION (lock rules 9/35): authority-shaped/PII-shaped field names
 * are rejected at construction; consuming the profile as an access grant
 * has no code path at all.
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests, Envelope<T>) and
 * @arena/expert-qualification (the shared capability-node ref vocabulary
 * — consumed, never redefined). Zero service imports.
 *
 * The reference SERVICE (in-memory append-only store + injected dep
 * source ports + fail-closed provenance verification + the two read
 * lenses) lives in services/expert-performance
 * (@arena/expert-performance-service).
 */

export * from './errors.js';
export * from './shared.js';
export * from './dimensions.js';
export * from './record.js';
export * from './freshness.js';
export * from './profile.js';
export * from './aggregate.js';
export * from './ingestion.js';
export * from './envelopes.js';

import { EXPERT_PERFORMANCE_ERROR_CODES } from './errors.js';
import { EXPERT_PERFORMANCE_SCHEMA_VERSION, EXPERT_PERFORMANCE_SCHEMAS } from './envelopes.js';

/** Version of this package's protocol surface. */
export const EXPERT_PERFORMANCE_PROTOCOL_VERSION = EXPERT_PERFORMANCE_SCHEMA_VERSION;

/** The expert-performance error codes this build understands. */
export const SUPPORTED_EXPERT_PERFORMANCE_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(EXPERT_PERFORMANCE_ERROR_CODES),
);

/** The expert-performance schema registry. */
export const EXPERT_PERFORMANCE_SCHEMA_REGISTRY: Readonly<Record<string, string>> =
  Object.freeze({
    ...EXPERT_PERFORMANCE_SCHEMAS,
  });
