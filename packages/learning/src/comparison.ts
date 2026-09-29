/**
 * The PURE comparison computation of a learning experiment (Work Order
 * A020; requirement R15 "baseline/intervention/comparison"; R16
 * "Measure whether interventions change target capability"; spec
 * quality-model.md Q1.0 condition 1).
 *
 * Everything here is deterministic and side-effect free: same
 * declarations + same arm measurements ⇒ same comparison. The engine
 * (services/learning) supplies the arm measurements; these functions
 * validate them against the CLOSED declaration set (metric ids and
 * protected capability refs must match EXACTLY - unknown or missing
 * outcome metrics are hard contract violations; missing protected
 * measurements are recorded as NOT MEASURED so the verdict fails
 * closed, never silently).
 */

import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectFiniteNumber,
  expectNonNegativeNumber,
  isContentDigest,
  isNeutralId,
  toContentDigest,
  toNeutralId,
} from './shared.js';
import type { ContentDigest, NeutralId } from './shared.js';
import type {
  OutcomeMetricDeclaration,
  ProtectedCapabilityDeclaration,
  UncertaintyDeclaration,
  MetricDirection,
} from './descriptor.js';
import { isUncertaintyMethod } from './descriptor.js';
import { UNCERTAINTY_METHODS } from './descriptor.js';

// ---------------------------------------------------------------------------
// Arm measurement inputs
// ---------------------------------------------------------------------------

/** One measured outcome metric value (with optional variance) for one arm. */
export interface MetricMeasurement {
  readonly metricId: NeutralId;
  readonly value: number;
  /** Reported variance for this measurement (null when unreported - Q1.0 condition 5 fails closed). */
  readonly variance: number | null;
}

/** Stable field list for metric measurements. */
export const METRIC_MEASUREMENT_FIELDS = Object.freeze([
  'metricId',
  'value',
  'variance',
] as const);

export function isMetricMeasurement(value: unknown): value is MetricMeasurement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['metricId']) &&
    typeof candidate['value'] === 'number' &&
    Number.isFinite(candidate['value']) &&
    (candidate['variance'] === null ||
      (typeof candidate['variance'] === 'number' &&
        Number.isFinite(candidate['variance']) &&
        candidate['variance'] >= 0))
  );
}

function toMetricMeasurement(value: unknown, context: string): MetricMeasurement {
  const record = expectFields(
    value,
    ['metricId', 'value', 'variance'],
    [],
    LEARNING_ERROR_CODES.INVALID_METRIC,
    context,
  );
  return deepFreeze({
    metricId: toNeutralId(
      typeof record['metricId'] === 'string' ? record['metricId'] : '',
      `${context} metricId`,
    ),
    value: expectFiniteNumber(
      record['value'],
      'value',
      LEARNING_ERROR_CODES.INVALID_METRIC,
      context,
    ),
    variance:
      record['variance'] === null
        ? null
        : expectNonNegativeNumber(
            record['variance'],
            'variance',
            LEARNING_ERROR_CODES.INVALID_METRIC,
            context,
          ),
  });
}

/** One protected-capability measurement (keyed by the declared ref digest) for one arm. */
export interface ProtectedMeasurement {
  /** The digest of the DECLARED protected capability's A004 node ref. */
  readonly capabilityRef: ContentDigest;
  readonly value: number;
}

/** Stable field list for protected measurements. */
export const PROTECTED_MEASUREMENT_FIELDS = Object.freeze([
  'capabilityRef',
  'value',
] as const);

export function isProtectedMeasurement(value: unknown): value is ProtectedMeasurement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isContentDigest(candidate['capabilityRef']) &&
    typeof candidate['value'] === 'number' &&
    Number.isFinite(candidate['value'])
  );
}

function toProtectedMeasurement(value: unknown, context: string): ProtectedMeasurement {
  const record = expectFields(
    value,
    ['capabilityRef', 'value'],
    [],
    LEARNING_ERROR_CODES.INVALID_PROPOSAL,
    context,
  );
  return deepFreeze({
    capabilityRef: toContentDigest(
      typeof record['capabilityRef'] === 'string' ? record['capabilityRef'] : '',
      `${context} capabilityRef`,
    ),
    value: expectFiniteNumber(
      record['value'],
      'value',
      LEARNING_ERROR_CODES.INVALID_PROPOSAL,
      context,
    ),
  });
}

// ---------------------------------------------------------------------------
// Comparison outputs
// ---------------------------------------------------------------------------

/** The computed comparison of one declared outcome metric between the arms. */
export interface MetricComparison {
  readonly metricId: NeutralId;
  readonly direction: MetricDirection;
  readonly baselineValue: number;
  readonly interventionValue: number;
  /** interventionValue - baselineValue (sign is direction-independent). */
  readonly delta: number;
  /** True iff the metric strictly improved per its declared direction. */
  readonly improved: boolean;
  /** True iff the metric strictly regressed per its declared direction. */
  readonly regressed: boolean;
}

/** Stable field list for metric comparisons. */
export const METRIC_COMPARISON_FIELDS = Object.freeze([
  'metricId',
  'direction',
  'baselineValue',
  'interventionValue',
  'delta',
  'improved',
  'regressed',
] as const);

export function isMetricComparison(value: unknown): value is MetricComparison {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['metricId']) &&
    (candidate['direction'] === 'higher-is-better' ||
      candidate['direction'] === 'lower-is-better') &&
    typeof candidate['baselineValue'] === 'number' &&
    typeof candidate['interventionValue'] === 'number' &&
    typeof candidate['delta'] === 'number' &&
    typeof candidate['improved'] === 'boolean' &&
    typeof candidate['regressed'] === 'boolean'
  );
}

/** The computed regression check for one declared protected capability. */
export interface ProtectedCapabilityCheck {
  /** The digest of the declared protected capability's A004 node ref. */
  readonly capabilityRef: ContentDigest;
  readonly metricId: NeutralId;
  readonly direction: MetricDirection;
  readonly baselineValue: number | null;
  readonly interventionValue: number | null;
  readonly delta: number | null;
  /** True iff the protected capability regressed strictly per direction. False when unmeasured. */
  readonly regressed: boolean;
  /** False when either arm did not supply the measurement (Q1.0 condition 4 then fails). */
  readonly measured: boolean;
}

/** Stable field list for protected capability checks. */
export const PROTECTED_CAPABILITY_CHECK_FIELDS = Object.freeze([
  'capabilityRef',
  'metricId',
  'direction',
  'baselineValue',
  'interventionValue',
  'delta',
  'regressed',
  'measured',
] as const);

export function isProtectedCapabilityCheck(
  value: unknown,
): value is ProtectedCapabilityCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isContentDigest(candidate['capabilityRef']) &&
    isNeutralId(candidate['metricId']) &&
    (candidate['direction'] === 'higher-is-better' ||
      candidate['direction'] === 'lower-is-better') &&
    (candidate['baselineValue'] === null ||
      (typeof candidate['baselineValue'] === 'number' &&
        Number.isFinite(candidate['baselineValue']))) &&
    (candidate['interventionValue'] === null ||
      (typeof candidate['interventionValue'] === 'number' &&
        Number.isFinite(candidate['interventionValue']))) &&
    (candidate['delta'] === null ||
      (typeof candidate['delta'] === 'number' && Number.isFinite(candidate['delta']))) &&
    typeof candidate['regressed'] === 'boolean' &&
    typeof candidate['measured'] === 'boolean'
  );
}

/** One uncertainty report entry: both arms' reported variances per metric. */
export interface UncertaintyReportEntry {
  readonly metricId: NeutralId;
  readonly baselineVariance: number | null;
  readonly interventionVariance: number | null;
}

/** Stable field list for uncertainty report entries. */
export const UNCERTAINTY_REPORT_ENTRY_FIELDS = Object.freeze([
  'metricId',
  'baselineVariance',
  'interventionVariance',
] as const);

export function isUncertaintyReportEntry(
  value: unknown,
): value is UncertaintyReportEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralId(candidate['metricId']) &&
    (candidate['baselineVariance'] === null ||
      (typeof candidate['baselineVariance'] === 'number' &&
        Number.isFinite(candidate['baselineVariance']) &&
        candidate['baselineVariance'] >= 0)) &&
    (candidate['interventionVariance'] === null ||
      (typeof candidate['interventionVariance'] === 'number' &&
        Number.isFinite(candidate['interventionVariance']) &&
        candidate['interventionVariance'] >= 0))
  );
}

/** The reported uncertainty of a run: the declared method plus per-metric variance values. */
export interface UncertaintyReport {
  readonly method: string;
  readonly entries: readonly UncertaintyReportEntry[];
}

/** Stable field list for uncertainty reports. */
export const UNCERTAINTY_REPORT_FIELDS = Object.freeze(['method', 'entries'] as const);

export function isUncertaintyReport(value: unknown): value is UncertaintyReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['method'] === 'string' &&
    isUncertaintyMethod(candidate['method']) &&
    Array.isArray(candidate['entries']) &&
    (candidate['entries'] as unknown[]).every((entry) =>
      isUncertaintyReportEntry(entry),
    )
  );
}

// ---------------------------------------------------------------------------
// Pure computations
// ---------------------------------------------------------------------------

function metricDelta(
  direction: MetricDirection,
  baselineValue: number,
  interventionValue: number,
): { delta: number; improved: boolean; regressed: boolean } {
  const delta = interventionValue - baselineValue;
  const normalized = direction === 'higher-is-better' ? delta : -delta;
  return { delta, improved: normalized > 0, regressed: normalized < 0 };
}

function measurementByMetricId(
  metrics: readonly unknown[],
  context: string,
): Map<string, MetricMeasurement> {
  const byId = new Map<string, MetricMeasurement>();
  for (const entry of metrics) {
    const measurement = toMetricMeasurement(entry, context);
    const metricId = measurement.metricId as string;
    if (byId.has(metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.METRIC_MISMATCH, {
        message: `${context}: duplicate measurement for metric ${metricId} (exactly one measurement per declared metric per arm)`,
        details: { metricId },
      });
    }
    byId.set(metricId, measurement);
  }
  return byId;
}

function measurementByCapabilityRef(
  measurements: readonly unknown[],
  context: string,
): Map<string, number> {
  const byRef = new Map<string, number>();
  for (const entry of measurements) {
    const measurement = toProtectedMeasurement(entry, context);
    const capabilityRef = measurement.capabilityRef as string;
    if (byRef.has(capabilityRef)) {
      throw new LearningError(LEARNING_ERROR_CODES.PROTECTED_CAPABILITY_MISMATCH, {
        message: `${context}: duplicate protected-capability measurement for ref ${capabilityRef}`,
        details: { capabilityRef },
      });
    }
    byRef.set(capabilityRef, measurement.value);
  }
  return byRef;
}

/**
 * Compare the declared outcome metrics between the two arms. The arm
 * measurements must match the declaration EXACTLY: a missing metric,
 * an unknown metric or a duplicate is LEARNING_METRIC_MISMATCH (the
 * closed-set discipline - undeclared measurements cannot sneak in).
 */
export function compareOutcomeMetrics(
  declarations: readonly OutcomeMetricDeclaration[],
  baselineMetrics: readonly unknown[],
  interventionMetrics: readonly unknown[],
): readonly MetricComparison[] {
  const baselineById = measurementByMetricId(baselineMetrics, 'baseline arm metrics');
  const interventionById = measurementByMetricId(
    interventionMetrics,
    'intervention arm metrics',
  );
  for (const [metricId] of baselineById) {
    if (!declarations.some((entry) => (entry.metricId as string) === metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.METRIC_MISMATCH, {
        message: `baseline arm metrics: undeclared metric ${metricId} measured (arm metrics must match the declared outcome metrics exactly)`,
        details: { metricId },
      });
    }
  }
  for (const [metricId] of interventionById) {
    if (!declarations.some((entry) => (entry.metricId as string) === metricId)) {
      throw new LearningError(LEARNING_ERROR_CODES.METRIC_MISMATCH, {
        message: `intervention arm metrics: undeclared metric ${metricId} measured (arm metrics must match the declared outcome metrics exactly)`,
        details: { metricId },
      });
    }
  }
  const comparisons: MetricComparison[] = [];
  for (const declaration of declarations) {
    const metricId = declaration.metricId as string;
    const baseline = baselineById.get(metricId);
    const intervention = interventionById.get(metricId);
    if (baseline === undefined || intervention === undefined) {
      throw new LearningError(LEARNING_ERROR_CODES.METRIC_MISMATCH, {
        message: `outcome metric ${metricId} is declared but not measured in ${
          baseline === undefined ? 'the baseline' : 'the intervention'
        } arm (arm metrics must match the declared outcome metrics exactly)`,
        details: {
          metricId,
          missingIn: baseline === undefined ? 'baseline' : 'intervention',
        },
      });
    }
    const { delta, improved, regressed } = metricDelta(
      declaration.direction,
      baseline.value,
      intervention.value,
    );
    comparisons.push(
      deepFreeze({
        metricId: declaration.metricId,
        direction: declaration.direction,
        baselineValue: baseline.value,
        interventionValue: intervention.value,
        delta,
        improved,
        regressed,
      }),
    );
  }
  return Object.freeze([...comparisons]);
}

/**
 * Check the declared protected capabilities for regression. Missing
 * measurements are recorded as `measured: false` (never silently
 * skipped - the verdict then fails Q1.0 condition 4); measurements for
 * UNDECLARED capability refs are hard rejections
 * (LEARNING_PROTECTED_CAPABILITY_MISMATCH).
 */
export function checkProtectedCapabilities(
  declarations: readonly ProtectedCapabilityDeclaration[],
  baselineMeasurements: readonly unknown[],
  interventionMeasurements: readonly unknown[],
): readonly ProtectedCapabilityCheck[] {
  const baselineByRef = measurementByCapabilityRef(
    baselineMeasurements,
    'baseline arm protected metrics',
  );
  const interventionByRef = measurementByCapabilityRef(
    interventionMeasurements,
    'intervention arm protected metrics',
  );
  const declaredRefs = new Set(declarations.map((entry) => entry.ref.digest));
  for (const arm of [
    { name: 'baseline', map: baselineByRef },
    { name: 'intervention', map: interventionByRef },
  ]) {
    for (const capabilityRef of arm.map.keys()) {
      if (!declaredRefs.has(capabilityRef)) {
        throw new LearningError(LEARNING_ERROR_CODES.PROTECTED_CAPABILITY_MISMATCH, {
          message: `${arm.name} arm protected metrics: measurement for UNDECLARED protected capability ref ${capabilityRef} (protected measurements must match the declared set exactly)`,
          details: { capabilityRef },
        });
      }
    }
  }
  const checks: ProtectedCapabilityCheck[] = [];
  for (const declaration of declarations) {
    const capabilityRef = declaration.ref.digest;
    const baselineValue = baselineByRef.get(capabilityRef) ?? null;
    const interventionValue = interventionByRef.get(capabilityRef) ?? null;
    const measured = baselineValue !== null && interventionValue !== null;
    let delta: number | null = null;
    let regressed = false;
    if (measured) {
      const outcome = metricDelta(declaration.direction, baselineValue, interventionValue);
      delta = outcome.delta;
      regressed = outcome.regressed;
    }
    checks.push(
      deepFreeze({
        capabilityRef: declaration.ref.digest as ContentDigest,
        metricId: declaration.metricId,
        direction: declaration.direction,
        baselineValue,
        interventionValue,
        delta,
        regressed,
        measured,
      }),
    );
  }
  return Object.freeze([...checks]);
}

/**
 * Compute the uncertainty report: per declared metric, the variances
 * both arms reported (null when unreported - Q1.0 condition 5 fails
 * closed on null). The method is carried from the declaration.
 */
export function computeUncertaintyReport(
  declaration: UncertaintyDeclaration,
  baselineMetrics: readonly unknown[],
  interventionMetrics: readonly unknown[],
): UncertaintyReport {
  const method = isUncertaintyMethod(declaration.method)
    ? declaration.method
    : (() => {
        throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
          message: `uncertainty report: unknown method ${JSON.stringify(declaration.method)}`,
          details: { known: [...UNCERTAINTY_METHODS] },
        });
      })();
  const baselineById = measurementByMetricId(baselineMetrics, 'baseline arm metrics');
  const interventionById = measurementByMetricId(
    interventionMetrics,
    'intervention arm metrics',
  );
  const metricIds = new Set<string>([
    ...baselineById.keys(),
    ...interventionById.keys(),
  ]);
  const entries: UncertaintyReportEntry[] = [];
  for (const metricId of metricIds) {
    entries.push(
      deepFreeze({
        metricId: toNeutralId(metricId, 'uncertainty report metricId'),
        baselineVariance: baselineById.get(metricId)?.variance ?? null,
        interventionVariance: interventionById.get(metricId)?.variance ?? null,
      }),
    );
  }
  return deepFreeze({ method, entries: Object.freeze([...entries]) });
}
