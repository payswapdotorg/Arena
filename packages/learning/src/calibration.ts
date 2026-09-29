/**
 * CalibrationRecord - the LE1.0 Calibration surface (Work Order A020;
 * spec/learning.md "Calibration"; spec/quality-model.md
 * "uncertainty/calibration").
 *
 * LE1.0: "Where outcomes can later be observed, compare predicted
 * confidence/score with outcomes and preserve applicability context."
 *
 * A CalibrationRecord binds:
 *
 *   - the experiment run whose prediction is calibrated
 *     (`experimentRef` - the run-record digest);
 *   - the metric the prediction was about (`metricId`);
 *   - the prediction itself (`predicted`: confidence in [0, 1] plus
 *     the predicted delta, null when the prediction carried none);
 *   - the LATER-OBSERVED outcome (`observed`: closed outcome vocabulary
 *     - improved | not-improved | regressed | inconclusive - plus the
 *     observed delta, null when the observation carried none);
 *   - the APPLICABILITY CONTEXT (`applicability`: the target capability
 *     ref, the pinned task population and the pinned environment
 *     versions - the context in which the prediction applies, preserved
 *     so later readers know WHERE the calibration evidence holds);
 *   - `observedAt` + provenance.
 *
 * `summarizeCalibration` is the pure comparison: counts per outcome
 * bucket, mean predicted confidence per decided bucket and a Brier
 * score over decided (improved | not-improved | regressed) records -
 * a calibration diagnostic, never a capability claim.
 */

import { digestCanonical } from '@arena/protocol-core';
import { isCapabilityNodeRef } from '@arena/capability-graph';
import type { CapabilityNodeRef } from '@arena/capability-graph';
import { isTaskVersionRef } from '@arena/trajectory';
import type { TaskVersionRef } from '@arena/environment-protocol';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import { isArtifactRef } from './descriptor.js';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  expectFiniteNumber,
  isContentDigest,
  isLearningTimestamp,
  isNeutralId,
  isNeutralText,
  toContentDigest,
  toLearningId,
  toLearningTimestamp,
  toNeutralId,
  toNeutralText,
} from './shared.js';
import type { ContentDigest, LearningId, LearningTimestamp, NeutralId, NeutralText } from './shared.js';

/** Wire version of the calibration-record shape. */
export const CALIBRATION_RECORD_VERSION = 1 as const;

/** The closed observed-outcome vocabulary. */
export const OBSERVED_OUTCOMES = Object.freeze([
  'improved',
  'not-improved',
  'regressed',
  'inconclusive',
] as const);

export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export function isObservedOutcome(value: unknown): value is ObservedOutcome {
  return (
    typeof value === 'string' && (OBSERVED_OUTCOMES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// CalibrationRecord
// ---------------------------------------------------------------------------

/** The digest-free view - exactly what the calibration record commits to. */
export interface CalibrationRecordView {
  readonly recordVersion: typeof CALIBRATION_RECORD_VERSION;
  readonly calibrationId: LearningId;
  readonly experimentRef: ContentDigest;
  readonly metricId: NeutralId;
  readonly predicted: {
    readonly confidence: number;
    readonly delta: number | null;
  };
  readonly observed: {
    readonly outcome: ObservedOutcome;
    readonly delta: number | null;
  };
  readonly applicability: {
    readonly targetCapability: CapabilityNodeRef;
    readonly taskPopulation: readonly TaskVersionRef[];
    readonly environmentVersions: readonly {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    }[];
  };
  readonly observedAt: LearningTimestamp;
  readonly provenance: {
    readonly recordedBy: NeutralId;
    readonly recordedAt: LearningTimestamp;
    readonly notes: NeutralText | null;
  };
}

/** A frozen, content-addressed calibration record: the view plus its sha256 digest. */
export interface CalibrationRecord extends CalibrationRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the calibration-record view. */
export const CALIBRATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'calibrationId',
  'experimentRef',
  'metricId',
  'predicted',
  'observed',
  'applicability',
  'observedAt',
  'provenance',
] as const);

/** Stable field list for the applicability context. */
export const CALIBRATION_APPLICABILITY_FIELDS = Object.freeze([
  'targetCapability',
  'taskPopulation',
  'environmentVersions',
] as const);

export interface CreateCalibrationRecordInput {
  readonly calibrationId: string;
  readonly experimentRef: string;
  readonly metricId: string;
  readonly predicted: { readonly confidence: number; readonly delta: number | null };
  readonly observed: { readonly outcome: string; readonly delta: number | null };
  readonly applicability: {
    readonly targetCapability: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly taskPopulation: readonly { readonly taskId: string; readonly version: string }[];
    readonly environmentVersions: readonly {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    }[];
  };
  readonly observedAt: string;
  readonly provenance: {
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCalibrationRecordView(value: unknown): value is CalibrationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const predicted = candidate['predicted'];
  const observed = candidate['observed'];
  const applicability = candidate['applicability'];
  const provenance = candidate['provenance'];
  if (typeof predicted !== 'object' || predicted === null || Array.isArray(predicted)) {
    return false;
  }
  if (typeof observed !== 'object' || observed === null || Array.isArray(observed)) {
    return false;
  }
  if (typeof applicability !== 'object' || applicability === null || Array.isArray(applicability)) {
    return false;
  }
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
    return false;
  }
  const applicabilityRecord = applicability as Record<string, unknown>;
  const provenanceRecord = provenance as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CALIBRATION_RECORD_VERSION &&
    isNeutralId(candidate['calibrationId']) &&
    isContentDigest(candidate['experimentRef']) &&
    isNeutralId(candidate['metricId']) &&
    typeof (predicted as Record<string, unknown>)['confidence'] === 'number' &&
    ((predicted as Record<string, unknown>)['delta'] === null ||
      typeof (predicted as Record<string, unknown>)['delta'] === 'number') &&
    isObservedOutcome((observed as Record<string, unknown>)['outcome']) &&
    ((observed as Record<string, unknown>)['delta'] === null ||
      typeof (observed as Record<string, unknown>)['delta'] === 'number') &&
    isCapabilityNodeRef(applicabilityRecord['targetCapability']) &&
    Array.isArray(applicabilityRecord['taskPopulation']) &&
    (applicabilityRecord['taskPopulation'] as unknown[]).every((entry) =>
      isTaskVersionRef(entry),
    ) &&
    Array.isArray(applicabilityRecord['environmentVersions']) &&
    (applicabilityRecord['environmentVersions'] as unknown[]).every((entry) =>
      isArtifactRef(entry),
    ) &&
    isLearningTimestamp(candidate['observedAt']) &&
    isNeutralId(provenanceRecord['recordedBy']) &&
    isLearningTimestamp(provenanceRecord['recordedAt']) &&
    (provenanceRecord['notes'] === null || isNeutralText(provenanceRecord['notes']))
  );
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isCalibrationRecord(value: unknown): value is CalibrationRecord {
  if (!isCalibrationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

function toNullableFiniteNumber(
  value: unknown,
  field: string,
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message: `calibration record: ${field} must be a finite number or null`,
    });
  }
  return expectFiniteNumber(
    value,
    field,
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record',
  );
}

/**
 * Create a validated, deep-frozen, content-addressed calibration
 * record. Rejects malformed refs, out-of-range confidence, unknown
 * observed outcomes, malformed applicability context and malformed
 * provenance with typed LearningErrors.
 */
export async function createCalibrationRecord(
  input: CreateCalibrationRecordInput,
): Promise<CalibrationRecord> {
  const record = expectFields(
    input,
    [
      'calibrationId',
      'experimentRef',
      'metricId',
      'predicted',
      'observed',
      'applicability',
      'observedAt',
      'provenance',
    ],
    [],
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record',
  );

  const predicted = expectFields(
    record['predicted'],
    ['confidence', 'delta'],
    [],
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record predicted',
  );
  const observed = expectFields(
    record['observed'],
    ['outcome', 'delta'],
    [],
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record observed',
  );
  const applicability = expectFields(
    record['applicability'],
    ['targetCapability', 'taskPopulation', 'environmentVersions'],
    [],
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record applicability',
  );
  const provenance = expectFields(
    record['provenance'],
    ['recordedBy', 'recordedAt', 'notes'],
    [],
    LEARNING_ERROR_CODES.INVALID_CALIBRATION,
    'calibration record provenance',
  );

  const outcome = observed['outcome'];
  if (typeof outcome !== 'string' || !isObservedOutcome(outcome)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message: `calibration record: observed.outcome must be one of [${OBSERVED_OUTCOMES.join(', ')}], got: ${String(outcome)}`,
      details: { known: [...OBSERVED_OUTCOMES] },
    });
  }

  const targetCapability = applicability['targetCapability'];
  if (!isCapabilityNodeRef(targetCapability)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message: `calibration record applicability: targetCapability must be a structurally valid A004 CapabilityNodeRef (REAL @arena/capability-graph guard): ${JSON.stringify(targetCapability)}`,
    });
  }
  const rawTaskPopulation = applicability['taskPopulation'];
  if (!Array.isArray(rawTaskPopulation) || rawTaskPopulation.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message:
        'calibration record applicability: taskPopulation must be a non-empty pinned set of task/version refs (applicability context is preserved, not implied)',
    });
  }
  const taskPopulation: TaskVersionRef[] = [];
  for (const entry of rawTaskPopulation) {
    if (!isTaskVersionRef(entry)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
        message: `calibration record applicability: taskPopulation entry must be a structurally valid A009 TaskVersionRef (REAL @arena/trajectory guard): ${JSON.stringify(entry)}`,
      });
    }
    taskPopulation.push(deepFreeze({ ...entry }) as TaskVersionRef);
  }
  const rawEnvironmentVersions = applicability['environmentVersions'];
  if (!Array.isArray(rawEnvironmentVersions) || rawEnvironmentVersions.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message:
        'calibration record applicability: environmentVersions must be a non-empty pinned set of content-addressed environment refs',
    });
  }
  const environmentVersions = rawEnvironmentVersions.map((entry) => {
    if (!isArtifactRef(entry)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
        message: `calibration record applicability: environmentVersions entry is malformed: ${JSON.stringify(entry)}`,
      });
    }
    return deepFreeze({ ...entry });
  });

  const notes = provenance['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
      message: 'calibration record provenance: notes must be neutral text or null',
    });
  }

  const view: CalibrationRecordView = {
    recordVersion: CALIBRATION_RECORD_VERSION,
    calibrationId: toLearningId(
      typeof record['calibrationId'] === 'string' ? record['calibrationId'] : '',
      'calibration record calibrationId',
    ),
    experimentRef: toContentDigest(
      typeof record['experimentRef'] === 'string' ? record['experimentRef'] : '',
      'calibration record experimentRef',
    ),
    metricId: toNeutralId(
      typeof record['metricId'] === 'string' ? record['metricId'] : '',
      'calibration record metricId',
    ),
    predicted: deepFreeze({
      confidence: expectNumberInRange(
        predicted['confidence'],
        'predicted.confidence',
        0,
        1,
        LEARNING_ERROR_CODES.INVALID_CALIBRATION,
        'calibration record',
      ),
      delta: toNullableFiniteNumber(predicted['delta'], 'predicted.delta'),
    }),
    observed: deepFreeze({
      outcome,
      delta: toNullableFiniteNumber(observed['delta'], 'observed.delta'),
    }),
    applicability: deepFreeze({
      targetCapability: deepFreeze({ ...targetCapability }) as CapabilityNodeRef,
      taskPopulation: Object.freeze([...taskPopulation]),
      environmentVersions: Object.freeze([...environmentVersions]),
    }),
    observedAt: toLearningTimestamp(
      typeof record['observedAt'] === 'string' ? record['observedAt'] : '',
      'calibration record observedAt',
    ),
    provenance: deepFreeze({
      recordedBy: toNeutralId(
        typeof provenance['recordedBy'] === 'string' ? provenance['recordedBy'] : '',
        'calibration record provenance recordedBy',
      ),
      recordedAt: toLearningTimestamp(
        typeof provenance['recordedAt'] === 'string' ? provenance['recordedAt'] : '',
        'calibration record provenance recordedAt',
      ),
      notes: notes === null ? null : toNeutralText(notes, 'calibration record notes'),
    }),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'calibration record digest',
  );
  return deepFreeze({ ...view, digest }) as CalibrationRecord;
}

// ---------------------------------------------------------------------------
// The pure calibration summary
// ---------------------------------------------------------------------------

/** The pure comparison of predicted confidence against observed outcomes. */
export interface CalibrationSummary {
  readonly recordCount: number;
  readonly improvedCount: number;
  readonly notImprovedCount: number;
  readonly regressedCount: number;
  readonly inconclusiveCount: number;
  /** Mean predicted confidence over 'improved' records (null when none). */
  readonly meanPredictedConfidenceWhenImproved: number | null;
  /** Mean predicted confidence over 'not-improved' + 'regressed' records (null when none). */
  readonly meanPredictedConfidenceWhenNotImproved: number | null;
  /**
   * Brier score over DECIDED records (improved → 1, not-improved/regressed
   * → 0): mean of (confidence − outcome)². A calibration diagnostic,
   * never a capability claim. Null when no decided records exist.
   */
  readonly brierScore: number | null;
}

const CALIBRATION_SUMMARY_FIELDS = Object.freeze([
  'recordCount',
  'improvedCount',
  'notImprovedCount',
  'regressedCount',
  'inconclusiveCount',
  'meanPredictedConfidenceWhenImproved',
  'meanPredictedConfidenceWhenNotImproved',
  'brierScore',
] as const);

export function isCalibrationSummary(value: unknown): value is CalibrationSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [...CALIBRATION_SUMMARY_FIELDS].every((field) => field in candidate);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Summarize calibration records: predicted confidence vs observed outcomes (PURE). */
export function summarizeCalibration(
  records: readonly CalibrationRecord[],
): CalibrationSummary {
  const decided: { confidence: number; outcome: number }[] = [];
  let improvedCount = 0;
  let notImprovedCount = 0;
  let regressedCount = 0;
  let inconclusiveCount = 0;
  const confidenceWhenImproved: number[] = [];
  const confidenceWhenNotImproved: number[] = [];
  for (const record of records) {
    if (!isCalibrationRecord(record)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_CALIBRATION, {
        message: 'calibration summary requires structurally valid calibration records',
      });
    }
    const confidence = record.predicted.confidence;
    switch (record.observed.outcome) {
      case 'improved': {
        improvedCount += 1;
        confidenceWhenImproved.push(confidence);
        decided.push({ confidence, outcome: 1 });
        break;
      }
      case 'not-improved': {
        notImprovedCount += 1;
        confidenceWhenNotImproved.push(confidence);
        decided.push({ confidence, outcome: 0 });
        break;
      }
      case 'regressed': {
        regressedCount += 1;
        confidenceWhenNotImproved.push(confidence);
        decided.push({ confidence, outcome: 0 });
        break;
      }
      case 'inconclusive': {
        inconclusiveCount += 1;
        break;
      }
    }
  }
  const brier =
    decided.length === 0
      ? null
      : decided.reduce((sum, entry) => sum + (entry.confidence - entry.outcome) ** 2, 0) /
        decided.length;
  return deepFreeze({
    recordCount: records.length,
    improvedCount,
    notImprovedCount,
    regressedCount,
    inconclusiveCount,
    meanPredictedConfidenceWhenImproved: mean(confidenceWhenImproved),
    meanPredictedConfidenceWhenNotImproved: mean(confidenceWhenNotImproved),
    brierScore: brier,
  });
}
