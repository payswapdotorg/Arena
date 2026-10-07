/**
 * Test support (Work Order C007) — deterministic fixtures for the
 * intervention service tests. Builds REAL C001 escalation records
 * driven to `session_ready` and REAL C006 expert session records via
 * the merged domain packages (injected ports, never mocked semantics).
 */

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
} from '@arena/escalation';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import {
  composePrivacyBarrier,
  createExpertSessionRecord,
  deriveExpertSessionCapsule,
  deriveSessionModes,
} from '@arena/expert-session';
import type { ExpertSessionRecord, ExecutionCapsuleSource } from '@arena/expert-session';

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const START = Date.parse('2026-10-07T10:00:00.000Z');
export const T0 = '2026-10-07T10:05:00.000Z';
export const T1 = '2026-10-07T10:10:00.000Z';
export const T2 = '2026-10-07T10:15:00.000Z';
export const T3 = '2026-10-07T10:20:00.000Z';
export const T4 = '2026-10-07T10:25:00.000Z';
/** past the escalation deadline (10:00 + 1h = 11:00) */
export const PAST_DEADLINE = '2026-10-07T12:00:00.000Z';
export const DIGEST_A = 'a'.repeat(64);
export const DIGEST_B = 'b'.repeat(64);

/** A valid ES1.0 request input authorizing teach + correct + unblock. */
export function interventionCapableRequestInput(
  overrides: Partial<CreateEscalationRequestInput> = {},
): CreateEscalationRequestInput {
  return {
    clientAppId: 'epoch-app',
    tenantId: TENANT_A,
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['teach', 'correct', 'unblock'],
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
    permittedActions: [
      'read-context',
      'run-approved-tools',
      'propose-patch',
      'annotate-evidence',
      'ask-clarification',
      'signal-tool-gap',
    ],
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

/** A REAL C001 escalation record driven to the `session_ready` state. */
export async function sessionReadyEscalation(
  overrides: Partial<CreateEscalationRequestInput> = {},
  sessionId = 'session-boq-teach-1',
): Promise<EscalationRecord> {
  const request = await createEscalationRequest(interventionCapableRequestInput(overrides));
  let record = createEscalationRecord(request, START);
  record = applyEscalationTransition(record, 'triaged', { now: START, actor: 'system' });
  record = applyEscalationTransition(record, 'matching', { now: START, actor: 'system' });
  record = applyEscalationTransition(record, 'offered', { now: START, expertRef: 'expert-alice', actor: 'system' });
  record = applyEscalationTransition(record, 'accepted', { now: START, expertRef: 'expert-alice', actor: 'expert-alice' });
  record = applyEscalationTransition(record, 'session_ready', {
    now: START,
    expertRef: 'expert-alice',
    sessionRef: sessionId,
    actor: 'expert-session-service',
  });
  return record;
}

/** The execution capsule source the capsule derivation runs against. */
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
    ],
    toolAvailability: ['search-vendors', 'compute-reconciliation'],
    policy: { privacyClassification: 'confidential', pii: 'redact', sanitization: 'strict' },
    relevantHistory: ['trajectory/run-2026-10-07-001'],
    environmentDigest: DIGEST_A,
  };
}

/** A REAL C006 expert session record (state `open`) bound to the escalation. */
export async function expertSessionRecord(
  escalation: EscalationRecord,
  sessionId = 'session-boq-teach-1',
): Promise<ExpertSessionRecord> {
  // Mirror C006's session-mode derivation from the request's modes.
  const allowedModes = deriveSessionModes(escalation.request.escalationModes);
  const sessionMode = allowedModes.find((mode) => mode !== 'observe') ?? 'observe';
  const barrier = composePrivacyBarrier({
    tenantId: TENANT_A,
    actionAllowlist: [
      'observe-state',
      'annotate',
      'edit-artifact',
      'invoke-tool',
      'supply-information',
      'submit-result',
      'signal-tool-gap',
      'capture-checkpoint',
    ],
    redactedFields: ['customerEmail', 'accountNumber'],
    redactedDocuments: [],
    excludedTools: [],
    identityMasking: true,
    timeLimitedCredentials: true,
    credentialsExpiresAt: escalation.request.deadline,
    readOnlyResources: ['logs/agent-trace.jsonl'],
    restrictions: { download: true, clipboard: true, screenshot: true },
  });
  const capsule = await deriveExpertSessionCapsule({
    escalationRef: { requestId: escalation.request.requestId, tenantId: TENANT_A },
    sessionMode,
    allowedModes,
    barrier,
    source: capsuleSource(),
    now: T0,
    expiresAt: escalation.request.deadline,
    sessionId,
  });
  return createExpertSessionRecord(capsule, T0);
}

/** A deterministic A011 trajectory binding for the intervention. */
export function trajectoryBinding() {
  return {
    trajectoryId: 'ivn-traj-teach-1',
    run: {
      taskVersion: { taskId: 'task-boq-42', version: '1.0.0' },
      environmentVersion: { namespace: 'boq', name: 'accra-standard', version: '1.2.0', digest: DIGEST_A },
      runId: 'tenant-alpha/run-boq-42',
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_A,
    substrateRef: DIGEST_B,
    seed: 'seed-0001',
    startedAt: T0,
  };
}

/** A teach-mode submit result input (per-mode contract fields). */
export function teachResultInput() {
  return {
    summary: 'performed the takeoff so the agent could observe the method',
    demonstration: [
      {
        stateRef: 'capsule/boq-teach-1/state-0',
        humanAction: 'annotated the foundation plan measurement points',
        consequenceRef: 'artifact/takeoff-notes-1',
        evidenceRefs: ['event/session-evt-3', 'artifact/takeoff-notes-1'],
      },
    ],
  };
}
