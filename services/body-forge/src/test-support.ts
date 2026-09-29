/**
 * Shared test fixtures for @arena/body-forge-fabric (internal, NOT
 * part of the public surface — hygiene.test.ts asserts it is not
 * exported).
 *
 * Self-contained REAL fixtures: A011 trajectories, A012 evaluation
 * records and A013 verification records built through their OWN
 * packages (test-only imports — the fabric's runtime deps stay
 * @arena/protocol-core + @arena/body-forge + the learning/skill-
 * extraction guards), an A019 SkillDraft built through
 * @arena/skill-extraction's own mining pipeline, an A020
 * ExperimentRunRecord built through @arena/learning's own pure
 * computations, and forge manifests/policies. Nothing is stubbed.
 */

import { createTrajectoryHeader, appendTrajectoryEntry, createTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import { createCapabilityNode } from '@arena/capability-graph';
import {
  buildSkillDraft,
  createExtractionPolicy,
  mineSkillCandidates,
  toValidatedTrajectoryRef,
} from '@arena/skill-extraction';
import type { CreateExtractionPolicyInput, SkillDraft, ValidatedTrajectoryRef } from '@arena/skill-extraction';
import {
  attributeExperiment,
  compareOutcomeMetrics,
  computeUncertaintyReport,
  createExperimentDescriptor,
  createExperimentRunRecord,
  decideCapabilityLift,
  freezeHistoricalInputs,
  checkProtectedCapabilities,
} from '@arena/learning';
import type { CreateExperimentDescriptorInput, ExperimentRunRecord } from '@arena/learning';
import { createBodyManifest, createForgePolicy, defaultForgePolicyInput } from '@arena/body-forge';
import type { CreateBodyManifestInput } from '@arena/body-forge';
import type { CorrelationId } from '@arena/protocol-core';

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

export const T0 = '2026-06-01T12:00:00.000Z';
export const T1 = '2026-06-01T12:00:01.000Z';
export const T2 = '2026-06-01T12:00:02.000Z';
export const T3 = '2026-06-01T12:00:03.000Z';
export const T4 = '2026-06-01T12:00:04.000Z';
export const T5 = '2026-06-01T12:00:05.000Z';
export const T6 = '2026-06-01T12:00:06.000Z';

export const CORR = 'corr-body-forge-fabric-0001';
export const FORGE_KEY = 'forge-key-fabric-0001';

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

  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }

  digest(): string {
    let hex = '';
    for (let i = 0; i < 8; i += 1) {
      hex += (this.nextUint32() >>> 0).toString(16).padStart(8, '0');
    }
    return hex;
  }
}

// ---------------------------------------------------------------------------
// A011/A012/A013 evidence fixtures (REAL, through their own packages)
// ---------------------------------------------------------------------------

export async function makeTrajectory(
  overrides: {
    readonly trajectoryId?: string;
    readonly runId?: string;
    readonly actionIds?: readonly string[];
  } = {},
): Promise<TrajectoryRecord> {
  const trajectoryId = overrides.trajectoryId ?? 'trajectory-forge-0001';
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
      runId: overrides.runId ?? 'tenant-a/run-forge-0001',
      initialSnapshotDigest: DIGEST_C,
      runRecordDigest: DIGEST_D,
    },
    agentBodyRef: DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: T0,
    seed: 'seed-forge-0001',
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
  sequence += 1;
  record = await appendTrajectoryEntry(record, {
    sequence,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [DIGEST_A] },
    occurredAt: T2,
  });
  return record;
}

export async function makeEvaluation(trajectoryChainHead: string): Promise<EvaluationRecord> {
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-forge-fabric',
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
      evaluatorRef: DIGEST_A,
      caseRef: DIGEST_C,
      trajectoryRef: trajectoryChainHead,
      criteriaRef: criteria.digest,
      seed: 'seed-forge-eval',
      verdicts: [{ criterionId: 'criterion-001', score: 1, judgment: null, notes: null }],
      confidence: 0.9,
      limitations: null,
      startedAt: T3,
      finishedAt: T4,
      provenance: { executedBy: 'eval-forge-fabric', recordedAt: T4, notes: null },
    },
    criteria,
  );
}

export async function makeVerification(
  trajectoryChainHead: string,
  index = 1,
): Promise<VerificationRecord> {
  const descriptor: VerifierDescriptor = await createVerifierDescriptor({
    verifierId: 'verifier-forge-fabric',
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
            name: `trajectory-forge-${String(index).padStart(4, '0')}`,
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
      idempotencyKey: `idem-forge-verification-${String(index).padStart(4, '0')}`,
      startedAt: T5,
      finishedAt: T6,
      provenance: { executedBy: 'verifier-forge-fabric', recordedAt: T6, notes: null },
    },
    descriptor,
  );
}

let refCounter = 0;

export async function makeValidatedRef(
  overrides: {
    readonly trajectoryId?: string;
    readonly runId?: string;
    readonly actionIds?: readonly string[];
  } = {},
): Promise<ValidatedTrajectoryRef> {
  refCounter += 1;
  const trajectory = await makeTrajectory({
    trajectoryId: overrides.trajectoryId ?? `trajectory-forge-f${String(refCounter).padStart(4, '0')}`,
    runId: overrides.runId ?? `tenant-a/run-forge-f${String(refCounter).padStart(4, '0')}`,
    ...(overrides.actionIds === undefined ? {} : { actionIds: overrides.actionIds }),
  });
  const evaluation = await makeEvaluation(trajectory.chainHead as string);
  const verification = await makeVerification(trajectory.chainHead as string, refCounter);
  return toValidatedTrajectoryRef({
    trajectory,
    evaluations: [evaluation],
    verifications: [verification],
  });
}

// ---------------------------------------------------------------------------
// A019 SkillDraft fixture (REAL, through the extraction pipeline)
// ---------------------------------------------------------------------------

export async function makeSkillDraft(): Promise<SkillDraft> {
  const ref = await makeValidatedRef();
  const targetNode = await createCapabilityNode({
    kind: 'capability',
    id: 'capability-reconciliation',
    version: '1.2.0',
    payload: { title: 'Reconciliation capability', description: 'forge fabric fixture target' },
  });
  const input: CreateExtractionPolicyInput = {
    policyId: 'policy-forge-fabric-extraction',
    version: '1.0.0',
    validation: {
      requiredVerificationOutcome: 'pass',
      minVerificationRecords: 1,
      requireEvaluations: true,
      requiredEvaluationOutcome: 'meets-criteria',
    },
    eligibility: {
      entryKinds: ['action', 'completion'],
      requireCompletedOutcome: 'completed',
    },
    thresholds: {
      minTrajectories: 1,
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
  const policy = await createExtractionPolicy(input);
  const mining = await mineSkillCandidates([ref], policy, {
    correlationId: CORR as CorrelationId,
    extractedAt: T5,
  });
  const candidate = mining.candidates[0];
  if (candidate === undefined) {
    throw new Error('fixture failure: the mining pipeline produced no candidate');
  }
  return buildSkillDraft(candidate, policy, [ref]);
}

// ---------------------------------------------------------------------------
// A020 ExperimentRunRecord fixture (REAL, through the learning computations)
// ---------------------------------------------------------------------------

function experimentInput(): CreateExperimentDescriptorInput {
  return {
    experimentId: 'experiment-reconciliation-0001',
    version: '1.0.0',
    targetCapability: {
      kind: 'capability',
      id: 'capability-reconciliation',
      version: '1.2.0',
      digest: DIGEST_F,
    },
    baseline: { bodyRef: DIGEST_D, substrateRef: DIGEST_E, runtimeRef: null },
    interventions: [
      {
        artifact: {
          namespace: 'arena-skills',
          name: 'ledger-reconciliation-checklist',
          version: '1.0.0',
          digest: DIGEST_A,
        },
        changedSurface: 'skills',
      },
    ],
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
    uncertainty: {
      method: 'analytic-variance',
      notes: 'variance over the pinned task population',
    },
    protectedCapabilities: [
      {
        ref: { kind: 'capability', id: 'capability-audit-trail', version: '1.0.0', digest: DIGEST_G },
        metricId: 'audit-trail-completeness',
        direction: 'higher-is-better',
      },
    ],
    provenance: { authoredBy: 'arena-body-forge-fabric-test', submittedAt: T0, notes: null },
  };
}

export async function makeExperimentRunRecord(): Promise<ExperimentRunRecord> {
  const descriptor = await createExperimentDescriptor(experimentInput());

  const baselineTrajectory = await makeTrajectory({
    trajectoryId: 'trajectory-forge-baseline',
    runId: 'tenant-a/run-forge-baseline',
  });
  const baselineEvaluation = await makeEvaluation(baselineTrajectory.chainHead as string);
  const baselineVerification = await makeVerification(baselineTrajectory.chainHead as string, 9001);
  const interventionTrajectory = await makeTrajectory({
    trajectoryId: 'trajectory-forge-intervention',
    runId: 'tenant-a/run-forge-intervention',
    actionIds: ['fetch-ledger', 'reconcile-entries', 'cross-check-totals', 'emit-report'],
  });
  const interventionEvaluation = await makeEvaluation(interventionTrajectory.chainHead as string);
  const interventionVerification = await makeVerification(interventionTrajectory.chainHead as string, 9002);

  const baselineFrozen = freezeHistoricalInputs({
    trajectories: [baselineTrajectory],
    evaluations: [baselineEvaluation],
    verifications: [baselineVerification],
  });
  const interventionFrozen = freezeHistoricalInputs({
    trajectories: [interventionTrajectory],
    evaluations: [interventionEvaluation],
    verifications: [interventionVerification],
  });

  const baselineMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 }];
  const interventionMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.01 }];
  const baselineProtected = [{ capabilityRef: DIGEST_G, value: 0.9 }];
  const interventionProtected = [{ capabilityRef: DIGEST_G, value: 0.95 }];

  const comparison = compareOutcomeMetrics(descriptor.outcomeMetrics, baselineMetrics, interventionMetrics);
  const protectedChecks = checkProtectedCapabilities(
    descriptor.protectedCapabilities,
    baselineProtected,
    interventionProtected,
  );
  const uncertainty = computeUncertaintyReport(descriptor.uncertainty, baselineMetrics, interventionMetrics);
  const attribution = attributeExperiment(descriptor, baselineFrozen, interventionFrozen, uncertainty);
  const verdict = decideCapabilityLift(
    descriptor,
    comparison,
    uncertainty,
    attribution,
    protectedChecks,
    [interventionVerification],
  );

  return createExperimentRunRecord({
    experimentKey: 'experiment-key-forge-0001',
    correlationId: CORR,
    descriptorRef: descriptor.digest as string,
    baseline: {
      trajectories: [baselineTrajectory.chainHead as string],
      evaluations: [baselineEvaluation.digest as string],
      verifications: [baselineVerification.digest as string],
    },
    intervention: {
      trajectories: [interventionTrajectory.chainHead as string],
      evaluations: [interventionEvaluation.digest as string],
      verifications: [interventionVerification.digest as string],
    },
    baselineMetrics,
    interventionMetrics,
    comparison: [...comparison],
    uncertainty,
    protectedCapabilityChecks: [...protectedChecks],
    attribution,
    verdict,
    provenance: { executedBy: 'arena-learning-fabric', recordedAt: T6, notes: null },
  });
}

// ---------------------------------------------------------------------------
// Forge manifest / policy fixtures
// ---------------------------------------------------------------------------

export function makeManifestInput(
  overrides: Partial<CreateBodyManifestInput> & {
    readonly targetVersion?: string;
    readonly citations?: CreateBodyManifestInput['provenance']['citations'];
    readonly parents?: CreateBodyManifestInput['lineage']['parents'];
    readonly supersedes?: CreateBodyManifestInput['lineage']['supersedes'];
  } = {},
): CreateBodyManifestInput {
  const {
    targetVersion,
    citations,
    parents,
    supersedes,
    provenance,
    lineage,
    ...rest
  } = overrides;
  const base: CreateBodyManifestInput = {
    manifestId: 'manifest-reconciliation-v1',
    version: '1.0.0',
    body: { tenant: 'tenant-a', name: 'ledger-reconciler' },
    targetVersion: '1.0.0',
    mission: 'Reconcile financial ledgers accurately and auditably.',
    role: 'senior-reconciliation-specialist',
    domainScope: ['finance', 'reconciliation'],
    capabilities: [
      { kind: 'capability', id: 'capability-reconciliation', version: '1.2.0', digest: DIGEST_F },
    ],
    skills: [
      { namespace: 'arena-skills', name: 'ledger-reconciliation-checklist', version: '1.0.0', digest: DIGEST_A },
    ],
    knowledge: [{ namespace: 'arena-knowledge', name: 'gaap-basics', version: '2.0.0', digest: DIGEST_B }],
    tools: [{ namespace: 'arena-tools', name: 'ledger-query-api', version: '1.1.0', digest: DIGEST_C }],
    procedures: [
      { namespace: 'arena-procedures', name: 'month-end-close-flow', version: '1.0.0', digest: DIGEST_D },
    ],
    memoryPolicy: { policyId: 'memory-append-only', statements: ['append-only recall, no rewrites'] },
    planningPolicy: { policyId: 'planning-checklist-first', statements: ['follow the checklist order'] },
    safetyPolicy: {
      policyId: 'safety-four-eyes',
      statements: ['require human sign-off before posting adjustments'],
    },
    escalation: {
      rules: [
        {
          condition: 'discrepancy-above-threshold',
          target: { type: 'user', tenant: 'tenant-a', principalId: 'controller-01' },
        },
      ],
    },
    authorityBoundaries: ['may propose adjustments; may not post them without sign-off'],
    evaluationSuites: [
      { namespace: 'arena-evaluation', name: 'reconciliation-accuracy-suite', version: '1.0.0', digest: DIGEST_E },
    ],
    verificationSuites: [
      { namespace: 'arena-verification', name: 'evidence-provenance-suite', version: '1.0.0', digest: DIGEST_F },
    ],
    environmentRequirements: [
      { namespace: 'arena-environments', name: 'erp-close-sandbox', version: '1.1.0', digest: DIGEST_B },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32768 },
    },
    rights: {
      license: 'Proprietary',
      commercialUse: 'requires-license',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['not a licensed accounting system'],
    },
    provenance: {
      author: { type: 'user', tenant: 'tenant-a', principalId: 'author-01' },
      authoredAt: T0,
      citations: [],
    },
    lineage: { parents: [] },
  };
  const mergedProvenance = { ...base.provenance, ...(provenance ?? {}) };
  if (citations !== undefined) {
    (mergedProvenance as { citations: unknown }).citations = citations;
  }
  const mergedLineage = { ...base.lineage, ...(lineage ?? {}) };
  if (parents !== undefined) {
    (mergedLineage as { parents: unknown }).parents = parents;
  }
  if (supersedes !== undefined) {
    (mergedLineage as { supersedes: unknown }).supersedes = supersedes;
  }
  return {
    ...base,
    ...rest,
    ...(targetVersion !== undefined ? { targetVersion } : {}),
    provenance: mergedProvenance,
    lineage: mergedLineage,
  } as CreateBodyManifestInput;
}

export async function makeManifest(
  overrides: Parameters<typeof makeManifestInput>[0] = {},
) {
  return createBodyManifest(makeManifestInput(overrides));
}

export async function makePolicy() {
  return createForgePolicy(defaultForgePolicyInput());
}

export function makeRecipe() {
  return {
    forgePrincipal: { type: 'service', tenant: 'tenant-a', principalId: 'arena-body-forge-fabric' },
    forgedAt: T5,
    correlationId: CORR,
  } as const;
}

export function parentRefV1() {
  return { tenant: 'tenant-a', name: 'ledger-reconciler', version: '1.0.0', digest: DIGEST_G };
}
