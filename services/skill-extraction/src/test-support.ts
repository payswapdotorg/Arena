/**
 * Shared test fixtures for @arena/skill-extraction-fabric (internal).
 *
 * Self-contained REAL fixtures: A011 trajectories, A012 evaluation
 * records and A013 verification records built through their OWN
 * packages (test-only imports — the fabric's runtime deps stay
 * @arena/protocol-core + @arena/skill-extraction), bundled into
 * validated refs through the package's own guard.
 */

import { createTrajectoryHeader, appendTrajectoryEntry, createTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import { createCapabilityNode } from '@arena/capability-graph';
import {
  createExtractionPolicy,
  toValidatedTrajectoryRef,
} from '@arena/skill-extraction';
import type {
  CreateExtractionPolicyInput,
  ExtractionPolicy,
  ValidatedTrajectoryRef,
} from '@arena/skill-extraction';

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

export const T0 = '2026-03-02T09:00:00.000Z';
export const T1 = '2026-03-02T09:00:01.000Z';
export const T2 = '2026-03-02T09:00:02.000Z';
export const T3 = '2026-03-02T09:00:03.000Z';
export const T4 = '2026-03-02T09:00:04.000Z';
export const T5 = '2026-03-02T09:00:05.000Z';
export const T6 = '2026-03-02T09:00:06.000Z';

export const CORR = 'corr-fabric-extraction-0001';
export const RUN_KEY = 'run-key-extraction-0001';

/** Build a REAL A011 trajectory. */
export async function makeTrajectory(
  overrides: {
    readonly trajectoryId?: string;
    readonly runId?: string;
    readonly actionIds?: readonly string[];
    readonly outcome?: 'completed' | 'failed' | 'timed-out';
    readonly omitCompletion?: boolean;
  } = {},
): Promise<TrajectoryRecord> {
  const trajectoryId = overrides.trajectoryId ?? 'trajectory-f0001';
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
      runId: overrides.runId ?? 'tenant-a/run-f0001',
      initialSnapshotDigest: DIGEST_C,
      runRecordDigest: DIGEST_D,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: T0,
    seed: 'seed-f0001',
  });
  let record = createTrajectoryRecord(header);
  let sequence = 0;
  for (const actionId of overrides.actionIds ?? ['fetch-ledger', 'reconcile-entries', 'emit-report']) {
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
      payload: { outcome: overrides.outcome ?? 'completed', evidenceDigests: [DIGEST_A] },
      occurredAt: T2,
    });
  }
  return record;
}

/** Build a REAL A012 evaluation record for a trajectory. */
export async function makeEvaluation(
  trajectoryChainHead: string,
  meetsCriteria = true,
): Promise<EvaluationRecord> {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-fabric-extraction',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 2,
        description: 'the run completed correctly',
        targetRef: DIGEST_F,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
  return createEvaluationRecord(
    {
      evaluatorRef: DIGEST_A,
      caseRef: DIGEST_C,
      trajectoryRef: trajectoryChainHead,
      criteriaRef: criteria.digest,
      seed: 'seed-eval-f0001',
      verdicts: [{ criterionId: 'criterion-001', score: meetsCriteria ? 1 : 0.1, judgment: null, notes: null }],
      confidence: 0.9,
      limitations: null,
      startedAt: T3,
      finishedAt: T4,
      provenance: { executedBy: 'eval-fabric-0001', recordedAt: T4, notes: null },
    },
    criteria,
  );
}

/** Build a REAL A013 verification record for a trajectory (outcome 'pass').
 * DETERMINISTIC in the chain head: the same trajectory yields the
 * byte-identical verification record (digest-stable fixtures). */
export async function makeVerification(
  trajectoryChainHead: string,
  _index?: number,
): Promise<VerificationRecord> {
  const descriptor: VerifierDescriptor = await createVerifierDescriptor({
    verifierId: 'verifier-fabric-extraction',
    version: '1.0.0',
    method: 'evidence_provenance_validation',
    requiredEvidence: [
      {
        requirementId: 'requirement-001',
        evidenceKind: 'trajectory',
        claim: 'the trajectory evidence is present and verified',
        artifact: null,
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'present, verified, supporting',
      fail: 'present, verified, contradicting',
      unknown: 'cannot be decided',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-reference-fabric', submittedAt: T0, notes: null },
  });
  return createVerificationRecord(
    {
      verifierRef: descriptor.digest,
      evidence: [
        {
          evidenceKind: 'trajectory',
          artifact: {
            namespace: 'arena-traj',
            name: `trajectory-${trajectoryChainHead.slice(0, 12)}`,
            version: '1.0.0',
            digest: trajectoryChainHead,
          },
          provenance: { producedBy: 'arena-reference-fabric', producedAt: T1, notes: null },
        },
      ],
      evidenceSupport: [
        { requirementId: 'requirement-001', status: 'present-supported', evidenceDigest: trajectoryChainHead, notes: null },
      ],
      correlationId: CORR,
      idempotencyKey: `idem-fabric-verification-${trajectoryChainHead.slice(0, 24)}`,
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'verifier-fabric-extraction', recordedAt: T6, notes: null },
    },
    descriptor,
  );
}

let refCounter = 0;

/** Build a REAL validated trajectory ref. */
export async function makeRef(
  overrides: {
    readonly trajectoryId?: string;
    readonly runId?: string;
    readonly actionIds?: readonly string[];
    readonly outcome?: 'completed' | 'failed' | 'timed-out';
    readonly omitCompletion?: boolean;
    readonly meetsCriteria?: boolean;
  } = {},
): Promise<ValidatedTrajectoryRef> {
  refCounter += 1;
  const trajectory = await makeTrajectory({
    trajectoryId: overrides.trajectoryId ?? `trajectory-f${String(refCounter).padStart(4, '0')}`,
    runId: overrides.runId ?? `tenant-a/run-f${String(refCounter).padStart(4, '0')}`,
    ...(overrides.actionIds === undefined ? {} : { actionIds: overrides.actionIds }),
    ...(overrides.outcome === undefined ? {} : { outcome: overrides.outcome }),
    ...(overrides.omitCompletion === undefined ? {} : { omitCompletion: overrides.omitCompletion }),
  });
  const evaluation = await makeEvaluation(trajectory.chainHead as string, overrides.meetsCriteria ?? true);
  const verification = await makeVerification(trajectory.chainHead as string, refCounter);
  return toValidatedTrajectoryRef({
    trajectory,
    evaluations: [evaluation],
    verifications: [verification],
  });
}

/** Build the REAL A004 target node + a policy input addressing it. */
export async function makeTargetNodeAndPolicyInput(
  overrides: {
    readonly minVerificationRecords?: number;
    readonly minTrajectories?: number;
  } = {},
) {
  const targetNode = await createCapabilityNode({
    kind: 'capability',
    id: 'capability-reconciliation',
    version: '1.2.0',
    payload: { title: 'Reconciliation capability', description: 'fabric fixture target' },
  });
  const input: CreateExtractionPolicyInput = {
    policyId: 'policy-fabric-extraction-0001',
    version: '1.0.0',
    validation: {
      requiredVerificationOutcome: 'pass',
      minVerificationRecords: overrides.minVerificationRecords ?? 1,
      requireEvaluations: true,
      requiredEvaluationOutcome: 'meets-criteria',
    },
    eligibility: {
      entryKinds: ['action', 'completion'],
      requireCompletedOutcome: 'completed',
    },
    thresholds: {
      minTrajectories: overrides.minTrajectories ?? 1,
      minOccurrences: 1,
    },
    taxonomy: {
      targetNode: {
        kind: targetNode.kind,
        id: targetNode.id,
        version: targetNode.version,
        digest: targetNode.digest,
      },
    },
  };
  return { targetNode, input };
}

/** Create + register the default fabric policy. */
export async function registerDefaultPolicy(
  service: { registerPolicy(policy: ExtractionPolicy): Promise<ExtractionPolicy> },
): Promise<ExtractionPolicy> {
  const { input } = await makeTargetNodeAndPolicyInput();
  return service.registerPolicy(await createExtractionPolicy(input));
}

/** Deterministic 32-bit LCG (mirrors the sibling test-supports). */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  int(maxExclusive: number): number {
    return Math.floor((this.nextUint32() / 2 ** 32) * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}
