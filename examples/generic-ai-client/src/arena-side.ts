/**
 * The Arena-side lifecycle driving shared by BOTH C019 E2E loops (the
 * generic client walkthrough and the Epoch escalation loop): the
 * post-subscription half of the §15 proof — bounded expert session,
 * intervention, validation, typed result, payment + Arena fee,
 * optional learning capture, close.
 *
 * This models what ARENA's own operators/experts do (the client only
 * observes through polling + signed webhooks). Deterministic.
 */

import { createEscalationResult } from '@arena/escalation';
import type { EscalationResult } from '@arena/escalation';
import {
  appendSessionEvent,
  applyExpertSessionTransition,
  composePrivacyBarrier,
  createExpertSessionRecord,
  createExpertSessionSubmission,
  deriveExpertSessionCapsule,
} from '@arena/expert-session';
import type { ExpertSessionRecord } from '@arena/expert-session';
import { checkModeAuthorization, sessionModeForEscalationMode } from '@arena/intervention';
import type { PlainJsonValue } from '@arena/expert-session';
import type { PaymentCostFields } from '@arena/payments-service';
import type { ReferenceArena } from './fabric.js';

export interface DriveCompletionInput {
  readonly arena: ReferenceArena;
  readonly requestId: string;
  readonly tenantId: string;
  /** The polling snapshot taken right after submission (state `offered`). */
  readonly offered: {
    readonly expertRef?: string;
    readonly escalationModes: readonly string[];
    readonly environmentSessionMode?: string;
    readonly permittedActions: readonly string[];
    readonly learningPermissions: { readonly allowKnowledgeCapture: boolean };
  };
  readonly taskRef: string;
  readonly worldState: Record<string, PlainJsonValue>;
  readonly resultSummary: string;
  readonly resultPayload: Record<string, PlainJsonValue>;
  readonly sessionId: string;
}

export interface DriveCompletionReceipt {
  readonly sessionRef: string;
  readonly capsuleDigest: string;
  readonly session: ExpertSessionRecord;
  readonly modeAuthorization: { readonly allowed: boolean; readonly mode: string };
  readonly expertActions: readonly { readonly action: string; readonly allowed: boolean }[];
  readonly result: EscalationResult;
  readonly costFields: PaymentCostFields;
  readonly learningCaptured: boolean;
}

export async function driveEscalationToCompletion(
  input: DriveCompletionInput,
): Promise<DriveCompletionReceipt> {
  const { arena, requestId, tenantId } = input;
  const at = () => arena.clock.now();
  const expertRef = input.offered.expertRef ?? 'expert-unassigned';

  // C010: budget hold + offer around the expert match.
  await arena.paymentService.holdBudget({ requestId, tenantId, operationKey: 'op-hold-0001' });
  await arena.paymentService.recordOffer({ requestId, tenantId, operationKey: 'op-offer-0001' });

  // C006: the bounded replica (privacy-sanitized capsule).
  const barrier = composePrivacyBarrier({
    tenantId,
    redactedFields: ['clientName', 'unitPrices.internal'],
    identityMasking: true,
    timeLimitedCredentials: true,
    credentialsExpiresAt: new Date(at() + 3_600_000).toISOString(),
    actionAllowlist: [...input.offered.permittedActions],
    readOnlyResources: ['boq-draft-v3.json'],
  });
  const capsule = await deriveExpertSessionCapsule({
    escalationRef: { requestId, tenantId },
    sessionMode: sessionModeForEscalationMode('solve'),
    allowedModes: ['takeover', 'unblock'],
    barrier,
    source: {
      taskRef: input.taskRef,
      worldState: input.worldState,
      files: [{ path: 'boq-draft-v3.json', readOnly: true }],
      toolAvailability: ['boq-calculator', 'rate-lookup'],
      policy: { privacyClassification: 'confidential', pii: 'redact', sanitization: 'strict' },
      relevantHistory: [requestId],
    },
    now: at(),
    expiresAt: new Date(at() + 3_600_000).toISOString(),
    sessionId: input.sessionId,
  });

  let session = createExpertSessionRecord(capsule, at());
  session = applyExpertSessionTransition(session, 'active', { now: at() });

  // The intervention: observable expert work inside the replica.
  session = appendSessionEvent(session, {
    kind: 'environment-observation',
    payload: { observed: `${input.taskRef} carries an unverified local convention` },
    now: at(),
    actor: expertRef,
  });
  session = appendSessionEvent(session, {
    kind: 'human-action',
    payload: { action: 'consult-local-convention', note: 'verify the local practice' },
    now: at(),
    actor: expertRef,
  });
  session = appendSessionEvent(session, {
    kind: 'tool-result',
    payload: { tool: 'rate-lookup', found: 'local convention confirmed (450mm foundation depth)' },
    now: at(),
    actor: expertRef,
  });
  session = appendSessionEvent(session, {
    kind: 'annotation',
    payload: { note: 'quantity recomputed on the confirmed convention', evidenceRef: 'rate-lookup-001' },
    now: at(),
    actor: expertRef,
  });
  session = appendSessionEvent(session, {
    kind: 'final-result',
    payload: input.resultPayload,
    now: at(),
    actor: expertRef,
  });
  const submission = createExpertSessionSubmission({
    sessionId: capsule.sessionId,
    result: input.resultPayload,
    evidence: [{ kind: 'event-ref', ref: 'rate-lookup-001' }],
    annotations: [{ subjectRef: 'boq-draft-v3.json', note: 'depth basis corrected' }],
    corrections: [
      { correctedRef: 'boq-draft-v3.json#blockC', replacement: { foundationDepthMm: 450 } },
    ],
    consentRightsStatement: {
      granted: true,
      statement: 'Knowledge patch may be retained as a scoped, attributed domain rule.',
    },
    now: at(),
  });
  session = applyExpertSessionTransition(session, 'completed', { now: at(), submission });

  // C007: mode authorization (the requested modes, closed vocabulary).
  const modeAuthorization = checkModeAuthorization(
    {
      escalationModes: input.offered.escalationModes,
      ...(input.offered.environmentSessionMode === undefined
        ? {}
        : { environmentSessionMode: input.offered.environmentSessionMode }),
    },
    'solve',
  );

  // Lifecycle: accepted → session_ready → in_progress (+ permitted actions).
  // (The service stamps `now` from the SAME fixed clock; the caller never
  // injects transition time through this surface.)
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'accepted', {
    actor: expertRef,
  });
  // C010: the acceptance + capture markers ride the ACCEPTED state
  // window (the ledger's lifecycle binding — capture at ACCEPTED).
  await arena.paymentService.recordAcceptance({ requestId, tenantId, operationKey: 'op-accept-0001' });
  await arena.paymentService.captureBudget({ requestId, tenantId, operationKey: 'op-capture-0001' });
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'session_ready', {
    sessionRef: capsule.sessionId,
    actor: 'arena',
  });
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'in_progress', {
    actor: expertRef,
  });
  const expertActions: { action: string; allowed: boolean }[] = [];
  for (const action of input.offered.permittedActions) {
    const recorded = await arena.escalationService.recordExpertAction(requestId, tenantId, action);
    expertActions.push({ action: recorded.action, allowed: recorded.allowed });
  }

  // The typed ES1.0 result + validation (recorded verdict — the C009 seam).
  const result = createEscalationResult({
    kind: 'unblock',
    producedAt: at(),
    summary: input.resultSummary,
    blockageRef: `${input.taskRef}/foundation-depth`,
    resolution: input.resultPayload,
  });
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'submitted', {
    result,
    actor: expertRef,
  });
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'validating', {
    actor: 'arena',
  });
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'result_accepted', {
    validationStatus: 'passed',
    actor: 'arena',
  });

  // Payment: release on completion (the deterministic fee split) → PAID.
  const release = await arena.paymentService.releasePayout({
    requestId,
    tenantId,
    operationKey: 'op-release-0001',
  });
  const costFields = release.costFields;
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'paid', {
    cost: {
      amountMinorUnits: costFields.amountMinorUnits,
      currency: costFields.currency,
      arenaFeeMinorUnits: costFields.arenaFeeMinorUnits,
      expertPayoutStatus: costFields.expertPayoutStatus,
    },
    actor: 'arena',
  });

  // Optional learning capture → close.
  const learningCaptured = input.offered.learningPermissions.allowKnowledgeCapture;
  if (learningCaptured) {
    await arena.escalationService.advanceLifecycle(requestId, tenantId, 'learning_captured', {
      actor: 'arena',
    });
  }
  await arena.escalationService.advanceLifecycle(requestId, tenantId, 'closed', {
    actor: 'arena',
  });

  return Object.freeze({
    sessionRef: capsule.sessionId,
    capsuleDigest: capsule.digest,
    session,
    modeAuthorization: { allowed: modeAuthorization.allowed, mode: modeAuthorization.mode },
    expertActions: Object.freeze([...expertActions]),
    result,
    costFields,
    learningCaptured,
  });
}
