/**
 * The A027 REFERENCE END-TO-END CAPABILITY-GAP LEARNING SLICE.
 *
 * One deterministic function walks the FULL Arena loop, driven by an
 * EPI1.0 Epoch capability-development request through the A026 adapter:
 *
 *   Epoch capability-gap input (failed trajectory refs + evaluation gaps)
 *   → A026 adapter (typed request translation + job envelope)
 *   → CapabilityCase provisioning (A005) + lifecycle (submit, triage)
 *   → TaskSpec compilation (A008)
 *   → Environment provisioning + run (A009/A010, the A028 reference sandbox)
 *   → Trajectory (A011)
 *   → Evaluation (A012) → Verification (A013)
 *   → Skill extraction (A019) — the learned capability artifact
 *   → Learning attribution (A020) — baseline gap vs intervention, the
 *     A020 confound discipline, the capability-lift verdict
 *   → Certification citation (A023)
 *   → Typed Epoch response refs (A026) + A025 SDK read consumption
 *
 * No live model calls; every timestamp/seed/key is a fixed input.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import { createSubstrateRecord } from '@arena/model-substrate';
import type { CognitiveSubstrate, BodyVersion } from '@arena/agent-body';
import { bodyVersionRef } from '@arena/agent-body';
import type { SoftwareEngineerBodyBuild } from '@arena/body-software-engineer';
import { buildSoftwareEngineerBody } from '@arena/body-software-engineer';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import { environmentVersionRef } from '@arena/environment-protocol';
import {
  createSoftwareEngineerSandbox,
  sandboxSnapshotDigest,
  softwareEngineerRunDeclaration,
} from '@arena/environment-software-engineer';
import { submitCase, triageCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { createCompilationPolicy, TASK_QUALITY_DIMENSIONS } from '@arena/task-spec';
import type { TaskSpec, CompilationRecord } from '@arena/task-spec';
import { TaskCompilerFabric } from '@arena/task-compiler-fabric';
import {
  makeAdvanceRunCommand,
  makeCompleteRunCommand,
  makeStartRunCommand,
  makeSubmitRunCommand,
} from '@arena/environment-runtime';
import type { RunResult, RunStateSnapshot } from '@arena/environment-runtime';
import { EnvironmentRunner } from '@arena/environment-runner';
import {
  InMemoryEnvironmentRegistry,
  InMemoryEventSink,
  InMemoryRunRecordStore,
  ManualClock,
} from '@arena/environment-runner';
import { appendTrajectoryEntry, openTrajectory, verifyTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { createEvaluationCriteria, createEvaluatorDescriptor, createEvaluationRecord } from '@arena/evaluation';
import type { EvaluationCriteria, EvaluatorDescriptor, EvaluationRecord } from '@arena/evaluation';
import { EvaluationFabric } from '@arena/evaluation-fabric';
import {
  createVerifierDescriptor,
  createVerificationRecord,
} from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import { createVerificationFabric } from '@arena/verification-fabric';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import {
  createCompatibilityRegistry,
  evaluateBodySubstrateCompatibility,
} from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import { toValidatedTrajectoryRef, createExtractionPolicy } from '@arena/skill-extraction';
import type { ValidatedTrajectoryRef, SkillDraft } from '@arena/skill-extraction';
import { ExtractionService } from '@arena/skill-extraction-fabric';
import type { ExtractionRunRecord } from '@arena/skill-extraction-fabric';
import { createExperimentDescriptor } from '@arena/learning';
import type { ExperimentDescriptor } from '@arena/learning';
import { ExperimentEngine } from '@arena/learning-fabric';
import type { ExperimentRunRecord } from '@arena/learning';
import {
  createCertificationSubject,
  createCertificationSuite,
} from '@arena/certification';
import type { CertificationRecord, CertificationSuite, CertificationSubject } from '@arena/certification';
import { createCertificationFabric } from '@arena/certification-fabric';
import { ArenaApiClient, createLoopbackTransport } from '@arena/arena-sdk';
import { createApiFabric } from '@arena/api-fabric';
import type { ApiFabric } from '@arena/api-fabric';
import { EpochAdapter } from '@arena/epoch-adapter';
import type { EpochJobRecord, EpochOutputRef } from '@arena/epoch-adapter';
import { epochOutputRefFromBodyVersion, toEpochOutputRef } from '@arena/epoch-adapter';
import { makeGapEvaluator, makeGapVerifier } from './hooks.js';
import { keyOf, correlationOf, fixedClock } from './fixtures.js';
import { buildEpochGapRequest } from './fixtures.js';
import { buildTargetCapabilityNode, SCENARIO } from './fixtures.js';

// ---------------------------------------------------------------------------
// The trajectory fixtures (baseline = the GAP; intervention = the repair)
// ---------------------------------------------------------------------------

/**
 * The BASELINE trajectory: the provider's failed run — the capability
 * gap itself. No edit, no green suite, a failed completion.
 */
export async function buildBaselineTrajectory(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
  taskVersion: { readonly taskId: string; readonly version: string },
): Promise<TrajectoryRecord> {
  let record = await openTrajectory({
    trajectoryId: SCENARIO.baselineTrajectoryId,
    run: {
      taskVersion: { taskId: taskVersion.taskId, version: taskVersion.version },
      environmentVersion: {
        namespace: environment.identity.namespace,
        name: environment.identity.name,
        version: environment.version,
        digest: environment.digest,
      },
      runId: `${SCENARIO.tenant}/${SCENARIO.baselineRunKey}`,
      initialSnapshotDigest: sandboxSnapshotDigest(environment),
      runRecordDigest: null,
    },
    agentBodyRef: bodyVersion.digest,
    substrateRef: substrate.integrity.contentDigest,
    startedAt: SCENARIO.t1,
    seed: SCENARIO.seed,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'run-test-suite', input: { suite: 'reference-repair-suite' } },
    occurredAt: SCENARIO.t1,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'obs-stdout',
      channel: 'stdout',
      content: '1 failing: repairs_guard rejects minimal fixes',
    },
    occurredAt: SCENARIO.t1,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'completion',
    payload: { outcome: 'failed', evidenceDigests: [environment.digest] },
    occurredAt: SCENARIO.t1,
  });
  return record;
}

/**
 * The INTERVENTION trajectory: the completed repair loop the Arena
 * development produced — reproduce, edit, green suite, completion.
 */
export async function buildInterventionTrajectory(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
  taskVersion: { readonly taskId: string; readonly version: string },
  runRecordDigest: string,
): Promise<TrajectoryRecord> {
  let record = await openTrajectory({
    trajectoryId: SCENARIO.trajectoryId,
    run: {
      taskVersion: { taskId: taskVersion.taskId, version: taskVersion.version },
      environmentVersion: {
        namespace: environment.identity.namespace,
        name: environment.identity.name,
        version: environment.version,
        digest: environment.digest,
      },
      runId: `${SCENARIO.tenant}/${SCENARIO.runKey}`,
      initialSnapshotDigest: sandboxSnapshotDigest(environment),
      runRecordDigest,
    },
    agentBodyRef: bodyVersion.digest,
    substrateRef: substrate.integrity.contentDigest,
    startedAt: SCENARIO.t4,
    seed: SCENARIO.seed,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'run-test-suite', input: { suite: 'reference-repair-suite' } },
    occurredAt: SCENARIO.t4,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'obs-stdout',
      channel: 'stdout',
      content: '1 failing: repairs_guard rejects minimal fixes',
    },
    occurredAt: SCENARIO.t5,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'action',
    payload: { actionId: 'apply-file-edit', input: { file: 'src/repairs/guard.ts' } },
    occurredAt: SCENARIO.t6,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 4,
    kind: 'action',
    payload: { actionId: 'run-test-suite', input: { suite: 'reference-repair-suite' } },
    occurredAt: SCENARIO.t7,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 5,
    kind: 'observation',
    payload: {
      observationId: 'obs-stdout',
      channel: 'stdout',
      content: 'all 4 tests passed',
    },
    occurredAt: SCENARIO.t8,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 6,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [environment.digest] },
    occurredAt: SCENARIO.t9,
  });
  return record;
}

// ---------------------------------------------------------------------------
// The full loop
// ---------------------------------------------------------------------------

/** Everything the slice produces (the protocol-chain receipt). */
export interface GapScenarioReceipt {
  readonly substrate: CognitiveSubstrate;
  readonly bodyBuild: SoftwareEngineerBodyBuild;
  readonly bodyVersion: BodyVersion;
  readonly environment: EnvironmentDefinition;
  readonly epochRequest: Record<string, unknown>;
  readonly adapter: EpochAdapter;
  readonly apiFabric: ApiFabric;
  readonly job: EpochJobRecord;
  readonly command: Envelope<unknown>;
  readonly provisionedCase: CapabilityCase;
  readonly caseRecord: CapabilityCase;
  readonly compilationRecord: CompilationRecord;
  readonly taskSpec: TaskSpec;
  readonly runState: RunStateSnapshot;
  readonly runResult: RunResult;
  readonly baselineTrajectory: TrajectoryRecord;
  readonly trajectory: TrajectoryRecord;
  readonly criteria: EvaluationCriteria;
  readonly evaluator: EvaluatorDescriptor;
  readonly evaluationRecord: EvaluationRecord;
  readonly baselineEvaluation: EvaluationRecord;
  readonly verifier: VerifierDescriptor;
  readonly verificationRecord: VerificationRecord;
  readonly baselineVerification: VerificationRecord;
  readonly trajectoryVerifier: VerifierDescriptor;
  readonly trajectoryVerification: VerificationRecord;
  readonly baselineTrajectoryVerification: VerificationRecord;
  readonly compatibilityRecord: CompatibilityRecord;
  readonly validatedRef: ValidatedTrajectoryRef;
  readonly extractionPolicyDigest: string;
  readonly extractionRun: ExtractionRunRecord;
  readonly skillDraft: SkillDraft;
  readonly experiment: ExperimentDescriptor;
  readonly learningRun: ExperimentRunRecord;
  readonly suite: CertificationSuite;
  readonly subject: CertificationSubject;
  readonly certificationRecord: CertificationRecord;
  readonly completedJob: EpochJobRecord;
  readonly outputRefs: readonly EpochOutputRef[];
  readonly resolvedCertification: unknown;
}

/**
 * Walk the ENTIRE capability-gap learning loop deterministically.
 * See module docs.
 */
export async function runEpochCapabilityGapLoop(): Promise<GapScenarioReceipt> {
  // --- 0. Fixed reference fixtures -----------------------------------
  const environment = await createSoftwareEngineerSandbox();
  const bodyBuild = await buildSoftwareEngineerBody();
  const bodyVersion = bodyBuild.evolved.bodyVersion;
  const substrate = await createSubstrateRecord({
    adapterId: 'arena-neutral-adapter',
    adapterVersion: '1.0.0',
    modelFamily: 'reference-reasoner',
    modelId: SCENARIO.substrateId,
    modelRevision: '2026-10-02',
    modalityProfile: ['text-input', 'text-output', 'structured-input', 'structured-output'],
    toolCallingProfile: 'json-schema',
    contextLimits: { maxContextUnits: 262144, maxOutputUnits: 32768 },
    conditions: ['stable'],
  });
  const targetNode = await buildTargetCapabilityNode();

  // --- 1. The EPOCH capability-gap request (EPI1.0 raw wire form) ----
  const epochRequest = await buildEpochGapRequest({
    targetCapabilityDigest: targetNode.digest,
    domainDigest: await digestCanonical({ domain: 'software-engineering', version: '1.0.0' }),
    failedTrajectoryDigest: await digestCanonical({
      failing: 'repairs_guard',
      at: SCENARIO.t0,
    }),
    evaluationGapDigest: await digestCanonical({
      gap: 'completed repair loops',
      at: SCENARIO.t0,
    }),
    competencyDigest: await digestCanonical({ competency: 'test-repair', version: '1' }),
    environment,
    bodyVersion,
  });

  // --- 2. The A026 adapter: typed translation + job envelope ---------
  // The A025 read surface the adapter resolves outputs through.
  const apiFabric = createApiFabric();
  apiFabric.putBodyVersion(bodyVersion);
  const client = ArenaApiClient.forTenant(createLoopbackTransport(apiFabric), SCENARIO.tenant);
  const adapter = new EpochAdapter({ client, clock: fixedClock });
  const submission = await adapter.submitCapabilityDevelopmentRequest(epochRequest);
  if (submission.command === null) {
    throw new Error('the first submission must emit the run-capability-development command');
  }
  const command = submission.command as Envelope<unknown>;
  const job = adapter.startJob(submission.job.jobId);

  // --- 3. Case lifecycle: submit + triage (compilable) ---------------
  const actor = {
    type: 'service' as const,
    tenant: SCENARIO.tenant,
    principalId: 'epoch-orchestrator',
  };
  const submittedCase = await submitCase(submission.caseRecord, { at: SCENARIO.t1, actor });
  const caseRecord = await triageCase(submittedCase, {
    at: SCENARIO.t2,
    actor,
    note: 'Epoch capability-gap triage: reproducible failing test; task design unlocked.',
  });

  // --- 4. TaskSpec compilation (A008) --------------------------------
  const compiler = new TaskCompilerFabric();
  await compiler.registerCase(caseRecord);
  const policy = await createCompilationPolicy({
    policyId: SCENARIO.policyId,
    version: '1.0.0',
    description: 'the epoch capability-gap reference compilation policy',
    eligibility: { compilableStatuses: ['triaged', 'active'], minimumEvidenceCount: 1 },
    classSelection: [
      { matcher: 'tools-present', class: 'tool-use' },
      { matcher: 'always', class: 'correction' },
    ],
    difficulty: { mode: 'from-case', scale: 'arena:task-difficulty@1' },
    fieldMapping: {
      objectives: { mode: 'pass-through' },
      constraints: { mode: 'union', additional: ['attempt must be reproducible'] },
      prohibitedShortcuts: { mode: 'union', additional: ['no skipping the failing test'] },
      permittedTools: { mode: 'pass-through' },
      expectedOutputs: { mode: 'from-success-conditions' },
      instructions: {
        mode: 'template',
        template:
          'Work the case {caseId} for capability {capability} in domain {domain} (difficulty {difficulty}); objectives: {objectives}.',
      },
    },
    environment: { selection: 'first', seed: SCENARIO.seed, note: null },
    identity: { taskIdPrefix: SCENARIO.taskIdPrefix, initialVersion: '1.0.0' },
    expertQualification: {
      mode: 'from-target-capability',
      expectations: ['qualified in test repair within the last 180 days'],
      qualificationPolicy: {
        policyId: 'gap-reference-qualification-policy',
        version: '1.0.0',
        digest: await digestCanonical({ qualification: 'test-repair', version: '1' }),
      },
    },
    quality: TASK_QUALITY_DIMENSIONS.map((dimension) => ({
      dimension,
      satisfied: true,
      justification: `declared posture for ${dimension} under the epoch gap reference policy`,
    })),
    longHorizon: null,
    dataRights: { classification: 'private-tenant', licensing: null, privacyNotes: null },
  });
  await compiler.registerPolicy(policy);
  const compilation = await compiler.runCompilation(
    {
      caseDigest: caseRecord.digest,
      policyRef: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
      derivedAt: SCENARIO.t2,
      compiledAt: SCENARIO.t3,
    },
    { correlationId: correlationOf('compile'), idempotencyKey: keyOf('compile') },
  );
  const taskSpec = compilation.specs[0]!;

  // --- 5. Environment run (A010) -------------------------------------
  const runner = new EnvironmentRunner({
    clock: new ManualClock(SCENARIO.startMs),
    environments: new InMemoryEnvironmentRegistry(),
    records: new InMemoryRunRecordStore(),
    sink: new InMemoryEventSink(),
  });
  await runner.registerEnvironment(environment);
  const declaration = softwareEngineerRunDeclaration(
    environment,
    { taskId: taskSpec.identity.taskId, version: taskSpec.version },
    { runKey: SCENARIO.runKey, jobRef: SCENARIO.jobRef },
  );
  const submittedRun = await runner.submitRun(
    makeSubmitRunCommand(
      { declaration },
      { correlationId: correlationOf('submit'), idempotencyKey: keyOf('submit') },
    ),
  );
  if (!submittedRun.decision.admitted) {
    throw new Error(`run not admitted: ${submittedRun.decision.violations.join('; ')}`);
  }
  const target = { runId: submittedRun.record.runId, tenantId: SCENARIO.tenant };
  const life = (name: string) => ({
    correlationId: correlationOf(name),
    idempotencyKey: keyOf(name),
  });
  await runner.startRun(makeStartRunCommand(target, life('start')));
  await runner.advanceRun(makeAdvanceRunCommand(target, life('advance-1')));
  await runner.advanceRun(makeAdvanceRunCommand(target, life('advance-2')));
  const { state: runState, result: runResult } = await runner.completeRun(
    makeCompleteRunCommand(target, life('complete')),
  );

  // --- 6. Trajectories (A011): the baseline gap + the repair ----------
  const baselineTrajectory = await buildBaselineTrajectory(
    bodyVersion,
    substrate,
    environment,
    { taskId: taskSpec.identity.taskId, version: taskSpec.version },
  );
  const trajectory = await buildInterventionTrajectory(
    bodyVersion,
    substrate,
    environment,
    { taskId: taskSpec.identity.taskId, version: taskSpec.version },
    submittedRun.record.digest,
  );
  await verifyTrajectoryRecord(trajectory);
  await verifyTrajectoryRecord(baselineTrajectory);

  // --- 7. Evaluation (A012): the SAME evaluator version both arms ----
  const criteria = await createEvaluationCriteria({
    criteriaId: SCENARIO.criteriaId,
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-tests-green',
        weight: 3,
        description: 'the repaired test suite is green in the pinned sandbox',
        targetRef: caseRecord.digest,
      },
      {
        criterionId: 'criterion-reproduction-shown',
        weight: 1,
        description: 'the trajectory reproduces the failure before editing',
        targetRef: trajectory.chainHead,
      },
      {
        criterionId: 'criterion-no-prohibited-shortcuts',
        weight: 2,
        description: 'the failing test is repaired, not deleted or skipped',
        targetRef: trajectory.chainHead,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
  const evaluator = await createEvaluatorDescriptor({
    evaluatorId: SCENARIO.evaluatorId,
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: caseRecord.digest,
      trajectoryRef: trajectory.chainHead,
      bodyRef: bodyVersion.digest,
      substrateRef: substrate.integrity.contentDigest,
    },
    criteriaRef: criteria.digest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations: 'reference evaluator; semantic replay of the trajectory chain, not human review',
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'authored by the A027 epoch gap reference slice',
    },
  });
  const evaluationFabric = new EvaluationFabric();
  evaluationFabric.registry.registerCriteria(criteria);
  evaluationFabric.registry.registerEvaluator(evaluator, makeGapEvaluator());
  const evaluationRecord = await evaluationFabric.evaluate(
    evaluator.digest,
    caseRecord,
    trajectory,
    {
      seed: SCENARIO.seed,
      startedAt: SCENARIO.t5,
      finishedAt: SCENARIO.t6,
      provenanceNotes: 'A027 epoch gap slice intervention evaluation',
    },
  );
  // The baseline arm carries the SAME evaluator version (same descriptor
  // digest — no evaluator-version confound), judging the GAP trajectory.
  const baselineCriteria = await createEvaluationCriteria({
    criteriaId: `${SCENARIO.criteriaId}-baseline`,
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-tests-green',
        weight: 3,
        description: 'the repaired test suite is green in the pinned sandbox',
        targetRef: caseRecord.digest,
      },
      {
        criterionId: 'criterion-reproduction-shown',
        weight: 1,
        description: 'the trajectory reproduces the failure before editing',
        targetRef: baselineTrajectory.chainHead,
      },
      {
        criterionId: 'criterion-no-prohibited-shortcuts',
        weight: 2,
        description: 'the failing test is repaired, not deleted or skipped',
        targetRef: baselineTrajectory.chainHead,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
  const baselineEvaluation = await createEvaluationRecord(
    {
      evaluatorRef: evaluator.digest,
      caseRef: caseRecord.digest,
      trajectoryRef: baselineTrajectory.chainHead,
      criteriaRef: baselineCriteria.digest,
      seed: SCENARIO.seed,
      verdicts: [
        { criterionId: 'criterion-tests-green', score: 0, judgment: 'suite not green at completion', notes: null },
        { criterionId: 'criterion-reproduction-shown', score: 1, judgment: 'failure reproduced', notes: null },
        { criterionId: 'criterion-no-prohibited-shortcuts', score: 0, judgment: 'run failed', notes: null },
      ],
      confidence: 0.9,
      limitations: null,
      startedAt: SCENARIO.t1,
      finishedAt: SCENARIO.t1,
      provenance: {
        executedBy: 'gap-repair-evaluator',
        recordedAt: SCENARIO.t1,
        notes: 'the baseline (gap) arm judged by the same evaluator version',
      },
    },
    baselineCriteria,
  );

  // --- 8. Verification (A013): evidence artifacts, both arms ---------
  const verifier = await createVerifierDescriptor({
    verifierId: SCENARIO.verifierId,
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'requirement-test-report',
        evidenceKind: 'test-report',
        claim: 'the repaired test suite passes against the pinned sandbox',
        artifact: null,
        requiredProducer: null,
      },
      {
        requirementId: 'requirement-trajectory-proof',
        evidenceKind: 'trajectory-proof',
        claim: 'the trajectory chain verifies and ends in a completed outcome',
        artifact: null,
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'every declared requirement is satisfied by digest-verified evidence',
      fail: 'digest-verified evidence is present but contradicts a declared requirement',
      unknown: 'at least one declared requirement cannot be decided',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'authored by the A027 epoch gap reference slice',
    },
  });
  const verificationFabric = createVerificationFabric();
  verificationFabric.registry.registerVerifier(
    verifier,
    makeGapVerifier({
      chainHead: trajectory.chainHead,
      entryCount: trajectory.entries.length,
      outcome: 'completed',
    }),
  );
  const greenReport = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'gap-test-report-0001', version: '1.0.0' },
    content: { suite: 'reference-repair-suite', testsRun: 4, passed: 4, failures: [] },
  });
  const greenProof = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'gap-trajectory-proof-0001', version: '1.0.0' },
    content: {
      chainHead: trajectory.chainHead,
      outcome: 'completed',
      entryCount: trajectory.entries.length,
    },
  });
  verificationFabric.putArtifact(greenReport);
  verificationFabric.putArtifact(greenProof);
  const verificationRecord = await verificationFabric.verify(
    verifier.digest,
    [
      {
        evidenceKind: 'test-report',
        artifact: {
          namespace: greenReport.identity.namespace,
          name: greenReport.identity.name,
          version: greenReport.identity.version,
          digest: greenReport.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t8, notes: null },
      },
      {
        evidenceKind: 'trajectory-proof',
        artifact: {
          namespace: greenProof.identity.namespace,
          name: greenProof.identity.name,
          version: greenProof.identity.version,
          digest: greenProof.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t9, notes: null },
      },
    ],
    {
      correlationId: correlationOf('verify'),
      idempotencyKey: keyOf('verify'),
      startedAt: SCENARIO.t6,
      finishedAt: SCENARIO.t7,
      provenanceNotes: 'A027 epoch gap slice intervention verification',
    },
  );
  // The baseline (gap) verification: red report + failed proof → fail.
  const redReport = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'gap-test-report-baseline', version: '1.0.0' },
    content: {
      suite: 'reference-repair-suite',
      testsRun: 4,
      passed: 3,
      failures: ['repairs_guard rejects minimal fixes'],
    },
  });
  const redProof = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'gap-trajectory-proof-baseline', version: '1.0.0' },
    content: {
      chainHead: baselineTrajectory.chainHead,
      outcome: 'failed',
      entryCount: baselineTrajectory.entries.length,
    },
  });
  verificationFabric.putArtifact(redReport);
  verificationFabric.putArtifact(redProof);
  const baselineVerification = await verificationFabric.verify(
    verifier.digest,
    [
      {
        evidenceKind: 'test-report',
        artifact: {
          namespace: redReport.identity.namespace,
          name: redReport.identity.name,
          version: redReport.identity.version,
          digest: redReport.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t1, notes: null },
      },
      {
        evidenceKind: 'trajectory-proof',
        artifact: {
          namespace: redProof.identity.namespace,
          name: redProof.identity.name,
          version: redProof.identity.version,
          digest: redProof.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t1, notes: null },
      },
    ],
    {
      correlationId: correlationOf('verify-baseline'),
      idempotencyKey: keyOf('verify-baseline'),
      startedAt: SCENARIO.t1,
      finishedAt: SCENARIO.t1,
      provenanceNotes: 'A027 epoch gap slice baseline verification (the gap fails closed)',
    },
  );

  // The trajectory-citing verification records (A019's R17 binding
  // discipline: the verification EVIDENCE is the trajectory digest).
  const trajectoryVerifier = await createVerifierDescriptor({
    verifierId: SCENARIO.trajectoryVerifierId,
    version: '1.0.0',
    method: 'evidence_provenance_validation',
    requiredEvidence: [
      {
        requirementId: 'requirement-trajectory',
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
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'authored by the A027 epoch gap reference slice',
    },
  });
  const trajectoryVerification = await createVerificationRecord(
    {
      verifierRef: trajectoryVerifier.digest,
      evidence: [
        {
          evidenceKind: 'trajectory',
          artifact: {
            namespace: 'arena-traj',
            name: `trajectory-${trajectory.chainHead.slice(0, 12)}`,
            version: '1.0.0',
            digest: trajectory.chainHead,
          },
          provenance: { producedBy: 'arena-reference-fabric', producedAt: SCENARIO.t9, notes: null },
        },
      ],
      evidenceSupport: [
        {
          requirementId: 'requirement-trajectory',
          status: 'present-supported',
          evidenceDigest: trajectory.chainHead,
          notes: null,
        },
      ],
      correlationId: correlationOf('verify-trajectory'),
      idempotencyKey: keyOf('verify-trajectory'),
      startedAt: SCENARIO.t8,
      finishedAt: SCENARIO.t9,
      provenance: {
        executedBy: SCENARIO.trajectoryVerifierId,
        recordedAt: SCENARIO.t9,
        notes: null,
      },
    },
    trajectoryVerifier,
  );
  const baselineTrajectoryVerification = await createVerificationRecord(
    {
      verifierRef: trajectoryVerifier.digest,
      evidence: [
        {
          evidenceKind: 'trajectory',
          artifact: {
            namespace: 'arena-traj',
            name: `trajectory-${baselineTrajectory.chainHead.slice(0, 12)}`,
            version: '1.0.0',
            digest: baselineTrajectory.chainHead,
          },
          provenance: { producedBy: 'arena-reference-fabric', producedAt: SCENARIO.t1, notes: null },
        },
      ],
      evidenceSupport: [
        {
          requirementId: 'requirement-trajectory',
          status: 'present-unsupported',
          evidenceDigest: baselineTrajectory.chainHead,
          notes: null,
        },
      ],
      correlationId: correlationOf('verify-baseline-trajectory'),
      idempotencyKey: keyOf('verify-baseline-trajectory'),
      startedAt: SCENARIO.t1,
      finishedAt: SCENARIO.t1,
      provenance: {
        executedBy: SCENARIO.trajectoryVerifierId,
        recordedAt: SCENARIO.t1,
        notes: null,
      },
    },
    trajectoryVerifier,
  );

  // --- 9. Skill extraction (A019): the learned capability artifact ---
  const validatedRef = await toValidatedTrajectoryRef({
    trajectory,
    evaluations: [evaluationRecord],
    verifications: [trajectoryVerification],
  });
  const extractionPolicy = await createExtractionPolicy({
    policyId: SCENARIO.extractionPolicyId,
    version: '1.0.0',
    validation: {
      requiredVerificationOutcome: 'pass',
      minVerificationRecords: 1,
      requireEvaluations: true,
      requiredEvaluationOutcome: 'meets-criteria',
    },
    eligibility: {
      entryKinds: ['action', 'observation', 'completion'],
      requireCompletedOutcome: 'completed',
    },
    thresholds: { minTrajectories: 1, minOccurrences: 1 },
    taxonomy: {
      targetNode: {
        kind: 'capability',
        id: 'test-repair',
        version: '1.0.0',
        digest: targetNode.digest,
      },
    },
  });
  const extractionService = new ExtractionService();
  await extractionService.registerPolicy(extractionPolicy);
  const extractionRun = await extractionService.extract(
    extractionPolicy.digest,
    [validatedRef],
    {
      runKey: 'run-key-gap-extract-0001',
      correlationId: correlationOf('extract'),
      startedAt: SCENARIO.t10,
      finishedAt: SCENARIO.t11,
    },
  );
  const draftDigest = extractionRun.drafts[0];
  if (draftDigest === undefined) {
    throw new Error('the extraction run must emit at least one skill draft');
  }
  const skillDraft = extractionService.getDraft(draftDigest)!;

  // --- 10. Learning attribution (A020): gap → lift -------------------
  const experiment = await createExperimentDescriptor({
    experimentId: SCENARIO.experimentId,
    version: '1.0.0',
    targetCapability: {
      kind: 'capability',
      id: 'test-repair',
      version: '1.0.0',
      digest: targetNode.digest,
    },
    baseline: {
      bodyRef: bodyVersion.digest,
      substrateRef: substrate.integrity.contentDigest,
      runtimeRef: await digestCanonical({ runtimeId: SCENARIO.runtimeId, runtimeVersion: '1.0.0' }),
    },
    interventions: [
      {
        artifact: {
          namespace: SCENARIO.tenant,
          name: skillDraft.skillNode.id,
          version: skillDraft.skillNode.version,
          digest: skillDraft.digest,
        },
        changedSurface: 'skills',
      },
    ],
    taskPopulation: [{ taskId: taskSpec.identity.taskId, version: taskSpec.version }],
    evaluationSuiteRefs: [criteria.digest],
    verificationSuiteRefs: [verifier.digest],
    environmentVersions: [environmentVersionRef(environment)],
    outcomeMetrics: [
      {
        metricId: 'gap-resolution-score',
        description: 'weighted criteria score of the capability-gap task population',
        direction: 'higher-is-better',
      },
    ],
    uncertainty: { method: 'analytic-variance', notes: 'deterministic reference slice' },
    protectedCapabilities: [
      {
        ref: {
          kind: 'capability',
          id: 'regression-guard',
          version: '1.0.0',
          digest: await digestCanonical({ capability: 'regression-guard', version: '1' }),
        },
        metricId: 'regression-guard-score',
        direction: 'higher-is-better',
      },
    ],
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'the A027 epoch capability-gap learning experiment',
    },
  });
  const engine = new ExperimentEngine();
  await engine.registerExperiment(experiment);
  const learningRun = await engine.run(
    experiment.digest,
    {
      baseline: {
        trajectories: [baselineTrajectory],
        evaluations: [baselineEvaluation],
        verifications: [baselineTrajectoryVerification],
        metrics: [{ metricId: 'gap-resolution-score', value: 0.17, variance: 0.01 }],
        protectedMetrics: [
          { capabilityRef: experiment.protectedCapabilities[0]!.ref.digest, value: 0.9 },
        ],
      },
      intervention: {
        trajectories: [trajectory],
        evaluations: [evaluationRecord],
        verifications: [trajectoryVerification],
        metrics: [{ metricId: 'gap-resolution-score', value: 1, variance: 0.01 }],
        protectedMetrics: [
          { capabilityRef: experiment.protectedCapabilities[0]!.ref.digest, value: 0.95 },
        ],
      },
    },
    {
      experimentKey: 'exp-key-gap-0001',
      correlationId: correlationOf('learn'),
      recordedAt: SCENARIO.t10,
      provenanceNotes: 'A027 epoch gap slice learning run',
    },
  );

  // --- 11. Certification citation (A023) -----------------------------
  const compatibility = await evaluateBodySubstrateCompatibility(
    bodyVersion.substrateCompatibility,
    substrate,
  );
  if (compatibility.verdict !== 'compatible') {
    throw new Error(`reference substrate must be compatible: ${compatibility.reasons.join('; ')}`);
  }
  const compatibilityRegistry = createCompatibilityRegistry();
  const compatibilityRecord = await compatibilityRegistry.createAndRegister(
    `${bodyVersion.body.tenant}/${bodyVersion.body.name}@${bodyVersion.version}#${bodyVersion.digest}`,
    `${substrate.modelId}@1.0.0#${substrate.integrity.contentDigest}`,
    { verdict: 'compatible', reasons: [], details: { walkthrough: 'A027 epoch gap slice' } },
    SCENARIO.t7,
  );
  const subject = createCertificationSubject({
    bodyVersionRef: {
      tenant: bodyVersion.body.tenant,
      name: bodyVersion.body.name,
      version: bodyVersion.version,
      digest: bodyVersion.digest,
    },
    substrateRef: {
      substrateId: substrate.modelId,
      substrateVersion: '1.0.0',
      digest: substrate.integrity.contentDigest,
    },
    environmentRef: {
      environmentId: environment.identity.name,
      environmentVersion: environment.version,
      constraints: ['seeded-simulation', 'declared-mounts-only', 'default-deny-egress'],
    },
    runtimeProfile: {
      runtimeId: SCENARIO.runtimeId,
      runtimeVersion: '1.0.0',
      configuration: { timeoutMs: 30000, maxSteps: 64 },
    },
    possessionRef: null,
    tenantId: SCENARIO.tenant,
    workspaceId: SCENARIO.workspaceId,
  });
  const suite = await createCertificationSuite({
    suiteId: SCENARIO.suiteId,
    version: '1.0.0',
    levelGrant: 'CANDIDATE',
    stages: [
      {
        stageId: 'stage-verify-evidence',
        kind: 'verification',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: verifier.digest,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
      {
        stageId: 'stage-evaluate-repair',
        kind: 'evaluation',
        evaluatorRef: evaluator.digest,
        criteriaRef: criteria.digest,
        verifierRef: null,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
      {
        stageId: 'stage-compat-substrate',
        kind: 'compatibility',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: null,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
    ],
    constraints: [],
    limitations: null,
    supersedes: null,
    inputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
    outputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'the A027 epoch gap certification suite for the candidate channel',
    },
  });
  const certificationFabric = createCertificationFabric();
  certificationFabric.registry.registerSuite(suite);
  certificationFabric.putVerificationRecord(verificationRecord);
  certificationFabric.putEvaluationRecord(evaluationRecord);
  certificationFabric.putCompatibilityRecord(compatibilityRecord);
  const certificationRecord = await certificationFabric.certify(
    suite.digest,
    subject,
    [verificationRecord.digest, evaluationRecord.digest, compatibilityRecord.recordDigest],
    {
      correlationId: correlationOf('certify'),
      idempotencyKey: keyOf('certify'),
      startedAt: SCENARIO.t10,
      finishedAt: SCENARIO.t11,
      provenanceNotes: 'A027 epoch gap slice certification',
    },
  );

  // --- 12. The typed EPOCH response (A026) + A025 read-back ----------
  apiFabric.putCertificationRecord(certificationRecord);
  apiFabric.putCertificationSuite(suite);
  apiFabric.putCompatibilityRecord(compatibilityRecord);
  const outputRefs: readonly EpochOutputRef[] = [
    toEpochOutputRef({
      refVersion: 1,
      kind: 'task-spec',
      digest: taskSpec.digest,
      address: `arena:task-spec/${taskSpec.identity.taskId}@${taskSpec.version}#${taskSpec.digest}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'environment',
      digest: environment.digest,
      address: `arena:environment/${environment.identity.namespace}/${environment.identity.name}@${environment.version}#${environment.digest}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'trajectory-set',
      digest: trajectory.chainHead,
      address: `arena:trajectory/${SCENARIO.trajectoryId}#${trajectory.chainHead}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'evaluator',
      digest: evaluator.digest,
      address: `arena:evaluator/${SCENARIO.evaluatorId}#${evaluator.digest}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'verifier',
      digest: verifier.digest,
      address: `arena:verifier/${SCENARIO.verifierId}#${verifier.digest}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'skill-artifact',
      digest: skillDraft.digest,
      address: `arena:skill/${skillDraft.skillNode.id}#${skillDraft.digest}`,
    }),
    epochOutputRefFromBodyVersion(bodyVersionRef(bodyVersion)),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'compatibility-report',
      digest: compatibilityRecord.recordDigest,
      address: `arena:compatibility/${bodyVersion.body.name}#${compatibilityRecord.recordDigest}`,
    }),
    toEpochOutputRef({
      refVersion: 1,
      kind: 'certification',
      digest: certificationRecord.digest,
      address: `arena:certification/${SCENARIO.suiteId}#${certificationRecord.digest}`,
    }),
  ];
  const completedJob = adapter.completeJob(job.jobId, { refs: outputRefs });
  const certificationRef = outputRefs.find((ref) => ref.kind === 'certification')!;
  const resolvedCertification = await adapter.resolveOutputRef(certificationRef);

  return {
    substrate,
    bodyBuild,
    bodyVersion,
    environment,
    epochRequest,
    adapter,
    apiFabric,
    job,
    command,
    provisionedCase: submission.caseRecord,
    caseRecord,
    compilationRecord: compilation.record,
    taskSpec,
    runState,
    runResult,
    baselineTrajectory,
    trajectory,
    criteria,
    evaluator,
    evaluationRecord,
    baselineEvaluation,
    verifier,
    verificationRecord,
    baselineVerification,
    trajectoryVerifier,
    trajectoryVerification,
    baselineTrajectoryVerification,
    compatibilityRecord,
    validatedRef,
    extractionPolicyDigest: extractionPolicy.digest,
    extractionRun,
    skillDraft,
    experiment,
    learningRun,
    suite,
    subject,
    certificationRecord,
    completedJob,
    outputRefs,
    resolvedCertification,
  };
}

/** Digest map of the receipt (the regression pin basis). */
export function receiptDigests(receipt: GapScenarioReceipt): Record<string, string> {
  return {
    bodyVersion: receipt.bodyVersion.digest,
    case: receipt.caseRecord.digest,
    taskSpec: receipt.taskSpec.digest,
    runRecord: receipt.runResult.recordDigest,
    baselineTrajectory: receipt.baselineTrajectory.chainHead,
    trajectory: receipt.trajectory.chainHead,
    criteria: receipt.criteria.digest,
    evaluator: receipt.evaluator.digest,
    evaluation: receipt.evaluationRecord.digest,
    baselineEvaluation: receipt.baselineEvaluation.digest,
    verifier: receipt.verifier.digest,
    verification: receipt.verificationRecord.digest,
    baselineVerification: receipt.baselineVerification.digest,
    trajectoryVerification: receipt.trajectoryVerification.digest,
    compatibility: receipt.compatibilityRecord.recordDigest,
    skillDraft: receipt.skillDraft.digest,
    experiment: receipt.experiment.digest,
    learningRun: receipt.learningRun.digest,
    suite: receipt.suite.digest,
    certification: receipt.certificationRecord.digest,
  };
}
