/**
 * Shared test fixtures for the @arena/control-ui suites (Work Order A018).
 * NOT exported from the package index — internal to the tests, mirroring
 * the test-support conventions of capability-case and agent-body.
 *
 * The fixture corpus is built through the DOMAIN packages' public APIs
 * only, with fixed timestamps and digest fixtures, so every golden string
 * in the render/router suites is byte-stable.
 */

import { createBodyVersion } from '@arena/agent-body';
import type { BodyVersion } from '@arena/agent-body';
import { createCapabilityCase } from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import { createEnvironmentDefinition, toRunAddress } from '@arena/environment-protocol';
import { createJobRecord } from '@arena/job-protocol';
import type { JobRecord } from '@arena/job-protocol';
import { createAdapterDescriptor, createSubstrateRecord, createSubstrateRegistry } from '@arena/model-substrate';
import type { SubstrateRegistration } from '@arena/model-substrate';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';

import type { ConsoleCorpus } from './corpus.js';
import type { TrajectoryStep } from './views.js';

/** Well-known 64-hex digest fixtures. */
export const DIGEST_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DIGEST_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const DIGEST_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
export const DIGEST_D = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

export const AT = '2026-10-01T09:00:00.000Z';
export const RUN_ID = 'run-fixture-0001';

/** Build the fixture capability case (a small, valid, ACTIVE case). */
export async function makeFixtureCase(): Promise<CapabilityCase> {
  const draft = await createCapabilityCase({
    identity: { tenant: 'tenant-fixture', caseId: 'case-fixture' },
    version: '1.0.0',
    source: { type: 'user', tenant: 'tenant-fixture', principalId: 'analyst-1' },
    problemStatement: 'Fixture problem statement for console rendering tests.',
    targetCapability: { kind: 'capability', id: 'fixture-capability', version: '1.0.0', digest: DIGEST_A },
    domain: { kind: 'domain', id: 'fixture-domain', version: '1.0.0', digest: DIGEST_B },
    context: 'Fixture context.',
    observedFailure: {
      summary: 'Fixture observed failure.',
      observedAt: AT,
      reproduction: 'Fixture reproduction.',
    },
    evidence: [{ digest: DIGEST_C, description: 'Fixture trajectory export.' }],
    unknowns: ['Fixture unknown'],
    desiredOutcome: 'Fixture desired outcome.',
    expertRequirements: {
      competencies: [
        { kind: 'expert-competency', id: 'fixture-competency', version: '1.0.0', digest: DIGEST_D },
      ],
      qualifications: ['fixture-qualification'],
    },
    environmentRequirements: {
      environments: [
        { namespace: 'tenant-fixture', name: 'fixture-sandbox', version: '1.0.0', digest: DIGEST_A },
      ],
      constraints: ['fixture constraint'],
    },
    taskRequirements: {
      objectives: ['fixture objective'],
      constraints: ['fixture constraint'],
      allowedTools: [
        { namespace: 'tenant-fixture', name: 'fixture-tool', version: '1.0.0', digest: DIGEST_B },
      ],
      forbiddenShortcuts: ['fixture shortcut'],
      successConditions: ['fixture success condition'],
      evidenceCriteria: ['fixture evidence criterion'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'fixture-evaluator', version: '1.0.0', digest: DIGEST_C },
      ],
      criteria: ['fixture criterion'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'fixture-verifier', version: '1.0.0', digest: DIGEST_D },
      ],
      evidenceStandards: ['fixture standard'],
    },
    provenance: { recordDigest: DIGEST_A },
    priority: 'normal',
    risk: 'low',
    createdAt: AT,
  });
  return draft;
}

/** Build the fixture agent body version. */
export async function makeFixtureBody(): Promise<BodyVersion> {
  return createBodyVersion({
    body: { tenant: 'tenant-fixture', name: 'fixture-agent' },
    version: '1.0.0',
    mission: 'Fixture mission.',
    role: 'fixture-role',
    domainScope: ['fixture-domain'],
    capabilities: ['fixture-capability'],
    skills: [
      { namespace: 'tenant-fixture', name: 'fixture-skill', version: '1.0.0', digest: DIGEST_A },
    ],
    knowledge: [
      { namespace: 'tenant-fixture', name: 'fixture-knowledge', version: '1.0.0', digest: DIGEST_B },
    ],
    tools: [
      { namespace: 'tenant-fixture', name: 'fixture-tool', version: '1.0.0', digest: DIGEST_C },
    ],
    procedures: [
      { namespace: 'tenant-fixture', name: 'fixture-procedure', version: '1.0.0', digest: DIGEST_D },
    ],
    memoryPolicy: { policyId: 'fixture-memory', statements: ['persist outcomes'] },
    planningPolicy: { policyId: 'fixture-planning', statements: ['plan first'] },
    escalation: {
      rules: [
        {
          condition: 'fixture-condition',
          target: { type: 'expert', tenant: 'tenant-fixture', principalId: 'expert-1' },
        },
      ],
    },
    authorityBoundaries: ['fixture-boundary'],
    safetyPolicy: { policyId: 'fixture-safety', statements: ['stay safe'] },
    evaluationSuites: [
      { namespace: 'tenant-fixture', name: 'fixture-eval-suite', version: '1.0.0', digest: DIGEST_A },
    ],
    verificationSuites: [
      { namespace: 'tenant-fixture', name: 'fixture-verif-suite', version: '1.0.0', digest: DIGEST_B },
    ],
    environmentRequirements: [
      { namespace: 'tenant-fixture', name: 'fixture-sandbox', version: '1.0.0', digest: DIGEST_C },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 1000 },
      requiredEvaluationSuites: [
        { namespace: 'tenant-fixture', name: 'fixture-eval-suite', version: '1.0.0', digest: DIGEST_A },
      ],
      prohibitedConditions: ['deprecated'],
    },
    provenance: {
      creator: { type: 'agent-body', tenant: 'tenant-fixture', principalId: 'forge-1' },
      createdAt: AT,
      rights: {
        license: 'Proprietary',
        commercialUse: 'requires-license',
        redistribution: 'tenant-only',
        customerData: 'derived',
        professionalLimitations: ['human-signoff-required'],
      },
      records: [],
    },
    lineage: { parents: [] },
  });
}

/** Build the fixture substrate registration (via model-substrate public APIs). */
export async function makeFixtureSubstrate(): Promise<SubstrateRegistration> {
  const descriptor = await createAdapterDescriptor({
    adapterId: 'fixture-adapter',
    adapterVersion: '1.0.0',
    protocolVersion: '1.0.0',
    supportedModalities: ['text-input', 'text-output'],
    supportedToolCalling: 'json-schema',
    contextCeiling: { maxContextUnits: 4096, maxOutputUnits: 2048 },
  });
  const substrate = await createSubstrateRecord({
    adapterId: 'fixture-adapter',
    adapterVersion: '1.0.0',
    modelFamily: 'fixture-family',
    modelId: 'fixture-model',
    modelRevision: 'r1',
    modalityProfile: ['text-input', 'text-output'],
    toolCallingProfile: 'json-schema',
    contextLimits: { maxContextUnits: 4096, maxOutputUnits: 2048 },
    conditions: ['stable'],
  });
  const registry = createSubstrateRegistry();
  return registry.register({
    substrateId: 'substrate-fixture',
    substrate,
    adapterDescriptor: descriptor,
    registeredAt: AT,
  });
}

/** Build the fixture job record (queued, freshly submitted). */
export async function makeFixtureJob(): Promise<JobRecord> {
  return createJobRecord({
    definitionDigest: DIGEST_A,
    kind: { namespace: 'tenant-fixture', name: 'fixture-job-kind', version: '1.0.0' },
    correlationId: toCorrelationId('fixture-correlation-1'),
    idempotencyKey: toIdempotencyKey('fixture-idempotency-1'),
    idempotencyScope: 'fixture-scope',
    input: { fixture: true },
    policy: {
      timeoutMs: 30000,
      retry: { maxAttempts: 2, backoffScheduleMs: [1000], retryableErrorClasses: [] },
    },
    jobId: 'job-fixture-0001',
    submittedAt: AT,
  });
}

/** Build the fixture environment run (definition + run address). */
export async function makeFixtureRun() {
  const definition = await createEnvironmentDefinition({
    identity: { namespace: 'tenant-fixture', name: 'fixture-sandbox' },
    version: '1.0.0',
    image: { imageKind: 'content-addressed-image', digest: DIGEST_A, buildDigest: null },
    initialState: {
      snapshot: { snapshotId: 'fixture-snapshot', digest: DIGEST_B },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: { mode: 'deterministic', capture: null, note: null },
      seed: null,
      seedAlgorithm: null,
      reseedPolicy: 'forbidden',
      note: null,
    },
    actionSurface: {
      actions: [{ actionId: 'fixture-action', description: null }],
      tools: [{ toolId: 'fixture-tool', description: null }],
    },
    observationSurface: {
      observations: [{ observationId: 'fixture-obs', channel: 'stdout', description: null }],
    },
    resourceLimits: { cpuMillis: 1000, memoryMiB: 512, wallClockSeconds: 600 },
    networkPolicy: { egress: 'default-deny' },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [{ mountPath: '/workspace', access: 'read-write', source: 'workspace' }],
    },
    secretPolicy: { isolation: 'isolation-boundary' },
    timeLimits: { startupSeconds: 30, cleanupGraceSeconds: 10, deadlineBehavior: 'grace-then-stop' },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'destroy' },
    checkpointSemantics: { supported: false, triggers: [], retention: null },
    evidenceOutputs: {
      outputs: [
        { outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: null },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'fixture-evaluator',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/fixture/evaluation@1.0.0',
          description: null,
        },
      ],
      verifiers: [
        {
          hookId: 'fixture-verifier',
          role: 'verifier',
          phase: 'on-evidence',
          invocationSchema: 'arena:schema/fixture/verification@1.0.0',
          description: null,
        },
      ],
    },
  });
  const address = toRunAddress({
    taskVersion: { taskId: 'fixture-task', version: '1.0.0' },
    environmentVersion: {
      namespace: 'tenant-fixture',
      name: 'fixture-sandbox',
      version: '1.0.0',
      digest: definition.digest,
    },
    runId: RUN_ID,
    initialSnapshotDigest: DIGEST_B,
    trajectoryDigest: DIGEST_C,
    evidenceDigests: [DIGEST_D],
  });
  return { definition, address };
}

/** The fixture trajectory steps. */
export function makeFixtureSteps(): readonly TrajectoryStep[] {
  return [
    {
      sequence: 1,
      at: AT,
      actor: 'tenant-fixture/fixture-agent@1.0.0',
      action: 'fixture-action: read inputs',
      observation: 'inputs read',
    },
    {
      sequence: 2,
      at: '2026-10-01T09:05:00.000Z',
      actor: 'tenant-fixture/fixture-agent@1.0.0',
      action: 'fixture-action: submit result',
      observation: 'result submitted',
      evidenceDigest: DIGEST_D,
    },
  ];
}

/** Build the complete fixture corpus (one entry per section). */
export async function makeFixtureCorpus(): Promise<ConsoleCorpus> {
  const [caseRecord, body, substrate, job, run] = await Promise.all([
    makeFixtureCase(),
    makeFixtureBody(),
    makeFixtureSubstrate(),
    makeFixtureJob(),
    makeFixtureRun(),
  ]);
  return {
    cases: [caseRecord],
    bodies: [body],
    substrates: [substrate],
    jobs: [job],
    runs: [run],
    trajectories: { [run.address.runId]: makeFixtureSteps() },
  };
}
