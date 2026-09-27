/**
 * Shared test fixtures for the @arena/capability-case suites (Work Order
 * A005). NOT exported from the package index — this module exists so every
 * test file builds cases from ONE canonical valid input (the convention of
 * @arena/capability-graph's src/testing.ts).
 */

import type { CreateCapabilityCaseInput } from './case.js';

export const DIGEST_A =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_B =
  'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_C =
  'c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_D =
  'd1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_E =
  'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

export const AT = '2026-09-28T10:00:00.000Z';
export const AT_LATER = '2026-09-28T11:00:00.000Z';
export const AT_EVEN_LATER = '2026-09-28T12:00:00.000Z';

export const ACTOR = {
  type: 'user',
  tenant: 'tenant-a',
  principalId: 'case-intake',
} as const;

export const ACTOR_SERVICE = {
  type: 'service',
  tenant: 'tenant-a',
  principalId: 'case-orchestrator',
} as const;

/** The canonical valid createCapabilityCase input every test starts from. */
export function validCaseInput(): CreateCapabilityCaseInput {
  return {
    identity: { tenant: 'tenant-a', caseId: 'case-review-invoices' },
    version: '1.0.0',
    source: { type: 'user', tenant: 'tenant-a', principalId: 'analyst-1' },
    problemStatement:
      'The invoicing agent fails to reconcile credit notes against partially paid invoices.',
    targetCapability: {
      kind: 'capability',
      id: 'invoice-reconciliation',
      version: '1.2.0',
      digest: DIGEST_A,
    },
    domain: { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_B },
    context:
      'Production tenant workload; monthly close; ERP exports partial payments without netting credit notes.',
    observedFailure: {
      summary:
        'Agent marked a partially paid invoice as fully settled, ignoring an open credit note.',
      observedAt: AT,
      reproduction:
        'Run the monthly close with one partially paid invoice and one open credit note.',
    },
    evidence: [
      {
        digest: DIGEST_C,
        description: 'Trajectory export of the failing close run (2026-09-27).',
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
          digest: DIGEST_D,
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
          digest: DIGEST_E,
        },
      ],
      constraints: ['No live ERP writes'],
    },
    taskRequirements: {
      objectives: ['Reconcile credit notes against partially paid invoices'],
      constraints: ['Use only the ERP export snapshot'],
      allowedTools: [
        { namespace: 'tenant-a', name: 'erp-export-reader', version: '1.0.0', digest: DIGEST_A },
      ],
      forbiddenShortcuts: ['Assume full settlement without checking credit notes'],
      successConditions: ['Netted total matches the ERP expected balance'],
      evidenceCriteria: ['Annotated trajectory with the netting decision'],
      difficulty: 'standard',
    },
    evaluationRequirements: {
      evaluators: [
        { kind: 'evaluator', id: 'reconciliation-accuracy', version: '1.0.0', digest: DIGEST_B },
      ],
      criteria: ['Netting accuracy >= 99% on the evaluation set'],
    },
    verificationRequirements: {
      verifiers: [
        { kind: 'verifier', id: 'erp-balance-check', version: '1.0.0', digest: DIGEST_C },
      ],
      evidenceStandards: ['Balance proof exported from the sandbox ERP'],
    },
    currentBody: {
      tenant: 'tenant-a',
      name: 'invoicing-agent',
      version: '3.2.1',
      digest: DIGEST_D,
    },
    currentSubstrate: {
      adapterId: 'neutral-adapter',
      modelFamily: 'reasoning-family',
      modelId: 'large-reasoner',
      modelRevision: 'rev-2',
      contentDigest: DIGEST_E,
    },
    provenance: { recordDigest: DIGEST_A },
    priority: 'high',
    risk: 'moderate',
    createdAt: AT,
  };
}

/** A minimal variant without the optional body/substrate refs. */
export function bodylessCaseInput(): CreateCapabilityCaseInput {
  const input = validCaseInput();
  const { currentBody: _b, currentSubstrate: _s, ...rest } = input;
  return rest;
}
