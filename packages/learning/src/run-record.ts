/**
 * ExperimentRunRecord - the APPEND-ONCE result record of one learning
 * experiment run (Work Order A020; spec LE1.0 "Experiment" minimum
 * "result"; architecture-lock rules 5, 6, 17, 18).
 *
 * The record carries:
 *
 *   - `experimentKey` + `correlationId` - the run's idempotency key and
 *     correlation id (lock rule 17; re-running the SAME experiment key
 *     returns the recorded result - the reference engine implements
 *     the replay, this shape carries the address);
 *   - `descriptorRef` - the digest of the ExperimentDescriptor this run
 *     executed;
 *   - `baseline` / `intervention` - the RUN references of both arms:
 *     the A011 trajectory digests (chain heads), the A012
 *     evaluation-record digests and the A013 verification-record
 *     digests the arms ran over;
 *   - `baselineMetrics` / `interventionMetrics` - the collected
 *     outcome-metric measurements of both arms (values + reported
 *     variances);
 *   - `comparison` - the computed per-metric comparison;
 *   - `uncertainty` - the reported variance values per metric;
 *   - `protectedCapabilityChecks` - the protected-capability
 *     regression measurements (Q1.0 condition 4);
 *   - `attribution` - the structured AttributionResult (LE1.0);
 *   - `verdict` - the CapabilityLiftVerdict (Q1.0 - closed vocabulary,
 *     never a score);
 *   - `provenance` - who executed the run, when, with what notes.
 *
 * Immutable, content-addressed (sha256 over the canonical digest-free
 * view); there is NO update or delete path - historical evidence is
 * append-only and never rewritten by learning (lock rule 6).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isLearningTimestamp,
  isNeutralId,
  isNeutralText,
  toContentDigest,
  toLearningTimestamp,
  toNeutralId,
  toNeutralText,
} from './shared.js';
import type { ContentDigest, LearningTimestamp, NeutralId, NeutralText } from './shared.js';
import {
  isMetricComparison,
  isMetricMeasurement,
  isProtectedCapabilityCheck,
  isUncertaintyReport,
} from './comparison.js';
import type { MetricComparison, MetricMeasurement, ProtectedCapabilityCheck, UncertaintyReport } from './comparison.js';
import { isAttributionResultView } from './attribution.js';
import type { AttributionResultView } from './attribution.js';
import { isCapabilityLiftVerdict, isLiftConditions } from './verdict.js';
import type { CapabilityLiftVerdict } from './verdict.js';

/** Wire version of the experiment-run-record shape. */
export const EXPERIMENT_RUN_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Arm run references
// ---------------------------------------------------------------------------

/**
 * The RUN references of one arm: the digest addresses of the evidence
 * the arm ran over - A011 trajectory digests (chain heads), A012
 * evaluation-record digests, A013 verification-record digests. The
 * referenced objects are bound BY DIGEST, never redefined here.
 */
export interface ArmRunRefs {
  readonly trajectories: readonly ContentDigest[];
  readonly evaluations: readonly ContentDigest[];
  readonly verifications: readonly ContentDigest[];
}

/** Stable field list for arm run refs. */
export const ARM_RUN_REFS_FIELDS = Object.freeze([
  'trajectories',
  'evaluations',
  'verifications',
] as const);

export function isArmRunRefs(value: unknown): value is ArmRunRefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['trajectories']) &&
    Array.isArray(candidate['evaluations']) &&
    Array.isArray(candidate['verifications']) &&
    [...(candidate['trajectories'] as unknown[]), ...(candidate['evaluations'] as unknown[]), ...(candidate['verifications'] as unknown[])].every(
      (entry) => isContentDigest(entry),
    )
  );
}

function toArmRunRefs(value: unknown, context: string): ArmRunRefs {
  const record = expectFields(
    value,
    ['trajectories', 'evaluations', 'verifications'],
    [],
    LEARNING_ERROR_CODES.INVALID_RUN,
    context,
  );
  const digestList = (raw: unknown, field: string): readonly ContentDigest[] => {
    if (!Array.isArray(raw)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
        message: `${context}: ${field} must be an array of content digests`,
      });
    }
    return Object.freeze(
      raw.map((entry) =>
        toContentDigest(typeof entry === 'string' ? entry : '', `${context} ${field} entry`),
      ),
    );
  };
  return deepFreeze({
    trajectories: digestList(record['trajectories'], 'trajectories'),
    evaluations: digestList(record['evaluations'], 'evaluations'),
    verifications: digestList(record['verifications'], 'verifications'),
  });
}

// ---------------------------------------------------------------------------
// Run provenance
// ---------------------------------------------------------------------------

/** Provenance of one experiment run. */
export interface RunProvenance {
  readonly executedBy: NeutralId;
  readonly recordedAt: LearningTimestamp;
  readonly notes: NeutralText | null;
}

/** Stable field list for run provenance. */
export const RUN_PROVENANCE_FIELDS = Object.freeze([
  'executedBy',
  'recordedAt',
  'notes',
] as const);

export function isRunProvenance(value: unknown): value is RunProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['executedBy']) &&
    isLearningTimestamp(candidate['recordedAt']) &&
    (candidate['notes'] === null || isNeutralText(candidate['notes']))
  );
}

function toRunProvenance(value: unknown): RunProvenance {
  const record = expectFields(
    value,
    ['executedBy', 'recordedAt', 'notes'],
    [],
    LEARNING_ERROR_CODES.INVALID_PROVENANCE,
    'experiment run record provenance',
  );
  const notes = record['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'experiment run record provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    executedBy: toNeutralId(
      typeof record['executedBy'] === 'string' ? record['executedBy'] : '',
      'run provenance executedBy',
    ),
    recordedAt: toLearningTimestamp(
      typeof record['recordedAt'] === 'string' ? record['recordedAt'] : '',
      'run provenance recordedAt',
    ),
    notes: notes === null ? null : toNeutralText(notes, 'run provenance notes'),
  });
}

// ---------------------------------------------------------------------------
// ExperimentRunRecord
// ---------------------------------------------------------------------------

/** The digest-free view - exactly what the run-record digest commits to. */
export interface ExperimentRunRecordView {
  readonly recordVersion: typeof EXPERIMENT_RUN_RECORD_VERSION;
  readonly experimentKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly descriptorRef: ContentDigest;
  readonly baseline: ArmRunRefs;
  readonly intervention: ArmRunRefs;
  readonly baselineMetrics: readonly MetricMeasurement[];
  readonly interventionMetrics: readonly MetricMeasurement[];
  readonly comparison: readonly MetricComparison[];
  readonly uncertainty: UncertaintyReport;
  readonly protectedCapabilityChecks: readonly ProtectedCapabilityCheck[];
  readonly attribution: AttributionResultView;
  readonly verdict: CapabilityLiftVerdict;
  readonly provenance: RunProvenance;
}

/** A frozen, content-addressed experiment run record: the view plus its sha256 digest. */
export interface ExperimentRunRecord extends ExperimentRunRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the run-record view (tests + contracts mirror it). */
export const EXPERIMENT_RUN_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'experimentKey',
  'correlationId',
  'descriptorRef',
  'baseline',
  'intervention',
  'baselineMetrics',
  'interventionMetrics',
  'comparison',
  'uncertainty',
  'protectedCapabilityChecks',
  'attribution',
  'verdict',
  'provenance',
] as const);

export interface CreateExperimentRunRecordInput {
  readonly experimentKey: string;
  readonly correlationId: string;
  readonly descriptorRef: string;
  readonly baseline: {
    readonly trajectories: readonly string[];
    readonly evaluations: readonly string[];
    readonly verifications: readonly string[];
  };
  readonly intervention: {
    readonly trajectories: readonly string[];
    readonly evaluations: readonly string[];
    readonly verifications: readonly string[];
  };
  readonly baselineMetrics: readonly {
    readonly metricId: string;
    readonly value: number;
    readonly variance: number | null;
  }[];
  readonly interventionMetrics: readonly {
    readonly metricId: string;
    readonly value: number;
    readonly variance: number | null;
  }[];
  readonly comparison: readonly MetricComparison[];
  readonly uncertainty: UncertaintyReport;
  readonly protectedCapabilityChecks: readonly ProtectedCapabilityCheck[];
  readonly attribution: AttributionResultView;
  readonly verdict: CapabilityLiftVerdict;
  readonly provenance: {
    readonly executedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isExperimentRunRecordView(
  value: unknown,
): value is ExperimentRunRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === EXPERIMENT_RUN_RECORD_VERSION &&
    typeof candidate['experimentKey'] === 'string' &&
    isIdempotencyKey(candidate['experimentKey']) &&
    typeof candidate['correlationId'] === 'string' &&
    isCorrelationId(candidate['correlationId']) &&
    isContentDigest(candidate['descriptorRef']) &&
    isArmRunRefs(candidate['baseline']) &&
    isArmRunRefs(candidate['intervention']) &&
    Array.isArray(candidate['baselineMetrics']) &&
    (candidate['baselineMetrics'] as unknown[]).every((entry) =>
      isMetricMeasurement(entry),
    ) &&
    Array.isArray(candidate['interventionMetrics']) &&
    (candidate['interventionMetrics'] as unknown[]).every((entry) =>
      isMetricMeasurement(entry),
    ) &&
    Array.isArray(candidate['comparison']) &&
    (candidate['comparison'] as unknown[]).length > 0 &&
    (candidate['comparison'] as unknown[]).every((entry) => isMetricComparison(entry)) &&
    isUncertaintyReport(candidate['uncertainty']) &&
    Array.isArray(candidate['protectedCapabilityChecks']) &&
    (candidate['protectedCapabilityChecks'] as unknown[]).every((entry) =>
      isProtectedCapabilityCheck(entry),
    ) &&
    isAttributionResultView(candidate['attribution']) &&
    isCapabilityLiftVerdict(candidate['verdict']) &&
    isRunProvenance(candidate['provenance'])
  );
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isExperimentRunRecord(value: unknown): value is ExperimentRunRecord {
  if (!isExperimentRunRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed experiment run
 * record. Validates the full shape: valid experiment key + correlation
 * id, digest refs, metric measurements, non-empty comparison, the
 * uncertainty report, protected-capability checks, the attribution
 * result (all six LE1.0 sources), the five-condition verdict and the
 * run provenance. Consistency between metric ids across measurements,
 * comparison and uncertainty is enforced (the same closed metric set
 * everywhere). Throws typed LearningErrors on every failure mode.
 */
export async function createExperimentRunRecord(
  input: CreateExperimentRunRecordInput,
): Promise<ExperimentRunRecord> {
  const record = expectFields(
    input,
    [
      'experimentKey',
      'correlationId',
      'descriptorRef',
      'baseline',
      'intervention',
      'baselineMetrics',
      'interventionMetrics',
      'comparison',
      'uncertainty',
      'protectedCapabilityChecks',
      'attribution',
      'verdict',
      'provenance',
    ],
    [],
    LEARNING_ERROR_CODES.INVALID_RECORD,
    'experiment run record',
  );

  if (typeof record['experimentKey'] !== 'string' || !isIdempotencyKey(record['experimentKey'])) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
      message: `experiment run record: experimentKey must be a valid idempotency key (architecture-lock rule 17): ${JSON.stringify(record['experimentKey'])}`,
    });
  }
  if (typeof record['correlationId'] !== 'string' || !isCorrelationId(record['correlationId'])) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RUN, {
      message: `experiment run record: correlationId must be a valid correlation id: ${JSON.stringify(record['correlationId'])}`,
    });
  }

  const metricIdsOf = (metrics: readonly unknown[], context: string): string[] => {
    const ids: string[] = [];
    for (const entry of metrics) {
      if (!isMetricMeasurement(entry)) {
        throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
          message: `${context}: every metric measurement must be structurally valid {metricId, value, variance}`,
        });
      }
      ids.push(entry.metricId as string);
    }
    return ids;
  };
  const comparisonMetricIds = (record['comparison'] as readonly MetricComparison[]).map(
    (entry) => entry.metricId as string,
  );
  if (comparisonMetricIds.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message: 'experiment run record: comparison must carry at least one metric comparison',
    });
  }
  const uncertainty = record['uncertainty'];
  if (!isUncertaintyReport(uncertainty)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message: 'experiment run record: uncertainty must be a structurally valid uncertainty report',
    });
  }
  const uncertaintyMetricIds = uncertainty.entries.map((entry) => entry.metricId as string);
  for (const metricId of comparisonMetricIds) {
    if (!uncertaintyMetricIds.includes(metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
        message: `experiment run record: metric ${metricId} appears in the comparison but not in the uncertainty report (Q1.0 condition 5 requires a reported entry per declared metric)`,
        details: { metricId },
      });
    }
  }
  const baselineMetricsRaw = record['baselineMetrics'];
  if (!Array.isArray(baselineMetricsRaw)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
      message: 'experiment run record: baselineMetrics must be an array of metric measurements',
    });
  }
  const interventionMetricsRaw = record['interventionMetrics'];
  if (!Array.isArray(interventionMetricsRaw)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_METRIC, {
      message: 'experiment run record: interventionMetrics must be an array of metric measurements',
    });
  }
  const baselineMetricIds = metricIdsOf(baselineMetricsRaw, 'experiment run record baselineMetrics');
  const interventionMetricIds = metricIdsOf(
    interventionMetricsRaw,
    'experiment run record interventionMetrics',
  );
  for (const metricId of comparisonMetricIds) {
    if (!baselineMetricIds.includes(metricId) || !interventionMetricIds.includes(metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
        message: `experiment run record: metric ${metricId} appears in the comparison but not in both arms' measurements`,
        details: { metricId },
      });
    }
  }
  const sortedComparison = [...comparisonMetricIds].sort();
  const sortedBaseline = [...baselineMetricIds].sort();
  const sortedIntervention = [...interventionMetricIds].sort();
  if (
    sortedComparison.join(',') !== sortedBaseline.join(',') ||
    sortedComparison.join(',') !== sortedIntervention.join(',')
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment run record: the metric id sets of the comparison and both arms must be identical',
      details: {
        comparison: sortedComparison,
        baseline: sortedBaseline,
        intervention: sortedIntervention,
      },
    });
  }

  const attribution = record['attribution'];
  if (!isAttributionResultView(attribution)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment run record: attribution must be a structurally valid attribution result (one finding per LE1.0 source)',
    });
  }
  const verdict = record['verdict'];
  if (!isCapabilityLiftVerdict(verdict) || !isLiftConditions(verdict.conditions)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment run record: verdict must be a structurally valid capability-lift verdict (closed vocabulary + the five Q1.0 conditions)',
    });
  }
  if (
    (attribution.confounds as readonly string[]).includes('evaluator-version-confound') &&
    verdict.verdict !== 'inconclusive-unless-controlled'
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment run record: an evaluator-version-confound in the attribution REQUIRES the verdict inconclusive-unless-controlled (a changed evaluator score is not automatically a capability improvement)',
      details: { confounds: attribution.confounds, verdict: verdict.verdict },
    });
  }
  if (
    (attribution.confounds as readonly string[]).includes('verifier-version-confound') &&
    verdict.verdict !== 'inconclusive-unless-controlled'
  ) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message:
        'experiment run record: a verifier-version-confound in the attribution REQUIRES the verdict inconclusive-unless-controlled',
      details: { confounds: attribution.confounds, verdict: verdict.verdict },
    });
  }

  const view: ExperimentRunRecordView = {
    recordVersion: EXPERIMENT_RUN_RECORD_VERSION,
    experimentKey: record['experimentKey'] as IdempotencyKey,
    correlationId: record['correlationId'] as CorrelationId,
    descriptorRef: toContentDigest(
      typeof record['descriptorRef'] === 'string' ? record['descriptorRef'] : '',
      'experiment run record descriptorRef',
    ),
    baseline: toArmRunRefs(record['baseline'], 'experiment run record baseline'),
    intervention: toArmRunRefs(record['intervention'], 'experiment run record intervention'),
    baselineMetrics: deepFreeze([...(record['baselineMetrics'] as readonly MetricMeasurement[])]),
    interventionMetrics: deepFreeze([
      ...(record['interventionMetrics'] as readonly MetricMeasurement[]),
    ]),
    comparison: deepFreeze([...(record['comparison'] as readonly MetricComparison[])]),
    uncertainty: deepFreeze({ ...uncertainty }) as UncertaintyReport,
    protectedCapabilityChecks: deepFreeze([
      ...(record['protectedCapabilityChecks'] as readonly ProtectedCapabilityCheck[]),
    ]),
    attribution: deepFreeze({ ...attribution }) as AttributionResultView,
    verdict: deepFreeze({ ...verdict }) as CapabilityLiftVerdict,
    provenance: toRunProvenance(record['provenance']),
  };
  const digest = toContentDigest(
    await digestCanonical(view),
    'experiment run record digest',
  );
  return deepFreeze({ ...view, digest }) as ExperimentRunRecord;
}

/** The digest-free view of a run record (what the digest commits to). */
export function experimentRunRecordView(
  record: ExperimentRunRecord,
): ExperimentRunRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as ExperimentRunRecordView;
}

/**
 * Recompute the run-record digest over the digest-free view and compare
 * (optionally against an expected digest). Throws LEARNING_TAMPERED on
 * any mismatch.
 */
export async function recomputeExperimentRunRecordDigest(
  record: ExperimentRunRecord,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isExperimentRunRecord(record)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
      message: 'run-record digest recomputation requires a structurally valid experiment run record',
    });
  }
  const actual = await digestCanonical(experimentRunRecordView(record));
  if (actual !== record.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new LearningError(LEARNING_ERROR_CODES.TAMPERED, {
      message: `experiment run record digest mismatch: expected ${expectedDigest ?? record.digest}, got ${actual}`,
      details: { experimentKey: record.experimentKey, expected: expectedDigest ?? record.digest, actual },
    });
  }
  return toContentDigest(actual, 'recomputed experiment run record digest');
}
