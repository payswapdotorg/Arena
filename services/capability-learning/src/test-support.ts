/**
 * Shared test fixtures for @arena/capability-learning-service (internal,
 * NOT part of the public surface — hygiene.test.ts asserts it).
 *
 * Self-contained REAL fixtures: A011 trajectories, A012 evaluation
 * records and A013 verification records built through their OWN
 * packages (test-only imports), plus improvement-candidate inputs for
 * the compiler ingestion seam.
 */

import {
  createTrajectoryHeader,
  appendTrajectoryEntry,
  createTrajectoryRecord,
} from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluationRecord } from '@arena/evaluation';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import type { ExperimentArmInput } from './ports.js';

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

export const T0 = '2026-10-08T08:00:00.000Z';
export const T1 = '2026-10-08T08:00:01.000Z';
export const T2 = '2026-10-08T08:00:02.000Z';
export const T3 = '2026-10-08T08:00:03.000Z';
export const T4 = '2026-10-08T08:00:04.000Z';
export const T5 = '2026-10-08T08:00:05.000Z';
export const T6 = '2026-10-08T08:00:06.000Z';

export const TARGET_CAPABILITY = Object.freeze({
  kind: 'capability',
  id: 'capability-reconciliation',
  version: '1.2.0',
  digest: DIGEST_F,
});
export const PROTECTED_CAPABILITY = Object.freeze({
  kind: 'capability',
  id: 'capability-audit-trail',
  version: '1.0.0',
  digest: DIGEST_G,
});

export interface CandidateInputOverrides {
  readonly candidateId?: string;
  readonly tenantId?: string;
  readonly changedSurface?: string;
  readonly artifactDigest?: string;
  readonly rightsStatus?: string;
  readonly globalReuseRequested?: boolean;
}

/** A candidate input matching the compiler's plan (eval suite DIGEST_A, metric 'reconciliation-accuracy'). */
export function makeCandidateInput(overrides: CandidateInputOverrides = {}) {
  return {
    candidateId: overrides.candidateId ?? 'candidate-reconciliation-0001',
    tenantId: overrides.tenantId ?? 'tenant-a',
    sourceKind: 'tool-gap-body-improvement-candidate',
    sourceRecordRef: DIGEST_C,
    changedSurface: overrides.changedSurface ?? 'skills',
    artifact: {
      namespace: 'arena-skills',
      name: 'reconciliation-checklist-skill',
      version: '1.0.0',
      digest: overrides.artifactDigest ?? DIGEST_A,
    },
    supersedes: null,
    targetCapability: { ...TARGET_CAPABILITY },
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
          ref: { ...PROTECTED_CAPABILITY },
          metricId: 'audit-trail-completeness',
          direction: 'higher-is-better',
        },
      ],
    },
    evidenceRefs: [DIGEST_C, DIGEST_H],
    rights: {
      status: overrides.rightsStatus ?? 'granted-for-global-reuse',
      statement: 'expert session consent granted for global reuse (EES1.0 completion contract)',
    },
    globalReuseRequested: overrides.globalReuseRequested ?? true,
    provenance: { capturedFrom: 'capability-improvement', capturedAt: T0, notes: null },
  } as const;
}

// ---------------------------------------------------------------------------
// REAL A011/A012/A013 arm fixtures (through their own packages)
// ---------------------------------------------------------------------------

export interface TrajectoryOverrides {
  readonly trajectoryId?: string;
  readonly runId?: string;
}

export async function makeTrajectoryRecord(overrides: TrajectoryOverrides = {}) {
  const trajectoryId = overrides.trajectoryId ?? 'trajectory-cl-0001';
  const header = await createTrajectoryHeader({
    trajectoryId,
    run: {
      taskVersion: { taskId: 'task-reconciliation', version: '1.0.0' },
      environmentVersion: {
        namespace: 'arena',
        name: 'erp-close-sandbox',
        version: '1.1.0',
        digest: DIGEST_B,
      },
      runId: overrides.runId ?? 'tenant-a/run-cl-0001',
      initialSnapshotDigest: DIGEST_C,
      runRecordDigest: DIGEST_D,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: T0,
    seed: 'seed-cl-0001',
  });
  let record = createTrajectoryRecord(header);
  let sequence = 0;
  for (const actionId of ['fetch-ledger', 'reconcile-entries', 'emit-report']) {
    sequence += 1;
    record = await appendTrajectoryEntry(record, {
      sequence,
      kind: 'action',
      payload: { actionId, input: { source: 'erp' } },
      occurredAt: T1,
    });
  }
  sequence += 1;
  record = await appendTrajectoryEntry(record, {
    sequence,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [DIGEST_A] },
    occurredAt: T2,
  });
  return record;
}

export interface EvaluationOverrides {
  readonly evaluatorRef?: string;
}

export async function makeEvaluationRecord(
  trajectoryChainHead: string,
  overrides: EvaluationOverrides = {},
) {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-cl',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 2,
        description: 'the run completed the reconciliation correctly',
        targetRef: DIGEST_F,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
  return createEvaluationRecord(
    {
      evaluatorRef: overrides.evaluatorRef ?? DIGEST_A,
      caseRef: DIGEST_C,
      trajectoryRef: trajectoryChainHead,
      criteriaRef: criteria.digest,
      seed: 'seed-cl-eval',
      verdicts: [{ criterionId: 'criterion-001', score: 1, judgment: null, notes: null }],
      confidence: 0.9,
      limitations: null,
      startedAt: T3,
      finishedAt: T4,
      provenance: { executedBy: 'eval-cl-0001', recordedAt: T4, notes: null },
    },
    criteria,
  );
}

export interface VerificationOverrides {
  readonly mode?: 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate';
}

let verificationCounter = 0;

export async function makeVerificationRecord(
  trajectoryChainHead: string,
  overrides: VerificationOverrides = {},
): Promise<VerificationRecord> {
  verificationCounter += 1;
  const trajectoryArtifact = {
    namespace: 'arena-traj',
    name: `trajectory-cl-${String(verificationCounter).padStart(4, '0')}`,
    version: '1.0.0',
    digest: trajectoryChainHead,
  };
  const descriptor: VerifierDescriptor = await createVerifierDescriptor({
    verifierId: 'verifier-cl-0001',
    version: '1.0.0',
    method: 'evidence_provenance_validation',
    requiredEvidence: [
      {
        requirementId: 'requirement-001',
        evidenceKind: 'trajectory',
        claim: 'the trajectory is present, digest-verified and provenance-valid',
        artifact: null,
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'the trajectory evidence is present, verified and supports the claim',
      fail: 'verified trajectory evidence contradicts the claim',
      unknown: 'the trajectory evidence cannot be decided',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: null },
  });
  const mode = overrides.mode ?? 'pass';
  const supportStatus =
    mode === 'pass'
      ? 'present-supported'
      : mode === 'fail'
        ? 'present-unsupported'
        : mode === 'unknown-missing'
          ? 'missing'
          : mode === 'unknown-unverified'
            ? 'present-unverified'
            : 'present-indeterminate';
  return createVerificationRecord(
    {
      verifierRef: descriptor.digest,
      evidence: [
        {
          evidenceKind: 'trajectory',
          artifact: { ...trajectoryArtifact },
          provenance: { producedBy: 'arena-reference-fabric', producedAt: T1, notes: null },
        },
      ],
      evidenceSupport: [
        { requirementId: 'requirement-001', status: supportStatus, evidenceDigest: mode === 'unknown-missing' ? null : trajectoryChainHead, notes: null },
      ],
      correlationId: 'corr-cl-fixture',
      idempotencyKey: `idem-cl-${String(verificationCounter).padStart(4, '0')}`,
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'verifier-cl-0001', recordedAt: T6, notes: null },
    },
    descriptor,
  );
}

export interface ArmOverrides {
  readonly trajectoryId?: string;
  readonly runId?: string;
  readonly evaluatorRef?: string;
  readonly verificationMode?: 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate';
  readonly metricValue?: number;
  readonly metricVariance?: number | null;
  readonly protectedValue?: number;
  readonly omitProtected?: boolean;
}

export async function makeArm(overrides: ArmOverrides = {}): Promise<ExperimentArmInput> {
  const trajectory = await makeTrajectoryRecord({
    ...(overrides.trajectoryId === undefined ? {} : { trajectoryId: overrides.trajectoryId }),
    ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
  });
  const evaluation = await makeEvaluationRecord(
    trajectory.chainHead as string,
    ...(overrides.evaluatorRef === undefined ? [] : [{ evaluatorRef: overrides.evaluatorRef }]),
  );
  const verification = await makeVerificationRecord(trajectory.chainHead as string, {
    mode: overrides.verificationMode ?? 'pass',
  });
  return {
    trajectories: [trajectory],
    evaluations: [evaluation],
    verifications: [verification],
    metrics: [
      {
        metricId: 'reconciliation-accuracy',
        value: overrides.metricValue ?? 0.9,
        variance: overrides.metricVariance === undefined ? 0.01 : overrides.metricVariance,
      },
    ],
    protectedMetrics:
      overrides.omitProtected === true
        ? []
        : [{ capabilityRef: PROTECTED_CAPABILITY.digest as string, value: overrides.protectedValue ?? 0.95 }],
  };
}
