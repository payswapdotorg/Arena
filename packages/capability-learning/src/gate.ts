/**
 * The Q1.0 CAPABILITY-LIFT ADOPTION GATE (Work Order C022;
 * spec/quality-model.md Q1.0 "Capability lift" — THE adoption law of
 * this work order).
 *
 * Q1.0: "A learning intervention is successful only when:
 *   1. target capability improves on a pinned evaluation population;
 *   2. improvement survives a verification audit;
 *   3. evaluator/version changes are accounted for;
 *   4. regression on protected capabilities is measured;
 *   5. uncertainty/variance is reported where material."
 *
 * The gate consumes the A020 ExperimentRunRecord of the program's
 * assembled experiment (A020 already evaluates the five conditions —
 * decideCapabilityLift; the gate ADOPTS on top of it) and emits a TYPED
 * CLOSED VERDICT, never a bare boolean:
 *
 *   - `adopted-with-evidence`        — the A020 verdict is
 *     'lift-demonstrated' AND the run record is bound to THIS program's
 *     experiment AND the compile boundary holds;
 *   - `rejected-with-reasons`        — machine-readable reasons from a
 *     closed vocabulary (verification audit not survived → fail-closed;
 *     evaluator/verifier version confounds — "a changed evaluator score
 *     is not automatically a capability improvement"; regressions;
 *     unmeasured protected capabilities; program/run binding mismatch);
 *   - `unknown-insufficient-sample`  — the ONLY unmet Q1.0 condition is
 *     uncertainty reporting and the run record's variances are
 *     missing/null — the sample cannot support a decision either way
 *     (honest unknown, NOT a rejection).
 *
 * Evaluator-change masquerading as capability lift is structurally
 * refused: the A020 'inconclusive-unless-controlled' verdict maps to
 * rejected-with-reasons carrying the evaluator/verifier confound
 * reasons, and the gate verdict records the attribution confounds it
 * observed.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  CAPABILITY_LIFT_VERDICTS,
  deepFreeze,
  isCapabilityLiftVerdict,
  isContentDigest,
  toContentDigest,
} from '@arena/learning';
import type { ContentDigest, ExperimentDescriptor, ExperimentRunRecord, LiftConditions } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { ImprovementProgram } from './program.js';
import { isImprovementProgram } from './program.js';
import type { ImprovementCandidate } from './candidate.js';
import { enforceCompilerBoundary, historicalDigestsOfCompilation } from './boundary.js';
import { assembleProgramExperiment } from './experiment.js';

/** Wire version of the adoption-gate verdict shape. */
export const ADOPTION_GATE_VERSION = 1 as const;

/** The closed adoption-gate verdict vocabulary (never a bare boolean). */
export const ADOPTION_GATE_VERDICTS = Object.freeze([
  'adopted-with-evidence',
  'rejected-with-reasons',
  'unknown-insufficient-sample',
] as const);
export type AdoptionGateVerdictKind = (typeof ADOPTION_GATE_VERDICTS)[number];

export function isAdoptionGateVerdictKind(value: unknown): value is AdoptionGateVerdictKind {
  return (
    typeof value === 'string' &&
    (ADOPTION_GATE_VERDICTS as readonly string[]).includes(value)
  );
}

/** The closed gate-reject reason vocabulary (machine-readable). */
export const ADOPTION_GATE_REJECT_REASONS = Object.freeze([
  'pinned-population-improvement-absent',
  'verification-audit-not-survived',
  'evaluator-version-confound',
  'verifier-version-confound',
  'protected-capability-regression',
  'outcome-metric-regression',
  'protected-capability-unmeasured',
  'uncertainty-not-reported',
  'program-experiment-mismatch',
  'boundary-violation',
] as const);
export type AdoptionGateRejectReason = (typeof ADOPTION_GATE_REJECT_REASONS)[number];

export function isAdoptionGateRejectReason(value: unknown): value is AdoptionGateRejectReason {
  return (
    typeof value === 'string' &&
    (ADOPTION_GATE_REJECT_REASONS as readonly string[]).includes(value)
  );
}

/** One measured metric lift (intervention vs baseline on the pinned population). */
export interface MeasuredLift {
  readonly metricId: string;
  readonly baselineValue: number;
  readonly interventionValue: number;
  readonly delta: number;
  readonly improved: boolean;
}

/** The digest-free gate verdict view — exactly what the digest commits to. */
export interface AdoptionGateVerdictView {
  readonly recordVersion: typeof ADOPTION_GATE_VERSION;
  readonly kind: AdoptionGateVerdictKind;
  readonly programRef: ContentDigest;
  /** The A020 run record digest the verdict was computed over. */
  readonly runRecordRef: ContentDigest;
  /** The A020 experiment descriptor digest the run executed. */
  readonly experimentRef: ContentDigest;
  /** The Q1.0 five conditions as evaluated by the A020 verdict (explicit, never implied). */
  readonly conditions: LiftConditions;
  /** The A020 capability-lift verdict kind this gate verdict derives from. */
  readonly experimentVerdict: string;
  /** Attribution confounds observed in the run record (surfaced, never absorbed). */
  readonly attributionConfounds: readonly string[];
  /** Machine-readable reject reasons (closed vocabulary; empty unless rejected). */
  readonly reasons: readonly AdoptionGateRejectReason[];
  /** The measured lift per declared outcome metric (empty when not measured). */
  readonly measuredLift: readonly MeasuredLift[];
  readonly basis: string;
}

/** A frozen, content-addressed adoption-gate verdict: the view plus its sha256 digest. */
export interface AdoptionGateVerdict extends AdoptionGateVerdictView {
  readonly digest: ContentDigest;
}

/** Stable field list for the gate verdict view. */
export const ADOPTION_GATE_VERDICT_FIELDS = Object.freeze([
  'recordVersion',
  'kind',
  'programRef',
  'runRecordRef',
  'experimentRef',
  'conditions',
  'experimentVerdict',
  'attributionConfounds',
  'reasons',
  'measuredLift',
  'basis',
] as const);

/** Structural (non-throwing) check for the digest-free gate verdict view. */
export function isAdoptionGateVerdictView(value: unknown): value is AdoptionGateVerdictView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === ADOPTION_GATE_VERSION &&
    isAdoptionGateVerdictKind(candidate['kind']) &&
    isContentDigest(candidate['programRef']) &&
    isContentDigest(candidate['runRecordRef']) &&
    isContentDigest(candidate['experimentRef']) &&
    typeof candidate['conditions'] === 'object' &&
    candidate['conditions'] !== null &&
    typeof candidate['experimentVerdict'] === 'string' &&
    (CAPABILITY_LIFT_VERDICTS as readonly string[]).includes(candidate['experimentVerdict']) &&
    Array.isArray(candidate['attributionConfounds']) &&
    Array.isArray(candidate['reasons']) &&
    (candidate['reasons'] as unknown[]).every((entry) => isAdoptionGateRejectReason(entry)) &&
    Array.isArray(candidate['measuredLift']) &&
    typeof candidate['basis'] === 'string' &&
    candidate['basis'].length > 0
  );
}

/** Structural (non-throwing) check for the full gate verdict (view + digest). */
export function isAdoptionGateVerdict(value: unknown): value is AdoptionGateVerdict {
  if (!isAdoptionGateVerdictView(value)) return false;
  return isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

export interface EvaluateAdoptionGateInput {
  /** The program seeking adoption. */
  readonly program: ImprovementProgram;
  /**
   * The A020 ExperimentDescriptor ASSEMBLED FROM THIS PROGRAM (the gate
   * re-derives it and compares digests — a run of a different program's
   * experiment can never adopt this program; cross-tenant replay of
   * another tenant's evidence is refused by the same binding).
   */
  readonly experiment: ExperimentDescriptor;
  /** The A020 run record of the experiment above. */
  readonly runRecord: ExperimentRunRecord;
  /** The candidates the program was compiled from (compile-boundary evidence). */
  readonly candidates: readonly ImprovementCandidate[];
}

/**
 * THE Q1.0 ADOPTION GATE: evaluate one program's improvement over its
 * A020 experiment run record. PURE: same program + same run record ⇒
 * same verdict. Emits a typed closed verdict — adopted-with-evidence /
 * rejected-with-reasons / unknown-insufficient-sample — NEVER a bare
 * boolean.
 */
export async function evaluateAdoptionGate(
  input: EvaluateAdoptionGateInput,
): Promise<AdoptionGateVerdict> {
  const record = input;
  if (!isImprovementProgram(record.program)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM, {
      message: 'adoption gate requires a validated ImprovementProgram',
    });
  }
  if (!isCapabilityLiftVerdict(record.runRecord.verdict)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_GATE_VERDICT, {
      message: 'adoption gate requires a structurally valid A020 CapabilityLiftVerdict on the run record',
    });
  }
  if (typeof (record.experiment as unknown as Record<string, unknown>)?.['digest'] !== 'string') {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_EXPERIMENT, {
      message: 'adoption gate requires the A020 ExperimentDescriptor assembled from this program (see assembleProgramExperiment)',
    });
  }
  const experimentRef = toContentDigest(
    record.experiment.digest as string,
    'adoption gate experimentRef',
  );

  const runVerdict = record.runRecord.verdict;
  const conditions = runVerdict.conditions;
  const confounds = [...(record.runRecord.attribution.confounds as readonly string[])];
  const measuredLift: MeasuredLift[] = (record.runRecord.comparison as readonly {
    metricId: string;
    baselineValue: number;
    interventionValue: number;
    delta: number;
    improved: boolean;
  }[]).map((entry) =>
    Object.freeze({
      metricId: entry.metricId,
      baselineValue: entry.baselineValue,
      interventionValue: entry.interventionValue,
      delta: entry.delta,
      improved: entry.improved,
    }),
  );

  const reasons: AdoptionGateRejectReason[] = [];
  let kind: AdoptionGateVerdictKind;
  let basis: string;

  // Program ↔ experiment binding: re-derive the experiment FROM THIS
  // PROGRAM and compare digests — a run of a different program's
  // experiment (including another tenant's replayed evidence) can never
  // adopt this program.
  const reassembled = await assembleProgramExperiment(record.program, {
    experimentId: record.experiment.experimentId as string,
    version: record.experiment.version as string,
  });
  const experimentBound =
    (reassembled.digest as string) === (record.experiment.digest as string) &&
    (experimentRef as string) === (record.runRecord.descriptorRef as string);

  // Compile boundary: the proposed artifact must be a NEW digest (LE1.0 wall).
  let boundaryOk = true;
  try {
    enforceCompilerBoundary(
      historicalDigestsOfCompilation(record.candidates),
      record.program,
    );
  } catch {
    boundaryOk = false;
  }

  if (!experimentBound) {
    reasons.push('program-experiment-mismatch');
  }
  if (!boundaryOk) {
    reasons.push('boundary-violation');
  }

  if (runVerdict.verdict === 'lift-demonstrated') {
    if (experimentBound && boundaryOk) {
      kind = 'adopted-with-evidence';
      basis = `all five Q1.0 conditions hold on the pinned evaluation population (A020 verdict ${JSON.stringify(runVerdict.verdict)}); verification audit survived; attribution confounds: none; measured lift on ${String(measuredLift.length)} metric(s); compile boundary verified against ${String(historicalDigestsOfCompilation(record.candidates).length)} historical digest(s)`;
    } else {
      kind = 'rejected-with-reasons';
      basis = `the experiment demonstrated lift, but the gate could not bind it to this program (${reasons.join(', ')}) — adoption refused (fail-closed)`;
    }
  } else if (runVerdict.verdict === 'inconclusive-unless-controlled') {
    kind = 'rejected-with-reasons';
    if (confounds.includes('evaluator-version-confound')) reasons.push('evaluator-version-confound');
    if (confounds.includes('verifier-version-confound')) reasons.push('verifier-version-confound');
    basis = `measurement validity not established: ${confounds.join(', ')} — a changed evaluator score is NOT automatically a capability improvement (LE1.0 attribution; Q1.0 condition 3)`;
  } else if (runVerdict.verdict === 'regression-detected') {
    kind = 'rejected-with-reasons';
    const regressedProtected = (record.runRecord.protectedCapabilityChecks as readonly {
      regressed: boolean;
      capabilityRef: string;
    }[]).filter((entry) => entry.regressed);
    if (regressedProtected.length > 0) reasons.push('protected-capability-regression');
    if (measuredLift.some((entry) => !entry.improved && entry.delta !== 0)) reasons.push('outcome-metric-regression');
    basis = `regression detected — adoption refused (Q1.0 conditions 1/4)`;
  } else {
    // not-demonstrated — decompose the unmet conditions into closed reasons.
    if (!conditions.pinnedPopulationImprovement) reasons.push('pinned-population-improvement-absent');
    if (!conditions.survivesVerificationAudit) reasons.push('verification-audit-not-survived');
    if (!conditions.evaluatorVersionChangesAccounted) {
      if (confounds.includes('evaluator-version-confound')) reasons.push('evaluator-version-confound');
      if (confounds.includes('verifier-version-confound')) reasons.push('verifier-version-confound');
    }
    if (!conditions.protectedCapabilityRegressionMeasured) reasons.push('protected-capability-unmeasured');
    const unmet = Object.entries(conditions).filter(([, holds]) => holds !== true).map(([field]) => field);

    const varianceKnown = (record.runRecord.uncertainty.entries as readonly {
      baselineVariance: number | null;
      interventionVariance: number | null;
    }[]).every(
      (entry) => entry.baselineVariance !== null && entry.interventionVariance !== null,
    );
    if (
      unmet.length === 1 &&
      unmet[0] === 'uncertaintyReported' &&
      !varianceKnown
    ) {
      kind = 'unknown-insufficient-sample';
      basis = 'the sample cannot support an adoption decision either way: variance is unreported/null for the declared metrics (Q1.0 condition 5) while every other condition holds — honest unknown, not a rejection';
    } else {
      kind = 'rejected-with-reasons';
      if (!conditions.uncertaintyReported && !reasons.includes('uncertainty-not-reported')) {
        reasons.push('uncertainty-not-reported');
      }
      basis = `capability lift not demonstrated; unmet Q1.0 condition(s): ${unmet.join(', ')}`;
    }
  }

  if (kind === 'rejected-with-reasons' && !experimentBound && !reasons.includes('program-experiment-mismatch')) {
    reasons.push('program-experiment-mismatch');
  }

  const view: AdoptionGateVerdictView = {
    recordVersion: ADOPTION_GATE_VERSION,
    kind,
    programRef: record.program.digest,
    runRecordRef: record.runRecord.digest,
    experimentRef,
    conditions: deepFreeze({ ...conditions }),
    experimentVerdict: runVerdict.verdict,
    attributionConfounds: Object.freeze([...confounds]),
    reasons: Object.freeze([...new Set(reasons)]),
    measuredLift: Object.freeze(measuredLift),
    basis,
  };
  const digest = toContentDigest(await digestCanonical(view), 'adoption gate verdict digest');
  return deepFreeze({ ...view, digest }) as AdoptionGateVerdict;
}

/** Strict re-parse of a gate verdict view (unknown members rejected). */
export function toAdoptionGateVerdictView(value: unknown): AdoptionGateVerdictView {
  if (!isAdoptionGateVerdictView(value)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_GATE_VERDICT, {
      message: 'adoption gate verdict parsing requires a structurally valid verdict view',
    });
  }
  return deepFreeze({ ...value }) as AdoptionGateVerdictView;
}
