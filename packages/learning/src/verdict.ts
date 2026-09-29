/**
 * The CLOSED capability-lift verdict vocabulary (Work Order A020;
 * spec/quality-model.md Q1.0 "Capability lift"; requirement R16 -
 * "Measure whether interventions change target capability").
 *
 * Q1.0: "A learning intervention is successful only when:
 *   1. target capability improves on a pinned evaluation population;
 *   2. improvement survives a verification audit;
 *   3. evaluator/version changes are accounted for;
 *   4. regression on protected capabilities is measured;
 *   5. uncertainty/variance is reported where material."
 *
 * The verdict is a CLOSED VOCABULARY, NEVER A SCORE:
 *
 *   - `lift-demonstrated`        - ALL FIVE conditions hold;
 *   - `inconclusive-unless-controlled` - the evaluator or verifier
 *     version differs between arms (measurement validity is not
 *     established; spec LE1.0 "a changed evaluator score is not
 *     automatically a capability improvement");
 *   - `regression-detected`      - a protected capability regressed, or
 *     a declared outcome metric strictly regressed;
 *   - `not-demonstrated`         - conditions were evaluated but the
 *     lift is absent or a condition is unmet/unmeasured.
 *
 * Verdict precedence (DISCLOSED DESIGN DECISION): confounds outrank
 * everything (a confounded measurement can neither demonstrate lift
 * nor honestly attribute an apparent regression - the record still
 * carries every finding so nothing is silently absorbed); regression
 * outranks not-demonstrated (the safety signal must be visible).
 */

import type { VerificationRecord } from '@arena/verification';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import { expectEnumMember, deepFreeze } from './shared.js';
import type { ExperimentDescriptor } from './descriptor.js';
import type {
  MetricComparison,
  ProtectedCapabilityCheck,
  UncertaintyReport,
} from './comparison.js';
import type { AttributionResultView } from './attribution.js';

/** The closed verdict vocabulary - never a score. */
export const CAPABILITY_LIFT_VERDICTS = Object.freeze([
  'lift-demonstrated',
  'not-demonstrated',
  'inconclusive-unless-controlled',
  'regression-detected',
] as const);

export type CapabilityLiftVerdictKind = (typeof CAPABILITY_LIFT_VERDICTS)[number];

/** The five Q1.0 success-condition keys (closed field list). */
export const LIFT_CONDITION_FIELDS = Object.freeze([
  'pinnedPopulationImprovement',
  'survivesVerificationAudit',
  'evaluatorVersionChangesAccounted',
  'protectedCapabilityRegressionMeasured',
  'uncertaintyReported',
] as const);

export type LiftConditionField = (typeof LIFT_CONDITION_FIELDS)[number];

/** The five Q1.0 conditions, each explicitly evaluated (never implied). */
export interface LiftConditions {
  /** Q1.0 (1): every declared outcome metric strictly improves per its declared direction, on the pinned population. */
  readonly pinnedPopulationImprovement: boolean;
  /** Q1.0 (2): the intervention arm carries ≥1 verification and every one passes. */
  readonly survivesVerificationAudit: boolean;
  /** Q1.0 (3): no evaluator-version-confound and no verifier-version-confound between arms. */
  readonly evaluatorVersionChangesAccounted: boolean;
  /** Q1.0 (4): ≥1 protected capability declared AND every one measured in both arms. */
  readonly protectedCapabilityRegressionMeasured: boolean;
  /** Q1.0 (5): variance reported (non-null in both arms) for EVERY declared metric (conservative reading of "where material" - fails closed). */
  readonly uncertaintyReported: boolean;
}

/** Structural (non-throwing) check for the five conditions. */
export function isLiftConditions(value: unknown): value is LiftConditions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [...LIFT_CONDITION_FIELDS].every(
    (field) => typeof candidate[field] === 'boolean',
  );
}

/** Structural (non-throwing) check for a verdict kind. */
export function isCapabilityLiftVerdictKind(
  value: unknown,
): value is CapabilityLiftVerdictKind {
  return (
    typeof value === 'string' &&
    (CAPABILITY_LIFT_VERDICTS as readonly string[]).includes(value)
  );
}

/** Validating constructor - unknown verdicts are rejected loudly. */
export function toCapabilityLiftVerdictKind(
  value: string,
  context: string,
): CapabilityLiftVerdictKind {
  return expectEnumMember(
    value,
    CAPABILITY_LIFT_VERDICTS,
    'verdict',
    LEARNING_ERROR_CODES.INVALID_VERDICT,
    context,
  );
}

/** The frozen verdict value object: the kind plus the five conditions plus the machine-derived basis. */
export interface CapabilityLiftVerdict {
  readonly recordVersion: 1;
  readonly verdict: CapabilityLiftVerdictKind;
  readonly conditions: LiftConditions;
  /** Deterministic machine-derived basis (which conditions failed / which confounds fired). */
  readonly basis: string;
}

/** Structural (non-throwing) check for the full verdict object. */
export function isCapabilityLiftVerdict(value: unknown): value is CapabilityLiftVerdict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === 1 &&
    isCapabilityLiftVerdictKind(candidate['verdict']) &&
    isLiftConditions(candidate['conditions']) &&
    typeof candidate['basis'] === 'string' &&
    candidate['basis'].length > 0
  );
}

// ---------------------------------------------------------------------------
// The pure verdict computation (Q1.0 five conditions + precedence)
// ---------------------------------------------------------------------------

/**
 * Decide the capability-lift verdict (PURE - R16 "Measure whether
 * interventions change target capability").
 *
 * The five Q1.0 conditions are evaluated explicitly:
 *
 *   (1) pinnedPopulationImprovement - every declared outcome metric
 *       strictly improves per its declared direction;
 *   (2) survivesVerificationAudit - the intervention arm carries ≥1
 *       verification record and every one has outcome 'pass';
 *   (3) evaluatorVersionChangesAccounted - no evaluator-version-confound
 *       and no verifier-version-confound between arms;
 *   (4) protectedCapabilityRegressionMeasured - ≥1 protected capability
 *       declared and every one measured in both arms;
 *   (5) uncertaintyReported - variance reported (non-null in BOTH arms)
 *       for every declared metric (conservative reading of "where
 *       material": fails closed when unknown).
 *
 * Verdict precedence (disclosed design decision):
 *   confounds → `inconclusive-unless-controlled`; then regressions
 *   (protected OR outcome-metric) → `regression-detected`; then
 *   all-five-conditions → `lift-demonstrated`; else
 *   `not-demonstrated`.
 */
export function decideCapabilityLift(
  descriptor: ExperimentDescriptor,
  comparison: readonly MetricComparison[],
  uncertainty: UncertaintyReport,
  attribution: AttributionResultView,
  protectedChecks: readonly ProtectedCapabilityCheck[],
  interventionVerifications: readonly VerificationRecord[],
): CapabilityLiftVerdict {
  if (comparison.length === 0) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_VERDICT, {
      message: 'verdict computation requires at least one metric comparison (the experiment declares outcome metrics)',
    });
  }

  const evaluatorConfound = attribution.confounds.includes('evaluator-version-confound');
  const verifierConfound = attribution.confounds.includes('verifier-version-confound');

  const conditions: LiftConditions = {
    pinnedPopulationImprovement:
      comparison.length === descriptor.outcomeMetrics.length &&
      comparison.every((entry) => entry.improved),
    survivesVerificationAudit:
      interventionVerifications.length > 0 &&
      interventionVerifications.every((entry) => entry.outcome === 'pass'),
    evaluatorVersionChangesAccounted: !evaluatorConfound && !verifierConfound,
    protectedCapabilityRegressionMeasured:
      descriptor.protectedCapabilities.length > 0 &&
      protectedChecks.length === descriptor.protectedCapabilities.length &&
      protectedChecks.every((entry) => entry.measured),
    uncertaintyReported:
      uncertainty.entries.length >= descriptor.outcomeMetrics.length &&
      uncertainty.entries.every(
        (entry) => entry.baselineVariance !== null && entry.interventionVariance !== null,
      ),
  };

  const protectedRegressed = protectedChecks.some((entry) => entry.measured && entry.regressed);
  const metricRegressed = comparison.some((entry) => entry.regressed);

  let verdict: CapabilityLiftVerdictKind;
  let basis: string;
  if (evaluatorConfound || verifierConfound) {
    verdict = 'inconclusive-unless-controlled';
    basis = `measurement validity not established: ${attribution.confounds.join(', ')} (LE1.0: a changed evaluator score is not automatically a capability improvement)`;
  } else if (protectedRegressed || metricRegressed) {
    verdict = 'regression-detected';
    const regressedProtected = protectedChecks
      .filter((entry) => entry.measured && entry.regressed)
      .map((entry) => entry.capabilityRef as string);
    const regressedMetrics = comparison
      .filter((entry) => entry.regressed)
      .map((entry) => entry.metricId as string);
    basis = `regression detected${regressedProtected.length > 0 ? `; protected capabilities regressed: ${regressedProtected.join(', ')}` : ''}${regressedMetrics.length > 0 ? `; outcome metrics regressed: ${regressedMetrics.join(', ')}` : ''}`;
  } else if (
    conditions.pinnedPopulationImprovement &&
    conditions.survivesVerificationAudit &&
    conditions.evaluatorVersionChangesAccounted &&
    conditions.protectedCapabilityRegressionMeasured &&
    conditions.uncertaintyReported
  ) {
    verdict = 'lift-demonstrated';
    basis = 'all five Q1.0 conditions hold: pinned-population improvement, verification audit survived, evaluator/verifier versions accounted, protected-capability regression measured (none regressed), uncertainty reported';
  } else {
    verdict = 'not-demonstrated';
    const failed: string[] = [];
    for (const [field, holds] of Object.entries(conditions)) {
      if (holds !== true) failed.push(field);
    }
    basis = `capability lift not demonstrated; unmet Q1.0 condition(s): ${failed.join(', ')}`;
  }

  return deepFreeze({
    recordVersion: 1,
    verdict,
    conditions,
    basis,
  });
}
