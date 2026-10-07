/**
 * Test support (Work Order C009 service) — deterministic fixtures: an
 * escalation record driven through the C001 public lifecycle to
 * SUBMITTED, a SOLVE intervention result contract, and a wired
 * reference service fabric.
 */

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
  createEscalationResult,
} from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';
import { createInterventionResult } from '@arena/intervention';
import type { InterventionResultContract } from '@arena/intervention';
import { createValidatorCandidate } from '@arena/escalation-validation';
import type { CreateDeclaredValidationConditionInput } from '@arena/escalation-validation';
import { EscalationValidationService } from './service.js';
import {
  FixedClock,
  InMemoryEscalationEventSink,
  InMemoryEscalationPort,
  InMemoryValidationStore,
  ReferenceEvaluationStage,
  ReferenceVerificationStage,
} from './fabric.js';
import type {
  ReferenceEvaluationScript,
  ReferenceVerificationScript,
} from './fabric.js';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');

/** A fixed, valid ES1.0 request input (deterministic). */
export function validRequestInput(overrides: Record<string, unknown> = {}) {
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
  } as Parameters<typeof createEscalationRequest>[0];
}

/** A fixed, valid declared validation condition. */
export function validConditionInput(
  overrides: Partial<CreateDeclaredValidationConditionInput> = {},
): CreateDeclaredValidationConditionInput {
  return {
    kind: 'criteria-threshold',
    criteriaRefs: ['boq-estimation.quantity-takeoff.completeness'],
    criteriaThreshold: 0.8,
    requiredEvidenceKinds: ['artifact-ref', 'trajectory-ref'],
    requiredEvidenceClaims: [
      'the completed quantity takeoff is backed by a provenance-bearing artifact',
      'the observable work record backs the claimed steps',
    ],
    maxRevisionAttempts: 2,
    revisionWindowMs: 3_600_000,
    ...overrides,
  };
}

/** A SOLVE intervention result contract (the SUBMITTED payload). */
export function solveContract(): InterventionResultContract {
  return createInterventionResult({
    mode: 'solve',
    permittedModes: ['solve'],
    requestId: 'esc_00000000000000000000000000000000',
    sessionId: 'session-alpha-1',
    producedAt: '2026-10-07T10:30:00.000Z',
    summary: 'Completed the quantity takeoff subproblem with evidence.',
    payload: { total: 1250 },
    steps: ['measure walls', 'apply local convention'],
    evidenceRefs: ['artifact://takeoff-1', 'trajectory://run-2026-10-07-001'],
  });
}

/**
 * Drive one escalation through the C001 public lifecycle to SUBMITTED
 * (triaged → matching → offered → accepted → session_ready →
 * in_progress → submitted), assigning the given expert.
 */
export async function escalationToSubmitted(
  expertRef = 'expert-submitter-1',
): Promise<EscalationRecord> {
  const request = await createEscalationRequest(
    validRequestInput({ requestId: 'esc_00000000000000000000000000000000' }),
  );
  let record = createEscalationRecord(request, T0);
  const step = (ms: number): { now: number } => ({ now: T0 + ms });
  record = applyEscalationTransition(record, 'triaged', step(1_000));
  record = applyEscalationTransition(record, 'matching', step(2_000));
  record = applyEscalationTransition(record, 'offered', { ...step(3_000), expertRef });
  record = applyEscalationTransition(record, 'accepted', step(4_000));
  record = applyEscalationTransition(record, 'session_ready', {
    ...step(5_000),
    sessionRef: 'session-alpha-1',
  });
  record = applyEscalationTransition(record, 'in_progress', step(6_000));
  const result = createEscalationResult({
    kind: 'solution',
    producedAt: '2026-10-07T10:30:00.000Z',
    summary: 'Completed the quantity takeoff subproblem with evidence.',
    payload: { total: 1250 },
    steps: ['measure walls', 'apply local convention'],
  });
  record = applyEscalationTransition(record, 'submitted', {
    ...step(7_000),
    result,
  });
  return record;
}

/** One validator candidate (C005 dimensional projection). */
export function validatorCandidate(expertRef: string, evidenceRecords = 10) {
  return createValidatorCandidate({
    expertRef,
    tenant: 'tenant-alpha',
    competency: [
      {
        skill: 'boq-estimation.quantity-takeoff',
        evidenceRecords,
        totalSampleSize: evidenceRecords * 10,
        latestOutcome: 'demonstrated',
        stale: false,
      },
    ],
    agreement: { agreements: 8, disagreements: 1 },
  });
}

/** The handoff command a C007 submit produces for the SOLVE contract. */
export function handoffCommand(contract: InterventionResultContract = solveContract()) {
  return {
    requestId: 'esc_00000000000000000000000000000000',
    tenantId: 'tenant-alpha',
    correlationId: 'corr-0001',
    mode: 'solve',
    resultKind: 'solution',
    contract,
    submittedAt: '2026-10-07T10:30:00.000Z',
  };
}

/** A fully-wired reference service over the in-memory fabric. */
export async function wiredService(options: {
  readonly evaluation?: ReferenceEvaluationScript;
  readonly verification?: ReferenceVerificationScript;
  readonly candidates?: readonly ReturnType<typeof validatorCandidate>[];
  readonly now?: number;
} = {}) {
  const escalationPort = new InMemoryEscalationPort();
  const eventSink = new InMemoryEscalationEventSink();
  const store = new InMemoryValidationStore();
  const service = new EscalationValidationService({
    clock: new FixedClock(options.now ?? T0 + 8 * 60_000),
    escalationPort,
    eventSink,
    store,
    evaluationStage: new ReferenceEvaluationStage(options.evaluation ?? {}),
    verificationStage: new ReferenceVerificationStage(options.verification ?? {}),
    validatorDirectory: {
      listValidatorCandidates: async () => options.candidates ?? [validatorCandidate('expert-validator-1')],
    },
  });
  const escalation = await escalationToSubmitted();
  await escalationPort.seed(escalation);
  return { service, escalationPort, eventSink, store, escalation };
}
