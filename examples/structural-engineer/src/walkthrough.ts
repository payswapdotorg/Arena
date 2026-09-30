/**
 * The A029 REFERENCE END-TO-END WALKTHROUGH.
 *
 * One deterministic function walks the ENTIRE Arena protocol chain for
 * the Structural Engineer Agent Body:
 *
 *   Body (A021 forge + A003 lineage)
 *   → Substrate (A016) → Possession (A003)
 *   → Capability Case (A005) → TaskSpec compilation (A008)
 *   → Environment provisioning + run (A009/A010)
 *   → Trajectory (A011)
 *   → Evaluation (A012) → Verification (A013)
 *   → Compatibility (A022) → Certification (A023)
 *   → Release registration + publication (A024)
 *   → SDK read consumption (A025)
 *
 * No live model calls; every timestamp/seed/key is a fixed input.
 */

import { toCorrelationId, toIdempotencyKey, digestCanonical } from '@arena/protocol-core';
import { createPossession } from '@arena/agent-body';
import type { BodyVersion, Possession } from '@arena/agent-body';
import { createSubstrateRecord } from '@arena/model-substrate';
import type { CognitiveSubstrate } from '@arena/agent-body';
import { createCapabilityCase, submitCase, triageCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { createCompilationPolicy, TASK_QUALITY_DIMENSIONS } from '@arena/task-spec';
import type { CompilationPolicy, TaskSpec, CompilationRecord } from '@arena/task-spec';
import { TaskCompilerFabric } from '@arena/task-compiler-fabric';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import { environmentVersionRef } from '@arena/environment-protocol';
import {
  makeAdvanceRunCommand,
  makeCheckpointRunCommand,
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
import { createEvaluationCriteria, createEvaluatorDescriptor } from '@arena/evaluation';
import type { EvaluationCriteria, EvaluatorDescriptor, EvaluationRecord } from '@arena/evaluation';
import { EvaluationFabric } from '@arena/evaluation-fabric';
import { createVerifierDescriptor } from '@arena/verification';
import type { VerifierDescriptor, VerificationRecord } from '@arena/verification';
import { createVerificationFabric } from '@arena/verification-fabric';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import {
  createCompatibilityRegistry,
  evaluateBodySubstrateCompatibility,
} from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import {
  createCertificationSubject,
  createCertificationSuite,
} from '@arena/certification';
import type { CertificationRecord, CertificationSuite, CertificationSubject } from '@arena/certification';
import { createCertificationFabric } from '@arena/certification-fabric';
import { memoryStore } from '@arena/body-registry';
import type { ReleaseRecord } from '@arena/body-registry';
import { BodyRegistryService } from '@arena/body-registry-fabric';
import type { ReleasePublicationRecord } from '@arena/body-registry';
import { ArenaApiClient, createLoopbackTransport } from '@arena/arena-sdk';
import { createApiFabric } from '@arena/api-fabric';
import {
  buildStructuralEngineerBody,
  latestStructuralEngineerVersionRef,
} from '@arena/body-structural-engineer';
import type { StructuralEngineerBodyBuild } from '@arena/body-structural-engineer';
import {
  createStructuralAnalysisSandbox,
  sandboxSnapshotDigest,
  structuralEngineerRunDeclaration,
  STRUCTURAL_ENGINEER_RUN_SEED,
} from '@arena/environment-structural-engineer';
import { makeStructuralEngineerEvaluator, makeStructuralEngineerVerifier } from './hooks.js';
import type { StructComplianceReportContent, StructTrajectoryProofContent } from './hooks.js';

// ---------------------------------------------------------------------------
// Fixed scenario inputs (determinism: no clock reads, no randomness)
// ---------------------------------------------------------------------------

export const SCENARIO = Object.freeze({
  tenant: 'arena-reference',
  caseId: 'case-struct-failing-check',
  taskIdPrefix: 'task-struct-',
  policyId: 'policy-struct-reference',
  trajectoryId: 'trajectory-struct-reference-0001',
  runKey: 'run-struct-reference-0001',
  jobRef: 'job-struct-reference-0001',
  substrateId: 'reference-reasoner-1',
  runtimeId: 'arena-runtime',
  environmentId: 'structural-analysis-sandbox',
  workspaceId: 'ws-reference',
  suiteId: 'suite-struct-reference-certification',
  evaluatorId: 'struct-compliance-suite-evaluator',
  verifierId: 'struct-evidence-verifier',
  seed: STRUCTURAL_ENGINEER_RUN_SEED,
  startMs: Date.parse('2026-10-02T09:00:00.000Z'),
  t0: '2026-10-02T09:00:00.000Z',
  t1: '2026-10-02T09:01:00.000Z',
  t2: '2026-10-02T09:02:00.000Z',
  t3: '2026-10-02T09:03:00.000Z',
  t4: '2026-10-02T09:04:00.000Z',
  t5: '2026-10-02T09:05:00.000Z',
  t6: '2026-10-02T09:06:00.000Z',
  t7: '2026-10-02T09:07:00.000Z',
  t8: '2026-10-02T09:08:00.000Z',
  t9: '2026-10-02T09:09:00.000Z',
});

// Fixed per-step keys (deterministic under any execution interleaving).
function keyOf(name: string) {
  return toIdempotencyKey(`idem-struct-${name}`);
}
function correlationOf(name: string) {
  return toCorrelationId(`corr-struct-${name}`);
}

// ---------------------------------------------------------------------------
// Stage builders (reused by the walkthrough and the adversarial tests)
// ---------------------------------------------------------------------------

/** The reference cognitive substrate: a neutral, offline reasoner. */
export async function buildReferenceSubstrate(
  overrides: {
    readonly toolCallingProfile?: string;
    readonly conditions?: readonly string[];
    readonly contextUnits?: number;
  } = {},
): Promise<CognitiveSubstrate> {
  return createSubstrateRecord({
    adapterId: 'arena-neutral-adapter',
    adapterVersion: '1.0.0',
    modelFamily: 'reference-reasoner',
    modelId: SCENARIO.substrateId,
    modelRevision: '2026-10-02',
    modalityProfile: ['text-input', 'text-output', 'structured-input', 'structured-output'],
    toolCallingProfile: overrides.toolCallingProfile ?? 'json-schema',
    contextLimits: {
      maxContextUnits: overrides.contextUnits ?? 262144,
      maxOutputUnits: 32768,
    },
    conditions: overrides.conditions ?? ['stable'],
  });
}

/** Bind body version + substrate + runtime + environment + policies. */
export async function buildPossession(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
): Promise<Possession> {
  return createPossession({
    bodyVersion,
    substrate,
    runtime: {
      runtimeId: SCENARIO.runtimeId,
      runtimeVersion: '1.0.0',
      configuration: { timeoutMs: 30000, maxSteps: 64 },
    },
    environment: {
      environmentId: environment.identity.name,
      environmentVersion: environment.version,
      constraints: ['seeded-simulation', 'declared-mounts-only', 'default-deny-egress'],
    },
    policies: {
      bundleId: 'bundle-struct-reference',
      bundleVersion: '1.0.0',
      policies: [
        {
          policyId: 'memory-task-scoped',
          statements: ['retain task-scoped working notes only'],
        },
        {
          policyId: 'safety-no-silent-capacity',
          statements: ['never silently assume capacity; cite the pinned code edition'],
        },
      ],
    },
    modelSpecificArtifacts: [],
  });
}

/** The reference capability case: a failing gravity ULS check in the tenant model. */
export async function buildCase(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
): Promise<CapabilityCase> {
  const envRef = environmentVersionRef(environment);
  const evaluatorRequirementDigest = await digestCanonical({
    evaluatorId: SCENARIO.evaluatorId,
    version: '1.0.0',
    expectation: 'judge analysis-correction trajectories against the reference criteria',
  });
  const verifierRequirementDigest = await digestCanonical({
    verifierId: SCENARIO.verifierId,
    version: '1.0.0',
    expectation: 'verify green compliance reports and trajectory-chain proofs',
  });
  const draft = await createCapabilityCase({
    identity: { tenant: SCENARIO.tenant, caseId: SCENARIO.caseId },
    version: '1.0.0',
    source: { type: 'user', tenant: SCENARIO.tenant, principalId: 'engineer-01' },
    problemStatement:
      'The gravity ULS check fails on transfer beam B-1: the load model rejects a minimal, correct parameter correction.',
    targetCapability: {
      kind: 'capability',
      id: 'code-compliance-correction',
      version: '1.0.0',
      digest: bodyVersion.lineage.parents[0]?.digest ?? bodyVersion.digest,
    },
    domain: {
      kind: 'domain',
      id: 'structural-engineering',
      version: '1.0.0',
      digest: await digestCanonical({ domain: 'structural-engineering', version: '1.0.0' }),
    },
    context:
      'Reference tenant workload: a failing gravity ULS check on transfer beam B-1 blocks the code-compliance report.',
    observedFailure: {
      summary:
        'beam-b1-gravity-uls check fails: utilization 1.12 exceeds the 1.00 limit under load combination 1.4D+1.6L.',
      observedAt: SCENARIO.t0,
      reproduction:
        'Run the reference compliance check set on the pinned analysis-sandbox snapshot.',
    },
    evidence: [
      {
        digest: await digestCanonical({
          failing: 'beam-b1-gravity-uls',
          utilization: 1.12,
          at: SCENARIO.t0,
        }),
        description: 'Failing solver output captured from the sandbox run.',
      },
    ],
    unknowns: [
      'Whether the tributary-width mismatch against drawing S-201 is a model defect or a drawing revision',
    ],
    desiredOutcome:
      'The failing check is corrected through a minimal, reviewable load-model change and the check set is green.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'code-compliance-correction',
          version: '1.0.0',
          digest: bodyVersion.digest,
        },
      ],
      qualifications: ['senior-structural-engineer'],
    },
    environmentRequirements: {
      environments: [envRef],
      constraints: ['No live network writes; internal reference-data registries only'],
    },
    taskRequirements: {
      objectives: ['Correct the load model so the gravity ULS check on B-1 passes'],
      constraints: ['Use only the pinned sandbox snapshot and the pinned code edition'],
      allowedTools: bodyVersion.tools,
      forbiddenShortcuts: ['Do not waive or relax the failing limit-state criterion to make it pass'],
      successConditions: ['The full reference compliance check set passes in the sandbox'],
      evidenceCriteria: ['A trajectory showing reproduction, correction and a green re-run'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        {
          kind: 'evaluator',
          id: SCENARIO.evaluatorId,
          version: '1.0.0',
          digest: evaluatorRequirementDigest,
        },
      ],
      criteria: ['The correction loop is completed: failing check, correction, green check set'],
    },
    verificationRequirements: {
      verifiers: [
        {
          kind: 'verifier',
          id: SCENARIO.verifierId,
          version: '1.0.0',
          digest: verifierRequirementDigest,
        },
      ],
      evidenceStandards: ['Green compliance report and trajectory-chain proof, digest-pinned'],
    },
    currentBody: {
      tenant: bodyVersion.body.tenant,
      name: bodyVersion.body.name,
      version: bodyVersion.version,
      digest: bodyVersion.digest,
    },
    currentSubstrate: {
      adapterId: substrate.adapterId,
      modelFamily: substrate.modelFamily,
      modelId: substrate.modelId,
      modelRevision: substrate.modelRevision,
      contentDigest: substrate.integrity.contentDigest,
    },
    provenance: {
      recordDigest: await digestCanonical({ case: SCENARIO.caseId, version: '1.0.0' }),
    },
    priority: 'high',
    risk: 'moderate',
    createdAt: SCENARIO.t0,
  });
  const submitted = await submitCase(draft, {
    at: SCENARIO.t1,
    actor: { type: 'user', tenant: SCENARIO.tenant, principalId: 'engineer-01' },
  });
  return triageCase(submitted, {
    at: SCENARIO.t2,
    actor: { type: 'user', tenant: SCENARIO.tenant, principalId: 'engineer-01' },
    note: 'Triage rationale: reproducible failing check with a pinned code edition; task design unlocked.',
  });
}

/** The structural-engineer reference compilation policy. */
export async function buildCompilationPolicy(): Promise<CompilationPolicy> {
  return createCompilationPolicy({
    policyId: SCENARIO.policyId,
    version: '1.0.0',
    description: 'the structural-engineer reference compilation policy',
    eligibility: { compilableStatuses: ['triaged', 'active'], minimumEvidenceCount: 1 },
    classSelection: [
      { matcher: 'tools-present', class: 'tool-use' },
      { matcher: 'always', class: 'correction' },
    ],
    difficulty: { mode: 'from-case', scale: 'arena:task-difficulty@1' },
    fieldMapping: {
      objectives: { mode: 'pass-through' },
      constraints: { mode: 'union', additional: ['attempt must be reproducible'] },
      prohibitedShortcuts: {
        mode: 'union',
        additional: ['no relaxing the failing limit-state criterion'],
      },
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
      expectations: ['qualified in code-compliance correction within the last 180 days'],
      qualificationPolicy: {
        policyId: 'struct-reference-qualification-policy',
        version: '1.0.0',
        digest: await digestCanonical({ qualification: 'code-compliance-correction', version: '1' }),
      },
    },
    quality: TASK_QUALITY_DIMENSIONS.map((dimension) => ({
      dimension,
      satisfied: true,
      justification: `declared posture for ${dimension} under the structural-engineer reference policy`,
    })),
    longHorizon: null,
    dataRights: { classification: 'private-tenant', licensing: null, privacyNotes: null },
  });
}

/** The agent trajectory: reproduce → correct → re-run → completion. */
export async function buildTrajectory(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
  taskVersion: { readonly taskId: string; readonly version: string },
  runRecordDigest: string,
  options: { readonly completed?: boolean } = {},
): Promise<TrajectoryRecord> {
  const completed = options.completed ?? true;
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
    payload: { actionId: 'run-structural-analysis', input: { suite: 'reference-compliance-suite' } },
    occurredAt: SCENARIO.t4,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'obs-solver-log',
      channel: 'stdout',
      content: '1 failing: beam-b1-gravity-uls utilization 1.12 exceeds limit 1.00',
    },
    occurredAt: SCENARIO.t5,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'action',
    payload: {
      actionId: 'update-load-model',
      input: { parameter: 'tributary-width', source: 'drawing-s-201' },
    },
    occurredAt: SCENARIO.t6,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 4,
    kind: 'action',
    payload: { actionId: 'run-structural-analysis', input: { suite: 'reference-compliance-suite' } },
    occurredAt: SCENARIO.t7,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 5,
    kind: 'observation',
    payload: {
      observationId: 'obs-solver-log',
      channel: 'stdout',
      content: 'all 4 checks passed',
    },
    occurredAt: SCENARIO.t8,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 6,
    kind: 'completion',
    payload: {
      outcome: completed ? 'completed' : 'failed',
      evidenceDigests: [environment.digest],
    },
    occurredAt: SCENARIO.t9,
  });
  return record;
}

/** The reference evaluation criteria bound to a case + trajectory. */
export async function buildCriteria(
  caseDigest: string,
  trajectoryDigest: string,
): Promise<EvaluationCriteria> {
  return createEvaluationCriteria({
    criteriaId: 'criteria-struct-check-correction',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-checks-green',
        weight: 2,
        description: 'the corrected compliance check set is green in the pinned sandbox',
        targetRef: caseDigest,
      },
      {
        criterionId: 'criterion-reproduction-shown',
        weight: 1,
        description: 'the trajectory reproduces the failing check before correcting',
        targetRef: trajectoryDigest,
      },
      {
        criterionId: 'criterion-no-prohibited-shortcuts',
        weight: 1,
        description: 'the failing check is corrected, not waived or relaxed',
        targetRef: trajectoryDigest,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
}

/** The reference evaluator descriptor bound to case + trajectory + criteria. */
export async function buildEvaluatorDescriptor(
  caseDigest: string,
  trajectoryDigest: string,
  criteriaDigest: string,
  bodyDigest: string,
  substrateDigest: string,
): Promise<EvaluatorDescriptor> {
  return createEvaluatorDescriptor({
    evaluatorId: SCENARIO.evaluatorId,
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: caseDigest,
      trajectoryRef: trajectoryDigest,
      bodyRef: bodyDigest,
      substrateRef: substrateDigest,
    },
    criteriaRef: criteriaDigest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations:
      'reference evaluator; semantic replay of the trajectory chain, not licensed engineering review',
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: SCENARIO.t0,
      notes: 'authored by the A029 reference walkthrough',
    },
  });
}

/** The reference verifier descriptor (constraint_check, two requirements). */
export async function buildVerifierDescriptor(): Promise<VerifierDescriptor> {
  return createVerifierDescriptor({
    verifierId: SCENARIO.verifierId,
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'requirement-compliance-report',
        evidenceKind: 'compliance-report',
        claim: 'the corrected compliance check set passes against the pinned sandbox and code edition',
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
      notes: 'authored by the A029 reference walkthrough',
    },
  });
}

/** The reference certification subject for the evolved body version. */
export function buildSubject(
  bodyVersion: BodyVersion,
  substrate: CognitiveSubstrate,
  environment: EnvironmentDefinition,
  possessionDigest: string,
): CertificationSubject {
  return createCertificationSubject({
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
    possessionRef: possessionDigest,
    tenantId: SCENARIO.tenant,
    workspaceId: SCENARIO.workspaceId,
  });
}

/** The reference certification suite: verification + evaluation + compatibility stages. */
export async function buildCertificationSuite(
  verifierDigest: string,
  evaluatorDigest: string,
  criteriaDigest: string,
): Promise<CertificationSuite> {
  return createCertificationSuite({
    suiteId: SCENARIO.suiteId,
    version: '1.0.0',
    levelGrant: 'CERTIFIED',
    stages: [
      {
        stageId: 'stage-verify-evidence',
        kind: 'verification',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: verifierDigest,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
      {
        stageId: 'stage-evaluate-correction',
        kind: 'evaluation',
        evaluatorRef: evaluatorDigest,
        criteriaRef: criteriaDigest,
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
      notes: 'the A029 reference certification suite for the structural engineer body',
    },
  });
}

// ---------------------------------------------------------------------------
// The full chain
// ---------------------------------------------------------------------------

/** Everything the walkthrough produces (the protocol-chain receipt). */
export interface ScenarioReceipt {
  readonly bodyBuild: StructuralEngineerBodyBuild;
  readonly substrate: CognitiveSubstrate;
  readonly possession: Possession;
  readonly environment: EnvironmentDefinition;
  readonly caseRecord: CapabilityCase;
  readonly compilationRecord: CompilationRecord;
  readonly taskSpec: TaskSpec;
  readonly runState: RunStateSnapshot;
  readonly runResult: RunResult;
  readonly trajectory: TrajectoryRecord;
  readonly criteria: EvaluationCriteria;
  readonly evaluator: EvaluatorDescriptor;
  readonly evaluationRecord: EvaluationRecord;
  readonly verifier: VerifierDescriptor;
  readonly verificationRecord: VerificationRecord;
  readonly compatibilityRecord: CompatibilityRecord;
  readonly suite: CertificationSuite;
  readonly subject: CertificationSubject;
  readonly certificationRecord: CertificationRecord;
  readonly releaseRecord: ReleaseRecord;
  readonly publication: ReleasePublicationRecord;
  readonly complianceReport: MaterialArtifact<unknown>;
  readonly trajectoryProof: MaterialArtifact<unknown>;
}

/**
 * Walk the ENTIRE reference chain deterministically. See module docs.
 */
export async function runReferenceScenario(): Promise<ScenarioReceipt> {
  // 1-2. Environment + Body (the body manifest cites this environment).
  const environment = await createStructuralAnalysisSandbox();
  const bodyBuild = await buildStructuralEngineerBody();
  const bodyVersion = bodyBuild.evolved.bodyVersion;

  // 3. Substrate + 4. Possession.
  const substrate = await buildReferenceSubstrate();
  const possession = await buildPossession(bodyVersion, substrate, environment);

  // 5. Capability Case (cites the body, the substrate and the environment).
  const caseRecord = await buildCase(bodyVersion, substrate, environment);

  // 6. Compile the TaskSpec against the case (A008).
  const compiler = new TaskCompilerFabric();
  await compiler.registerCase(caseRecord);
  const policy = await buildCompilationPolicy();
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

  // 7. Provision the environment and drive the run (A010 runner).
  const runner = new EnvironmentRunner({
    clock: new ManualClock(SCENARIO.startMs),
    environments: new InMemoryEnvironmentRegistry(),
    records: new InMemoryRunRecordStore(),
    sink: new InMemoryEventSink(),
  });
  await runner.registerEnvironment(environment);
  const declaration = structuralEngineerRunDeclaration(
    environment,
    { taskId: taskSpec.identity.taskId, version: taskSpec.version },
  );
  const submitted = await runner.submitRun(
    makeSubmitRunCommand(
      { declaration },
      { correlationId: correlationOf('submit'), idempotencyKey: keyOf('submit') },
    ),
  );
  if (!submitted.decision.admitted) {
    throw new Error(`run not admitted: ${submitted.decision.violations.join('; ')}`);
  }
  const target = { runId: submitted.record.runId, tenantId: SCENARIO.tenant };
  const life = (name: string) => ({
    correlationId: correlationOf(name),
    idempotencyKey: keyOf(name),
  });
  await runner.startRun(makeStartRunCommand(target, life('start')));
  await runner.advanceRun(makeAdvanceRunCommand(target, life('advance-1')));
  await runner.checkpointRun(makeCheckpointRunCommand(target, life('checkpoint')));
  await runner.advanceRun(makeAdvanceRunCommand(target, life('advance-2')));
  const { state: runState, result: runResult } = await runner.completeRun(
    makeCompleteRunCommand(target, life('complete')),
  );

  // 8. The agent trajectory over the run (A011).
  const trajectory = await buildTrajectory(
    bodyVersion,
    substrate,
    environment,
    { taskId: taskSpec.identity.taskId, version: taskSpec.version },
    submitted.record.digest,
  );
  await verifyTrajectoryRecord(trajectory);

  // 9. Evaluation (A012): semantic replay evaluator over the trajectory.
  const criteria = await buildCriteria(caseRecord.digest, trajectory.chainHead);
  const evaluator = await buildEvaluatorDescriptor(
    caseRecord.digest,
    trajectory.chainHead,
    criteria.digest,
    bodyVersion.digest,
    substrate.integrity.contentDigest,
  );
  const evaluationFabric = new EvaluationFabric();
  evaluationFabric.registry.registerCriteria(criteria);
  evaluationFabric.registry.registerEvaluator(evaluator, makeStructuralEngineerEvaluator());
  const evaluationRecord = await evaluationFabric.evaluate(
    evaluator.digest,
    caseRecord,
    trajectory,
    {
      seed: SCENARIO.seed,
      startedAt: SCENARIO.t5,
      finishedAt: SCENARIO.t6,
      provenanceNotes: 'A029 reference walkthrough evaluation',
    },
  );

  // 10. Verification (A013): digest-pinned artifacts, semantic checks.
  const verifier = await buildVerifierDescriptor();
  const verificationFabric = createVerificationFabric();
  const structVerifierHook = makeStructuralEngineerVerifier({
    chainHead: trajectory.chainHead,
    entryCount: trajectory.entries.length,
  });
  verificationFabric.registry.registerVerifier(verifier, structVerifierHook);
  const complianceReportContent: StructComplianceReportContent = {
    suite: 'reference-compliance-suite',
    checksRun: 4,
    passed: 4,
    failures: [],
    maxUtilization: 0.94,
  };
  const complianceReport = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'struct-compliance-report-0001', version: '1.0.0' },
    content: complianceReportContent,
  });
  const trajectoryProofContent: StructTrajectoryProofContent = {
    chainHead: trajectory.chainHead,
    outcome: 'completed',
    entryCount: trajectory.entries.length,
  };
  const trajectoryProof = await createMaterialArtifact({
    identity: { namespace: SCENARIO.tenant, name: 'struct-trajectory-proof-0001', version: '1.0.0' },
    content: trajectoryProofContent,
  });
  verificationFabric.putArtifact(complianceReport);
  verificationFabric.putArtifact(trajectoryProof);
  const verificationRecord = await verificationFabric.verify(
    verifier.digest,
    [
      {
        evidenceKind: 'compliance-report',
        artifact: {
          namespace: complianceReport.identity.namespace,
          name: complianceReport.identity.name,
          version: complianceReport.identity.version,
          digest: complianceReport.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t8, notes: null },
      },
      {
        evidenceKind: 'trajectory-proof',
        artifact: {
          namespace: trajectoryProof.identity.namespace,
          name: trajectoryProof.identity.name,
          version: trajectoryProof.identity.version,
          digest: trajectoryProof.digest,
        },
        provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t9, notes: null },
      },
    ],
    {
      correlationId: correlationOf('verify'),
      idempotencyKey: keyOf('verify'),
      startedAt: SCENARIO.t6,
      finishedAt: SCENARIO.t7,
      provenanceNotes: 'A029 reference walkthrough verification',
    },
  );

  // 11. Compatibility (A022): body profile × substrate, then the record.
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
    { verdict: 'compatible', reasons: [], details: { walkthrough: 'A029 reference' } },
    SCENARIO.t7,
  );

  // 12. Certification (A023): suite over the scoped composition.
  const subject = buildSubject(bodyVersion, substrate, environment, possession.digest);
  const suite = await buildCertificationSuite(
    verifier.digest,
    evaluator.digest,
    criteria.digest,
  );
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
      startedAt: SCENARIO.t7,
      finishedAt: SCENARIO.t8,
      provenanceNotes: 'A029 reference walkthrough certification',
    },
  );

  // 13. Release registration + publication (A024).
  const stores = {
    bodyVersions: memoryStore([[bodyVersion.digest, bodyVersion]]),
    certificationRecords: memoryStore([[certificationRecord.digest, certificationRecord]]),
    compatibilityRecords: memoryStore([
      [compatibilityRecord.recordDigest, compatibilityRecord],
    ]),
    forgeRecords: memoryStore([
      [bodyBuild.evolved.forgeRecord.digest, bodyBuild.evolved.forgeRecord],
    ]),
  };
  const registryService = new BodyRegistryService({ stores });
  const releaseRecord = await registryService.register(
    {
      bodyVersionRef: {
        tenant: bodyVersion.body.tenant,
        name: bodyVersion.body.name,
        version: bodyVersion.version,
        digest: bodyVersion.digest,
      },
      channel: 'stable',
      certificationRefs: [certificationRecord.digest],
      compatibilityRefs: [compatibilityRecord.recordDigest],
      forgeRecordDigest: bodyBuild.evolved.forgeRecord.digest,
    },
    {
      correlationId: correlationOf('release'),
      idempotencyKey: keyOf('release'),
      releaseVersion: '1.0.0',
      recordedAt: SCENARIO.t8,
      provenance: {
        releasedBy: 'arena-reference-publisher',
        notes: 'A029 reference walkthrough release',
      },
    },
  );
  const publication = await registryService.publish(releaseRecord.digest, {
    publisher: { type: 'service', tenant: SCENARIO.tenant, principalId: 'release-bot-struct' },
    rights: bodyBuild.evolved.manifest.rights,
    publishedAt: SCENARIO.t9,
  });

  // 14. SDK read consumption (A025) — sanity only; deep parity in tests.
  const apiFabric = createApiFabric();
  apiFabric.putReleaseRecord(releaseRecord);
  apiFabric.putReleasePublication(publication);
  apiFabric.putCertificationRecord(certificationRecord);
  apiFabric.putCertificationSuite(suite);
  apiFabric.putCompatibilityRecord(compatibilityRecord);
  apiFabric.putBodyVersion(bodyVersion);
  const client = ArenaApiClient.forTenant(
    createLoopbackTransport(apiFabric),
    SCENARIO.tenant,
  );
  const activeRelease = await client.resolveActiveRelease(
    SCENARIO.tenant,
    bodyVersion.body.name,
    'stable',
  );
  if (activeRelease === null || activeRelease.digest !== releaseRecord.digest) {
    throw new Error('SDK loopback must resolve the active stable release just published');
  }

  return {
    bodyBuild,
    substrate,
    possession,
    environment,
    caseRecord,
    compilationRecord: compilation.record,
    taskSpec,
    runState,
    runResult,
    trajectory,
    criteria,
    evaluator,
    evaluationRecord,
    verifier,
    verificationRecord,
    compatibilityRecord,
    suite,
    subject,
    certificationRecord,
    releaseRecord,
    publication,
    complianceReport,
    trajectoryProof,
  };
}

/** The canonical body-version ref of the latest reference body version. */
export function scenarioBodyVersionRef(receipt: ScenarioReceipt) {
  return latestStructuralEngineerVersionRef(receipt.bodyBuild);
}

/** Digest helper for receipts. */
export function receiptDigests(receipt: ScenarioReceipt): Record<string, string> {
  return {
    bodyVersion: receipt.bodyBuild.evolved.bodyVersion.digest,
    possession: receipt.possession.digest,
    case: receipt.caseRecord.digest,
    taskSpec: receipt.taskSpec.digest,
    runRecord: receipt.runResult.runAddress.trajectoryDigest,
    trajectory: receipt.trajectory.chainHead,
    criteria: receipt.criteria.digest,
    evaluation: receipt.evaluationRecord.digest,
    verification: receipt.verificationRecord.digest,
    compatibility: receipt.compatibilityRecord.recordDigest,
    suite: receipt.suite.digest,
    certification: receipt.certificationRecord.digest,
    release: receipt.releaseRecord.digest,
    publication: receipt.publication.digest,
  };
}
