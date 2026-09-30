/**
 * SLO definitions with error budgets (Work Order A035; requirement R33).
 *
 * Frozen record types + a PURE, deterministic evaluator over a time
 * window:
 *
 *   - an SLO pins a service-level indicator (CLOSED indicator kind:
 *     good-total ratio, latency-threshold ratio, log-error ratio) and a
 *     target ratio strictly between 0 and 1;
 *   - the error budget is DERIVED, never hand-set: allowedBad ratio =
 *     1 - target; the evaluator reports consumed/remaining/exhausted
 *     against the observed sample window;
 *   - evaluation is strict about the window: samples outside the window
 *     are REJECTED (OBS_SAMPLE_OUTSIDE_WINDOW — the caller slices, the
 *     evaluator never silently widens a window), unordered samples are
 *     rejected (OBS_SAMPLES_UNORDERED), and malformed windows are
 *     rejected (OBS_INVALID_WINDOW);
 *   - NO DATA FAILS CLOSED: when fewer than `minSampleCount` samples
 *     are in the window the verdict is 'no-data' — NEVER 'met' — and
 *     the error budget is reported as fully consumed (treated as
 *     breached by alert evaluation).
 */

import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import {
  isEnumMember,
  isFiniteNonNegativeNumber,
  isNeutralId,
  isStrictRatio,
  isTelemetryId,
} from './shared.js';
import type { NeutralId, ObservabilityTimestamp, TelemetryId } from './shared.js';
import type { LogSignal, MetricSignal } from './telemetry.js';
import { isTelemetrySignal } from './telemetry.js';

/** Deterministic ratio boundary tolerance (IEEE-754 stabilization). */
export const RATIO_EPSILON = 1e-12 as const;

export const SLO_DEFINITION_VERSION = 1 as const;

/** Closed service-level indicator kinds. */
export const SLI_KINDS = Object.freeze([
  'good-total-ratio',
  'latency-threshold-ratio',
  'log-error-ratio',
] as const);
export type SliKind = (typeof SLI_KINDS)[number];

export function isSliKind(value: unknown): value is SliKind {
  return isEnumMember(value, SLI_KINDS);
}

/** Closed SLO verdict vocabulary (ordering matters for severity rolls-up). */
export const SLO_VERDICTS = Object.freeze(['met', 'at-risk', 'breached', 'no-data'] as const);
export type SloVerdict = (typeof SLO_VERDICTS)[number];

export function isSloVerdict(value: unknown): value is SloVerdict {
  return isEnumMember(value, SLO_VERDICTS);
}

/** The derived error budget of one evaluation (frozen record). */
export interface ErrorBudget {
  /** Ratio of bad events the SLO tolerates over the window: 1 - target. */
  readonly allowedBadRatio: number;
  /** Observed bad-event ratio (0 when no samples; 1 on no-data fail-closed). */
  readonly observedBadRatio: number;
  /** Fraction of the budget already burned (observed/allowed, capped at 1). */
  readonly consumedRatio: number;
  readonly remainingRatio: number;
  readonly exhausted: boolean;
}

/** A frozen SLO definition. */
export interface SloDefinition {
  readonly definitionVersion: typeof SLO_DEFINITION_VERSION;
  readonly sloId: TelemetryId;
  readonly name: string;
  readonly service: NeutralId;
  readonly sli: {
    readonly kind: SliKind;
    /** Metric name for ratio indicators; log source for log-error-ratio. */
    readonly metricName: NeutralId;
    /** Threshold in ms for 'latency-threshold-ratio' (null otherwise). */
    readonly thresholdMs: number | null;
  };
  /** Target good-event ratio, strictly within (0, 1). */
  readonly targetRatio: number;
  /** Rolling evaluation window in ms (>= 1). */
  readonly windowMs: number;
  /** Minimum samples for a trustworthy verdict (fail-closed below this). */
  readonly minSampleCount: number;
  /** Ratio of budget consumption at/above which the verdict is 'at-risk'. */
  readonly atRiskThresholdRatio: number;
  readonly description: string | null;
}

export function isSloDefinition(value: unknown): value is SloDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['definitionVersion'] !== SLO_DEFINITION_VERSION) return false;
  if (!isTelemetryId(record['sloId'])) return false;
  if (!isNeutralId(record['service'])) return false;
  if (typeof record['name'] !== 'string') return false;
  const sli = record['sli'];
  if (typeof sli !== 'object' || sli === null) return false;
  const sliRecord = sli as Record<string, unknown>;
  return (
    isSliKind(sliRecord['kind']) &&
    isNeutralId(sliRecord['metricName']) &&
    (sliRecord['thresholdMs'] === null ||
      isFiniteNonNegativeNumber(sliRecord['thresholdMs'])) &&
    isStrictRatio(record['targetRatio']) &&
    isFiniteNonNegativeNumber(record['windowMs']) &&
    (record['windowMs'] as number) >= 1 &&
    typeof record['minSampleCount'] === 'number' &&
    Number.isSafeInteger(record['minSampleCount']) &&
    (record['minSampleCount'] as number) >= 1 &&
    isStrictRatio(record['atRiskThresholdRatio'])
  );
}

/** Validate + freeze a raw value into a SloDefinition. */
export function toSloDefinition(value: unknown): SloDefinition {
  if (typeof value !== 'object' || value === null) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'SLO definition must be a JSON object',
    });
  }
  const record = value as Record<string, unknown>;
  if (record['definitionVersion'] !== SLO_DEFINITION_VERSION) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `unsupported SLO definition version: ${String(record['definitionVersion'])} (expected ${String(SLO_DEFINITION_VERSION)})`,
    });
  }
  if (!isTelemetryId(record['sloId'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `sloId must be a telemetry id, got ${JSON.stringify(record['sloId'])}`,
    });
  }
  if (!isNeutralId(record['service'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `service must be a neutral id, got ${JSON.stringify(record['service'])}`,
    });
  }
  if (typeof record['name'] !== 'string' || record['name'].length === 0 || record['name'].length > 256) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'SLO name must be a non-empty string (<= 256 chars)',
    });
  }
  const sliRaw = record['sli'];
  if (typeof sliRaw !== 'object' || sliRaw === null || Array.isArray(sliRaw)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'sli must be an object',
    });
  }
  const sli = sliRaw as Record<string, unknown>;
  if (!isSliKind(sli['kind'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `sli.kind must be one of ${SLI_KINDS.join(', ')}, got ${String(sli['kind'])}`,
    });
  }
  const kind = sli['kind'] as SliKind;
  if (!isNeutralId(sli['metricName'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `sli.metricName must be a neutral id, got ${JSON.stringify(sli['metricName'])}`,
    });
  }
  let thresholdMs: number | null = null;
  if (kind === 'latency-threshold-ratio') {
    const raw = sli['thresholdMs'];
    if (typeof raw !== 'number' || !isFiniteNonNegativeNumber(raw) || raw <= 0) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
        message: 'latency-threshold-ratio requires a positive finite thresholdMs',
      });
    }
    thresholdMs = raw;
  } else if (sli['thresholdMs'] !== null && sli['thresholdMs'] !== undefined) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `sli.kind ${kind} must not carry thresholdMs`,
    });
  }
  const targetRatio = record['targetRatio'];
  if (!isStrictRatio(targetRatio)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `targetRatio must be strictly within (0, 1), got ${String(targetRatio)}`,
    });
  }
  const windowMs = record['windowMs'];
  if (typeof windowMs !== 'number' || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `windowMs must be an integer >= 1 (epoch ms), got ${String(windowMs)}`,
    });
  }
  const minSampleCount = record['minSampleCount'];
  if (
    typeof minSampleCount !== 'number' ||
    !Number.isSafeInteger(minSampleCount) ||
    minSampleCount < 1
  ) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `minSampleCount must be an integer >= 1, got ${String(minSampleCount)}`,
    });
  }
  const atRiskThresholdRatio = record['atRiskThresholdRatio'];
  if (!isStrictRatio(atRiskThresholdRatio)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: `atRiskThresholdRatio must be strictly within (0, 1), got ${String(atRiskThresholdRatio)}`,
    });
  }
  const description = record['description'];
  if (description !== null && description !== undefined && typeof description !== 'string') {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'description must be a string or null',
    });
  }
  return Object.freeze({
    definitionVersion: SLO_DEFINITION_VERSION,
    sloId: record['sloId'] as TelemetryId,
    name: record['name'] as string,
    service: record['service'] as NeutralId,
    sli: Object.freeze({
      kind,
      metricName: sli['metricName'] as NeutralId,
      thresholdMs,
    }),
    targetRatio,
    windowMs,
    minSampleCount,
    atRiskThresholdRatio,
    description: (description ?? null) as string | null,
  });
}

// ---------------------------------------------------------------------------
// Evaluation (pure, deterministic, window-strict, no-data fail-closed)
// ---------------------------------------------------------------------------

/** An evaluation window: [windowStart, windowEnd], duration == windowMs. */
export interface EvaluationWindow {
  readonly windowStart: ObservabilityTimestamp;
  readonly windowEnd: ObservabilityTimestamp;
}

/** The frozen result of evaluating one SLO over one window. */
export interface SloEvaluation {
  readonly sloId: TelemetryId;
  readonly windowStart: ObservabilityTimestamp;
  readonly windowEnd: ObservabilityTimestamp;
  readonly sampleCount: number;
  readonly goodCount: number;
  readonly badCount: number;
  readonly achievedRatio: number;
  readonly targetRatio: number;
  readonly errorBudget: ErrorBudget;
  readonly verdict: SloVerdict;
}

export interface EvaluateSloInput {
  readonly definition: SloDefinition;
  readonly window: EvaluationWindow;
  /** Telemetry feeding the indicator: metric signals (or log signals for log-error-ratio). */
  readonly samples: readonly (MetricSignal | LogSignal)[];
}

/**
 * Pure SLO evaluation. Determinism: identical (definition, window,
 * samples) always yields an identical evaluation — no clock, no
 * randomness, no ambient state.
 */
export function evaluateSlo(input: EvaluateSloInput): SloEvaluation {
  const { definition, window, samples } = input;
  if (!isSloDefinition(definition)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
      message: 'SLO evaluation requires a structurally valid definition',
    });
  }
  checkWindow(window, definition.windowMs);
  checkSamples(samples, window);

  const relevant = samples.filter((sample) => {
    if (definition.sli.kind === 'log-error-ratio') {
      // The indicator measures the healthy-share of the service's log stream.
      return sample.kind === 'log' && sample.sourceService === definition.service;
    }
    return (
      sample.kind === 'metric' &&
      sample.sourceService === definition.service &&
      sample.metricName === definition.sli.metricName
    );
  });

  const sampleCount = relevant.length;
  let goodCount = 0;
  if (sampleCount > 0) {
    if (definition.sli.kind === 'log-error-ratio') {
      goodCount = relevant.filter((s) => (s as LogSignal).level !== 'error' && (s as LogSignal).level !== 'warn').length;
    } else if (definition.sli.kind === 'latency-threshold-ratio') {
      const threshold = definition.sli.thresholdMs as number;
      goodCount = relevant.filter(
        (s) => (s as MetricSignal).value <= threshold,
      ).length;
    } else {
      // good-total-ratio over a counter metric carrying boolean 0/1
      // goodness per event (1 = good event, 0 = bad event).
      goodCount = relevant.filter((s) => (s as MetricSignal).value >= 1).length;
    }
  }
  const badCount = sampleCount - goodCount;

  const allowedBadRatio = 1 - definition.targetRatio;
  let observedBadRatio = 0;
  if (sampleCount > 0) {
    observedBadRatio = badCount / sampleCount;
  }

  // NO-DATA FAILS CLOSED: verdict 'no-data', budget reported exhausted.
  if (sampleCount < definition.minSampleCount) {
    return freezeEvaluation({
      sloId: definition.sloId,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      sampleCount,
      goodCount,
      badCount,
      achievedRatio: 0,
      targetRatio: definition.targetRatio,
      errorBudget: {
        allowedBadRatio,
        observedBadRatio: 1,
        consumedRatio: 1,
        remainingRatio: 0,
        exhausted: true,
      },
      verdict: 'no-data',
    });
  }

  const achievedRatio = goodCount / sampleCount;
  const consumedRatio =
    allowedBadRatio > 0
      ? observedBadRatio > allowedBadRatio
        ? 1
        : observedBadRatio / allowedBadRatio
      : observedBadRatio > 0
        ? 1
        : 0;
  const remainingRatio = 1 - consumedRatio;
  // Boundary tolerance: 2/200 == 1 - 0.99 is an exact budget burn in
  // rational arithmetic but a hair under 1 in IEEE-754. Deterministic
  // epsilon (1e-12) keeps verdicts stable at the boundary.
  const exhausted = consumedRatio >= 1 - RATIO_EPSILON;
  const breached = achievedRatio < definition.targetRatio - RATIO_EPSILON;
  const verdict: SloVerdict = breached
    ? 'breached'
    : consumedRatio >= definition.atRiskThresholdRatio
      ? 'at-risk'
      : 'met';

  return freezeEvaluation({
    sloId: definition.sloId,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    sampleCount,
    goodCount,
    badCount,
    achievedRatio,
    targetRatio: definition.targetRatio,
    errorBudget: {
      allowedBadRatio,
      observedBadRatio,
      consumedRatio,
      remainingRatio,
      exhausted,
    },
    verdict,
  });
}

function freezeEvaluation(evaluation: SloEvaluation): SloEvaluation {
  return Object.freeze({
    ...evaluation,
    errorBudget: Object.freeze({ ...evaluation.errorBudget }),
  });
}

function checkWindow(window: EvaluationWindow, expectedWindowMs: number): void {
  if (
    !Number.isSafeInteger(window.windowStart) ||
    window.windowStart < 0 ||
    !Number.isSafeInteger(window.windowEnd) ||
    window.windowEnd < 0
  ) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
      message: 'evaluation window bounds must be epoch-ms integers >= 0',
    });
  }
  if (window.windowEnd <= window.windowStart) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
      message: `evaluation window end (${String(window.windowEnd)}) must be after start (${String(window.windowStart)})`,
      details: { windowStart: window.windowStart, windowEnd: window.windowEnd },
    });
  }
  const duration = window.windowEnd - window.windowStart;
  if (duration !== expectedWindowMs) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
      message: `evaluation window duration ${String(duration)}ms does not match the definition's windowMs ${String(expectedWindowMs)}ms (windows are never silently widened or shrunk)`,
      details: { duration, expectedWindowMs: expectedWindowMs },
    });
  }
}

function checkSamples(
  samples: readonly (MetricSignal | LogSignal)[],
  window: EvaluationWindow,
): void {
  let lastAt: number | null = null;
  for (const sample of samples) {
    if (!isTelemetrySignal(sample)) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
        message: 'SLO evaluation samples must be structurally valid telemetry signals',
      });
    }
    if (sample.occurredAt < window.windowStart || sample.occurredAt > window.windowEnd) {
      throw new ObservabilityError(OBS_ERROR_CODES.SAMPLE_OUTSIDE_WINDOW, {
        message: `sample ${String(sample.signalId)} at ${String(sample.occurredAt)} lies outside the evaluation window [${String(window.windowStart)}, ${String(window.windowEnd)}] (callers slice windows; the evaluator never widens them)`,
        details: {
          sampleAt: sample.occurredAt,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
        },
      });
    }
    if (lastAt !== null && sample.occurredAt < lastAt) {
      throw new ObservabilityError(OBS_ERROR_CODES.SAMPLES_UNORDERED, {
        message: `SLO samples must be ordered by occurredAt (non-decreasing); ${String(sample.signalId)} regresses behind ${String(lastAt)}`,
        details: { lastAt, sampleAt: sample.occurredAt },
      });
    }
    lastAt = sample.occurredAt;
  }
}
