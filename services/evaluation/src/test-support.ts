/**
 * Shared test fixtures for @arena/evaluation-fabric (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 *
 * Builds REAL domain objects with the REAL packages: an A005
 * CapabilityCase via createCapabilityCase and an A011 TrajectoryRecord
 * via openTrajectory + appendTrajectoryEntry, so the fabric's input
 * contract is exercised against genuine sibling-package objects, not
 * stubs.
 */

import { createEvaluatorDescriptor } from '@arena/evaluation';
import type { EvaluatorDescriptor } from '@arena/evaluation';
import { createEvaluationCriteria } from '@arena/evaluation';
import type { EvaluationCriteria } from '@arena/evaluation';
import { createCapabilityCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { appendTrajectoryEntry, openTrajectory } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { makeDeterministicTestEvaluator, makeRubricEvaluator } from './evaluators.js';
import { EvaluationFabric } from './fabric.js';
import type { EvaluationFabric as Fabric } from './fabric.js';

export const T0 = '2026-03-01T12:00:00.000Z';
export const T1 = '2026-03-01T12:00:01.000Z';
export const T2 = '2026-03-01T12:00:02.000Z';
export const T3 = '2026-03-01T12:00:03.000Z';
export const T_OTHER_DAY = '2026-04-02T18:00:00.000Z';

const BODY_DIGEST = '4444444444444444444444444444444444444444444444444444444444444444';
const SUBSTRATE_DIGEST = '5555555555555555555555555555555555555555555555555555555555555555';
const SNAPSHOT_DIGEST = '2222222222222222222222222222222222222222222222222222222222222222';

/** A REAL A005 CapabilityCase (minimal-but-valid, fixed digest). */
export async function buildCase(): Promise<CapabilityCase> {
  return createCapabilityCase({
    identity: { tenant: 'tenant-a', caseId: 'case-evaluation-demo' },
    version: '1.0.0',
    source: { type: 'user', tenant: 'tenant-a', principalId: 'analyst-1' },
    problemStatement:
      'The invoicing agent fails to reconcile credit notes against partially paid invoices.',
    targetCapability: {
      kind: 'capability',
      id: 'invoice-reconciliation',
      version: '1.2.0',
      digest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    },
    domain: {
      kind: 'domain',
      id: 'accounts-payable',
      version: '1.0.0',
      digest: 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    },
    context: 'Production tenant workload; monthly close; ERP exports partial payments.',
    observedFailure: {
      summary:
        'Agent marked a partially paid invoice as fully settled, ignoring an open credit note.',
      observedAt: T0,
      reproduction: 'Run the monthly close with one partially paid invoice and one open credit note.',
    },
    evidence: [
      {
        digest: 'c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        description: 'Trajectory export of the failing close run.',
      },
    ],
    unknowns: ['Whether the ERP ever nets credit notes on export'],
    desiredOutcome:
      'The agent nets credit notes against partially paid invoices and explains the netting.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'accounts-payable-reconciliation',
          version: '1.0.0',
          digest: 'd1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        },
      ],
      qualifications: ['certified-accountant'],
    },
    environmentRequirements: {
      environments: [
        {
          namespace: 'tenant-a',
          name: 'erp-close-sandbox',
          version: '1.4.0',
          digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        },
      ],
      constraints: ['No live ERP writes'],
    },
    taskRequirements: {
      objectives: ['Reconcile credit notes against partially paid invoices'],
      constraints: ['Use only the ERP export snapshot'],
      allowedTools: [
        {
          namespace: 'tenant-a',
          name: 'erp-export-reader',
          version: '1.0.0',
          digest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        },
      ],
      forbiddenShortcuts: ['Assume full settlement without checking credit notes'],
      successConditions: ['Netted total matches the ERP expected balance'],
      evidenceCriteria: ['Annotated trajectory with the netting decision'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'reconciliation-accuracy', version: '1.0.0', digest: BODY_DIGEST },
      ],
      criteria: ['Netting accuracy >= 99% on the evaluation set'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'erp-balance-check', version: '1.0.0', digest: SUBSTRATE_DIGEST },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox ERP'],
    },
    currentBody: {
      tenant: 'tenant-a',
      name: 'invoicing-agent',
      version: '3.2.1',
      digest: BODY_DIGEST,
    },
    currentSubstrate: {
      adapterId: 'neutral-adapter',
      modelFamily: 'reasoning-family',
      modelId: 'large-reasoner',
      modelRevision: 'rev-2',
      contentDigest: SUBSTRATE_DIGEST,
    },
    provenance: { recordDigest: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' },
    priority: 'high',
    risk: 'moderate',
    createdAt: T0,
  });
}

/** A REAL A011 TrajectoryRecord for the case above (3 entries + completion). */
export async function buildTrajectory(): Promise<TrajectoryRecord> {
  let record = await openTrajectory({
    trajectoryId: 'trajectory-evaluation-demo',
    run: {
      taskVersion: { taskId: 'task-monthly-close', version: '2.1.0' },
      environmentVersion: {
        namespace: 'tenant-a',
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      },
      runId: 'tenant-a/run-evaluation-demo',
      initialSnapshotDigest: SNAPSHOT_DIGEST,
      runRecordDigest: '3333333333333333333333333333333333333333333333333333333333333333',
    },
    agentBodyRef: BODY_DIGEST,
    substrateRef: SUBSTRATE_DIGEST,
    startedAt: T0,
    seed: 'seed-1234',
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'read-erp-export', input: { command: 'net', args: ['credit-notes'] } },
    occurredAt: T0,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'stdout-tail',
      channel: 'stdout',
      content: 'netted 1 credit note against invoice INV-0042',
    },
    occurredAt: T1,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [SNAPSHOT_DIGEST] },
    occurredAt: T2,
  });
  return record;
}

/** A criteria object whose entry targets are pinned to the demo case. */
export async function buildCriteria(
  caseDigest: string,
  trajectoryDigest: string,
  criteriaId: string = 'criteria-invoice-reconciliation',
): Promise<EvaluationCriteria> {
  return createEvaluationCriteria({
    criteriaId,
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 2,
        description: 'credit notes are netted against partially paid invoices',
        targetRef: caseDigest,
      },
      {
        criterionId: 'criterion-002',
        weight: 1,
        description: 'the netting decision is explained in the summary',
        targetRef: trajectoryDigest,
      },
      {
        criterionId: 'criterion-003',
        weight: 1,
        description: 'no live ERP writes occur during the run',
        targetRef: trajectoryDigest,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
}

export interface DescriptorOverrides {
  readonly evaluatorId?: string;
  readonly version?: string;
  readonly kind?: string;
  readonly confidence?: number;
  readonly seeded?: boolean;
  readonly deterministic?: boolean;
  readonly requiresHuman?: boolean;
  readonly bodyRef?: string | null;
  readonly substrateRef?: string | null;
}

/** A descriptor input bound to the demo case/trajectory/criteria. */
export async function buildDescriptorInput(
  caseDigest: string,
  trajectoryDigest: string,
  criteriaDigest: string,
  overrides: DescriptorOverrides = {},
): Promise<EvaluatorDescriptor> {
  return createEvaluatorDescriptor({
    evaluatorId: overrides.evaluatorId ?? 'eval-reconciliation-accuracy',
    version: overrides.version ?? '1.0.0',
    kind: overrides.kind ?? 'deterministic-test',
    inputs: {
      caseRef: caseDigest,
      trajectoryRef: trajectoryDigest,
      bodyRef: overrides.bodyRef === undefined ? BODY_DIGEST : overrides.bodyRef,
      substrateRef:
        overrides.substrateRef === undefined ? SUBSTRATE_DIGEST : overrides.substrateRef,
    },
    criteriaRef: criteriaDigest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: {
      deterministic: overrides.deterministic ?? true,
      seeded: overrides.seeded ?? true,
      requiresHuman: overrides.requiresHuman ?? false,
    },
    confidence: overrides.confidence ?? 0.9,
    limitations: 'reference evaluator; judgments are seeded derivations, not human review',
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T0,
      notes: 'authored by the A012 reference fabric',
    },
  });
}

/** A fully-wired fabric: demo criteria + deterministic-test and rubric evaluators registered. */
export async function buildFabric(): Promise<{
  fabric: Fabric;
  caseRecord: CapabilityCase;
  trajectoryRecord: TrajectoryRecord;
  criteria: EvaluationCriteria;
  deterministicEvaluator: EvaluatorDescriptor;
  rubricEvaluator: EvaluatorDescriptor;
}> {
  const fabric = new EvaluationFabric();
  const caseRecord = await buildCase();
  const trajectoryRecord = await buildTrajectory();
  const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
  const deterministicEvaluator = await buildDescriptorInput(
    caseRecord.digest,
    trajectoryRecord.chainHead,
    criteria.digest,
    { evaluatorId: 'eval-reconciliation-accuracy', kind: 'deterministic-test' },
  );
  const rubricEvaluator = await buildDescriptorInput(
    caseRecord.digest,
    trajectoryRecord.chainHead,
    criteria.digest,
    {
      evaluatorId: 'eval-reconciliation-rubric',
      kind: 'rubric',
      confidence: 0.8,
    },
  );
  fabric.registry.registerCriteria(criteria);
  fabric.registry.registerEvaluator(deterministicEvaluator, makeDeterministicTestEvaluator());
  fabric.registry.registerEvaluator(rubricEvaluator, makeRubricEvaluator());
  return { fabric, caseRecord, trajectoryRecord, criteria, deterministicEvaluator, rubricEvaluator };
}

/** Deterministic 32-bit LCG for property tests (Numerical Recipes constants). */
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
