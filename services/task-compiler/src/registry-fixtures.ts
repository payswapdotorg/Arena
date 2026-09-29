/**
 * Registry test fixtures — deterministic TaskSpec proposals at the same
 * identity, version and DIFFERENT content (to exercise append-only
 * supersession). Not part of the public surface.
 */

import { createTaskSpec } from '@arena/task-spec';
import type { TaskSpec } from '@arena/task-spec';

const BASE = {
  identity: { tenant: 'tenant-alpha', taskId: 'task-case-review-invoices' },
  version: '1.0.0',
  taskClass: 'correction',
  capabilityLabels: ['invoice-reconciliation', 'accounts-payable'],
  difficulty: { scale: 'arena:task-difficulty@1', class: 'standard' },
  domain: {
    kind: 'domain',
    id: 'accounts-payable',
    version: '1.0.0',
    digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  initialState: {
    environment: {
      namespace: 'tenant-alpha',
      name: 'erp-close-sandbox',
      version: '1.4.0',
      digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    seed: 'seed-2026-alpha',
    note: null,
  },
  objectives: ['Reconcile credit notes against partially paid invoices'],
  constraints: ['Use only the ERP export snapshot'],
  permittedTools: [
    {
      namespace: 'tenant-alpha',
      name: 'erp-export-reader',
      version: '1.0.0',
      digest: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
  ],
  prohibitedShortcuts: ['Assume full settlement without checking credit notes'],
  expectedOutputs: ['Netted total matches the ERP expected balance'],
  completionCriteria: ['Netted total matches the ERP expected balance'],
  evidenceCriteria: ['Annotated trajectory with the netting decision'],
  longHorizonEvidence: null,
  environmentRequirements: {
    environments: [
      {
        namespace: 'tenant-alpha',
        name: 'erp-close-sandbox',
        version: '1.4.0',
        digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
    ],
    constraints: ['No live ERP writes'],
  },
  evaluatorBindings: [
    {
      evaluatorId: 'reconciliation-accuracy',
      version: '1.0.0',
      descriptorDigest: '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f',
    },
  ],
  verifierBindings: [
    {
      verifierId: 'erp-balance-check',
      version: '1.0.0',
      descriptorDigest: '2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e',
    },
  ],
  expertQualificationRequirements: {
    competencies: [
      {
        kind: 'capability',
        id: 'invoice-reconciliation',
        version: '1.2.0',
        digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    ],
    qualificationPolicy: null,
    expectations: ['qualified in the target capability within the last 180 days'],
  },
  quality: [
    'realistic-context',
    'discriminative-difficulty',
    'observable-success',
    'reproducible-evaluation',
    'low-leakage',
    'clear-provenance',
    'declared-limitations',
  ].map((dimension) => ({
    dimension,
    satisfied: true,
    justification: `declared posture for ${dimension}`,
    provenance: { source: 'compilation-policy', ref: 'reference-policy@1.0.0' },
  })),
  dataRights: {
    classification: 'private-tenant',
    tenantScope: 'tenant-alpha',
    crossTenantReuse: false,
    licensing: null,
    privacyNotes: null,
  },
  derivedFrom: {
    caseRef: {
      tenant: 'tenant-alpha',
      caseId: 'case-review-invoices',
      version: '1.0.0',
      digest: '3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d',
    },
    policyRef: {
      policyId: 'reference-policy',
      version: '1.0.0',
      digest: '4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c',
    },
  },
} as const;

/** Three content-distinct proposals at the SAME identity + version. */
export async function createFixtureSpecs(): Promise<[TaskSpec, TaskSpec, TaskSpec]> {
  const first = await createTaskSpec({
    ...BASE,
    instructions: 'first proposal content',
  } as never);
  const second = await createTaskSpec({
    ...BASE,
    instructions: 'second proposal content (different rules)',
  } as never);
  const third = await createTaskSpec({
    ...BASE,
    instructions: 'third proposal content (yet another policy)',
    objectives: ['Reconcile credit notes', 'Explain the netting in the summary'],
  } as never);
  return [first, second, third];
}
