/**
 * Shared test fixtures for @arena/capability-learning (internal, NOT
 * exported from the index — hygiene.test.ts asserts it).
 *
 * Deterministic candidates + hand-built structurally-valid A020 run
 * records (comparison / uncertainty / attribution / verdict views), so
 * the gate tests exercise the REAL createExperimentRunRecord
 * constructor without dragging in full arm-evidence fixtures.
 */

import { createExperimentRunRecord } from '@arena/learning';
import type {
  AttributionResultView,
  CapabilityLiftVerdict,
  ExperimentRunRecord,
  LiftConditions,
  MetricComparison,
  UncertaintyReport,
} from '@arena/learning';
import { createImprovementCandidate } from './candidate.js';
import type { CreateImprovementCandidateInput, ImprovementCandidate } from './candidate.js';

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';
export const DIGEST_F =
  '6666666666666666666666666666666666666666666666666666666666666666';
export const DIGEST_G =
  '7777777777777777777777777777777777777777777777777777777777777777';
export const DIGEST_H =
  '8888888888888888888888888888888888888888888888888888888888888888';

export const T0 = '2026-10-01T08:00:00.000Z';
export const T1 = '2026-10-01T08:00:01.000Z';

export const TARGET_CAPABILITY = Object.freeze({
  kind: 'capability',
  id: 'capability-reconciliation',
  version: '1.2.0',
  digest: DIGEST_F,
});
export const OTHER_TARGET_CAPABILITY = Object.freeze({
  kind: 'capability',
  id: 'capability-month-end-close',
  version: '2.0.0',
  digest: DIGEST_G,
});

export interface CandidateOverrides {
  readonly candidateId?: string;
  readonly tenantId?: string;
  readonly sourceKind?: string;
  readonly changedSurface?: string;
  readonly artifactDigest?: string;
  readonly supersedes?: string | null;
  readonly targetCapability?: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly evidenceRefs?: readonly string[];
  readonly rightsStatus?: string;
  readonly globalReuseRequested?: boolean;
}

export function makeCandidateInput(
  overrides: CandidateOverrides = {},
): CreateImprovementCandidateInput {
  return {
    candidateId: overrides.candidateId ?? 'candidate-reconciliation-0001',
    tenantId: overrides.tenantId ?? 'tenant-a',
    sourceKind: overrides.sourceKind ?? 'tool-gap-body-improvement-candidate',
    sourceRecordRef: overrides.evidenceRefs?.[0] ?? DIGEST_C,
    changedSurface: overrides.changedSurface ?? 'skills',
    artifact: {
      namespace: 'arena-skills',
      name: 'reconciliation-checklist-skill',
      version: '1.0.0',
      digest: overrides.artifactDigest ?? DIGEST_A,
    },
    supersedes: overrides.supersedes === undefined ? null : overrides.supersedes,
    targetCapability: { ...(overrides.targetCapability ?? TARGET_CAPABILITY) },
    baseline: { bodyRef: DIGEST_D, substrateRef: DIGEST_E, runtimeRef: null },
    experimentPlan: {
      taskPopulation: [{ taskId: 'task-reconciliation', version: '1.0.0' }],
      evaluationSuiteRefs: [DIGEST_A],
      verificationSuiteRefs: [DIGEST_F],
      environmentVersions: [
        { namespace: 'arena', name: 'erp-close-sandbox', version: '1.1.0', digest: DIGEST_B },
      ],
      outcomeMetrics: [
        {
          metricId: 'reconciliation-accuracy',
          description: 'fraction of ledger entries reconciled correctly',
          direction: 'higher-is-better',
        },
      ],
      uncertainty: { method: 'analytic-variance', notes: 'variance over the pinned population' },
      protectedCapabilities: [
        {
          ref: {
            kind: 'capability',
            id: 'capability-audit-trail',
            version: '1.0.0',
            digest: DIGEST_G,
          },
          metricId: 'audit-trail-completeness',
          direction: 'higher-is-better',
        },
      ],
    },
    evidenceRefs: overrides.evidenceRefs ?? [DIGEST_C, DIGEST_H],
    rights: {
      status: overrides.rightsStatus ?? 'granted-for-global-reuse',
      statement: 'expert session consent granted for global reuse (EES1.0 completion contract)',
    },
    globalReuseRequested: overrides.globalReuseRequested ?? true,
    provenance: { capturedFrom: 'capability-improvement', capturedAt: T0, notes: null },
  };
}

export async function makeCandidate(
  overrides: CandidateOverrides = {},
): Promise<ImprovementCandidate> {
  return createImprovementCandidate(makeCandidateInput(overrides));
}

// ---------------------------------------------------------------------------
// Hand-built A020 run record views (structurally valid)
// ---------------------------------------------------------------------------

export interface RunRecordFixtureOptions {
  readonly descriptorRef?: string;
  readonly verdictKind?: 'lift-demonstrated' | 'not-demonstrated' | 'inconclusive-unless-controlled' | 'regression-detected';
  readonly conditions?: Partial<LiftConditions>;
  readonly confounds?: readonly string[];
  readonly baselineValue?: number;
  readonly interventionValue?: number;
  readonly variance?: number | null;
  readonly protectedRegressed?: boolean;
  readonly protectedMeasured?: boolean;
  readonly experimentKey?: string;
}

function makeComparison(
  baselineValue: number,
  interventionValue: number,
): MetricComparison {
  const delta = interventionValue - baselineValue;
  return {
    metricId: 'reconciliation-accuracy',
    direction: 'higher-is-better',
    baselineValue,
    interventionValue,
    delta,
    improved: delta > 0,
    regressed: delta < 0,
  } as unknown as MetricComparison;
}

function makeUncertainty(variance: number | null): UncertaintyReport {
  return {
    method: 'analytic-variance',
    entries: [
      { metricId: 'reconciliation-accuracy', baselineVariance: variance, interventionVariance: variance },
    ],
  } as unknown as UncertaintyReport;
}

function makeAttribution(confounds: readonly string[]): AttributionResultView {
  const finding = (source: string, status: string, basis: string) =>
    ({ source, status, basis }) as AttributionResultView['findings'][number];
  const detected = (source: string) => confounds.includes(`${source}-version-confound`);
  return {
    recordVersion: 1,
    findings: [
      finding('substrate', 'not-indicated', 'no declared substrate surface and identical substrate digests'),
      finding('body', 'declared-intervention', 'intervention declares a body surface'),
      finding('environment', 'not-indicated', 'no declared environment surface and identical environment digests'),
      finding(
        'evaluator-change',
        detected('evaluator') ? 'detected-version-difference' : 'not-indicated',
        detected('evaluator')
          ? 'evaluator digests differ between arms - the observed score change is NOT automatically a capability improvement'
          : 'identical evaluator digests across arms',
      ),
      finding(
        'verifier-change',
        detected('verifier') ? 'detected-version-difference' : 'not-indicated',
        detected('verifier')
          ? 'verifier digests differ between arms - the verification audit outcome is not comparable across arms'
          : 'identical verifier digests across arms',
      ),
      finding('sampling-measurement-variance', 'within-measurement-variance', 'variance reported for 1 metric'),
    ],
    confounds: confounds as unknown as AttributionResultView['confounds'],
    evaluatorDigestsBaseline: [DIGEST_A],
    evaluatorDigestsIntervention: confounds.includes('evaluator-version-confound')
      ? [DIGEST_B]
      : [DIGEST_A],
    verifierDigestsBaseline: [DIGEST_F],
    verifierDigestsIntervention: confounds.includes('verifier-version-confound')
      ? [DIGEST_H]
      : [DIGEST_F],
    basis: confounds.length > 0 ? `confounds: ${confounds.join(', ')}` : 'no evaluator/verifier version confounds between arms',
  } as unknown as AttributionResultView;
}

export async function makeRunRecord(
  options: RunRecordFixtureOptions = {},
): Promise<ExperimentRunRecord> {
  const baselineValue = options.baselineValue ?? 0.8;
  const interventionValue = options.interventionValue ?? 0.9;
  const verdictKind = options.verdictKind ?? 'lift-demonstrated';
  const conditions: LiftConditions = {
    pinnedPopulationImprovement: options.conditions?.pinnedPopulationImprovement ?? (interventionValue > baselineValue),
    survivesVerificationAudit: options.conditions?.survivesVerificationAudit ?? true,
    evaluatorVersionChangesAccounted: options.conditions?.evaluatorVersionChangesAccounted ?? (options.confounds ?? []).length === 0,
    protectedCapabilityRegressionMeasured: options.conditions?.protectedCapabilityRegressionMeasured ?? true,
    uncertaintyReported: options.conditions?.uncertaintyReported ?? (options.variance !== null && options.variance !== undefined ? true : false),
  };
  const verdict: CapabilityLiftVerdict = {
    recordVersion: 1,
    verdict: verdictKind,
    conditions,
    basis: `fixture verdict ${verdictKind}`,
  } as unknown as CapabilityLiftVerdict;
  const variance = options.variance === undefined ? 0.01 : options.variance;
  const input = {
    experimentKey: options.experimentKey ?? 'idem-cl-fixture-0001',
    correlationId: 'corr-cl-fixture',
    descriptorRef: options.descriptorRef ?? DIGEST_C,
    baseline: { trajectories: [DIGEST_A], evaluations: [DIGEST_B], verifications: [DIGEST_F] },
    intervention: { trajectories: [DIGEST_D], evaluations: [DIGEST_E], verifications: [DIGEST_H] },
    baselineMetrics: [{ metricId: 'reconciliation-accuracy', value: baselineValue, variance }],
    interventionMetrics: [{ metricId: 'reconciliation-accuracy', value: interventionValue, variance }],
    comparison: [makeComparison(baselineValue, interventionValue)],
    uncertainty: makeUncertainty(variance),
    protectedCapabilityChecks: [
      {
        capabilityRef: DIGEST_G,
        metricId: 'audit-trail-completeness',
        direction: 'higher-is-better',
        baselineValue: 0.9,
        interventionValue: options.protectedRegressed ? 0.5 : 0.95,
        delta: options.protectedRegressed ? -0.4 : 0.05,
        regressed: options.protectedRegressed ?? false,
        measured: options.protectedMeasured ?? true,
      },
    ],
    attribution: makeAttribution(options.confounds ?? []),
    verdict,
    provenance: { executedBy: 'arena-capability-learning-test', recordedAt: T1, notes: null },
  };
  // Branded types are compile-time only; the REAL constructor validates
  // structure at runtime — cast the fixture input across the brand.
  return createExperimentRunRecord(input as unknown as Parameters<typeof createExperimentRunRecord>[0]);
}
