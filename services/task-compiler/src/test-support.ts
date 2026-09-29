/**
 * Shared test fixtures for @arena/task-compiler-fabric (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 *
 * Everything deterministic: fixed timestamps, fixed digests, REAL
 * content-addressed @arena/capability-case and @arena/task-spec objects.
 */

import {
  createCapabilityCase,
  submitCase,
  triageCase,
  activateCase,
} from '@arena/capability-case';
import type { CapabilityCase } from '@arena/capability-case';
import type { CreateCapabilityCaseInput } from '@arena/capability-case';
import {
  createCompilationPolicy,
} from '@arena/task-spec';
import type { CreateCompilationPolicyInput } from '@arena/task-spec';
import { TASK_QUALITY_DIMENSIONS } from '@arena/task-spec';

export const T0 = '2026-02-01T09:30:00.000Z';
export const T1 = '2026-02-02T09:30:00.000Z';
export const T2 = '2026-02-03T09:30:00.000Z';

export const DIGESTS = Object.freeze({
  domain: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  capability: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  envA: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  envB: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  tool: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  evaluator: '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f',
  verifier: '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e',
  qualificationPolicy:
    '5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
  provenance: '9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a',
} as const);

/** A valid capability-case input (tenant-alpha, one env, one tool). */
export function validCaseInput(
  overrides?: Partial<CreateCapabilityCaseInput>,
): CreateCapabilityCaseInput {
  return {
    identity: { tenant: 'tenant-alpha', caseId: 'case-review-invoices' },
    version: '1.0.0',
    source: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    problemStatement:
      'The invoicing agent fails to reconcile credit notes against partially paid invoices.',
    targetCapability: {
      kind: 'capability',
      id: 'invoice-reconciliation',
      version: '1.2.0',
      digest: DIGESTS.capability,
    },
    domain: { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGESTS.domain },
    context:
      'Production tenant workload; monthly close; ERP exports partial payments without netting credit notes.',
    observedFailure: {
      summary:
        'Agent marked a partially paid invoice as fully settled, ignoring an open credit note.',
      observedAt: T0,
      reproduction:
        'Run the monthly close with one partially paid invoice and one open credit note.',
    },
    evidence: [
      {
        digest: '6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a',
        description: 'Trajectory export of the failing close run.',
      },
    ],
    unknowns: ['Whether the ERP ever nets credit notes on export'],
    desiredOutcome:
      'The agent nets credit notes against partially paid invoices and explains the netting in its summary.',
    expertRequirements: {
      competencies: [
        {
          kind: 'expert-competency',
          id: 'accounts-payable-reconciliation',
          version: '1.0.0',
          digest: DIGESTS.qualificationPolicy,
        },
      ],
      qualifications: ['certified-accountant'],
    },
    environmentRequirements: {
      environments: [
        { namespace: 'tenant-alpha', name: 'erp-close-sandbox', version: '1.4.0', digest: DIGESTS.envA },
      ],
      constraints: ['No live ERP writes'],
    },
    taskRequirements: {
      objectives: ['Reconcile credit notes against partially paid invoices'],
      constraints: ['Use only the ERP export snapshot'],
      allowedTools: [
        { namespace: 'tenant-alpha', name: 'erp-export-reader', version: '1.0.0', digest: DIGESTS.tool },
      ],
      forbiddenShortcuts: ['Assume full settlement without checking credit notes'],
      successConditions: ['Netted total matches the ERP expected balance'],
      evidenceCriteria: ['Annotated trajectory with the netting decision'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'reconciliation-accuracy', version: '1.0.0', digest: DIGESTS.evaluator },
      ],
      criteria: ['Netting accuracy >= 99% on the evaluation set'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'erp-balance-check', version: '1.0.0', digest: DIGESTS.verifier },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox ERP'],
    },
    provenance: { recordDigest: DIGESTS.provenance },
    priority: 'high',
    risk: 'moderate',
    createdAt: T0,
    ...overrides,
  };
}

/** A TRIAGED case (compilable): draft → submitted → triaged. */
export async function triagedCase(): Promise<CapabilityCase> {
  const draft = await createCapabilityCase(validCaseInput());
  const submitted = await submitCase(draft, {
    at: T1,
    actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
  });
  return triageCase(submitted, {
    at: T1,
    actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    note: 'Triage rationale: high-volume failure cluster; task design unlocked.',
  });
}

/** An ACTIVE case (compilable): draft → submitted → triaged → active. */
export async function activeCase(): Promise<CapabilityCase> {
  const triaged = await triagedCase();
  return activateCase(triaged, {
    at: T2,
    actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
  });
}

/** A two-environment case variant (for the 'each' selection mode). */
export async function multiEnvTriagedCase(): Promise<CapabilityCase> {
  const draft = await createCapabilityCase(
    validCaseInput({
      identity: { tenant: 'tenant-alpha', caseId: 'case-multi-env' },
      environmentRequirements: {
        environments: [
          { namespace: 'tenant-alpha', name: 'erp-close-sandbox', version: '1.4.0', digest: DIGESTS.envA },
          { namespace: 'tenant-alpha', name: 'erp-ci-sandbox', version: '2.0.0', digest: DIGESTS.envB },
        ],
        constraints: ['No live ERP writes'],
      },
    }),
  );
  const submitted = await submitCase(draft, {
    at: T1,
    actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
  });
  return triageCase(submitted, {
    at: T1,
    actor: { type: 'user', tenant: 'tenant-alpha', principalId: 'analyst-1' },
    note: 'Triage rationale: multi-environment validation wanted.',
  });
}

/** The reference compilation policy (matches the package fixture shape). */
export function validPolicyInput(): CreateCompilationPolicyInput {
  return {
    policyId: 'reference-policy',
    version: '1.0.0',
    description: 'the reference compilation policy used by the A008 fabric fixtures',
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
        policyId: 'reference-qualification-policy',
        version: '1.0.0',
        digest: DIGESTS.qualificationPolicy,
      },
    },
    quality: TASK_QUALITY_DIMENSIONS.map((dimension) => ({
      dimension,
      satisfied: true,
      justification: `declared posture for ${dimension} under the reference policy`,
    })),
    longHorizon: null,
    dataRights: { classification: 'private-tenant', licensing: null, privacyNotes: null },
  };
}

/** Create the reference policy (validated + digested + frozen). */
export function createReferencePolicy(): Promise<
  import('@arena/task-spec').CompilationPolicy
> {
  return createCompilationPolicy(validPolicyInput());
}
