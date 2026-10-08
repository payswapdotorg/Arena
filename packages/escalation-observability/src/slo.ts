/**
 * SLO rollups in the A035 vocabulary (Work Order C021; issue #127;
 * docs/operations/slo-targets.md — the operating posture this stays
 * consistent with).
 *
 * The A035 surface (@arena/observability) OWNS the SLO vocabulary:
 * SloDefinition, the closed SLI kinds, the derived error budget and the
 * pure evaluator. This file rolls ESCALATION measurements up INTO that
 * vocabulary:
 *
 *   - rollupSlo: builds an A035 SloDefinition (good-total-ratio over a
 *     projected per-dimension counter) + MetricSignals (1 = good
 *     escalation, 0 = bad) and runs the REAL A035 evaluator — the
 *     rollup verdict/error-budget arithmetic is A035's, never
 *     re-implemented here. The formula is DISCLOSED on the view (a
 *     human-readable string + the sample counts);
 *   - small-sample status is EXPLICIT: a cell with fewer samples than
 *     the definition's minSampleCount carries smallSample: true (the
 *     A035 verdict itself already fails closed to 'no-data');
 *   - aggregateSloRollups: the cross-tenant AGGREGATE endpoint view —
 *     cells below the small-sample threshold are SUPPRESSED (excluded
 *     from the aggregate, counted but never identified): a tenant's
 *     detail can never leak through an aggregate SLO endpoint.
 *
 * Deterministic: identical inputs yield identical rollups (no clock, no
 * randomness — all times injected).
 */

import { evaluateSlo } from '@arena/observability';
import type { MetricSignal, SloDefinition, SloEvaluation, SloVerdict } from '@arena/observability';

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';
import { DEFAULT_SMALL_SAMPLE_MIN, deepFreeze, isEnumMember, toTenantScope } from './shared.js';

/** Wire version of the SLO rollup shapes. */
export const SLO_ROLLUP_VERSION = 1 as const;

/** The closed rollup dimensions. */
export const SLO_ROLLUP_DIMENSIONS = Object.freeze([
  'capability',
  'tenant',
  'resource-class',
  'client-app',
] as const);
export type SloRollupDimension = (typeof SLO_ROLLUP_DIMENSIONS)[number];

export function isSloRollupDimension(value: unknown): value is SloRollupDimension {
  return isEnumMember(value, SLO_ROLLUP_DIMENSIONS);
}

/** The evaluation window of a rollup: [windowStart, windowEnd] epoch ms. */
export interface RollupWindow {
  readonly windowStart: number;
  readonly windowEnd: number;
}

/** One good/bad sample feeding a rollup. */
export interface SloRollupSample {
  /** Epoch ms — must fall inside the evaluation window. */
  readonly occurredAt: number;
  /** 1 = good escalation outcome, 0 = bad (the A035 good-total-ratio convention). */
  readonly good: boolean;
}

/** The disclosed formula of a rollup (carried as data, rendered verbatim). */
export interface SloRollupFormula {
  readonly sliKind: 'good-total-ratio';
  readonly metricName: string;
  readonly targetRatio: number;
  readonly windowMs: number;
  readonly minSampleCount: number;
  readonly statement: string;
}

/** The frozen dimensional SLO rollup view. */
export interface SloRollupView {
  readonly rollupVersion: typeof SLO_ROLLUP_VERSION;
  readonly dimension: SloRollupDimension;
  readonly key: string;
  readonly sloId: string;
  /** The A035 evaluation (verdict + error budget in the A035 vocabulary). */
  readonly evaluation: SloEvaluation;
  /** Explicit small-sample status (sampleCount < minSampleCount). */
  readonly smallSample: boolean;
  readonly formula: SloRollupFormula;
}

export interface RollupSloInput {
  readonly dimension: SloRollupDimension;
  /** The dimensional key (capability id, tenant scope, resource class...). */
  readonly key: string;
  readonly samples: readonly SloRollupSample[];
  /** [windowStart, windowEnd] epoch ms — duration must equal windowMs. */
  readonly window: RollupWindow;
  readonly targetRatio: number;
  readonly minSampleCount?: number;
  readonly atRiskThresholdRatio?: number;
}

function metricNameFor(dimension: SloRollupDimension, _key: string): string {
  // Neutral-id pattern is ^[a-z][a-z0-9-]{1,62}$ — the dimensional key
  // rides in the signal LABELS, never in the metric name.
  return `escalation-outcome-${dimension}`;
}

function sanitizeLabelValue(value: string): string {
  // LABEL_VALUE_PATTERN: ^[A-Za-z0-9][A-Za-z0-9._@:/-]{0,255}$ — replace
  // anything outside with '-' (deterministic sanitization).
  const sanitized = value.replace(/[^A-Za-z0-9._@:/-]/g, '-');
  return sanitized.length === 0 ? 'unknown' : sanitized.slice(0, 256);
}

function sloIdFor(dimension: SloRollupDimension, key: string): string {
  return `slo-escalation-${dimension}-${key}`;
}

/**
 * Roll escalation outcome samples up into one A035-vocabulary SLO view.
 * The evaluation runs through the REAL @arena/observability evaluator
 * (window-strict, no-data fail-closed, deterministic 1e-12 boundary).
 */
export function rollupSlo(input: RollupSloInput): SloRollupView {
  if (!isSloRollupDimension(input.dimension)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
      message: `unknown SLO rollup dimension: ${JSON.stringify(input.dimension)}`,
      details: { vocabulary: SLO_ROLLUP_DIMENSIONS },
    });
  }
  if (typeof input.key !== 'string' || input.key.length === 0 || input.key.length > 128) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
      message: `SLO rollup key must be a non-empty string (<= 128 chars): ${JSON.stringify(input.key)}`,
    });
  }
  const targetRatio = input.targetRatio;
  if (typeof targetRatio !== 'number' || targetRatio <= 0 || targetRatio >= 1) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
      message: `targetRatio must be strictly within (0, 1), got: ${String(targetRatio)}`,
    });
  }
  const minSampleCount = input.minSampleCount ?? DEFAULT_SMALL_SAMPLE_MIN;
  const atRiskThresholdRatio = input.atRiskThresholdRatio ?? 0.5;
  const windowMs = input.window.windowEnd - input.window.windowStart;
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
      message: 'evaluation window must be a positive integer span of milliseconds',
      details: { window: input.window },
    });
  }
  const metricName = metricNameFor(input.dimension, input.key);
  const labelKey = sanitizeLabelValue(input.key);
  const definition: SloDefinition = deepFreeze({
    definitionVersion: 1,
    sloId: sloIdFor(input.dimension, input.key),
    name: `Escalation outcome SLO (${input.dimension}: ${input.key})`,
    service: 'escalation-observability',
    sli: Object.freeze({
      kind: 'good-total-ratio',
      metricName,
      thresholdMs: null,
    }),
    targetRatio,
    windowMs,
    minSampleCount,
    atRiskThresholdRatio,
    description:
      'C021 rollup over escalation outcome samples (good-total-ratio); evaluated by the A035 engine (docs/operations/slo-targets.md policy)',
  }) as SloDefinition;

  const samples: MetricSignal[] = input.samples.map((sample, index) => {
    if (!Number.isSafeInteger(sample.occurredAt) || sample.occurredAt < 0) {
      throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
        message: `sample occurredAt must be epoch-ms integers >= 0, got: ${String(sample.occurredAt)}`,
      });
    }
    return Object.freeze({
      signalVersion: 1,
      kind: 'metric',
      signalId: `sig-${input.dimension}-${labelKey}-${index}`,
      sequence: index + 1,
      occurredAt: sample.occurredAt,
      sourceService: 'escalation-observability',
      correlationId: `corr-escalation-${input.dimension}`,
      causationId: null,
      tenantId: null,
      metricName,
      metricType: 'counter',
      unit: 'count',
      value: sample.good ? 1 : 0,
      labels: Object.freeze({ dimension: input.dimension, key: labelKey }),
    }) as unknown as MetricSignal;
  });
  // A035 requires samples ordered by occurredAt (OBS_SAMPLES_UNORDERED).
  samples.sort((a, b) => a.occurredAt - b.occurredAt);

  const evaluation = evaluateSlo({
    definition,
    window: input.window as unknown as Parameters<typeof evaluateSlo>[0]['window'],
    samples,
  });
  return deepFreeze({
    rollupVersion: SLO_ROLLUP_VERSION,
    dimension: input.dimension,
    key: input.key,
    sloId: definition.sloId,
    evaluation,
    smallSample: evaluation.sampleCount < minSampleCount,
    formula: deepFreeze({
      sliKind: 'good-total-ratio',
      metricName,
      targetRatio,
      windowMs,
      minSampleCount,
      statement: `achieved = good / total over the ${windowMs}ms window (good-total-ratio on '${metricName}'); error budget allowedBad = 1 - target; verdict per the A035 policy (met / at-risk / breached / no-data, no-data fails closed below ${minSampleCount} samples)`,
    }),
  } satisfies SloRollupView);
}

// ---------------------------------------------------------------------------
// Cross-tenant aggregate view (small-sample suppression)
// ---------------------------------------------------------------------------

/** The aggregate cross-tenant SLO view — detail-suppressed by design. */
export interface AggregateSloView {
  readonly rollupVersion: typeof SLO_ROLLUP_VERSION;
  readonly dimension: SloRollupDimension;
  readonly sloId: string;
  readonly evaluation: SloEvaluation;
  readonly formula: SloRollupFormula;
  /**
   * The number of contributing cells whose samples were SUPPRESSED
   * (below the small-sample threshold) — a COUNT, never an identity:
   * suppressed cells' keys/tenants are not disclosed.
   */
  readonly suppressedCellCount: number;
  readonly contributingCellCount: number;
}

export interface AggregateSloInput {
  readonly dimension: SloRollupDimension;
  /** The per-cell rollups to aggregate (typically per-tenant cells). */
  readonly cells: readonly SloRollupView[];
  readonly window: RollupWindow;
  readonly targetRatio: number;
  readonly minSampleCount?: number;
  readonly atRiskThresholdRatio?: number;
}

/**
 * Aggregate per-cell rollups into ONE cross-cell view. SUPPRESSION LAW:
 * every cell with fewer samples than the small-sample threshold is
 * EXCLUDED from the aggregate (its samples never blend in) and counted
 * ONLY as an anonymous count — a tenant's detail can never leak through
 * an aggregate SLO endpoint.
 */
export function aggregateSloRollups(input: AggregateSloInput): AggregateSloView {
  if (!isSloRollupDimension(input.dimension)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLO, {
      message: `unknown SLO rollup dimension: ${JSON.stringify(input.dimension)}`,
      details: { vocabulary: SLO_ROLLUP_DIMENSIONS },
    });
  }
  const minSampleCount = input.minSampleCount ?? DEFAULT_SMALL_SAMPLE_MIN;
  let contributing = 0;
  let suppressed = 0;
  const samples: SloRollupSample[] = [];
  for (const cell of input.cells) {
    if (cell.evaluation.sampleCount < minSampleCount) {
      suppressed += 1;
      continue;
    }
    contributing += 1;
    for (let good = 0; good < cell.evaluation.goodCount; good += 1) {
      samples.push({
        occurredAt: input.window.windowStart,
        good: true,
      });
    }
    for (let bad = 0; bad < cell.evaluation.badCount; bad += 1) {
      samples.push({
        occurredAt: input.window.windowStart,
        good: false,
      });
    }
  }
  const aggregate = rollupSlo({
    dimension: input.dimension,
    key: 'aggregate',
    samples,
    window: input.window,
    targetRatio: input.targetRatio,
    minSampleCount,
    ...(input.atRiskThresholdRatio !== undefined
      ? { atRiskThresholdRatio: input.atRiskThresholdRatio }
      : {}),
  });
  return deepFreeze({
    rollupVersion: SLO_ROLLUP_VERSION,
    dimension: input.dimension,
    sloId: aggregate.sloId,
    evaluation: aggregate.evaluation,
    formula: aggregate.formula,
    suppressedCellCount: suppressed,
    contributingCellCount: contributing,
  } satisfies AggregateSloView);
}

// ---------------------------------------------------------------------------
// Tenant-lens helper
// ---------------------------------------------------------------------------

/** Build the per-tenant rollup input view (tenant lens — domain-level scope). */
export function tenantSloRollupKey(tenant: string): string {
  return toTenantScope(tenant, 'tenant');
}

/** Re-export the A035 verdict vocabulary guard for consumers. */
export { isSloVerdictGuard as isSloVerdict };

function isSloVerdictGuard(value: unknown): value is SloVerdict {
  return (
    typeof value === 'string' &&
    ['met', 'at-risk', 'breached', 'no-data'].includes(value)
  );
}
