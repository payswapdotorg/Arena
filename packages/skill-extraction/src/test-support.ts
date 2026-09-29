/**
 * Shared test fixtures for @arena/skill-extraction (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 *
 * Every fixture is a REAL record from the REAL sibling packages: A011
 * trajectories through @arena/trajectory's own constructors, A012
 * evaluation records through @arena/evaluation's, A013 verification
 * records through @arena/verification's. Nothing is stubbed — the
 * negative tests prove the guards reject REAL malformed evidence, not
 * toy doubles.
 */

import { createTrajectoryHeader, appendTrajectoryEntry, createTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';
import type { VerificationRecord, VerifierDescriptor } from '@arena/verification';
import type { CreateExtractionPolicyInput } from './policy.js';
import { toValidatedTrajectoryRef } from './validated-ref.js';
import type { ValidatedTrajectoryRef } from './validated-ref.js';

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

export const T0 = '2026-03-01T08:00:00.000Z';
export const T1 = '2026-03-01T08:00:01.000Z';
export const T2 = '2026-03-01T08:00:02.000Z';
export const T3 = '2026-03-01T08:00:03.000Z';
export const T4 = '2026-03-01T08:00:04.000Z';
export const T5 = '2026-03-01T08:00:05.000Z';
export const T6 = '2026-03-01T08:00:06.000Z';
export const T7 = '2026-03-01T08:00:07.000Z';

export const CORR_ID = 'corr-extraction-0001';

/** The A004 taxonomy target node ref used by fixture policies. */
export const TARGET_NODE = Object.freeze({
  kind: 'capability',
  id: 'capability-reconciliation',
  version: '1.2.0',
  digest: DIGEST_F,
});

export interface TrajectoryOverrides {
  readonly trajectoryId?: string;
  readonly runId?: string;
  /** Action ids appended in order (sequence 1..n). */
  readonly actionIds?: readonly string[];
  /** Whether an observation entry is interleaved (not eligible by default policy). */
  readonly withObservation?: boolean;
  readonly outcome?: 'completed' | 'failed' | 'timed-out';
  /** Omit the completion entry (a still-open trajectory). */
  readonly omitCompletion?: boolean;
}

/** Build a REAL A011 TrajectoryRecord through @arena/trajectory itself. */
export async function makeTrajectoryRecord(
  overrides: TrajectoryOverrides = {},
): Promise<TrajectoryRecord> {
  const trajectoryId = overrides.trajectoryId ?? 'trajectory-0001';
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
      runId: overrides.runId ?? 'tenant-a/run-0001',
      initialSnapshotDigest: DIGEST_C,
      runRecordDigest: DIGEST_D,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: T0,
    seed: 'seed-0001',
  });
  let record = createTrajectoryRecord(header);

  const actionIds = overrides.actionIds ?? ['fetch-ledger', 'reconcile-entries', 'emit-report'];
  let sequence = 0;
  for (const actionId of actionIds) {
    sequence += 1;
    record = await appendTrajectoryEntry(record, {
      sequence,
      kind: 'action',
      payload: { actionId, input: { source: 'erp' } },
      occurredAt: T1,
    });
    if (overrides.withObservation === true) {
      sequence += 1;
      record = await appendTrajectoryEntry(record, {
        sequence,
        kind: 'observation',
        payload: { observationId: `obs-${String(sequence)}`, channel: 'stdout', content: 'ok' },
        occurredAt: T1,
      });
    }
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

export interface EvaluationOverrides {
  readonly trajectoryRef?: string;
  readonly meetsCriteria?: boolean;
  readonly evaluatorId?: string;
}

/** Build a REAL A012 EvaluationRecord judging the given trajectory digest. */
export async function makeEvaluationRecord(
  trajectoryChainHead: string,
  overrides: EvaluationOverrides = {},
): Promise<EvaluationRecord> {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-extraction',
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
  const score = overrides.meetsCriteria === false ? 0.1 : 1;
  return createEvaluationRecord(
    {
      evaluatorRef: DIGEST_A,
      caseRef: DIGEST_C,
      trajectoryRef: overrides.trajectoryRef ?? trajectoryChainHead,
      criteriaRef: criteria.digest,
      seed: 'seed-eval-0001',
      verdicts: [
        { criterionId: 'criterion-001', score, judgment: null, notes: null },
        { criterionId: 'criterion-002', score, judgment: null, notes: null },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: T3,
      finishedAt: T4,
      provenance: {
        executedBy: overrides.evaluatorId ?? 'eval-extraction-0001',
        recordedAt: T4,
        notes: null,
      },
    },
    criteria,
  );
}

export interface VerificationOverrides {
  /** 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate' */
  readonly mode?: 'pass' | 'fail' | 'unknown-missing' | 'unknown-unverified' | 'unknown-indeterminate';
  /**
   * Evidence-address override: the artifact digest the record's bundle
   * names (defaults to the trajectory chain head; pass a DIFFERENT digest
   * to build a real, valid record that simply does not reference the
   * trajectory — the ref guard's EVIDENCE_MISMATCH negative).
   */
  readonly evidenceDigest?: string;
  readonly verifierId?: string;
  readonly idempotencyKey?: string;
}

let verificationCounter = 0;

/**
 * Build a REAL A013 VerificationRecord whose evidence bundle addresses
 * the given trajectory (an artifact whose digest IS the chain head).
 */
export async function makeVerificationRecord(
  trajectoryChainHead: string,
  overrides: VerificationOverrides = {},
): Promise<VerificationRecord> {
  verificationCounter += 1;
  const trajectoryArtifact = {
    namespace: 'arena-traj',
    name: `trajectory-${String(verificationCounter).padStart(4, '0')}`,
    version: '1.0.0',
    digest: trajectoryChainHead,
  };
  const descriptor: VerifierDescriptor = await createVerifierDescriptor({
    verifierId: overrides.verifierId ?? 'verifier-extraction-0001',
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
      artifact: {
        ...trajectoryArtifact,
        digest: addressedDigest,
      },
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
        {
          requirementId: 'requirement-001',
          status: supportStatus,
          evidenceDigest,
          notes: null,
        },
      ],
      correlationId: CORR_ID,
      idempotencyKey:
        overrides.idempotencyKey ?? `idem-verification-${String(verificationCounter).padStart(4, '0')}`,
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'verifier-extraction-0001', recordedAt: T6, notes: null },
    },
    descriptor,
  );
}

export interface ValidatedRefOverrides extends TrajectoryOverrides {
  readonly evaluationOverrides?: EvaluationOverrides;
  readonly verificationOverrides?: VerificationOverrides;
  /** Additional (divergent) evaluation records judging another trajectory. */
  readonly extraEvaluations?: readonly EvaluationRecord[];
  readonly extraVerifications?: readonly VerificationRecord[];
}

/** Build a REAL ValidatedTrajectoryRef bundle. */
export async function makeValidatedRef(
  overrides: ValidatedRefOverrides = {},
): Promise<ValidatedTrajectoryRef> {
  const trajectory = await makeTrajectoryRecord(overrides);
  const evaluation = await makeEvaluationRecord(
    trajectory.chainHead as string,
    overrides.evaluationOverrides,
  );
  const verification = await makeVerificationRecord(
    trajectory.chainHead as string,
    overrides.verificationOverrides,
  );
  return toValidatedTrajectoryRef({
    trajectory,
    evaluations: [evaluation, ...(overrides.extraEvaluations ?? [])],
    verifications: [verification, ...(overrides.extraVerifications ?? [])],
  });
}

export interface PolicyOverrides {
  readonly policyId?: string;
  readonly version?: string;
  readonly requiredVerificationOutcome?: string;
  readonly minVerificationRecords?: number;
  readonly requireEvaluations?: boolean;
  readonly requiredEvaluationOutcome?: string | null;
  readonly entryKinds?: readonly string[];
  readonly requireCompletedOutcome?: string | null;
  readonly minTrajectories?: number;
  readonly minOccurrences?: number;
  readonly targetNode?: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
}

/** A default-policy input (the documented house defaults). */
export function makePolicyInput(overrides: PolicyOverrides = {}): CreateExtractionPolicyInput {
  return {
    policyId: overrides.policyId ?? 'policy-extraction-0001',
    version: overrides.version ?? '1.0.0',
    validation: {
      requiredVerificationOutcome: overrides.requiredVerificationOutcome ?? 'pass',
      minVerificationRecords: overrides.minVerificationRecords ?? 1,
      requireEvaluations: overrides.requireEvaluations ?? true,
      requiredEvaluationOutcome:
        overrides.requiredEvaluationOutcome === undefined
          ? 'meets-criteria'
          : overrides.requiredEvaluationOutcome,
    },
    eligibility: {
      entryKinds: overrides.entryKinds ?? ['action', 'completion'],
      requireCompletedOutcome:
        overrides.requireCompletedOutcome === undefined
          ? 'completed'
          : overrides.requireCompletedOutcome,
    },
    thresholds: {
      minTrajectories: overrides.minTrajectories ?? 1,
      minOccurrences: overrides.minOccurrences ?? 1,
    },
    taxonomy: { targetNode: overrides.targetNode ?? TARGET_NODE },
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

  hex64(): string {
    let out = '';
    while (out.length < 64) {
      out += this.nextUint32().toString(16).padStart(8, '0');
    }
    return out.slice(0, 64);
  }
}
