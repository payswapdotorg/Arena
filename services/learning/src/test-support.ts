/**
 * Shared test fixtures for @arena/learning-fabric (internal, NOT part
 * of the public surface — hygiene.test.ts asserts it is not exported).
 *
 * Self-contained REAL fixtures: A011 trajectories, A012 evaluation
 * records and A013 verification records built through their OWN
 * packages (test-only imports — the fabric's runtime deps stay
 * @arena/protocol-core + @arena/learning + the sibling record guards),
 * with experiment descriptors built through @arena/learning's own
 * constructor.
 */

import { createTrajectoryHeader, appendTrajectoryEntry, createTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import { createExperimentDescriptor } from '@arena/learning';
import type { CreateExperimentDescriptorInput, ExperimentDescriptor } from '@arena/learning';

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

export const T0 = '2026-04-01T08:00:00.000Z';
export const T1 = '2026-04-01T08:00:01.000Z';
export const T2 = '2026-04-01T08:00:02.000Z';
export const T3 = '2026-04-01T08:00:03.000Z';
export const T4 = '2026-04-01T08:00:04.000Z';
export const T5 = '2026-04-01T08:00:05.000Z';
export const T6 = '2026-04-01T08:00:06.000Z';
export const T7 = '2026-04-01T08:00:07.000Z';

export const CORR_ID = 'corr-learning-fabric';
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
export const TASK_POPULATION = Object.freeze([
  { taskId: 'task-reconciliation', version: '1.0.0' },
]);
export const ENVIRONMENT_VERSION = Object.freeze({
  namespace: 'arena',
  name: 'erp-close-sandbox',
  version: '1.1.0',
  digest: DIGEST_B,
});

export interface ExperimentInputOverrides {
  readonly experimentId?: string | undefined;
  readonly version?: string | undefined;
  readonly changedSurface?: string | undefined;
  readonly protectedCapabilities?: readonly {
    readonly ref: {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly metricId: string;
    readonly direction: string;
  }[] | undefined;
}

export function makeExperimentInput(
  overrides: ExperimentInputOverrides = {},
): CreateExperimentDescriptorInput {
  return {
    experimentId: overrides.experimentId ?? 'experiment-reconciliation-0001',
    version: overrides.version ?? '1.0.0',
    targetCapability: { ...TARGET_CAPABILITY },
    baseline: { bodyRef: DIGEST_D, substrateRef: DIGEST_E, runtimeRef: null },
    interventions: [
      {
        artifact: {
          namespace: 'arena-skills',
          name: 'reconciliation-checklist-skill',
          version: '1.0.0',
          digest: DIGEST_A,
        },
        changedSurface: overrides.changedSurface ?? 'skills',
      },
    ],
    taskPopulation: TASK_POPULATION.map((entry) => ({ ...entry })),
    evaluationSuiteRefs: [DIGEST_A],
    verificationSuiteRefs: [DIGEST_F],
    environmentVersions: [{ ...ENVIRONMENT_VERSION }],
    outcomeMetrics: [
      {
        metricId: 'reconciliation-accuracy',
        description: 'fraction of ledger entries reconciled correctly',
        direction: 'higher-is-better',
      },
    ],
    uncertainty: {
      method: 'analytic-variance',
      notes: 'variance over the pinned task population',
    },
    protectedCapabilities:
      overrides.protectedCapabilities === undefined
        ? [
            {
              ref: { ...PROTECTED_CAPABILITY },
              metricId: 'audit-trail-completeness',
              direction: 'higher-is-better',
            },
          ]
        : [...(overrides.protectedCapabilities ?? [])],
    provenance: { authoredBy: 'arena-learning-fabric-test', submittedAt: T0, notes: null },
  };
}

export async function makeDescriptor(
  overrides: ExperimentInputOverrides = {},
): Promise<ExperimentDescriptor> {
  return createExperimentDescriptor(makeExperimentInput(overrides));
}

export interface TrajectoryOverrides {
  readonly trajectoryId?: string | undefined;
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly taskVersion?: string | undefined;
  readonly environmentDigest?: string | undefined;
  readonly bodyRef?: string | undefined;
  readonly substrateRef?: string | undefined;
  readonly omitCompletion?: boolean | undefined;
}

export async function makeTrajectoryRecord(
  overrides: TrajectoryOverrides = {},
): Promise<TrajectoryRecord> {
  const trajectoryId = overrides.trajectoryId ?? 'trajectory-fabric-0001';
  const header = await createTrajectoryHeader({
    trajectoryId,
    run: {
      taskVersion: {
        taskId: overrides.taskId ?? 'task-reconciliation',
        version: overrides.taskVersion ?? '1.0.0',
      },
      environmentVersion: {
        namespace: 'arena',
        name: 'erp-close-sandbox',
        version: '1.1.0',
        digest: overrides.environmentDigest ?? DIGEST_B,
      },
      runId: overrides.runId ?? 'tenant-a/run-fabric-0001',
      initialSnapshotDigest: DIGEST_C,
      runRecordDigest: DIGEST_D,
    },
    agentBodyRef: overrides.bodyRef ?? DIGEST_D,
    substrateRef: overrides.substrateRef ?? DIGEST_E,
    startedAt: T0,
    seed: 'seed-fabric-0001',
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
  if (overrides.omitCompletion !== true) {
    sequence += 1;
    record = await appendTrajectoryEntry(record, {
      sequence,
      kind: 'completion',
      payload: { outcome: 'completed', evidenceDigests: [DIGEST_A] },
      occurredAt: T2,
    });
  }
  return record;
}

export interface EvaluationOverrides {
  readonly trajectoryRef?: string | undefined;
  readonly evaluatorRef?: string | undefined;
}

export async function makeEvaluationRecord(
  trajectoryChainHead: string,
  overrides: EvaluationOverrides = {},
): Promise<EvaluationRecord> {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-fabric',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 2,
        description: 'the run completed the reconciliation correctly',
        targetRef: DIGEST_F,
      },
      {
        criterionId: 'criterion-002',
        weight: 1,
        description: 'the run produced auditable evidence',
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
      trajectoryRef: overrides.trajectoryRef ?? trajectoryChainHead,
      criteriaRef: criteria.digest,
      seed: 'seed-fabric-eval',
      verdicts: [
        { criterionId: 'criterion-001', score: 1, judgment: null, notes: null },
        { criterionId: 'criterion-002', score: 1, judgment: null, notes: null },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: T3,
      finishedAt: T4,
      provenance: { executedBy: 'eval-fabric-0001', recordedAt: T4, notes: null },
    },
    criteria,
  );
}

export interface VerificationOverrides {
  readonly mode?: 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate' | undefined;
  readonly evidenceDigest?: string | undefined;
  readonly verifierId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

let verificationCounter = 0;

export async function makeVerificationRecord(
  trajectoryChainHead: string,
  overrides: VerificationOverrides = {},
): Promise<VerificationRecord> {
  verificationCounter += 1;
  const trajectoryArtifact = {
    namespace: 'arena-traj',
    name: `trajectory-fabric-${String(verificationCounter).padStart(4, '0')}`,
    version: '1.0.0',
    digest: trajectoryChainHead,
  };
  const descriptor: VerifierDescriptor = await createVerifierDescriptor({
    verifierId: overrides.verifierId ?? 'verifier-fabric-0001',
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
      unknown: 'the trajectory evidence cannot be decided (missing, unverifiable or inconclusive)',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: null },
  });
  const mode = overrides.mode ?? 'pass';
  const addressedDigest = overrides.evidenceDigest ?? trajectoryChainHead;
  const evidence = [
    {
      evidenceKind: 'trajectory',
      artifact: { ...trajectoryArtifact, digest: addressedDigest },
      provenance: { producedBy: 'arena-reference-fabric', producedAt: T1, notes: null },
    },
  ];
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
  const evidenceDigest = mode === 'unknown-missing' ? null : addressedDigest;
  return createVerificationRecord(
    {
      verifierRef: descriptor.digest,
      evidence,
      evidenceSupport: [
        { requirementId: 'requirement-001', status: supportStatus, evidenceDigest, notes: null },
      ],
      correlationId: CORR_ID,
      idempotencyKey:
        overrides.idempotencyKey ?? `idem-fabric-${String(verificationCounter).padStart(4, '0')}`,
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'verifier-fabric-0001', recordedAt: T6, notes: null },
    },
    descriptor,
  );
}

export interface ArmOverrides {
  readonly trajectoryId?: string | undefined;
  readonly runId?: string | undefined;
  readonly evaluatorRef?: string | undefined;
  readonly verifierId?: string | undefined;
  readonly verificationMode?: 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate' | undefined;
  readonly taskId?: string | undefined;
  readonly taskVersion?: string | undefined;
  readonly environmentDigest?: string | undefined;
  readonly bodyRef?: string | undefined;
  readonly substrateRef?: string | undefined;
  readonly omitCompletion?: boolean | undefined;
  readonly metricValue?: number | undefined;
  readonly metricVariance?: number | null | undefined;
  readonly protectedValue?: number | undefined;
  readonly omitProtected?: boolean | undefined;
}

export interface ArmFixture {
  readonly trajectories: readonly TrajectoryRecord[];
  readonly evaluations: readonly EvaluationRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly metrics: readonly { readonly metricId: string; readonly value: number; readonly variance: number | null }[];
  readonly protectedMetrics: readonly { readonly capabilityRef: string; readonly value: number }[];
}

async function makeArmFixture(
  label: 'baseline' | 'intervention',
  overrides: ArmOverrides,
  protectedRefDigest: string,
): Promise<ArmFixture> {
  const trajectory = await makeTrajectoryRecord({
    trajectoryId: overrides.trajectoryId ?? `trajectory-fabric-${label}`,
    runId: overrides.runId ?? `tenant-a/run-fabric-${label}`,
    taskId: overrides.taskId,
    taskVersion: overrides.taskVersion,
    environmentDigest: overrides.environmentDigest,
    bodyRef: overrides.bodyRef,
    substrateRef: overrides.substrateRef,
    omitCompletion: overrides.omitCompletion,
  });
  const evaluation = await makeEvaluationRecord(trajectory.chainHead as string, {
    evaluatorRef: overrides.evaluatorRef,
  });
  const verification = await makeVerificationRecord(trajectory.chainHead as string, {
    mode: overrides.verificationMode,
    verifierId: overrides.verifierId,
  });
  const metrics = [
    {
      metricId: 'reconciliation-accuracy',
      value: overrides.metricValue ?? (label === 'baseline' ? 0.8 : 0.9),
      variance: overrides.metricVariance === undefined ? 0.01 : overrides.metricVariance,
    },
  ];
  const protectedMetrics =
    overrides.omitProtected === true
      ? []
      : [
          {
            capabilityRef: protectedRefDigest,
            value: overrides.protectedValue ?? (label === 'baseline' ? 0.9 : 0.95),
          },
        ];
  return {
    trajectories: [trajectory],
    evaluations: [evaluation],
    verifications: [verification],
    metrics,
    protectedMetrics,
  };
}

export async function makeArms(
  baseline: ArmOverrides = {},
  intervention: ArmOverrides = {},
  protectedRefDigest: string = PROTECTED_CAPABILITY.digest,
): Promise<{ readonly baseline: ArmFixture; readonly intervention: ArmFixture }> {
  return {
    baseline: await makeArmFixture('baseline', baseline, protectedRefDigest),
    intervention: await makeArmFixture('intervention', intervention, protectedRefDigest),
  };
}

/** Deterministic 32-bit LCG (Numerical Recipes constants, mirrors the sibling test-supports). */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}
