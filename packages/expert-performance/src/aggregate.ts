/**
 * The typed, versioned SINGLE-DIMENSION aggregate + the structural
 * no-single-global-score law (Work Order C005; spec/quality-model.md:
 * "Do not collapse expert quality into a single global score").
 *
 * The ONLY aggregate this package can produce is a per-dimension outcome
 * frequency summary that discloses:
 *
 *   - its FORMULA (closed vocabulary, versioned) and formula version;
 *   - its SAMPLE SIZES (per outcome + total);
 *   - its KNOWN LIMITATIONS (mandatory disclosures are appended to any
 *     caller-provided list — an aggregate without disclosed limitations
 *     has no construction path).
 *
 * Everything else fails closed:
 *
 *   - a CROSS-DIMENSION aggregate (records from more than one dimension,
 *     or a dimensions list with more than one entry) is rejected —
 *     INVALID_AGGREGATE;
 *   - a GLOBAL / OVERALL expert score has NO construction path at all:
 *     `consumeProfileAsGlobalScore` and `buildGlobalExpertScore` have no
 *     happy path and always throw GLOBAL_SCORE_REJECTED (the single-score
 *     smuggling attempt fails closed at every boundary — domain, lens,
 *     aggregate, envelope, service).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  toPerformanceTimestamp,
} from './shared.js';
import type { PerformanceTimestamp } from './shared.js';
import { toPerformanceDimension } from './dimensions.js';
import type { PerformanceDimension } from './dimensions.js';
import type { PerformanceEvidenceRecord } from './record.js';
import type { FreshnessPolicy } from './freshness.js';

/** Wire version of the dimensional aggregate shape. */
export const DIMENSIONAL_AGGREGATE_VERSION = 1 as const;

/** The closed aggregate formula vocabulary (ONE entry — by construction). */
export const AGGREGATE_FORMULAS = Object.freeze(['dimensional-outcome-frequency'] as const);

export type AggregateFormula = (typeof AGGREGATE_FORMULAS)[number];

/** The formula version (changing the formula is a new formula version). */
export const AGGREGATE_FORMULA_VERSION = '1.0.0' as const;

/**
 * The mandatory limitation disclosures appended to EVERY aggregate —
 * "any aggregate is typed + versioned and must disclose its formula,
 * sample sizes and known limitations" (C005 work order).
 */
export const MANDATORY_AGGREGATE_LIMITATIONS = Object.freeze([
  'single-dimension summary only — cross-dimension aggregation, weighting or ranking is structurally unavailable (no-single-global-score law, spec/quality-model.md)',
  'an outcome frequency is a summary of append-only evidence, not a capability claim; applicability context and attribution are carried by the underlying records',
  'stale evidence is included in the counts but flagged by the profile freshness assessment; this aggregate performs no decay',
] as const);

export interface DimensionalSummaryAggregateView {
  readonly aggregateVersion: typeof DIMENSIONAL_AGGREGATE_VERSION;
  /** EXACTLY ONE dimension — cross-dimension aggregates are rejected. */
  readonly dimension: PerformanceDimension;
  readonly formula: AggregateFormula;
  readonly formulaVersion: typeof AGGREGATE_FORMULA_VERSION;
  readonly outcomeCounts: Readonly<Record<string, number>>;
  readonly sampleSize: number;
  readonly limitations: readonly string[];
  readonly asOf: PerformanceTimestamp;
}

/** A frozen, content-addressed dimensional aggregate (+ digest). */
export interface DimensionalSummaryAggregate extends DimensionalSummaryAggregateView {
  readonly digest: string;
}

export interface BuildDimensionalAggregateInput {
  readonly dimension: string;
  readonly records: readonly PerformanceEvidenceRecord[];
  readonly limitations?: readonly string[];
  readonly asOf: string;
}

/**
 * Build the typed, versioned, SINGLE-DIMENSION outcome-frequency
 * aggregate. Fails closed when the records span more than one dimension
 * (cross-dimension aggregation is structurally unavailable) or when the
 * formula is not the closed one. Mandatory limitation disclosures are
 * ALWAYS appended — an aggregate cannot be constructed without them.
 */
export async function buildDimensionalSummaryAggregate(
  input: BuildDimensionalAggregateInput,
): Promise<DimensionalSummaryAggregate> {
  const record = expectFields(
    input,
    ['dimension', 'records', 'asOf'],
    ['limitations'],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_AGGREGATE,
    'dimensional aggregate',
  );
  const dimension = toPerformanceDimension(record['dimension'], 'dimensional aggregate');
  const records = Array.isArray(record['records'])
    ? (record['records'] as readonly PerformanceEvidenceRecord[])
    : [];
  for (const evidence of records) {
    if (evidence.dimension !== dimension) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_AGGREGATE, {
        message: `dimensional aggregate: record ${JSON.stringify(evidence.recordId)} belongs to dimension '${evidence.dimension}' — an aggregate over dimension '${dimension}' cannot fold it (cross-dimension aggregation is structurally unavailable; the no-single-global-score law)`,
        details: { aggregateDimension: dimension, recordDimension: evidence.dimension },
      });
    }
  }
  const asOf = toPerformanceTimestamp(record['asOf'] as string, 'dimensional aggregate asOf');
  const admissible = records.filter(
    (evidence) => Date.parse(evidence.recordedAt) <= Date.parse(asOf),
  );
  const outcomeCounts: Record<string, number> = {};
  let sampleSize = 0;
  for (const evidence of admissible) {
    outcomeCounts[evidence.outcome] = (outcomeCounts[evidence.outcome] ?? 0) + 1;
    sampleSize += evidence.sampleSize;
  }
  const callerLimitations = Array.isArray(record['limitations'])
    ? (record['limitations'] as readonly string[])
    : [];
  for (const limitation of callerLimitations) {
    expectNonEmptyString(
      limitation,
      'limitation',
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_AGGREGATE,
      'dimensional aggregate',
    );
  }
  const view: DimensionalSummaryAggregateView = {
    aggregateVersion: DIMENSIONAL_AGGREGATE_VERSION,
    dimension,
    formula: 'dimensional-outcome-frequency',
    formulaVersion: AGGREGATE_FORMULA_VERSION,
    outcomeCounts: Object.freeze(outcomeCounts),
    sampleSize,
    limitations: Object.freeze([...callerLimitations, ...MANDATORY_AGGREGATE_LIMITATIONS]),
    asOf,
  };
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as DimensionalSummaryAggregate;
}

/** The digest-free view (what the digest commits to). */
export function dimensionalAggregateView(
  aggregate: DimensionalSummaryAggregate,
): DimensionalSummaryAggregateView {
  const { digest: _digest, ...rest } = aggregate;
  return deepFreeze({ ...rest }) as DimensionalSummaryAggregateView;
}

// ---------------------------------------------------------------------------
// The no-single-global-score law — no happy paths
// ---------------------------------------------------------------------------

/**
 * THE SINGLE-SCORE SMUGGLING DEFENSE: consuming a performance profile (or
 * any lens over it) as a global/overall expert score has NO happy path —
 * every call fails closed with GLOBAL_SCORE_REJECTED. Performance
 * evidence is dimensional; collapsing it is rejected at the boundary
 * (lock rule 35: performance evidence ≠ authorization ≠ correctness
 * verification).
 */
export function consumeProfileAsGlobalScore(): never {
  throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message:
      'expert performance cannot be collapsed into a single global score — read the dimensional evidence (spec/quality-model.md Expert quality; the profile is dimensional by construction)',
  });
}

/**
 * A global/overall/cross-dimension aggregate builder has NO construction
 * path: any requested formula outside the closed single-dimension
 * vocabulary (global-score, overall-score, weighted-composite, rank) is
 * rejected here before any record is folded.
 */
export function buildGlobalExpertScore(
  requestedFormula: string,
): never {
  throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message: `aggregate formula '${requestedFormula}' is not available — the only aggregate is the typed, versioned, single-dimension outcome-frequency summary (AGGREGATE_FORMULAS)`,
    details: { requestedFormula, known: AGGREGATE_FORMULAS },
  });
}

/**
 * Weighted cross-dimension combination is structurally unavailable: there
 * is no dimension weight table in this package at all. This function is
 * the fail-closed marker for that absence.
 */
export function applyDimensionWeights(): never {
  throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message:
      'no dimension weights exist — cross-dimension weighting would collapse expert quality into a single score and is structurally unavailable',
  });
}

/** Policy ref for aggregate freshness honesty (no decay in aggregates). */
export function aggregateDisclosesPolicy(_policy: FreshnessPolicy): true {
  return true;
}
