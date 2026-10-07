/**
 * Test support for services/human-data (Work Order C012) — deterministic
 * fixtures built through the PUBLIC domain surface of @arena/human-data and
 * the merged dependency vocabularies. NOT exported from the service index.
 */

import type { AdjudicationOutcome } from '@arena/escalation-validation';
import { createEscalationResult } from '@arena/escalation';
import type { EscalationResult } from '@arena/escalation';
import type { CreateHumanDataCommissionInput } from '@arena/human-data';
import type { ReplayTrace } from '@arena/expert-session';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';
export const CLIENT_APP_ID = 'studio-app';
export const NOW = Date.parse('2026-10-07T09:00:00.000Z');

export const CONSENT = Object.freeze({
  granted: true,
  statement:
    'Expert grants reuse rights for the produced records (EES1.0 consent/rights statement collected at session completion).',
});

export function makeCommissionInput(
  overrides: Partial<CreateHumanDataCommissionInput> = {},
): CreateHumanDataCommissionInput {
  return {
    tenantId: TENANT_A,
    clientAppId: CLIENT_APP_ID,
    datasetName: 'triage-corrections',
    capabilityNeed: 'medical.triage.corrections',
    deliverableKind: 'correction-pairs',
    escalationModes: ['correct'],
    perItemOutputSchema: {
      type: 'object',
      properties: { correctedRef: { type: 'string' }, replacement: { type: 'object' } },
    },
    quantity: 2,
    acceptanceCriteria: { criteria: ['replacement-is-valid-json'], minAcceptedRatio: 0.5 },
    budget: { amountMinorUnits: 5000, currency: 'USD' },
    urgency: 'priority',
    productionWindowMs: 24 * 60 * 60 * 1000,
    expertRequirements: { requiredCapabilities: ['medical.triage'] },
    locale: 'en',
    permittedActions: ['read-context', 'propose-patch', 'annotate-evidence'],
    environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 90 * 24 * 60 * 60 * 1000, disposition: 'retain' },
    rights: {
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'tenant-only',
      customerData: 'derived',
    },
    consent: {
      granted: true,
      statement:
        'The customer grants Arena the right to assemble the commissioned deliverables into a versioned dataset bundle (training-data rights; operational delivery stays separate per ERF1.0).',
    },
    now: NOW,
    ...overrides,
  };
}

export function makeAdjudicationOutcome(input: {
  readonly requestId: string;
  readonly tenantId?: string;
  readonly verdict?: 'ACCEPTED' | 'REVISION_REQUIRED' | 'REJECTED' | 'NEEDS_MORE_EVIDENCE';
}): AdjudicationOutcome {
  return {
    adjudicationVersion: 1,
    verdictId: `av_${input.requestId.replaceAll(/[^0-9a-f]/g, '0').slice(0, 32).padEnd(32, '0')}`,
    requestId: input.requestId,
    tenantId: input.tenantId ?? TENANT_A,
    attemptNumber: 1,
    verdict: input.verdict ?? 'ACCEPTED',
    reasons: [
      { code: 'evaluation-meets-criteria', detail: 'all declared criteria met', ref: null },
      { code: 'verification-pass', detail: 'evidence supports claims', ref: null },
    ],
    evaluationStage: {
      stage: 'evaluation',
      outcome: 'meets-criteria',
      recordDigest: 'a'.repeat(64),
      evaluatorRef: 'evaluator-ref-1',
      validatorExpertRef: null,
      criteriaJudgments: [{ criteriaRef: 'criteria:1', verdict: 'met', score: 1, note: null }],
      executedAt: '2026-10-07T10:00:00.000Z',
      provenance: 'test-fixture',
    },
    verificationStage: {
      stage: 'verification',
      outcome: 'pass',
      recordDigest: 'b'.repeat(64),
      verifierRef: 'verifier-ref-1',
      evidenceSupport: [{ claim: 'claim:1', status: 'present-supported' }],
      evidenceRefs: ['evidence://1'],
      executedAt: '2026-10-07T10:05:00.000Z',
      provenance: 'test-fixture',
    },
    validationStatus: (input.verdict ?? 'ACCEPTED') === 'ACCEPTED' ? 'passed' : 'pending',
    adjudicatedAt: '2026-10-07T10:10:00.000Z',
  };
}

export function makeResult(): EscalationResult {
  return createEscalationResult({
    kind: 'correction',
    producedAt: '2026-10-07T10:00:00.000Z',
    summary: 'fixture correction',
    correctedRef: 'record:T-1001',
    replacement: { priority: 'P1', rationale: 'clinical keywords detected' },
  });
}

export function makeReplayTrace(): ReplayTrace {
  return {
    replayVersion: 1,
    kind: 'bounded-expert-session-replay',
    sessionId: 'session-replay-1',
    capsuleDigest: 'c'.repeat(64),
    frames: [
      {
        step: 1,
        state: { queueDepth: 3 },
        action: { tool: 'triage-console', command: 'reclassify' },
        consequence: { ticketId: 'T-1001', newPriority: 'P1' },
        evidence: [{ annotation: 'clinical keywords detected' }],
      },
    ],
    replayedAt: '2026-10-07T10:30:00.000Z',
    liveMutation: false,
  };
}
