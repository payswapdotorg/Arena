/**
 * Test support (Work Order C006) — deterministic fixtures for the
 * expert-session service tests. Reuses @arena/escalation's canonical
 * request factory and drives REAL C001 lifecycle records through
 * created → triaged → matching → offered → accepted so session binding
 * is exercised against the genuine C001 state machine (injected port,
 * never a mock of its semantics).
 */

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
} from '@arena/escalation';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import type { ExecutionCapsuleSource } from '@arena/expert-session';

/** A valid ES1.0 request input (mirrors @arena/escalation's fixture shape; the package does not export its own test-support). */
function baseRequestInput(): CreateEscalationRequestInput {
  return {
    clientAppId: 'epoch-app',
    tenantId: 'tenant-alpha',
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['teach'],
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
    permittedActions: ['read-context', 'run-approved-tools', 'propose-patch', 'annotate-evidence', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
  };
}

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const START = Date.parse('2026-10-07T10:00:00.000Z');
export const T0 = '2026-10-07T10:05:00.000Z';
export const T1 = '2026-10-07T10:10:00.000Z';
export const T2 = '2026-10-07T10:15:00.000Z';
export const T3 = '2026-10-07T10:20:00.000Z';
/** past the escalation deadline (10:00 + 1h = 11:00) */
export const PAST_DEADLINE = '2026-10-07T12:00:00.000Z';

/** A request input that authorizes a bounded-replica session. */
export function sessionCapableRequestInput(
  overrides: Partial<CreateEscalationRequestInput> = {},
): CreateEscalationRequestInput {
  return {
    ...baseRequestInput(),
    escalationModes: ['teach'],
    ...overrides,
  };
}

/** A REAL C001 escalation record driven to the `accepted` state. */
export async function acceptedEscalation(
  overrides: Partial<CreateEscalationRequestInput> = {},
): Promise<EscalationRecord> {
  const request = await createEscalationRequest(sessionCapableRequestInput(overrides));
  let record = createEscalationRecord(request, START);
  record = applyEscalationTransition(record, 'triaged', { now: START, actor: 'system' });
  record = applyEscalationTransition(record, 'matching', { now: START, actor: 'system' });
  record = applyEscalationTransition(record, 'offered', { now: START, expertRef: 'expert-alice', actor: 'system' });
  record = applyEscalationTransition(record, 'accepted', { now: START, expertRef: 'expert-alice', actor: 'expert-alice' });
  return record;
}

/** The execution capsule source the materializer derives against. */
export function capsuleSource(): ExecutionCapsuleSource {
  return {
    taskRef: 'task-7',
    worldState: {
      step: 'awaiting-vendor-match',
      customerEmail: 'acme-buyer@example.com',
      accountNumber: '1234567890',
      openItems: [
        { invoice: 'INV-001', amount: 12000 },
        { invoice: 'INV-002', amount: 8000 },
      ],
    },
    files: [
      { path: 'logs/agent-trace.jsonl', readOnly: true },
      { path: 'docs/vendor-catalog.md' },
      { path: 'docs/confidential-notes.md' },
    ],
    toolAvailability: ['search-vendors', 'compute-reconciliation', 'admin-console'],
    policy: { privacyClassification: 'confidential', pii: 'redact', sanitization: 'strict' },
    relevantHistory: ['trajectory/run-2026-10-07-001'],
    environmentDigest: 'c'.repeat(64),
  };
}
