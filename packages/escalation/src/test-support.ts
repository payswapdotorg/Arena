/**
 * Test support (Work Order C001) — deterministic fixtures for the
 * escalation domain tests, mirroring @arena/arena-sdk's test-support.ts
 * convention. Exported from the package so downstream surfaces
 * (services/escalation-api, adapters/escalation) reuse ONE canonical
 * request factory instead of drifting local copies.
 */

import type { CreateEscalationRequestInput } from './request.js';

/** A fixed, valid ES1.0 request input (deterministic ids / timestamps). */
export function validEscalationRequestInput(overrides: Partial<CreateEscalationRequestInput> = {}): CreateEscalationRequestInput {
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
