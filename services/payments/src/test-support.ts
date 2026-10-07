/**
 * Test support (Work Order C010 service layer) — deterministic fixtures
 * binding REAL @arena/escalation records to the payments service
 * through the injected lifecycle port (the C001 seam), mirroring the
 * domain package's test-support convention.
 */

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
} from '@arena/escalation';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import type { EscalationLifecyclePort as Port } from './ports.js';

export const FIXED_NOW = Date.parse('2026-10-07T10:00:00.000Z');

/**
 * A fixed, valid ES1.0 request input (deterministic ids / timestamps).
 * Local copy of the C001 fixture shape — the escalation package's
 * test-support is deliberately NOT part of its public surface (see
 * @arena/entitlements' test-support header for the house rule).
 */
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
    now: new Date(FIXED_NOW).toISOString(),
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
      jurisdictions: ['GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object', required: ['total'], properties: { total: { type: 'number' } } },
    contextReferences: [{ kind: 'task-ref', ref: 'task-7' }],
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

/** A full valid escalation record driven to the `offered` state. */
export async function offeredEscalationRecord(
  overrides: Partial<CreateEscalationRequestInput> = {},
): Promise<EscalationRecord> {
  const request = await createEscalationRequest(validEscalationRequestInput(overrides));
  let record = createEscalationRecord(request, FIXED_NOW);
  record = applyEscalationTransition(record, 'triaged', { now: FIXED_NOW });
  record = applyEscalationTransition(record, 'matching', { now: FIXED_NOW });
  record = applyEscalationTransition(record, 'offered', { now: FIXED_NOW, expertRef: 'expert-alpha-1' });
  return record;
}

/** A record driven further to `accepted`. */
export async function acceptedEscalationRecord(
  overrides: Partial<CreateEscalationRequestInput> = {},
): Promise<EscalationRecord> {
  return driveToAccepted(await offeredEscalationRecord(overrides));
}

/** Stepwise driver: offered → accepted (one record, advanced in place). */
export function driveToAccepted(record: EscalationRecord): EscalationRecord {
  return applyEscalationTransition(record, 'accepted', { now: FIXED_NOW });
}

const RESULT_PAYLOAD = {
  resultVersion: 1,
  kind: 'answer',
  summary: 'The BOQ total is 1_234 units.',
  producedAt: new Date(FIXED_NOW).toISOString(),
  payload: { answer: '1234 units' },
} as const;

/** Stepwise driver: accepted → … → result_accepted (validation passed). */
export function driveToResultAccepted(record: EscalationRecord): EscalationRecord {
  let driven = applyEscalationTransition(record, 'session_ready', {
    now: FIXED_NOW,
    sessionRef: 'session-alpha-1',
  });
  driven = applyEscalationTransition(driven, 'in_progress', { now: FIXED_NOW });
  driven = applyEscalationTransition(driven, 'submitted', {
    now: FIXED_NOW,
    result: RESULT_PAYLOAD,
  });
  driven = applyEscalationTransition(driven, 'validating', { now: FIXED_NOW });
  return applyEscalationTransition(driven, 'result_accepted', {
    now: FIXED_NOW,
    validationStatus: 'passed',
  });
}

/** A record driven through validation to `result_accepted` (validation passed). */
export async function resultAcceptedEscalationRecord(
  overrides: Partial<CreateEscalationRequestInput> = {},
): Promise<EscalationRecord> {
  return driveToResultAccepted(await acceptedEscalationRecord(overrides));
}

/** A tenant-scoped C001 directory over real escalation records (the injected C001 seam). */
export function escalationDirectory(
  ...records: readonly EscalationRecord[]
): Port & { put(record: EscalationRecord): void } {
  const map = new Map<string, EscalationRecord>(records.map((record) => [record.request.requestId, record]));
  return {
    get: async (requestId: string, tenantId: string) => {
      const record = map.get(requestId);
      if (record === undefined || record.request.tenantId !== tenantId) return undefined;
      return {
        requestId: record.request.requestId,
        tenantId: record.request.tenantId,
        correlationId: record.request.correlationId,
        state: record.state,
        budget: {
          amountMinorUnits: record.request.budget.amountMinorUnits,
          currency: record.request.budget.currency,
        },
      };
    },
    put(record: EscalationRecord): void {
      map.set(record.request.requestId, record);
    },
  };
}
