/**
 * Test support (Work Order A008) — deterministic fixtures for the test
 * suites. Fixed digests, fixed timestamps, fixed content: no randomness
 * anywhere, so every test is reproducible byte-for-byte.
 */

import { createTaskSpec } from './spec.js';
import type { CreateTaskSpecInput } from './spec.js';
import { createCompilationPolicy } from './compilation-policy.js';
import type { CreateCompilationPolicyInput } from './compilation-policy.js';
import { TASK_QUALITY_DIMENSIONS } from './quality.js';

/** Deterministic 64-hex digests (content-agnostic test fixtures). */
export const DIGESTS = Object.freeze({
  domain: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  capability: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  envA: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  envB: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  tool: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  evaluator: '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f',
  verifier: '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e',
  caseRef: '3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d',
  policy: '4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c',
  qualificationPolicy:
    '5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
  evidence: '6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a',
} as const);

export const T0 = '2026-02-01T09:30:00.000Z';
export const T1 = '2026-02-02T09:30:00.000Z';

const domainRef = () => ({
  kind: 'domain',
  id: 'software-engineering',
  version: '1.0.0',
  digest: DIGESTS.domain,
});

const capabilityRef = () => ({
  kind: 'capability',
  id: 'code-review',
  version: '1.2.0',
  digest: DIGESTS.capability,
});

const envA = () => ({
  namespace: 'tenant-alpha',
  name: 'review-workspace',
  version: '1.0.0',
  digest: DIGESTS.envA,
});

const envB = () => ({
  namespace: 'tenant-alpha',
  name: 'review-workspace-ci',
  version: '1.1.0',
  digest: DIGESTS.envB,
});

/** The canonical quality posture used by fixtures (all seven dimensions). */
export function qualityFixture(overrides?: {
  dimension?: string;
  satisfied?: boolean;
  justification?: string;
}): CreateTaskSpecInput['quality'] {
  return TASK_QUALITY_DIMENSIONS.map((dimension) => ({
    dimension,
    satisfied:
      overrides?.dimension === dimension ? (overrides.satisfied ?? true) : true,
    justification:
      overrides?.dimension === dimension && overrides.justification !== undefined
        ? overrides.justification
        : `declared posture for ${dimension} under the test fixture`,
    provenance: { source: 'compilation-policy', ref: 'fixture-policy@1.0.0' },
  }));
}

/** A structurally valid CreateTaskSpecInput (the fixture of record). */
export function validSpecInput(overrides?: Partial<CreateTaskSpecInput>): CreateTaskSpecInput {
  return {
    identity: { tenant: 'tenant-alpha', taskId: 'task-case-001' },
    version: '1.0.0',
    taskClass: 'correction',
    capabilityLabels: ['code-review', 'software-engineering'],
    difficulty: { scale: 'arena:task-difficulty@1', class: 'standard' },
    domain: domainRef(),
    initialState: { environment: envA(), seed: 'seed-2026-alpha', note: null },
    instructions:
      'Fix the failing review check for capability code-review: restore the guard.',
    objectives: ['restore the failing guard', 'keep the public surface unchanged'],
    constraints: ['no new dependencies'],
    permittedTools: [
      { namespace: 'tenant-alpha', name: 'shell', version: '1.0.0', digest: DIGESTS.tool },
    ],
    prohibitedShortcuts: ['do not delete the failing test to make it pass'],
    expectedOutputs: ['a patch that passes the guard'],
    completionCriteria: ['the guard passes', 'the public surface is unchanged'],
    evidenceCriteria: ['the trajectory shows the edit and the re-run'],
    longHorizonEvidence: null,
    environmentRequirements: {
      environments: [envA()],
      constraints: ['filesystem is ephemeral'],
    },
    evaluatorBindings: [
      { evaluatorId: 'guard-evaluator', version: '1.0.0', descriptorDigest: DIGESTS.evaluator },
    ],
    verifierBindings: [
      { verifierId: 'guard-verifier', version: '1.0.0', descriptorDigest: DIGESTS.verifier },
    ],
    expertQualificationRequirements: {
      competencies: [capabilityRef()],
      qualificationPolicy: {
        policyId: 'fixture-qualification-policy',
        version: '1.0.0',
        digest: DIGESTS.qualificationPolicy,
      },
      expectations: ['qualified in code review within the last 180 days'],
    },
    quality: qualityFixture(),
    dataRights: {
      classification: 'private-tenant',
      tenantScope: 'tenant-alpha',
      crossTenantReuse: false,
      licensing: null,
      privacyNotes: 'contains tenant code context',
    },
    derivedFrom: {
      caseRef: {
        tenant: 'tenant-alpha',
        caseId: 'case-001',
        version: '1.0.0',
        digest: DIGESTS.caseRef,
      },
      policyRef: {
        policyId: 'fixture-policy',
        version: '1.0.0',
        digest: DIGESTS.policy,
      },
    },
    ...overrides,
  };
}

/** Create the fixture TaskSpec (validated + digested + frozen). */
export function createFixtureSpec(
  overrides?: Partial<CreateTaskSpecInput>,
): Promise<import('./spec.js').TaskSpec> {
  return createTaskSpec(validSpecInput(overrides));
}

/** A structurally valid CompilationPolicy input (the fixture of record). */
export function validPolicyInput(): CreateCompilationPolicyInput {
  return {
    policyId: 'fixture-policy',
    version: '1.0.0',
    description: 'the reference compilation policy used by the A008 fixtures',
    eligibility: {
      compilableStatuses: ['triaged', 'active'],
      minimumEvidenceCount: 1,
    },
    classSelection: [
      { matcher: 'difficulty-is', class: 'environment-exploration', difficulty: 'exploratory' },
      { matcher: 'tools-present', class: 'tool-use' },
      { matcher: 'shortcuts-present', class: 'adversarial' },
      { matcher: 'evidence-at-least', class: 'benchmark', count: 3 },
      { matcher: 'always', class: 'correction' },
    ],
    difficulty: { mode: 'from-case', scale: 'arena:task-difficulty@1' },
    fieldMapping: {
      objectives: { mode: 'pass-through' },
      constraints: { mode: 'union', additional: ['attempt must be reproducible'] },
      prohibitedShortcuts: { mode: 'union', additional: ['no skipping the environment'] },
      permittedTools: { mode: 'pass-through' },
      expectedOutputs: { mode: 'from-success-conditions' },
      instructions: {
        mode: 'template',
        template:
          'Work the case {caseId} for capability {capability} in domain {domain} (difficulty {difficulty}); objectives: {objectives}.',
      },
    },
    environment: { selection: 'first', seed: 'seed-2026-alpha', note: null },
    identity: { taskIdPrefix: 'task-', initialVersion: '1.0.0' },
    expertQualification: {
      mode: 'from-target-capability',
      expectations: ['qualified in the target capability within the last 180 days'],
      qualificationPolicy: {
        policyId: 'fixture-qualification-policy',
        version: '1.0.0',
        digest: DIGESTS.qualificationPolicy,
      },
    },
    quality: TASK_QUALITY_DIMENSIONS.map((dimension) => ({
      dimension,
      satisfied: true,
      justification: `declared posture for ${dimension} under the fixture policy`,
    })),
    longHorizon: null,
    dataRights: {
      classification: 'private-tenant',
      licensing: null,
      privacyNotes: null,
    },
  };
}

/** Create the fixture CompilationPolicy (validated + digested + frozen). */
export function createFixturePolicy(): Promise<
  import('./compilation-policy.js').CompilationPolicy
> {
  return createCompilationPolicy(validPolicyInput());
}

export { envA, envB, domainRef, capabilityRef };
