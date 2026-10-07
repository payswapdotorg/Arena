/**
 * The pure ingestion MAPPING (Work Order C005): how evidence derived from
 * the merged dep public surfaces becomes PerformanceEvidenceRecords —
 * through closed mapping tables only, never direct writes into dep state.
 *
 * The source-data shapes below are STRUCTURAL MIRRORS of the dep public
 * read surfaces (the @arena/expert-calibration-service convention for
 * cross-surface data-in seams): the reference service pulls them from the
 * injected dep ports (services/expert-performance/src/ports.ts); the real
 * C004/A007/A019/A020 fabrics implement the ports.
 *
 * DETERMINISM + ANTI-TAMPERING: the mapping derives the dimension OUTCOME,
 * the applicability context, the sample size, the evaluator version and
 * the attribution from the SOURCE DATA — a caller cannot choose them. The
 * caller chooses only WHICH admissible dimension a source feeds (validated
 * against SOURCE_FAMILY_DIMENSIONS) and the record identity.
 *
 * ATTRIBUTION DISCIPLINE flows through here: the learning-attribution
 * family carries its LE1.0 attribution kind verbatim (evaluator-change
 * stays evaluator-change); every other family defaults to expert-change
 * with the evaluator version pinned — and when the evaluator version
 * digest changed relative to the prior one, `classifyAttribution` forces
 * evaluator-change (the record constructor then enforces the law).
 *
 * DEVIATION NOTE (no dedicated canonical spec — architecture questions in
 * the PR): the (family → dimension → outcome) mapping tables below are
 * DERIVED from the quality-model dimensions, the C005 work-items row and
 * the dep vocabularies; they are closed constants — a mapping change is a
 * new vocabulary version.
 */

import { isCapabilityNodeRefView } from '@arena/expert-qualification';
import type { CapabilityNodeRefView } from '@arena/expert-qualification';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import { toPerformanceContentDigest, toPerformanceTimestamp } from './shared.js';
import { toSourceFamilyDimension } from './dimensions.js';
import type { EvidenceSourceFamily, PerformanceDimension } from './dimensions.js';
import { ATTRIBUTION_KINDS, classifyAttribution } from './record.js';
import type { AttributionKind, CreateEvidenceRecordInput } from './record.js';

// ---------------------------------------------------------------------------
// Structural mirrors of the dep public read surfaces (data-in seams)
// ---------------------------------------------------------------------------

/** C004 calibration drift-verdict source data (the DemonstratedPerformance seam). */
export interface CalibrationVerdictSourceData {
  /** The C004 closed drift-verdict vocabulary. */
  readonly verdict:
    | 'calibrated'
    | 'overconfident'
    | 'underconfident'
    | 'insufficient-sample'
    | 'stale';
  readonly capability: CapabilityNodeRefView;
  /** The evaluator version digest the verdict ran under (null when unpinned). */
  readonly evaluatorVersion: string | null;
  readonly freshSampleCount: number;
  readonly totalSampleCount: number;
  readonly observedAt: string;
  readonly recordDigest: string;
}

/** A007 qualification-record source data (status + declared fit + conflicts). */
export interface QualificationRecordSourceData {
  readonly status: 'qualified' | 'expired' | 'suspended' | 'revoked';
  readonly capability: CapabilityNodeRefView;
  readonly domain: string;
  readonly jurisdiction: string | null;
  readonly conflicts: readonly string[];
  readonly limitations: readonly string[];
  readonly observedAt: string;
  readonly recordDigest: string;
}

/** A007 matching-history entry source data (engagement/review/agreement outcomes). */
export interface MatchHistorySourceData {
  readonly engagementOutcome: 'completed' | 'completed-with-revision' | 'not-completed' | 'inconclusive';
  readonly reviewOutcome?: 'accepted' | 'accepted-with-changes' | 'rejected' | 'inconclusive';
  /** Whether the expert's delivered result agreed with the evaluator/validator. */
  readonly agreedWithEvaluator?: boolean;
  readonly taskFamily: string;
  readonly domain: string;
  readonly jurisdiction?: string;
  readonly evaluatorVersion: string | null;
  readonly sampleSize: number;
  readonly observedAt: string;
  readonly recordDigest: string;
}

/** A019 skill-extraction outcome source data (skill demonstrated on validated trajectories). */
export interface SkillExtractionSourceData {
  readonly skill: CapabilityNodeRefView;
  readonly outcome: 'demonstrated' | 'not-demonstrated' | 'inconclusive';
  readonly consistency?: 'stable' | 'variable';
  readonly sampleSize: number;
  readonly observedAt: string;
  readonly recordDigest: string;
}

/** A020 learning-experiment attribution source data (LE1.0 attribution vocabulary). */
export interface LearningAttributionSourceData {
  readonly attributionKind: 'expert-change' | 'evaluator-change' | 'measurement-variance';
  readonly evaluatorVersionBefore: string | null;
  readonly evaluatorVersionAfter: string | null;
  /** The capability the experiment targeted (required for skill-competency evidence). */
  readonly capability: CapabilityNodeRefView | null;
  readonly observedAt: string;
  readonly recordDigest: string;
}

export type EvidenceSourceData =
  | CalibrationVerdictSourceData
  | QualificationRecordSourceData
  | MatchHistorySourceData
  | SkillExtractionSourceData
  | LearningAttributionSourceData;

// ---------------------------------------------------------------------------
// The closed mapping tables
// ---------------------------------------------------------------------------

const CALIBRATION_SKILL_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  calibrated: 'demonstrated',
  underconfident: 'demonstrated',
  overconfident: 'not-demonstrated',
  'insufficient-sample': 'inconclusive',
  stale: 'inconclusive',
});

const CALIBRATION_AGREEMENT_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  calibrated: 'agreed',
  underconfident: 'partial',
  overconfident: 'partial',
  'insufficient-sample': 'inconclusive',
  stale: 'inconclusive',
});

const CALIBRATION_CONSISTENCY_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  calibrated: 'stable',
  underconfident: 'variable',
  overconfident: 'variable',
  'insufficient-sample': 'inconclusive',
  stale: 'inconclusive',
});

const QUALIFICATION_FIT_OUTCOMES: Readonly<Record<string, string>> = Object.freeze({
  qualified: 'fit-confirmed',
  expired: 'partial-fit',
  suspended: 'out-of-scope',
  revoked: 'out-of-scope',
});

const LEARNING_SKILL_OUTCOMES: Readonly<Record<AttributionKind, string>> = Object.freeze({
  'expert-change': 'improved',
  'evaluator-change': 'inconclusive',
  'measurement-variance': 'inconclusive',
});

const LEARNING_CONSISTENCY_OUTCOMES: Readonly<Record<AttributionKind, string>> = Object.freeze({
  'expert-change': 'stable',
  'evaluator-change': 'inconclusive',
  'measurement-variance': 'variable',
});

// ---------------------------------------------------------------------------
// The pure mapper
// ---------------------------------------------------------------------------

export interface MapSourceEvidenceInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly recordId: string;
  /** The dep surface the evidence accumulated from (closed family). */
  readonly family: string;
  /** The dimension this evidence feeds (must be admissible for the family). */
  readonly dimension: string;
  readonly source: EvidenceSourceData;
  /** The recording time (injected — no hidden clock). */
  readonly recordedAt: string;
  /** The evaluator version digest in force for (expert, dimension) BEFORE this record. */
  readonly priorEvaluatorVersion?: string | null;
}

function requireCapability(value: unknown, context: string): CapabilityNodeRefView {
  if (!isCapabilityNodeRefView(value)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF, {
      message: `${context}: a valid A007 CapabilityNodeRefView is required (consumed vocabulary)`,
    });
  }
  return value;
}

function requireRecordDigest(value: unknown, context: string): string {
  return toPerformanceContentDigest(value as string, `${context}.recordDigest`);
}

function requireObservedAt(value: unknown, context: string): string {
  return toPerformanceTimestamp(value as string, `${context}.observedAt`);
}

function requirePositive(value: unknown, field: string, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: ${field} must be a positive integer (sample size >= 1)`,
      details: { field },
    });
  }
  return value;
}

function mappedOutcome(
  dimension: PerformanceDimension,
  family: EvidenceSourceFamily,
  outcome: string,
): string {
  throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
    message: `ingestion mapping: no outcome for family '${family}' → dimension '${dimension}'`,
    details: { family, dimension, outcome },
  });
}

/**
 * Map ONE dep source record into ONE evidence-record input. PURE and
 * CLOSED: the outcome, applicability, sample size, evaluator version and
 * attribution are DERIVED from the source data; only the record identity
 * and target dimension are caller-chosen (and the dimension must be
 * admissible for the family). Fails closed on any source datum the
 * mapping cannot honestly express.
 */
export function mapSourceEvidence(input: MapSourceEvidenceInput): CreateEvidenceRecordInput {
  const { family, dimension } = toSourceFamilyDimension(
    input.family,
    input.dimension,
    'ingestion mapping',
  );
  const recordedAt = toPerformanceTimestamp(input.recordedAt, 'ingestion mapping recordedAt');
  const source = input.source;

  let outcome: string;
  let applicability: Record<string, unknown>;
  let sampleSize: number;
  let evaluatorVersion: string | null;
  let declaredKind: AttributionKind;
  let confidence: number | null = null;

  switch (family) {
    case 'expert-calibration-verdict': {
      const data = source as CalibrationVerdictSourceData;
      requireCapability(data.capability, 'calibration verdict');
      requireRecordDigest(data.recordDigest, 'calibration verdict');
      requireObservedAt(data.observedAt, 'calibration verdict');
      requirePositive(data.freshSampleCount, 'freshSampleCount', 'calibration verdict');
      requirePositive(data.totalSampleCount, 'totalSampleCount', 'calibration verdict');
      evaluatorVersion =
        data.evaluatorVersion === null
          ? null
          : toPerformanceContentDigest(data.evaluatorVersion, 'calibration verdict evaluatorVersion');
      applicability = { capability: { ...data.capability } };
      sampleSize = data.freshSampleCount;
      declaredKind = 'expert-change';
      if (dimension === 'skill-competency') {
        outcome = CALIBRATION_SKILL_OUTCOMES[data.verdict] ?? mappedOutcome(dimension, family, data.verdict);
        confidence = data.freshSampleCount / Math.max(1, data.totalSampleCount);
      } else if (dimension === 'agreement') {
        outcome = CALIBRATION_AGREEMENT_OUTCOMES[data.verdict] ?? mappedOutcome(dimension, family, data.verdict);
      } else if (dimension === 'consistency') {
        outcome = CALIBRATION_CONSISTENCY_OUTCOMES[data.verdict] ?? mappedOutcome(dimension, family, data.verdict);
      } else {
        outcome = 'active';
      }
      break;
    }
    case 'expert-qualification-record': {
      const data = source as QualificationRecordSourceData;
      requireCapability(data.capability, 'qualification record');
      requireRecordDigest(data.recordDigest, 'qualification record');
      requireObservedAt(data.observedAt, 'qualification record');
      evaluatorVersion = null;
      sampleSize = 1;
      declaredKind = 'expert-change';
      applicability = {
        capability: { ...data.capability },
        domain: data.domain,
        ...(data.jurisdiction === null || data.jurisdiction === undefined
          ? {}
          : { jurisdiction: data.jurisdiction }),
      };
      if (dimension === 'domain-jurisdiction-fit') {
        outcome = QUALIFICATION_FIT_OUTCOMES[data.status] ?? mappedOutcome(dimension, family, data.status);
      } else if (dimension === 'conflict-limitation') {
        outcome =
          data.conflicts.length > 0
            ? 'conflict-declared'
            : data.limitations.length > 0
              ? 'limitation-declared'
              : 'none-declared';
      } else {
        outcome = 'active';
      }
      break;
    }
    case 'expert-match-history': {
      const data = source as MatchHistorySourceData;
      requireRecordDigest(data.recordDigest, 'match history');
      requireObservedAt(data.observedAt, 'match history');
      requirePositive(data.sampleSize, 'sampleSize', 'match history');
      evaluatorVersion =
        data.evaluatorVersion === null
          ? null
          : toPerformanceContentDigest(data.evaluatorVersion, 'match history evaluatorVersion');
      sampleSize = data.sampleSize;
      declaredKind = 'expert-change';
      applicability = {
        taskFamily: data.taskFamily,
        domain: data.domain,
        ...(data.jurisdiction === undefined ? {} : { jurisdiction: data.jurisdiction }),
      };
      if (dimension === 'task-family-outcome') {
        outcome = data.engagementOutcome;
      } else if (dimension === 'review-outcome') {
        if (data.reviewOutcome === undefined) {
          throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
            message:
              'match history: review-outcome evidence requires the source entry to carry a reviewOutcome (the mapping never invents outcomes)',
          });
        }
        outcome = data.reviewOutcome;
      } else if (dimension === 'agreement') {
        if (data.agreedWithEvaluator === undefined) {
          throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
            message:
              'match history: agreement evidence requires the source entry to carry agreedWithEvaluator (the mapping never invents outcomes)',
          });
        }
        outcome = data.agreedWithEvaluator ? 'agreed' : 'disagreed';
      } else if (dimension === 'domain-jurisdiction-fit') {
        outcome = 'fit-confirmed';
      } else {
        outcome = 'active';
      }
      break;
    }
    case 'skill-extraction-outcome': {
      const data = source as SkillExtractionSourceData;
      requireCapability(data.skill, 'skill extraction');
      requireRecordDigest(data.recordDigest, 'skill extraction');
      requireObservedAt(data.observedAt, 'skill extraction');
      requirePositive(data.sampleSize, 'sampleSize', 'skill extraction');
      evaluatorVersion = null;
      sampleSize = data.sampleSize;
      declaredKind = 'expert-change';
      applicability = { capability: { ...data.skill } };
      if (dimension === 'skill-competency') {
        outcome = data.outcome;
      } else if (dimension === 'consistency') {
        if (data.consistency === undefined) {
          throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
            message:
              'skill extraction: consistency evidence requires the source outcome to carry a consistency signal (the mapping never invents outcomes)',
          });
        }
        outcome = data.consistency;
      } else {
        outcome = 'active';
      }
      break;
    }
    case 'learning-experiment-attribution': {
      const data = source as LearningAttributionSourceData;
      requireRecordDigest(data.recordDigest, 'learning attribution');
      requireObservedAt(data.observedAt, 'learning attribution');
      if (!ATTRIBUTION_KINDS.includes(data.attributionKind)) {
        throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.ATTRIBUTION_VIOLATION, {
          message: `learning attribution: unknown attribution kind ${JSON.stringify(data.attributionKind)} (closed LE1.0 vocabulary)`,
        });
      }
      declaredKind = data.attributionKind;
      evaluatorVersion =
        data.evaluatorVersionAfter === null
          ? null
          : toPerformanceContentDigest(
              data.evaluatorVersionAfter,
              'learning attribution evaluatorVersionAfter',
            );
      sampleSize = 1;
      if (dimension === 'skill-competency') {
        if (data.capability === null || data.capability === undefined) {
          throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
            message:
              'learning attribution: skill-competency evidence requires the experiment to target a capability (capability is null)',
          });
        }
        applicability = { capability: { ...requireCapability(data.capability, 'learning attribution') } };
        outcome = LEARNING_SKILL_OUTCOMES[data.attributionKind];
      } else {
        applicability = {};
        outcome = LEARNING_CONSISTENCY_OUTCOMES[data.attributionKind];
      }
      break;
    }
  }

  const priorEvaluatorVersion =
    input.priorEvaluatorVersion === undefined || input.priorEvaluatorVersion === null
      ? null
      : toPerformanceContentDigest(input.priorEvaluatorVersion, 'priorEvaluatorVersion');
  const kind = classifyAttribution({
    declaredKind,
    evaluatorVersion,
    priorEvaluatorVersion,
  });

  return {
    recordId: input.recordId,
    tenant: input.tenant,
    expertId: input.expertId,
    dimension,
    outcome,
    applicability: applicability as CreateEvidenceRecordInput['applicability'],
    sampleSize,
    confidence,
    observedAt: (source as { observedAt: string }).observedAt,
    recordedAt,
    source: {
      family,
      refDigest: (source as { recordDigest: string }).recordDigest,
      locator: (source as { recordDigest: string }).recordDigest,
    },
    attribution: { kind, evaluatorVersion },
    priorEvaluatorVersion,
  };
}

/** The evaluator version a source record was taken under (attribution input). */
export function evaluatorVersionOfSource(source: EvidenceSourceData): string | null {
  if ('evaluatorVersion' in source) {
    return source.evaluatorVersion ?? null;
  }
  if ('evaluatorVersionAfter' in source) {
    return source.evaluatorVersionAfter ?? null;
  }
  return null;
}
