/**
 * Deterministic fixtures for the A027 epoch end-to-end capability-gap
 * learning slice. NO clock reads, NO randomness: every timestamp, seed,
 * key and id is a fixed input, so the whole loop is byte-reproducible.
 */

import { digestCanonical, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { createSubstrateRecord } from '@arena/model-substrate';
import type { CognitiveSubstrate } from '@arena/agent-body';
import { createCapabilityNode } from '@arena/capability-graph';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import { environmentVersionRef } from '@arena/environment-protocol';
import { createSoftwareEngineerSandbox } from '@arena/environment-software-engineer';
import type { BodyVersion } from '@arena/agent-body';
import { buildSoftwareEngineerBody } from '@arena/body-software-engineer';
import type { SoftwareEngineerBodyBuild } from '@arena/body-software-engineer';

/** The fixed scenario constants (mirrors the A028 walkthrough discipline). */
export const SCENARIO = Object.freeze({
  tenant: 'arena-reference',
  requestId: 'epoch-req-gap-0001',
  caseId: 'epoch-req-gap-0001',
  taskIdPrefix: 'task-gap-',
  policyId: 'policy-epoch-gap-reference',
  trajectoryId: 'trajectory-gap-0001',
  baselineTrajectoryId: 'trajectory-gap-baseline',
  runKey: 'run-gap-0001',
  baselineRunKey: 'run-gap-baseline',
  jobRef: 'job-gap-0001',
  substrateId: 'reference-reasoner-1',
  runtimeId: 'arena-runtime',
  workspaceId: 'ws-reference',
  suiteId: 'suite-epoch-gap-certification',
  evaluatorId: 'gap-repair-evaluator',
  verifierId: 'gap-evidence-verifier',
  trajectoryVerifierId: 'gap-trajectory-verifier',
  criteriaId: 'criteria-gap-test-repair',
  experimentId: 'experiment-epoch-gap-0001',
  extractionPolicyId: 'policy-gap-skill-extraction',
  seed: 'EPOCH_E2E_RUN_SEED',
  startMs: Date.parse('2026-10-02T10:00:00.000Z'),
  t0: '2026-10-02T10:00:00.000Z',
  t1: '2026-10-02T10:01:00.000Z',
  t2: '2026-10-02T10:02:00.000Z',
  t3: '2026-10-02T10:03:00.000Z',
  t4: '2026-10-02T10:04:00.000Z',
  t5: '2026-10-02T10:05:00.000Z',
  t6: '2026-10-02T10:06:00.000Z',
  t7: '2026-10-02T10:07:00.000Z',
  t8: '2026-10-02T10:08:00.000Z',
  t9: '2026-10-02T10:09:00.000Z',
  t10: '2026-10-02T10:10:00.000Z',
  t11: '2026-10-02T10:11:00.000Z',
});

/** Deterministic per-step idempotency keys. */
export function keyOf(name: string) {
  return toIdempotencyKey(`idem-gap-${name}`);
}

/** Deterministic per-step correlation ids. */
export function correlationOf(name: string) {
  return toCorrelationId(`corr-gap-${name}`);
}

/** The fixed adapter clock (job timestamps are scenario inputs). */
export function fixedClock(): string {
  return SCENARIO.t2;
}

/** The reference cognitive substrate (neutral, offline reasoner). */
export async function buildReferenceSubstrate(): Promise<CognitiveSubstrate> {
  return createSubstrateRecord({
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
}

/**
 * Build the merged A028 reference vertical (the software-engineer body
 * + its sandbox environment). The epoch gap slice drives the REAL
 * reference surfaces — it does not reimplement them.
 */
export async function buildReferenceVertical(): Promise<{
  readonly bodyBuild: SoftwareEngineerBodyBuild;
  readonly bodyVersion: BodyVersion;
  readonly environment: EnvironmentDefinition;
}> {
  const environment = await createSoftwareEngineerSandbox();
  const bodyBuild = await buildSoftwareEngineerBody();
  return { bodyBuild, bodyVersion: bodyBuild.evolved.bodyVersion, environment };
}

/** The REAL A004 capability node the gap targets (test-repair). */
export async function buildTargetCapabilityNode() {
  return createCapabilityNode({
    kind: 'capability',
    id: 'test-repair',
    version: '1.0.0',
    payload: { title: 'Test repair', description: 'the capability the epoch gap targets' },
  });
}

/**
 * The EPI1.0 Epoch capability-development REQUEST in raw wire form —
 * the capability-gap input: a failed trajectory ref (the failed run the
 * provider observed), an evaluation gap, and the full case seed.
 */
export async function buildEpochGapRequest(dependencies: {
  readonly targetCapabilityDigest: string;
  readonly domainDigest: string;
  readonly failedTrajectoryDigest: string;
  readonly evaluationGapDigest: string;
  readonly competencyDigest: string;
  readonly environment: EnvironmentDefinition;
  readonly bodyVersion: BodyVersion;
}): Promise<Record<string, unknown>> {
  const envRef = environmentVersionRef(dependencies.environment);
  const evaluatorRequirementDigest = await digestCanonical({
    evaluatorId: SCENARIO.evaluatorId,
    version: '1.0.0',
    expectation: 'judge capability-gap repair trajectories against the reference criteria',
  });
  const verifierRequirementDigest = await digestCanonical({
    verifierId: SCENARIO.verifierId,
    version: '1.0.0',
    expectation: 'verify green test reports and trajectory-chain proofs',
  });
  return {
    requestVersion: 1,
    requestId: SCENARIO.requestId,
    requestedAt: SCENARIO.t0,
    tenant: SCENARIO.tenant,
    idempotencyKey: 'epoch-gap-key-0001',
    correlationId: 'corr-gap-epoch-0001',
    causationId: 'cause-gap-epoch-0001',
    authorization: {
      authorizationVersion: 1,
      tenant: SCENARIO.tenant,
      principal: 'epoch-orchestrator',
      scopes: ['capability-development'],
    },
    targetReleaseChannel: 'candidate',
    caseSeed: {
      problemStatement:
        'The capability gap: repairs_guard rejects minimal correct fixes; the provider observed repeated failures.',
      context:
        'Epoch capability-development consumption: the provider replayed failed trajectories and measured an evaluation gap.',
      desiredOutcome:
        'The test-repair capability completes a minimal, reviewable repair loop with a green suite.',
      targetCapability: {
        kind: 'capability',
        id: 'test-repair',
        version: '1.0.0',
        digest: dependencies.targetCapabilityDigest,
      },
      domain: {
        kind: 'domain',
        id: 'software-engineering',
        version: '1.0.0',
        digest: dependencies.domainDigest,
      },
      observedFailure: {
        summary: 'repairs_guard test fails: the guard rejects a minimal, correct fix.',
        observedAt: SCENARIO.t0,
        reproduction: 'Replay the failed trajectory on the pinned sandbox snapshot.',
      },
      evidence: [
        {
          digest: dependencies.failedTrajectoryDigest,
          description: 'Failed trajectory record captured by the provider run.',
        },
      ],
      unknowns: ['Whether the guard rejection is intentional policy or a defect'],
      priority: 'high',
      risk: 'moderate',
      expertRequirements: {
        competencies: [
          {
            kind: 'expert-competency',
            id: 'test-repair',
            version: '1.0.0',
            digest: dependencies.competencyDigest,
          },
        ],
        qualifications: ['senior-software-engineer'],
      },
      environmentRequirements: {
        environments: [envRef],
        constraints: ['No live network writes; internal registry only'],
      },
      taskRequirements: {
        objectives: ['Repair the failing guard test through a minimal change'],
        constraints: ['Use only the pinned sandbox snapshot'],
        allowedTools: dependencies.bodyVersion.tools,
        forbiddenShortcuts: ['Do not delete or skip the failing test to make it pass'],
        successConditions: ['The full reference test suite passes in the sandbox'],
        evidenceCriteria: ['A trajectory showing reproduction, edit and a green re-run'],
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
        criteria: ['The repair loop is completed: failing suite, edit, green suite'],
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
        evidenceStandards: ['Green test report and trajectory-chain proof, digest-pinned'],
      },
    },
    failedTrajectoryRefs: [
      { digest: dependencies.failedTrajectoryDigest, observedAt: SCENARIO.t0 },
    ],
    evaluationGaps: [
      {
        capability: 'test-repair',
        summary: 'The provider evaluator misses completed repair loops on guard edge cases',
        evidenceDigest: dependencies.evaluationGapDigest,
      },
    ],
    requirements: {
      capability: ['test-repair'],
      domain: ['software-engineering'],
    },
  };
}
