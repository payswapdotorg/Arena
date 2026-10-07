/**
 * The closed Expert-quality DIMENSION vocabulary (Work Order C005;
 * spec/quality-model.md "Expert quality" — the acceptance list).
 *
 * spec/quality-model.md: "Do not collapse expert quality into a single
 * global score. Maintain evidence for: competency by skill; task-family
 * performance; agreement; review outcomes; consistency; domain/
 * jurisdiction fit; recentness/freshness; conflicts/limitations."
 *
 * Each dimension is one RECORD FAMILY of the append-only profile: every
 * evidence record belongs to EXACTLY ONE dimension and carries that
 * dimension's closed outcome vocabulary, its applicability-context
 * requirements, and the ingestion source families allowed to feed it.
 * Cross-dimension evidence and cross-dimension aggregates are structurally
 * unavailable (see aggregate.ts — the no-single-global-score law).
 *
 * DEVIATION NOTE (no dedicated canonical spec — recorded as architecture
 * questions in the PR): the outcome vocabularies and the
 * (source-family → dimension) ingestion mapping below are DERIVED from the
 * quality-model dimension list, the C005 work-items row, the merged dep
 * surfaces' vocabularies (C004 drift verdicts, A007 qualification/match
 * history, A019 skill-extraction outcomes, A020 attribution sources) and
 * FINAL-HANDOFF §10. They are versioned constants — changing any of them
 * is a new profile version, never an in-place mutation.
 */

import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';

/** The wire version of the dimensional record-family vocabulary. */
export const PERFORMANCE_DIMENSION_VOCABULARY_VERSION = 1 as const;

/**
 * The eight Expert-quality dimensions — one record family each
 * (spec/quality-model.md order preserved).
 */
export const PERFORMANCE_DIMENSIONS = Object.freeze([
  'skill-competency',
  'task-family-outcome',
  'agreement',
  'review-outcome',
  'consistency',
  'domain-jurisdiction-fit',
  'recency',
  'conflict-limitation',
] as const);

export type PerformanceDimension = (typeof PERFORMANCE_DIMENSIONS)[number];

/** The closed outcome vocabulary per dimension. */
export const DIMENSION_OUTCOMES: Readonly<Record<PerformanceDimension, readonly string[]>> =
  Object.freeze({
    'skill-competency': Object.freeze([
      'demonstrated',
      'improved',
      'not-demonstrated',
      'regressed',
      'inconclusive',
    ]),
    'task-family-outcome': Object.freeze([
      'completed',
      'completed-with-revision',
      'not-completed',
      'inconclusive',
    ]),
    agreement: Object.freeze(['agreed', 'partial', 'disagreed', 'inconclusive']),
    'review-outcome': Object.freeze([
      'accepted',
      'accepted-with-changes',
      'rejected',
      'inconclusive',
    ]),
    consistency: Object.freeze(['stable', 'variable', 'inconclusive']),
    'domain-jurisdiction-fit': Object.freeze([
      'fit-confirmed',
      'partial-fit',
      'out-of-scope',
      'inconclusive',
    ]),
    recency: Object.freeze(['active', 'inactive']),
    'conflict-limitation': Object.freeze([
      'conflict-declared',
      'limitation-declared',
      'none-declared',
    ]),
  } as const);

export type DimensionOutcome = string;

/**
 * The applicability-context fields each dimension REQUIRES on its records
 * ("each record carrying source refs, sample size and applicability
 * context"). Optional elsewhere, required here — an evidence record
 * without its applicability context is not admissible.
 */
export const DIMENSION_REQUIRED_CONTEXT: Readonly<
  Record<PerformanceDimension, readonly string[]>
> = Object.freeze({
  'skill-competency': Object.freeze(['capability']),
  'task-family-outcome': Object.freeze(['taskFamily']),
  agreement: Object.freeze([]),
  'review-outcome': Object.freeze(['taskFamily']),
  consistency: Object.freeze([]),
  'domain-jurisdiction-fit': Object.freeze(['domain']),
  recency: Object.freeze([]),
  'conflict-limitation': Object.freeze(['domain']),
} as const);

/**
 * The ingestion source families (the merged dep public surfaces this
 * package accumulates — structural mirrors of THEIR vocabularies, never
 * writes into their state): C004 calibration/requalification verdicts,
 * A007 qualification records + matching history, A019 skill-extraction
 * outcomes, A020 experiment/attribution records.
 */
export const EVIDENCE_SOURCE_FAMILIES = Object.freeze([
  'expert-calibration-verdict',
  'expert-qualification-record',
  'expert-match-history',
  'skill-extraction-outcome',
  'learning-experiment-attribution',
] as const);

export type EvidenceSourceFamily = (typeof EVIDENCE_SOURCE_FAMILIES)[number];

/**
 * Which dimensions each source family may feed (closed mapping). An
 * ingestion attempt outside this table fails closed with
 * EXPERT_PERFORMANCE_INVALID_SOURCE — evidence cannot be booked into a
 * dimension its provenance family does not speak about.
 */
const SOURCE_FAMILY_DIMENSIONS_TABLE = {
  'expert-calibration-verdict': [
    'skill-competency',
    'agreement',
    'consistency',
    'recency',
  ],
  'expert-qualification-record': ['domain-jurisdiction-fit', 'conflict-limitation'],
  'expert-match-history': [
    'task-family-outcome',
    'review-outcome',
    'agreement',
    'domain-jurisdiction-fit',
    'recency',
  ],
  'skill-extraction-outcome': ['skill-competency', 'consistency', 'recency'],
  'learning-experiment-attribution': ['skill-competency', 'consistency'],
} as const;

export const SOURCE_FAMILY_DIMENSIONS: Readonly<
  Record<EvidenceSourceFamily, readonly PerformanceDimension[]>
> = Object.freeze(SOURCE_FAMILY_DIMENSIONS_TABLE);

export function isPerformanceDimension(value: unknown): value is PerformanceDimension {
  return (
    typeof value === 'string' &&
    (PERFORMANCE_DIMENSIONS as readonly string[]).includes(value)
  );
}

export function isEvidenceSourceFamily(value: unknown): value is EvidenceSourceFamily {
  return (
    typeof value === 'string' &&
    (EVIDENCE_SOURCE_FAMILIES as readonly string[]).includes(value)
  );
}

/** Validate + return the closed dimension (fail closed on unknown). */
export function toPerformanceDimension(value: unknown, context: string): PerformanceDimension {
  if (!isPerformanceDimension(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
      message: `${context}: unknown expert-quality dimension: ${JSON.stringify(String(value))} (closed vocabulary of ${String(PERFORMANCE_DIMENSIONS.length)})`,
      details: { known: PERFORMANCE_DIMENSIONS },
    });
  }
  return value;
}

/** Validate + return the closed outcome for a dimension (fail closed). */
export function toDimensionOutcome(
  dimension: PerformanceDimension,
  value: unknown,
  context: string,
): DimensionOutcome {
  const known = DIMENSION_OUTCOMES[dimension];
  if (typeof value !== 'string' || !known.includes(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_OUTCOME, {
      message: `${context}: outcome '${String(value)}' is not in the closed vocabulary of dimension '${dimension}'`,
      details: { dimension, known },
    });
  }
  return value;
}

/** Validate the (family → dimension) ingestion mapping (fail closed). */
export function toSourceFamilyDimension(
  family: unknown,
  dimension: unknown,
  context: string,
): { family: EvidenceSourceFamily; dimension: PerformanceDimension } {
  if (!isEvidenceSourceFamily(family)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: unknown evidence source family: ${JSON.stringify(String(family))}`,
      details: { known: EVIDENCE_SOURCE_FAMILIES },
    });
  }
  const target = toPerformanceDimension(dimension, context);
  const allowed = SOURCE_FAMILY_DIMENSIONS[family];
  if (!allowed.includes(target)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: source family '${family}' cannot feed dimension '${target}' (closed mapping)`,
      details: { family, dimension: target, allowed },
    });
  }
  return { family, dimension: target };
}
