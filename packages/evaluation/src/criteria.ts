/**
 * EvaluationCriteria — the EXPLICIT, versioned, content-addressed
 * criteria object judgment runs against (Work Order A012 gate 3;
 * spec EV1.0 "Evaluation is judgment against explicit criteria";
 * spec/quality-model.md "Evaluation quality" — score stability under
 * rerun, evaluator versioning).
 *
 * A criteria object binds:
 *   - `criteriaId` + `version` — the versioned identity of this criteria
 *     set (changing ANY content of a criteria object changes its digest;
 *     criteria are content-addressed, so every historical criteria
 *     version stays addressable forever — architecture-lock rule 12);
 *   - `entries` — the ORDERED criterion list: criterion id, positive
 *     finite weight, explicit description (what "good" looks like), and
 *     a content-addressed target ref (the digest of the object the
 *     criterion judges — a capability-case section, a capability-graph
 *     node, an artifact…). Criterion ids are unique (duplicate rejected);
 *   - `aggregation` — how per-criterion verdicts become one aggregate
 *     judgment: `weighted-sum` (normalized weighted mean of scores in
 *     [0,1]), `pass-threshold` (fraction of criteria passing, scores
 *     in {0,1}) or `rubric-level` (the minimum rubric level achieved,
 *     integer scores in [1,5]) — a closed enum;
 *   - `thresholds.passAt` — the judgment bar for the aggregate, its
 *     domain validated per aggregation policy (fraction in (0,1] for
 *     weighted-sum and pass-threshold; integer level in [1,5] for
 *     rubric-level).
 *
 * Content addressing: the sha256 digest is computed over the canonical
 * JSON of the digest-free view with @arena/protocol-core's
 * digestCanonical — NEVER reimplemented here. Same criteria ⇒ same
 * digest; ANY field change ⇒ a different digest (gate 3 tests). The
 * object is deep-frozen at creation — there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  isContentDigest,
  isEvaluationId,
  isEvaluationVersion,
  isNeutralText,
  toContentDigest,
  toEvaluationId,
  toEvaluationVersion,
  toNeutralText,
} from './shared.js';
import type { ContentDigest, EvaluationId, EvaluationVersion, NeutralText } from './shared.js';

/** Wire version of the evaluation-criteria shape. */
export const EVALUATION_CRITERIA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Aggregation policy (closed enum)
// ---------------------------------------------------------------------------

export const AGGREGATION_POLICIES = Object.freeze([
  'weighted-sum',
  'pass-threshold',
  'rubric-level',
] as const);

export type AggregationPolicy = (typeof AGGREGATION_POLICIES)[number];

/** Structural (non-throwing) check for the closed aggregation-policy enum. */
export function isAggregationPolicy(value: unknown): value is AggregationPolicy {
  return (
    typeof value === 'string' &&
    (AGGREGATION_POLICIES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// CriterionEntry — one ordered criterion
// ---------------------------------------------------------------------------

/** One criterion: id, weight, explicit description, target ref. */
export interface CriterionEntry {
  readonly criterionId: EvaluationId;
  /** Positive finite weight (normalized by the weighted-sum aggregation). */
  readonly weight: number;
  /** The explicit statement of what "good" looks like (EV1.0: explicit criteria). */
  readonly description: NeutralText;
  /** Content-addressed target: the digest of the object this criterion judges. */
  readonly targetRef: ContentDigest;
}

/** Stable field list for a criterion entry (tests + contracts mirror it). */
export const CRITERION_ENTRY_FIELDS = Object.freeze([
  'criterionId',
  'weight',
  'description',
  'targetRef',
] as const) as readonly string[];

export interface CriterionEntryInput {
  readonly criterionId: string;
  readonly weight: number;
  readonly description: string;
  readonly targetRef: string;
}

/** Structural (non-throwing) check for one criterion entry. */
export function isCriterionEntry(value: unknown): value is CriterionEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEvaluationId(candidate['criterionId']) &&
    typeof candidate['weight'] === 'number' &&
    Number.isFinite(candidate['weight']) &&
    candidate['weight'] > 0 &&
    isNeutralText(candidate['description']) &&
    isContentDigest(candidate['targetRef'])
  );
}

function toCriterionEntry(value: unknown, index: number): CriterionEntry {
  const record = expectFields(
    value,
    ['criterionId', 'weight', 'description', 'targetRef'],
    [],
    EVALUATION_ERROR_CODES.INVALID_CRITERIA,
    `criteria entry ${String(index + 1)}`,
  );
  const weight = expectNumberInRange(
    record['weight'],
    'weight',
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    EVALUATION_ERROR_CODES.INVALID_CRITERIA,
    `criteria entry ${String(index + 1)}`,
  );
  if (weight <= 0) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: `criteria entry ${String(index + 1)}: weight must be strictly positive, got: ${String(weight)}`,
      details: { field: 'weight', value: weight },
    });
  }
  return deepFreeze({
    criterionId: toEvaluationId(
      typeof record['criterionId'] === 'string' ? record['criterionId'] : '',
      `criteria entry ${String(index + 1)} criterionId`,
    ),
    weight,
    description: toNeutralText(
      typeof record['description'] === 'string' ? record['description'] : '',
      `criteria entry ${String(index + 1)} description`,
    ),
    targetRef: toContentDigest(
      typeof record['targetRef'] === 'string' ? record['targetRef'] : '',
      `criteria entry ${String(index + 1)} targetRef`,
    ),
  });
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** The judgment bar of the aggregate; semantics validated per policy. */
export interface EvaluationThresholds {
  /**
   * The aggregate value at or above which the aggregate judgment is
   * "meets-criteria": for weighted-sum/pass-threshold a fraction in
   * (0, 1]; for rubric-level an integer level in [1, 5].
   */
  readonly passAt: number;
}

/** Stable field list for thresholds (tests + contracts mirror it). */
export const EVALUATION_THRESHOLDS_FIELDS = Object.freeze(['passAt'] as const) as readonly string[];

function toThresholds(
  aggregation: AggregationPolicy,
  value: unknown,
): EvaluationThresholds {
  const record = expectFields(
    value,
    ['passAt'],
    [],
    EVALUATION_ERROR_CODES.INVALID_AGGREGATION,
    'criteria thresholds',
  );
  const passAt = record['passAt'];
  switch (aggregation) {
    case 'weighted-sum':
    case 'pass-threshold': {
      const checked = expectNumberInRange(
        passAt,
        'thresholds.passAt',
        Number.MIN_VALUE,
        1,
        EVALUATION_ERROR_CODES.THRESHOLD_OUT_OF_RANGE,
        'criteria thresholds',
      );
      if (checked <= 0) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.THRESHOLD_OUT_OF_RANGE, {
          message: `criteria thresholds: passAt for ${aggregation} must be in (0, 1], got: ${String(checked)}`,
          details: { aggregation, minimumExclusive: 0, maximum: 1, value: checked },
        });
      }
      return Object.freeze({ passAt: checked });
    }
    case 'rubric-level': {
      const checked = expectNumberInRange(
        passAt,
        'thresholds.passAt',
        1,
        5,
        EVALUATION_ERROR_CODES.THRESHOLD_OUT_OF_RANGE,
        'criteria thresholds',
      );
      if (!Number.isInteger(checked)) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.THRESHOLD_OUT_OF_RANGE, {
          message: `criteria thresholds: passAt for rubric-level must be an integer level in [1, 5], got: ${String(checked)}`,
          details: { aggregation, value: checked },
        });
      }
      return Object.freeze({ passAt: checked });
    }
  }
}

// ---------------------------------------------------------------------------
// EvaluationCriteria
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the criteria digest commits to. */
export interface EvaluationCriteriaView {
  readonly recordVersion: typeof EVALUATION_CRITERIA_VERSION;
  readonly criteriaId: EvaluationId;
  readonly version: EvaluationVersion;
  readonly entries: readonly CriterionEntry[];
  readonly aggregation: AggregationPolicy;
  readonly thresholds: EvaluationThresholds;
}

/** A frozen, content-addressed criteria object: the view plus its sha256 digest. */
export interface EvaluationCriteria extends EvaluationCriteriaView {
  readonly digest: ContentDigest;
}

/** Stable field list for the criteria view (tests + contracts mirror it). */
export const EVALUATION_CRITERIA_FIELDS = Object.freeze([
  'recordVersion',
  'criteriaId',
  'version',
  'entries',
  'aggregation',
  'thresholds',
] as const) as readonly string[];

export interface CreateEvaluationCriteriaInput {
  readonly criteriaId: string;
  readonly version: string;
  readonly entries: readonly CriterionEntryInput[];
  readonly aggregation: string;
  readonly thresholds: { readonly passAt: number };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isEvaluationCriteriaView(value: unknown): value is EvaluationCriteriaView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EVALUATION_CRITERIA_VERSION &&
    isEvaluationId(candidate['criteriaId']) &&
    isEvaluationVersion(candidate['version']) &&
    Array.isArray(candidate['entries']) &&
    (candidate['entries'] as unknown[]).length > 0 &&
    (candidate['entries'] as unknown[]).every((entry) => isCriterionEntry(entry)) &&
    isAggregationPolicy(candidate['aggregation']) &&
    typeof candidate['thresholds'] === 'object' &&
    candidate['thresholds'] !== null &&
    !Array.isArray(candidate['thresholds']) &&
    typeof (candidate['thresholds'] as Record<string, unknown>)['passAt'] === 'number'
  );
}

/** Structural (non-throwing) check for the full criteria object (view + digest). */
export function isEvaluationCriteria(value: unknown): value is EvaluationCriteria {
  if (!isEvaluationCriteriaView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed criteria object.
 * Rejects: empty entry lists, duplicate criterion ids, unknown fields,
 * non-positive weights, unknown aggregation policies, out-of-domain
 * thresholds — all with typed EvaluationErrors.
 */
export async function createEvaluationCriteria(
  input: CreateEvaluationCriteriaInput,
): Promise<EvaluationCriteria> {
  const record = expectFields(
    input,
    ['criteriaId', 'version', 'entries', 'aggregation', 'thresholds'],
    [],
    EVALUATION_ERROR_CODES.INVALID_CRITERIA,
    'evaluation criteria',
  );

  const criteriaId = toEvaluationId(
    typeof record['criteriaId'] === 'string' ? record['criteriaId'] : '',
    'evaluation criteria criteriaId',
  );
  const version = toEvaluationVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
    'evaluation criteria version',
  );
  const aggregation = expectEnumMemberOfAggregation(record['aggregation']);

  const rawEntries = record['entries'];
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: 'evaluation criteria: entries must be a non-empty ordered array of criterion entries',
      details: { received: Array.isArray(rawEntries) ? `array(${String(rawEntries.length)})` : typeof rawEntries },
    });
  }
  const entries = Object.freeze(
    rawEntries.map((entry, index) => toCriterionEntry(entry, index)),
  ) as readonly CriterionEntry[];

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.criterionId)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.DUPLICATE_CRITERION, {
        message: `evaluation criteria: duplicate criterion id ${JSON.stringify(entry.criterionId)} (criterion ids must be unique within a criteria object)`,
        details: { criterionId: entry.criterionId },
      });
    }
    seen.add(entry.criterionId);
  }

  const thresholds = toThresholds(aggregation, record['thresholds']);

  const view: EvaluationCriteriaView = {
    recordVersion: EVALUATION_CRITERIA_VERSION,
    criteriaId,
    version,
    entries,
    aggregation,
    thresholds,
  };
  const digest = toContentDigest(await digestCanonical(view), 'evaluation criteria digest');
  return deepFreeze({ ...view, digest }) as EvaluationCriteria;
}

function expectEnumMemberOfAggregation(value: unknown): AggregationPolicy {
  if (!isAggregationPolicy(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_AGGREGATION, {
      message: `evaluation criteria: aggregation must be one of [${AGGREGATION_POLICIES.join(', ')}], got: ${String(value)}`,
      details: { known: [...AGGREGATION_POLICIES] },
    });
  }
  return value;
}

/** The digest-free view of a criteria object (what the digest commits to). */
export function evaluationCriteriaView(criteria: EvaluationCriteria): EvaluationCriteriaView {
  const { digest: _digest, ...view } = criteria;
  return deepFreeze({ ...view }) as EvaluationCriteriaView;
}

/**
 * Recompute the criteria digest over the digest-free view and compare
 * (optionally against an expected digest). Throws EVALUATION_TAMPERED on
 * any mismatch — the content-addressing tripwire behind architecture-lock
 * rule 12.
 */
export async function recomputeEvaluationCriteriaDigest(
  criteria: EvaluationCriteria,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isEvaluationCriteria(criteria)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: 'criteria digest recomputation requires a structurally valid criteria object',
    });
  }
  const actual = await digestCanonical(evaluationCriteriaView(criteria));
  if (actual !== criteria.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: `evaluation criteria digest mismatch: expected ${expectedDigest ?? criteria.digest}, got ${actual}`,
      details: {
        criteriaId: criteria.criteriaId,
        expected: expectedDigest ?? criteria.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed criteria digest');
}

/** Sorted criterion-id list (stable ordering helper for comparisons). */
export function criterionIdsOf(criteria: EvaluationCriteria): readonly string[] {
  return criteria.entries.map((entry) => entry.criterionId);
}

/** The entry lookup by criterion id (O(n); criteria sets are small). */
export function criterionEntryById(
  criteria: EvaluationCriteria,
  criterionId: string,
): CriterionEntry | undefined {
  return criteria.entries.find((entry) => entry.criterionId === criterionId);
}
