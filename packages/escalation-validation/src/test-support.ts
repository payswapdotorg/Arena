/**
 * Test support (Work Order C009) — deterministic fixtures for the
 * escalation-validation domain tests, mirroring the sibling test-support
 * conventions (services/intervention defines its own request fixture
 * the same way: @arena/escalation's internal test-support is not part
 * of the package's public export surface).
 */

import type { CreateEscalationRequestInput } from '@arena/escalation';
import type { CreateDeclaredValidationConditionInput } from './plan.js';

export type { CreateEscalationRequestInput };

/** A fixed, valid ES1.0 request input (deterministic ids / timestamps). */
export function validEscalationRequestInput(
  overrides: Partial<CreateEscalationRequestInput> = {},
): CreateEscalationRequestInput {
  return {
    clientAppId: 'epoch-app',
    tenantId: 'tenant-alpha',
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    now: '2026-10-07T10:00:00.000Z',
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
      jurisdictions: ['GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object', required: ['total'], properties: { total: { type: 'number' } } },
    contextReferences: [
      { kind: 'task-ref', ref: 'task-7' },
      { kind: 'trajectory-ref', ref: 'trajectory/run-2026-10-07-001' },
    ],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
    ...overrides,
  };
}

/** A fixed, valid declared validation condition (criteria-threshold kind). */
export function validValidationConditionInput(
  overrides: Partial<CreateDeclaredValidationConditionInput> = {},
): CreateDeclaredValidationConditionInput {
  return {
    kind: 'criteria-threshold',
    criteriaRefs: ['boq-estimation.quantity-takeoff.completeness'],
    criteriaThreshold: 0.8,
    requiredEvidenceKinds: ['artifact-ref', 'trajectory-ref'],
    requiredEvidenceClaims: [
      'the corrected quantity takeoff is backed by a provenance-bearing artifact',
      'the observable work record backs the claimed steps',
    ],
    maxRevisionAttempts: 2,
    revisionWindowMs: 3_600_000,
    ...overrides,
  };
}
