/**
 * Test support for @arena/human-data (Work Order C012) — deterministic
 * fixtures over the REAL merged domain packages (never parallel models):
 * a valid commission input, C009 adjudication outcomes, EES1.0 replay
 * traces and C001 escalation results. NOT exported from the package index.
 */

import type { AdjudicationOutcome } from '@arena/escalation-validation';
import type { EscalationResult } from '@arena/escalation';
import { createEscalationResult } from '@arena/escalation';
import type { ReplayTrace } from '@arena/expert-session';
import type { CreateHumanDataCommissionInput, HumanDataCommission } from './commission.js';
import { createHumanDataCommission } from './commission.js';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';
export const CLIENT_APP_ID = 'studio-app';
export const NOW = Date.parse('2026-10-07T09:00:00.000Z');

const VALID_RIGHTS = Object.freeze({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'tenant-only',
  customerData: 'derived',
});

const VALID_CONSENT = Object.freeze({
  granted: true,
  statement:
    'The customer grants Arena the right to assemble the commissioned deliverables into a versioned dataset bundle for the customer AI pipeline (training-data rights; operational delivery stays separate per ERF1.0).',
});

/** A valid commission input (overrides merge last). */
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
    rights: VALID_RIGHTS,
    consent: VALID_CONSENT,
    now: NOW,
    ...overrides,
  };
}

export async function makeCommission(
  overrides: Partial<CreateHumanDataCommissionInput> = {},
): Promise<HumanDataCommission> {
  return createHumanDataCommission(makeCommissionInput(overrides));
}

/** A C009 AdjudicationOutcome literal (ACCEPTED by default). */
export function makeAdjudicationOutcome(input: {
  readonly requestId: string;
  readonly tenantId?: string;
  readonly verdict?: 'ACCEPTED' | 'REVISION_REQUIRED' | 'REJECTED' | 'NEEDS_MORE_EVIDENCE';
  readonly attemptNumber?: number;
}): AdjudicationOutcome {
  return {
    adjudicationVersion: 1,
    verdictId: `av_${requestIdHash(input.requestId)}`,
    requestId: input.requestId,
    tenantId: input.tenantId ?? TENANT_A,
    attemptNumber: input.attemptNumber ?? 1,
    verdict: input.verdict ?? 'ACCEPTED',
    reasons: [
      { code: 'evaluation-meets-criteria', detail: 'all declared criteria met', ref: null },
      { code: 'verification-pass', detail: 'evidence supports claims', ref: null },
    ] as AdjudicationOutcome['reasons'],
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

function requestIdHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(32, '0').slice(0, 32);
}

/** An EES1.0 bounded-session replay trace (state → action → consequence → evidence). */
export function makeReplayTrace(sessionId = 'session-replay-1'): ReplayTrace {
  return {
    replayVersion: 1,
    kind: 'bounded-expert-session-replay',
    sessionId,
    capsuleDigest: 'c'.repeat(64),
    frames: [
      {
        step: 1,
        state: { queueDepth: 3, oldestTicketMinutes: 42 },
        action: { tool: 'triage-console', command: 'reclassify', expert: 'expert-1' },
        consequence: { ticketId: 'T-1001', newPriority: 'P1' },
        evidence: [{ annotation: 'clinical keywords detected in T-1001' }],
      },
    ],
    replayedAt: '2026-10-07T10:30:00.000Z',
    liveMutation: false,
  };
}

/** A C001 escalation result of the requested kind. */
export function makeResult(kind: string): EscalationResult {
  const base = {
    producedAt: '2026-10-07T10:00:00.000Z',
    summary: 'fixture result',
  };
  switch (kind) {
    case 'correction':
      return createEscalationResult({
        ...base,
        kind,
        correctedRef: 'record:T-1001',
        replacement: { priority: 'P1', rationale: 'clinical keywords detected' },
      });
    case 'solution':
      return createEscalationResult({
        ...base,
        kind,
        payload: { resolved: true },
        steps: ['observe state', 'act', 'observe consequence'],
      });
    case 'evaluation-verdict':
      return createEscalationResult({
        ...base,
        kind,
        verdict: 'pass',
        subjectRef: 'subject:T-1002',
      });
    case 'knowledge-patch':
      return createEscalationResult({
        ...base,
        kind,
        statement: 'Tickets carrying clinical keywords are P1.',
        scope: 'tenant-a/triage',
      });
    case 'answer':
      return createEscalationResult({
        ...base,
        kind,
        payload: { answered: true },
      });
    default:
      throw new Error(`unsupported fixture result kind: ${kind}`);
  }
}

export { VALID_RIGHTS, VALID_CONSENT };
