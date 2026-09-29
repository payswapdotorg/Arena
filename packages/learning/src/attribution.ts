/**
 * The PURE attribution computation of a learning experiment (Work Order
 * A020; spec LE1.0 "Attribution"; requirement R16).
 *
 * LE1.0: "Distinguish: substrate improvement; Body improvement;
 * environment improvement; evaluator changes; verifier changes;
 * sampling/measurement variance. **A changed evaluator score is not
 * automatically a capability improvement.**"
 *
 * The observed delta is classified BY SOURCE from two evidence bases:
 *
 *   1. the DECLARED intervention surfaces (the LE1.0 nine, mapped to
 *      sources - see intervention-surface.ts for the disclosed mapping);
 *   2. the VERSION DIGESTS the arm records actually carry: evaluator
 *      digests (A012 records' evaluatorRef), verifier digests (A013
 *      records' verifierRef), substrate/body digests and environment
 *      digests (A011 trajectory headers).
 *
 * THE KEY RULE (spec-verbatim): when the evaluator or verifier version
 * digests DIFFER between the baseline and intervention arms, the
 * attribution MUST flag `evaluator-version-confound` /
 * `verifier-version-confound`. Confounds are SURFACED in the result -
 * never silently absorbed - and the capability-lift verdict reacts
 * (`inconclusive-unless-controlled`; see verdict computation and the
 * negative/adversarial tests).
 */

import type { TrajectoryRecord } from '@arena/trajectory';
import type { EvaluationRecord } from '@arena/evaluation';
import type { VerificationRecord } from '@arena/verification';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import {
  ATTRIBUTION_SOURCES,
  ATTRIBUTION_CONFOUNDS,
  toAttributionConfound,
  toAttributionFindingStatus,
  toAttributionSource,
} from './attribution-source.js';
import type {
  AttributionConfound,
  AttributionFindingStatus,
  AttributionSource,
} from './attribution-source.js';
import { SURFACE_TO_ATTRIBUTION_SOURCES } from './intervention-surface.js';
import type { InterventionSurface } from './intervention-surface.js';
import type { ExperimentDescriptor } from './descriptor.js';
import { deepFreeze, isNeutralText, toNeutralText } from './shared.js';
import type { NeutralText } from './shared.js';
import type { MetricComparison, UncertaintyReport } from './comparison.js';

/** Wire version of the attribution-result shape. */
export const ATTRIBUTION_RESULT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Arm evidence (read-only over historical records - lock rule 6)
// ---------------------------------------------------------------------------

/**
 * The evidence bundle of one experiment arm: the REAL A011 / A012 /
 * A013 records the comparison ran over. Attribution is READ-ONLY over
 * these records (historical evidence is append-only and never
 * rewritten by learning); it extracts version digests, never mutates
 * content.
 */
export interface ArmEvidence {
  readonly trajectories: readonly TrajectoryRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly verifications: readonly VerificationRecord[];
}

/** Stable field list for arm evidence. */
export const ARM_EVIDENCE_FIELDS = Object.freeze([
  'trajectories',
  'evaluations',
  'verifications',
] as const);

// ---------------------------------------------------------------------------
// Findings and the result
// ---------------------------------------------------------------------------

/** One attribution finding: a source, its closed status, and the deterministic basis. */
export interface AttributionFinding {
  readonly source: AttributionSource;
  readonly status: AttributionFindingStatus;
  readonly basis: NeutralText;
}

/** Stable field list for findings. */
export const ATTRIBUTION_FINDING_FIELDS = Object.freeze(['source', 'status', 'basis'] as const);

export function isAttributionFinding(value: unknown): value is AttributionFinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['source'] === 'string' &&
    (ATTRIBUTION_SOURCES as readonly string[]).includes(candidate['source']) &&
    typeof candidate['status'] === 'string' &&
    (['declared-intervention', 'detected-version-difference', 'within-measurement-variance', 'not-indicated'] as const as readonly string[]).includes(candidate['status']) &&
    isNeutralText(candidate['basis'])
  );
}

/** The structured attribution result of one experiment run. */
export interface AttributionResultView {
  readonly recordVersion: typeof ATTRIBUTION_RESULT_VERSION;
  /** One finding per LE1.0 source (all six, in canonical order). */
  readonly findings: readonly AttributionFinding[];
  /** The surfaced measurement-validity confounds (empty when none). */
  readonly confounds: readonly AttributionConfound[];
  /** Evaluator descriptor digests observed in the baseline arm (sorted). */
  readonly evaluatorDigestsBaseline: readonly string[];
  /** Evaluator descriptor digests observed in the intervention arm (sorted). */
  readonly evaluatorDigestsIntervention: readonly string[];
  /** Verifier descriptor digests observed in the baseline arm (sorted). */
  readonly verifierDigestsBaseline: readonly string[];
  /** Verifier descriptor digests observed in the intervention arm (sorted). */
  readonly verifierDigestsIntervention: readonly string[];
  /** Deterministic machine-derived summary. */
  readonly basis: NeutralText;
}

/** Stable field list for the attribution result view. */
export const ATTRIBUTION_RESULT_FIELDS = Object.freeze([
  'recordVersion',
  'findings',
  'confounds',
  'evaluatorDigestsBaseline',
  'evaluatorDigestsIntervention',
  'verifierDigestsBaseline',
  'verifierDigestsIntervention',
  'basis',
] as const);

export function isAttributionResultView(value: unknown): value is AttributionResultView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === ATTRIBUTION_RESULT_VERSION &&
    Array.isArray(candidate['findings']) &&
    (candidate['findings'] as unknown[]).length === ATTRIBUTION_SOURCES.length &&
    (candidate['findings'] as unknown[]).every((entry) => isAttributionFinding(entry)) &&
    Array.isArray(candidate['confounds']) &&
    (candidate['confounds'] as unknown[]).every((entry) =>
      (ATTRIBUTION_CONFOUNDS as readonly string[]).includes(entry as string),
    ) &&
    Array.isArray(candidate['evaluatorDigestsBaseline']) &&
    Array.isArray(candidate['evaluatorDigestsIntervention']) &&
    Array.isArray(candidate['verifierDigestsBaseline']) &&
    Array.isArray(candidate['verifierDigestsIntervention']) &&
    isNeutralText(candidate['basis'])
  );
}

// ---------------------------------------------------------------------------
// Digest projections over arm evidence (READ-ONLY)
// ---------------------------------------------------------------------------

/** The unique sorted evaluator descriptor digests observed in one arm's evaluation records. */
export function armEvaluatorDigests(arm: ArmEvidence): readonly string[] {
  return Object.freeze(
    [...new Set(arm.evaluations.map((entry) => entry.evaluatorRef as string))].sort(),
  );
}

/** The unique sorted verifier descriptor digests observed in one arm's verification records. */
export function armVerifierDigests(arm: ArmEvidence): readonly string[] {
  return Object.freeze(
    [...new Set(arm.verifications.map((entry) => entry.verifierRef as string))].sort(),
  );
}

/** The unique sorted substrate digests observed in one arm's trajectory headers. */
export function armSubstrateDigests(arm: ArmEvidence): readonly string[] {
  return Object.freeze(
    [...new Set(arm.trajectories.map((entry) => entry.header.substrateRef as string))].sort(),
  );
}

/** The unique sorted agent-body digests observed in one arm's trajectory headers. */
export function armBodyDigests(arm: ArmEvidence): readonly string[] {
  return Object.freeze(
    [...new Set(arm.trajectories.map((entry) => entry.header.agentBodyRef as string))].sort(),
  );
}

/** The unique sorted environment digests observed in one arm's trajectory headers. */
export function armEnvironmentDigests(arm: ArmEvidence): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        arm.trajectories.map(
          (entry) => entry.header.run.environmentVersion.digest as string,
        ),
      ),
    ].sort(),
  );
}

function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

// ---------------------------------------------------------------------------
// The pure computation
// ---------------------------------------------------------------------------

interface FindingDraft {
  readonly source: AttributionSource;
  readonly status: AttributionFindingStatus;
  readonly basis: string;
}

function finalizeFinding(draft: FindingDraft): AttributionFinding {
  return deepFreeze({
    source: toAttributionSource(draft.source, 'attribution finding'),
    status: toAttributionFindingStatus(draft.status, 'attribution finding'),
    basis: toNeutralText(draft.basis, 'attribution finding basis'),
  });
}

/**
 * Compute the attribution of one experiment run. PURE: same descriptor
 * + same arm evidence + same uncertainty ⇒ same result. Confounds are
 * flagged (never absorbed) whenever the evaluator or verifier version
 * digests differ between arms.
 */
export function attributeExperiment(
  descriptor: ExperimentDescriptor,
  baselineArm: ArmEvidence,
  interventionArm: ArmEvidence,
  uncertainty?: UncertaintyReport,
): AttributionResultView {
  const declaredSurfaces = descriptor.interventions.map(
    (entry) => entry.changedSurface as InterventionSurface,
  );
  const declaredSources = new Set<string>();
  for (const surface of declaredSurfaces) {
    for (const source of SURFACE_TO_ATTRIBUTION_SOURCES[surface]) {
      declaredSources.add(source);
    }
  }

  const evaluatorBaseline = armEvaluatorDigests(baselineArm);
  const evaluatorIntervention = armEvaluatorDigests(interventionArm);
  const verifierBaseline = armVerifierDigests(baselineArm);
  const verifierIntervention = armVerifierDigests(interventionArm);
  const substrateBaseline = armSubstrateDigests(baselineArm);
  const substrateIntervention = armSubstrateDigests(interventionArm);
  const bodyBaseline = armBodyDigests(baselineArm);
  const bodyIntervention = armBodyDigests(interventionArm);
  const environmentBaseline = armEnvironmentDigests(baselineArm);
  const environmentIntervention = armEnvironmentDigests(interventionArm);

  const evaluatorConfound = !setsEqual(evaluatorBaseline, evaluatorIntervention);
  const verifierConfound = !setsEqual(verifierBaseline, verifierIntervention);

  const confounds: AttributionConfound[] = [];
  if (evaluatorConfound) {
    confounds.push(toAttributionConfound('evaluator-version-confound', 'attribution confounds'));
  }
  if (verifierConfound) {
    confounds.push(toAttributionConfound('verifier-version-confound', 'attribution confounds'));
  }

  const findings: FindingDraft[] = [];

  // substrate
  {
    const declared = declaredSources.has('substrate');
    const detected = !setsEqual(substrateBaseline, substrateIntervention);
    findings.push({
      source: 'substrate',
      status: declared
        ? 'declared-intervention'
        : detected
          ? 'detected-version-difference'
          : 'not-indicated',
      basis: declared
        ? `intervention declares a substrate/model-specific-adaptation surface${detected ? `; substrate digests also differ between arms (${JSON.stringify(substrateBaseline)} -> ${JSON.stringify(substrateIntervention)})` : ''}`
        : detected
          ? `substrate digests differ between arms without a declared substrate surface (${JSON.stringify(substrateBaseline)} -> ${JSON.stringify(substrateIntervention)})`
          : 'no declared substrate surface and identical substrate digests across arms',
    });
  }

  // body
  {
    const declared = declaredSources.has('body');
    const detected = !setsEqual(bodyBaseline, bodyIntervention);
    findings.push({
      source: 'body',
      status: declared
        ? 'declared-intervention'
        : detected
          ? 'detected-version-difference'
          : 'not-indicated',
      basis: declared
        ? `intervention declares a body-composition/skills/procedures/retrieval-knowledge/memory-policy surface${detected ? `; body digests also differ between arms (${JSON.stringify(bodyBaseline)} -> ${JSON.stringify(bodyIntervention)})` : ''}`
        : detected
          ? `body digests differ between arms without a declared body surface (${JSON.stringify(bodyBaseline)} -> ${JSON.stringify(bodyIntervention)})`
          : 'no declared body surface and identical body digests across arms',
    });
  }

  // environment
  {
    const declared = declaredSources.has('environment');
    const detected = !setsEqual(environmentBaseline, environmentIntervention);
    findings.push({
      source: 'environment',
      status: declared
        ? 'declared-intervention'
        : detected
          ? 'detected-version-difference'
          : 'not-indicated',
      basis: declared
        ? `intervention declares a tool-configuration surface${detected ? `; environment digests also differ between arms (${JSON.stringify(environmentBaseline)} -> ${JSON.stringify(environmentIntervention)})` : ''}`
        : detected
          ? `environment digests differ between arms without a declared environment surface (${JSON.stringify(environmentBaseline)} -> ${JSON.stringify(environmentIntervention)})`
          : 'no declared environment surface and identical environment digests across arms',
    });
  }

  // evaluator-change
  {
    const declared = declaredSources.has('evaluator-change');
    findings.push({
      source: 'evaluator-change',
      status: evaluatorConfound
        ? 'detected-version-difference'
        : declared
          ? 'declared-intervention'
          : 'not-indicated',
      basis: evaluatorConfound
        ? `evaluator digests differ between arms (${JSON.stringify(evaluatorBaseline)} -> ${JSON.stringify(evaluatorIntervention)}) - the observed score change is NOT automatically a capability improvement; verdict is inconclusive unless controlled`
        : declared
          ? 'intervention declares an evaluator-verifier surface, but the measurement instruments are identical across arms (controlled measurement)'
          : 'identical evaluator digests across arms',
    });
  }

  // verifier-change
  {
    const declared = declaredSources.has('verifier-change');
    findings.push({
      source: 'verifier-change',
      status: verifierConfound
        ? 'detected-version-difference'
        : declared
          ? 'declared-intervention'
          : 'not-indicated',
      basis: verifierConfound
        ? `verifier digests differ between arms (${JSON.stringify(verifierBaseline)} -> ${JSON.stringify(verifierIntervention)}) - the verification audit outcome is not comparable across arms; verdict is inconclusive unless controlled`
        : declared
          ? 'intervention declares an evaluator-verifier surface, but the verification instruments are identical across arms (controlled measurement)'
          : 'identical verifier digests across arms',
    });
  }

  // sampling-measurement-variance
  {
    const noiseCovered = uncertainty !== undefined && uncertainty.entries.length > 0;
    findings.push({
      source: 'sampling-measurement-variance',
      status: noiseCovered ? 'within-measurement-variance' : 'not-indicated',
      basis: noiseCovered
        ? `variance reported for ${String(uncertainty?.entries.length ?? 0)} metric(s) (method ${JSON.stringify(uncertainty?.method)}); deltas within the reported variance bound remain attributable to sampling/measurement noise rather than capability change`
        : 'no variance reported - sampling/measurement variance is not indicated',
    });
  }

  const basisParts: string[] = [];
  if (confounds.length > 0) {
    basisParts.push(`confounds: ${confounds.join(', ')}`);
  } else {
    basisParts.push('no evaluator/verifier version confounds between arms');
  }
  const declaredList = [...declaredSources].sort();
  basisParts.push(
    declaredList.length > 0
      ? `declared intervention sources: ${declaredList.join(', ')}`
      : 'no improvement sources declared by the intervention surfaces',
  );

  const view: AttributionResultView = {
    recordVersion: ATTRIBUTION_RESULT_VERSION,
    findings: Object.freeze(findings.map((draft) => finalizeFinding(draft))),
    confounds: Object.freeze([...confounds]),
    evaluatorDigestsBaseline: evaluatorBaseline,
    evaluatorDigestsIntervention: evaluatorIntervention,
    verifierDigestsBaseline: verifierBaseline,
    verifierDigestsIntervention: verifierIntervention,
    basis: toNeutralText(basisParts.join('; '), 'attribution basis'),
  };
  return deepFreeze(view);
}

function varianceBound(baselineVariance: number, interventionVariance: number): number {
  return Math.abs(baselineVariance) + Math.abs(interventionVariance);
}

/**
 * True iff any metric comparison's |delta| is within the reported
 * variance bound for that metric (the delta is statistically
 * indistinguishable from sampling/measurement noise). Used by the
 * run-record construction to cross-link the attribution's
 * sampling-measurement-variance finding with concrete metrics.
 */
export function deltaWithinVariance(
  comparison: MetricComparison,
  uncertainty: UncertaintyReport,
): boolean {
  const entry = uncertainty.entries.find(
    (candidate) => (candidate.metricId as string) === (comparison.metricId as string),
  );
  if (entry === undefined) return false;
  if (entry.baselineVariance === null || entry.interventionVariance === null) {
    return false;
  }
  return (
    Math.abs(comparison.delta) <=
    varianceBound(entry.baselineVariance, entry.interventionVariance)
  );
}

/** Parse a wire attribution result strictly (unknown members rejected). */
export function toAttributionResultView(value: unknown): AttributionResultView {
  if (!isAttributionResultView(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_ATTRIBUTION, {
      message: 'attribution result parsing requires a structurally valid attribution result view',
    });
  }
  return deepFreeze({ ...value }) as AttributionResultView;
}
