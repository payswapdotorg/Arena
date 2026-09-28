/**
 * EvaluationRecord — the APPEND-ONCE result record of one evaluation run
 * (Work Order A012 gate 4; spec EV1.0 "Evaluation is judgment against
 * explicit criteria"; architecture-lock rule 7 — evaluation carries
 * scores/judgments ONLY, never evidence claims; spec/quality-model.md —
 * score stability under rerun).
 *
 * A record binds:
 *   - `evaluatorRef` — the digest of the EvaluatorDescriptor that judged
 *     (which evaluator, which version, which criteria version — all
 *     accountable downstream; "evaluator/version changes are accounted
 *     for" per the quality model);
 *   - `caseRef` / `trajectoryRef` — the A005 CapabilityCase digest and
 *     the A011 TrajectoryRecord digest (chain head) that were judged;
 *   - `criteriaRef` — the digest of the EvaluationCriteria judged
 *     against (explicit criteria, versioned);
 *   - `seed` — the evaluation run's seed (null for unseeded evaluators);
 *     with the descriptor's reproducibility characteristics this is what
 *     makes rerun score stability auditable;
 *   - `verdicts` — ONE verdict per criterion (exact set equality with
 *     the criteria entries — mismatches are rejected): criterion id,
 *     score (domain validated per aggregation policy: [0,1] for
 *     weighted-sum, {0,1} for pass-threshold, integer [1,5] for
 *     rubric-level), optional judgment label, optional notes;
 *   - `aggregate` — the aggregate judgment computed PURELY from the
 *     criteria + verdicts per the aggregation policy (weighted-sum:
 *     normalized weighted mean; pass-threshold: passing fraction;
 *     rubric-level: the minimum level achieved), plus the outcome label
 *     (`meets-criteria` | `below-criteria`) against thresholds.passAt —
 *     a JUDGMENT, never an evidence claim;
 *   - `confidence` — calibrated confidence in this specific result, a
 *     finite number in [0, 1];
 *   - `limitations` — run-level caveats and known blind spots (null when
 *     the descriptor's limitations stand unqualified);
 *   - `startedAt` / `finishedAt` — the evaluation run's time bounds
 *     (finished-at preceding started-at is rejected);
 *   - `provenance` — who executed the run, when it was recorded, notes.
 *
 * The record is created ONCE from its inputs and deep-frozen — there is
 * NO mutation API (gate 4 negative test), and construction is PURE:
 * replaying the same inputs (including the same seed) yields the
 * byte-identical record digest (score-stability test, gate 11).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import type { AggregationPolicy, EvaluationCriteria } from './criteria.js';
import { isEvaluationCriteria } from './criteria.js';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  isEvaluationId,
  isEvaluationTimestamp,
  isNeutralText,
  toContentDigest,
  toEvaluationId,
  toEvaluationTimestamp,
  toNeutralText,
} from './shared.js';
import type {
  ContentDigest,
  EvaluationId,
  EvaluationSeed,
  EvaluationTimestamp,
  NeutralId,
  NeutralText,
} from './shared.js';

/** Wire version of the evaluation-record shape. */
export const EVALUATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Criterion verdicts
// ---------------------------------------------------------------------------

/** One per-criterion verdict: criterion id, score, judgment label, notes. */
export interface CriterionVerdict {
  readonly criterionId: EvaluationId;
  /** Score value; the legal domain depends on the aggregation policy. */
  readonly score: number;
  /** Optional judgment label (e.g. a rubric level name, an expert tag). */
  readonly judgment: NeutralText | null;
  /** Optional free-form notes supporting the judgment. */
  readonly notes: NeutralText | null;
}

/** Stable field list for a verdict (tests + contracts mirror it). */
export const CRITERION_VERDICT_FIELDS = Object.freeze([
  'criterionId',
  'score',
  'judgment',
  'notes',
] as const) as readonly string[];

export interface CriterionVerdictInput {
  readonly criterionId: string;
  readonly score: number;
  readonly judgment: string | null;
  readonly notes: string | null;
}

/** Structural (non-throwing) check for one criterion verdict. */
export function isCriterionVerdict(value: unknown): value is CriterionVerdict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEvaluationId(candidate['criterionId']) &&
    typeof candidate['score'] === 'number' &&
    Number.isFinite(candidate['score']) &&
    (candidate['judgment'] === null || isNeutralText(candidate['judgment'])) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

/** Validate a finite score at verdict-construction time (NaN/Infinity rejected). */
function toVerdictScore(value: unknown, index: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: `criterion verdict ${String(index + 1)}: score must be a finite number, got: ${String(value)}`,
      details: { field: 'score', index, value: String(value) },
    });
  }
  return value;
}

function toCriterionVerdict(value: unknown, index: number): CriterionVerdict {
  const record = expectFields(
    value,
    ['criterionId', 'score', 'judgment', 'notes'],
    [],
    EVALUATION_ERROR_CODES.INVALID_VERDICT,
    `criterion verdict ${String(index + 1)}`,
  );
  const judgment = record['judgment'];
  const notes = record['notes'];
  if (judgment !== null && typeof judgment !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: `criterion verdict ${String(index + 1)}: judgment must be neutral text or null`,
    });
  }
  if (notes !== null && typeof notes !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: `criterion verdict ${String(index + 1)}: notes must be neutral text or null`,
    });
  }
  return deepFreeze({
    criterionId: toEvaluationId(
      typeof record['criterionId'] === 'string' ? record['criterionId'] : '',
      `criterion verdict ${String(index + 1)} criterionId`,
    ),
    score: toVerdictScore(record['score'], index),
    judgment: judgment === null ? null : toNeutralText(judgment, `verdict ${String(index + 1)} judgment`),
    notes: notes === null ? null : toNeutralText(notes, `verdict ${String(index + 1)} notes`),
  });
}

/** Validate one score against the aggregation policy's legal domain. */
function assertScoreDomain(
  score: number,
  policy: AggregationPolicy,
  context: string,
): void {
  if (!Number.isFinite(score)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: `${context}: scores must be finite numbers, got: ${String(score)}`,
      details: { policy, score },
    });
  }
  switch (policy) {
    case 'weighted-sum':
      if (score < 0 || score > 1) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
          message: `${context}: weighted-sum scores must be finite numbers in [0, 1], got: ${String(score)}`,
          details: { policy, score },
        });
      }
      return;
    case 'pass-threshold':
      if (score !== 0 && score !== 1) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
          message: `${context}: pass-threshold scores must be exactly 0 or 1 (boolean outcome), got: ${String(score)}`,
          details: { policy, score },
        });
      }
      return;
    case 'rubric-level':
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
          message: `${context}: rubric-level scores must be integer levels in [1, 5], got: ${String(score)}`,
          details: { policy, score },
        });
      }
      return;
  }
}

// ---------------------------------------------------------------------------
// Aggregate outcome
// ---------------------------------------------------------------------------

/** The aggregate judgment label — a judgment about criteria, never an evidence claim. */
export const AGGREGATE_OUTCOMES = Object.freeze(['meets-criteria', 'below-criteria'] as const);

export type AggregateJudgment = (typeof AGGREGATE_OUTCOMES)[number];

/** The aggregate outcome: one score plus the judgment label against thresholds. */
export interface AggregateOutcome {
  readonly score: number;
  readonly outcome: AggregateJudgment;
}

/** Stable field list for the aggregate (tests + contracts mirror it). */
export const AGGREGATE_OUTCOME_FIELDS = Object.freeze(['score', 'outcome'] as const) as readonly string[];

/** Structural (non-throwing) check for an aggregate outcome. */
export function isAggregateOutcome(value: unknown): value is AggregateOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['score'] === 'number' &&
    Number.isFinite(candidate['score']) &&
    (candidate['outcome'] === 'meets-criteria' || candidate['outcome'] === 'below-criteria')
  );
}

/** Deterministic rounding to 6 decimal places (digest-stable aggregation). */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Aggregate per-criterion verdicts per the criteria's aggregation policy
 * — the PURE heart of judgment (gate 4 "aggregate outcome per the
 * aggregation policy"; gate 11 aggregate-outcome determinism).
 *
 *   weighted-sum   → Σ(score × weight) / Σ(weight), rounded to 6 decimals;
 *   pass-threshold → fraction of criteria with score 1, rounded to 6 decimals;
 *   rubric-level   → the minimum level achieved across criteria.
 *
 * The outcome label compares the aggregate against thresholds.passAt.
 * Throws EVALUATION_CRITERION_MISMATCH when the verdict set is not the
 * exact criteria set, and EVALUATION_INVALID_VERDICT on domain
 * violations.
 */
export function aggregateCriterionVerdicts(
  criteria: EvaluationCriteria,
  verdicts: readonly CriterionVerdictInput[],
): AggregateOutcome {
  if (!isEvaluationCriteria(criteria)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: 'aggregation requires a structurally valid criteria object',
    });
  }

  const expected = criteria.entries.map((entry) => entry.criterionId);
  const actual = verdicts.map((verdict) => verdict.criterionId);
  if (expected.length !== actual.length || new Set(actual).size !== actual.length) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.CRITERION_MISMATCH, {
      message: `verdict set does not match criteria set: expected ${String(expected.length)} unique verdicts, got ${String(actual.length)}`,
      details: { expected: [...expected], actual: [...actual] },
    });
  }
  const expectedSet = new Set<string>(expected);
  for (const id of actual) {
    if (!expectedSet.has(id)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.CRITERION_MISMATCH, {
        message: `verdict for unknown criterion ${JSON.stringify(id)} (criteria define: ${expected.join(', ')})`,
        details: { criterionId: id, expected: [...expected] },
      });
    }
  }
  for (const id of expected) {
    if (!actual.includes(id)) {
      throw new EvaluationError(EVALUATION_ERROR_CODES.CRITERION_MISMATCH, {
        message: `missing verdict for criterion ${JSON.stringify(id)} (every criterion must be judged)`,
        details: { criterionId: id, expected: [...expected] },
      });
    }
  }

  const byId = new Map<string, (typeof criteria.entries)[number]>(
    criteria.entries.map((entry) => [entry.criterionId, entry]),
  );
  for (const verdict of verdicts) {
    assertScoreDomain(verdict.score, criteria.aggregation, `criterion ${JSON.stringify(verdict.criterionId)}`);
  }

  let score: number;
  switch (criteria.aggregation) {
    case 'weighted-sum': {
      let weighted = 0;
      let total = 0;
      for (const verdict of verdicts) {
        const entry = byId.get(verdict.criterionId);
        if (entry === undefined) throw new Error('unreachable: verdict set validated above');
        weighted += verdict.score * entry.weight;
        total += entry.weight;
      }
      score = round6(weighted / total);
      break;
    }
    case 'pass-threshold': {
      const passing = verdicts.filter((verdict) => verdict.score === 1).length;
      score = round6(passing / verdicts.length);
      break;
    }
    case 'rubric-level': {
      let minimum = Number.POSITIVE_INFINITY;
      for (const verdict of verdicts) {
        if (verdict.score < minimum) minimum = verdict.score;
      }
      score = minimum;
      break;
    }
  }

  const outcome: AggregateJudgment = score >= criteria.thresholds.passAt ? 'meets-criteria' : 'below-criteria';
  return Object.freeze({ score, outcome });
}

// ---------------------------------------------------------------------------
// Record provenance
// ---------------------------------------------------------------------------

/** Provenance of one evaluation run (EV1.0 "provenance"). */
export interface EvaluationProvenance {
  /** Neutral identity of the executing evaluator instance/principal. */
  readonly executedBy: NeutralId;
  /** When the record was recorded (ms-precision UTC). */
  readonly recordedAt: EvaluationTimestamp;
  /** Optional free-form notes. */
  readonly notes: NeutralText | null;
}

/** Stable field list for run provenance (tests + contracts mirror it). */
export const EVALUATION_RECORD_PROVENANCE_FIELDS = Object.freeze([
  'executedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

/** Structural (non-throwing) check for run provenance. */
export function isEvaluationProvenance(value: unknown): value is EvaluationProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['executedBy'] === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/.test(candidate['executedBy']) &&
    isEvaluationTimestamp(candidate['recordedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toEvaluationProvenance(value: unknown): EvaluationProvenance {
  const record = expectFields(
    value,
    ['executedBy', 'recordedAt', 'notes'],
    [],
    EVALUATION_ERROR_CODES.INVALID_PROVENANCE,
    'evaluation record provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'evaluation record provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    executedBy: ((): NeutralId => {
      const raw = typeof record['executedBy'] === 'string' ? record['executedBy'] : '';
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(raw)) {
        throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_PROVENANCE, {
          message: `evaluation record provenance: invalid executedBy: ${JSON.stringify(raw)}`,
        });
      }
      return raw as NeutralId;
    })(),
    recordedAt: toEvaluationTimestamp(
      typeof record['recordedAt'] === 'string' ? record['recordedAt'] : '',
      'evaluation record provenance recordedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'evaluation record provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// EvaluationRecord
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the record digest commits to. */
export interface EvaluationRecordView {
  readonly recordVersion: typeof EVALUATION_RECORD_VERSION;
  /** Digest of the EvaluatorDescriptor that judged. */
  readonly evaluatorRef: ContentDigest;
  /** Digest of the judged A005 CapabilityCase. */
  readonly caseRef: ContentDigest;
  /** Digest of the judged A011 TrajectoryRecord (chain head). */
  readonly trajectoryRef: ContentDigest;
  /** Digest of the EvaluationCriteria judged against. */
  readonly criteriaRef: ContentDigest;
  /** The evaluation run's seed (null when the evaluator is unseeded). */
  readonly seed: EvaluationSeed | null;
  /** ONE verdict per criterion, in criteria order. */
  readonly verdicts: readonly CriterionVerdict[];
  /** The aggregate judgment per the aggregation policy. */
  readonly aggregate: AggregateOutcome;
  /** Calibrated confidence in this result, [0, 1]. */
  readonly confidence: number;
  /** Run-level limitations / known blind spots (null to inherit the descriptor's). */
  readonly limitations: NeutralText | null;
  readonly startedAt: EvaluationTimestamp;
  readonly finishedAt: EvaluationTimestamp;
  readonly provenance: EvaluationProvenance;
}

/** A frozen, content-addressed evaluation record: the view plus its sha256 digest. */
export interface EvaluationRecord extends EvaluationRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the record view (tests + contracts mirror it). */
export const EVALUATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'evaluatorRef',
  'caseRef',
  'trajectoryRef',
  'criteriaRef',
  'seed',
  'verdicts',
  'aggregate',
  'confidence',
  'limitations',
  'startedAt',
  'finishedAt',
  'provenance',
] as const) as readonly string[];

export interface CreateEvaluationRecordInput {
  readonly evaluatorRef: string;
  readonly caseRef: string;
  readonly trajectoryRef: string;
  readonly criteriaRef: string;
  readonly seed: string | null;
  readonly verdicts: readonly CriterionVerdictInput[];
  readonly confidence: number;
  readonly limitations: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isEvaluationRecordView(value: unknown): value is EvaluationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EVALUATION_RECORD_VERSION &&
    isEvaluationVerdictRefLike(candidate['evaluatorRef']) &&
    isEvaluationVerdictRefLike(candidate['caseRef']) &&
    isEvaluationVerdictRefLike(candidate['trajectoryRef']) &&
    isEvaluationVerdictRefLike(candidate['criteriaRef']) &&
    (candidate['seed'] === null ||
      (typeof candidate['seed'] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate['seed']))) &&
    Array.isArray(candidate['verdicts']) &&
    (candidate['verdicts'] as unknown[]).length > 0 &&
    (candidate['verdicts'] as unknown[]).every((verdict) => isCriterionVerdict(verdict)) &&
    isAggregateOutcome(candidate['aggregate']) &&
    typeof candidate['confidence'] === 'number' &&
    Number.isFinite(candidate['confidence']) &&
    candidate['confidence'] >= 0 &&
    candidate['confidence'] <= 1 &&
    (candidate['limitations'] === null || isNeutralText(candidate['limitations'])) &&
    isEvaluationTimestamp(candidate['startedAt']) &&
    isEvaluationTimestamp(candidate['finishedAt']) &&
    isEvaluationProvenance(candidate['provenance'])
  );
}

function isEvaluationVerdictRefLike(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isEvaluationRecord(value: unknown): value is EvaluationRecord {
  if (!isEvaluationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isEvaluationVerdictRefLike(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed evaluation record —
 * the APPEND-ONCE result of one evaluation run. The aggregate outcome is
 * COMPUTED from the criteria + verdicts (never caller-supplied), the
 * verdict set must be the exact criteria set, scores must obey the
 * aggregation policy's domain, and finished-at must not precede
 * started-at. Construction is pure: identical inputs (including seed)
 * yield the identical record digest.
 */
export async function createEvaluationRecord(
  input: CreateEvaluationRecordInput,
  criteria: EvaluationCriteria,
): Promise<EvaluationRecord> {
  const record = expectFields(
    input,
    [
      'evaluatorRef',
      'caseRef',
      'trajectoryRef',
      'criteriaRef',
      'seed',
      'verdicts',
      'confidence',
      'limitations',
      'startedAt',
      'finishedAt',
      'provenance',
    ],
    [],
    EVALUATION_ERROR_CODES.INVALID_RECORD,
    'evaluation record',
  );

  if (!isEvaluationCriteria(criteria)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: 'evaluation record creation requires a structurally valid criteria object',
    });
  }
  // The record's criteriaRef must bind the EXACT criteria object supplied:
  // judging against one criteria version while referencing another is an
  // integrity violation (quality model: evaluator/version changes must be
  // accountable).
  const declaredCriteriaRef =
    typeof record['criteriaRef'] === 'string' ? record['criteriaRef'] : '';
  if (declaredCriteriaRef !== criteria.digest) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.CRITERION_MISMATCH, {
      message: `evaluation record criteriaRef ${JSON.stringify(declaredCriteriaRef)} does not match the supplied criteria object (digest ${criteria.digest}) — a record must bind the exact criteria it judged against`,
      details: { declared: declaredCriteriaRef, actual: criteria.digest },
    });
  }

  const rawVerdicts = record['verdicts'];
  if (!Array.isArray(rawVerdicts) || rawVerdicts.length === 0) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'evaluation record: verdicts must be a non-empty array of criterion verdicts',
    });
  }
  const verdicts = rawVerdicts.map((verdict, index) => toCriterionVerdict(verdict, index));

  // Order verdicts to the criteria order (canonical order for the digest).
  const order = new Map(criteria.entries.map((entry) => [entry.criterionId, criteria.entries.indexOf(entry)]));
  const ordered = [...verdicts].sort(
    (a, b) => (order.get(a.criterionId) ?? -1) - (order.get(b.criterionId) ?? -1),
  );

  const aggregate = aggregateCriterionVerdicts(criteria, ordered);
  const confidence = expectNumberInRange(
    record['confidence'],
    'confidence',
    0,
    1,
    EVALUATION_ERROR_CODES.INVALID_RECORD,
    'evaluation record',
  );

  const startedAt = toEvaluationTimestamp(
    typeof record['startedAt'] === 'string' ? record['startedAt'] : '',
    'evaluation record startedAt',
  );
  const finishedAt = toEvaluationTimestamp(
    typeof record['finishedAt'] === 'string' ? record['finishedAt'] : '',
    'evaluation record finishedAt',
  );
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TIMESTAMP_REGRESSION, {
      message: `evaluation record: finishedAt ${finishedAt} precedes startedAt ${startedAt}`,
      details: { startedAt, finishedAt },
    });
  }

  const limitations = record['limitations'];
  if (limitations !== null && typeof limitations !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'evaluation record: limitations must be neutral text or null',
    });
  }
  const rawSeed = record['seed'];
  if (rawSeed !== null && typeof rawSeed !== 'string') {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'evaluation record: seed must be a neutral seed string or null',
    });
  }

  const view: EvaluationRecordView = {
    recordVersion: EVALUATION_RECORD_VERSION,
    evaluatorRef: toContentDigest(
      typeof record['evaluatorRef'] === 'string' ? record['evaluatorRef'] : '',
      'evaluation record evaluatorRef',
    ),
    caseRef: toContentDigest(
      typeof record['caseRef'] === 'string' ? record['caseRef'] : '',
      'evaluation record caseRef',
    ),
    trajectoryRef: toContentDigest(
      typeof record['trajectoryRef'] === 'string' ? record['trajectoryRef'] : '',
      'evaluation record trajectoryRef',
    ),
    criteriaRef: toContentDigest(
      typeof record['criteriaRef'] === 'string' ? record['criteriaRef'] : '',
      'evaluation record criteriaRef',
    ),
    seed: rawSeed === null ? null : (rawSeed as EvaluationSeed),
    verdicts: Object.freeze(ordered),
    aggregate,
    confidence,
    limitations: limitations === null ? null : toNeutralText(limitations, 'evaluation record limitations'),
    startedAt,
    finishedAt,
    provenance: toEvaluationProvenance(record['provenance']),
  };
  const digest = toContentDigest(await digestCanonical(view), 'evaluation record digest');
  return deepFreeze({ ...view, digest }) as EvaluationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function evaluationRecordView(record: EvaluationRecord): EvaluationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as EvaluationRecordView;
}

/**
 * Recompute the record digest over the digest-free view and compare
 * (optionally against an expected digest). Throws EVALUATION_TAMPERED on
 * any mismatch — the append-once content-addressing tripwire.
 */
export async function recomputeEvaluationRecordDigest(
  record: EvaluationRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isEvaluationRecord(record)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'record digest recomputation requires a structurally valid evaluation record',
    });
  }
  const actual = await digestCanonical(evaluationRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: `evaluation record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: {
        evaluatorRef: record.evaluatorRef,
        expected: expectedDigest ?? record.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed record digest');
}

/**
 * Replay an evaluation record's construction PURELY from its own inputs:
 * re-aggregates the verdicts against the criteria and rebuilds the
 * record, asserting the byte-identical digest (gate 4 "replayable/pure
 * construction from inputs"). Throws EVALUATION_TAMPERED when the
 * recomputed digest differs — the record is append-once, so a replay
 * divergence means tampering.
 */
export async function replayEvaluationRecord(
  record: EvaluationRecord,
  criteria: EvaluationCriteria,
): Promise<EvaluationRecord> {
  if (!isEvaluationRecord(record)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_RECORD, {
      message: 'evaluation replay requires a structurally valid evaluation record',
    });
  }
  const rebuilt = await createEvaluationRecord(
    {
      evaluatorRef: record.evaluatorRef,
      caseRef: record.caseRef,
      trajectoryRef: record.trajectoryRef,
      criteriaRef: record.criteriaRef,
      seed: record.seed,
      verdicts: record.verdicts.map((verdict) => ({
        criterionId: verdict.criterionId,
        score: verdict.score,
        judgment: verdict.judgment,
        notes: verdict.notes,
      })),
      confidence: record.confidence,
      limitations: record.limitations,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      provenance: {
        executedBy: record.provenance.executedBy,
        recordedAt: record.provenance.recordedAt,
        notes: record.provenance.notes,
      },
    },
    criteria,
  );
  if (rebuilt.digest !== record.digest) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: `evaluation record replay diverged: record declares ${record.digest}, pure reconstruction yields ${rebuilt.digest}`,
      details: { declared: record.digest, reconstructed: rebuilt.digest },
    });
  }
  return rebuilt;
}
