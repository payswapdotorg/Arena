/**
 * tests/integration/production/support/arena-side.ts — the ARENA-side
 * loop driver (Work Order P006; issue #158; the FINAL-HANDOFF §15 loop
 * stages (4)–(11): bounded expert session → intervention → validation →
 * typed result → payment + Arena fee → optional learning capture →
 * close).
 *
 * This models what ARENA's own operators/experts DO inside the deployed
 * host (the C019 example's src/arena-side.ts discipline, recomposed
 * over the INTEGRATED deployment): every lifecycle transition rides the
 * FROZEN host surface (`deployment.host.escalations.advance` — the same
 * surface the public transport binds onto), the expert action log
 * rides the engine's operator surface, and the payment flow rides the
 * REAL PaymentService over the demo provider. Clients NEVER see this
 * driver — they observe every stage at the public boundary (poll
 * results + signed webhook deliveries) exactly as a deployed client
 * would.
 *
 * Deterministic: the deployment's injected ManualClock is the only time
 * source (A015 law).
 */

import { createEscalationResult } from '@arena/escalation';
import type { EscalationResult } from '@arena/escalation';
import {
  appendSessionEvent,
  applyExpertSessionTransition,
  buildReplayTrace,
  composePrivacyBarrier,
  createExpertSessionRecord,
  createExpertSessionSubmission,
  deriveExpertSessionCapsule,
} from '@arena/expert-session';
import type { ExpertSessionRecord, PlainJsonValue, ReplayTrace } from '@arena/expert-session';
import { checkModeAuthorization, sessionModeForEscalationMode } from '@arena/intervention';
import type { PaymentCostFields } from '@arena/payments-service';
import type { IntegratedDeployment } from './harness.js';

/** The Arena-side snapshot the client's first poll produced (state `offered`). */
export interface OfferedSnapshot {
  readonly expertRef: string | undefined;
  readonly escalationModes: readonly string[];
  readonly environmentSessionMode: string | undefined;
  readonly permittedActions: readonly string[];
  readonly learningPermissions: { readonly allowKnowledgeCapture: boolean };
}

export interface DriveCompletionInput {
  readonly deployment: IntegratedDeployment;
  readonly requestId: string;
  readonly tenantId: string;
  readonly offered: OfferedSnapshot;
  readonly taskRef: string;
  readonly worldState: Record<string, PlainJsonValue>;
  readonly resultSummary: string;
  readonly resultPayload: Record<string, PlainJsonValue>;
  readonly sessionId: string;
  /** Idempotency operation keys (unique per escalation in the battery). */
  readonly paymentOperationKeys?: {
    readonly hold: string;
    readonly offer: string;
    readonly accept: string;
    readonly capture: string;
    readonly release: string;
  };
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
  readonly replay: ReplayTrace;
}

/**
 * Drive one escalation from `offered` to terminal over the integrated
 * deployment (the Arena-side half of the §15 loop). Every transition is
 * a guarded, tenant-gated host-surface call; every payment operation is
 * a real PaymentService call over the demo provider.
 */
export async function driveEscalationToCompletion(
  input: DriveCompletionInput,
): Promise<DriveCompletionReceipt> {
  const { deployment, requestId, tenantId } = input;
  const arena = deployment.arena;
  const clock = deployment.clock;
  const at = () => clock.now();
  const expertRef = input.offered.expertRef ?? 'expert-unassigned';
  const operationKeys = input.paymentOperationKeys ?? {
    hold: `op-hold-${requestId}`,
    offer: `op-offer-${requestId}`,
    accept: `op-accept-${requestId}`,
    capture: `op-capture-${requestId}`,
    release: `op-release-${requestId}`,
  };

  // C010: budget hold + commercial offer around the expert match.
  await arena.payments.holdBudget({ requestId, tenantId, operationKey: operationKeys.hold });
  await arena.payments.recordOffer({ requestId, tenantId, operationKey: operationKeys.offer });

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

  // The intervention: OBSERVABLE expert work inside the replica (the
  // event kinds the C006 session log records — observations, human
  // actions, tool results, annotations, the final result).
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

  // Lifecycle: accepted → session_ready → in_progress — every
  // transition through the FROZEN host surface (tenant-gated).
  await deployment.host.escalations.advance(tenantId, requestId, 'accepted', {
    actor: expertRef,
  });
  // C010: the acceptance + capture markers ride the ACCEPTED state
  // window (the ledger's lifecycle binding — capture at ACCEPTED).
  await arena.payments.recordAcceptance({ requestId, tenantId, operationKey: operationKeys.accept });
  await arena.payments.captureBudget({ requestId, tenantId, operationKey: operationKeys.capture });
  await deployment.host.escalations.advance(tenantId, requestId, 'session_ready', {
    sessionRef: capsule.sessionId,
    actor: 'arena',
  });
  await deployment.host.escalations.advance(tenantId, requestId, 'in_progress', {
    actor: expertRef,
  });

  // The permitted-actions log (the engine's operator surface; the closed
  // allowlist came from the request itself).
  const expertActions: { action: string; allowed: boolean }[] = [];
  for (const action of input.offered.permittedActions) {
    const recorded = await arena.escalations.recordExpertAction(requestId, tenantId, action);
    expertActions.push({ action: recorded.action, allowed: recorded.allowed });
  }

  // The typed ES1.0 result + validation (recorded verdict — the C009
  // seam rides the lifecycle's validationStatus field).
  const result = createEscalationResult({
    kind: 'unblock',
    producedAt: at(),
    summary: input.resultSummary,
    blockageRef: `${input.taskRef}/foundation-depth`,
    resolution: input.resultPayload,
  });
  await deployment.host.escalations.advance(tenantId, requestId, 'submitted', {
    result,
    actor: expertRef,
  });
  await deployment.host.escalations.advance(tenantId, requestId, 'validating', {
    actor: 'arena',
  });
  await deployment.host.escalations.advance(tenantId, requestId, 'result_accepted', {
    validationStatus: 'passed',
    actor: 'arena',
  });

  // Payment: release on completion (the deterministic fee split through
  // the DEMO provider) → PAID.
  const release = await arena.payments.releasePayout({
    requestId,
    tenantId,
    operationKey: operationKeys.release,
  });
  const costFields = release.costFields;
  await deployment.host.escalations.advance(tenantId, requestId, 'paid', {
    cost: {
      amountMinorUnits: costFields.amountMinorUnits,
      currency: costFields.currency,
      arenaFeeMinorUnits: costFields.arenaFeeMinorUnits,
      expertPayoutStatus: costFields.expertPayoutStatus,
    },
    actor: 'arena',
  });

  // Optional learning capture (consent-gated by the REQUEST's own
  // learningPermissions) → close.
  const learningCaptured = input.offered.learningPermissions.allowKnowledgeCapture;
  if (learningCaptured) {
    await deployment.host.escalations.advance(tenantId, requestId, 'learning_captured', {
      actor: 'arena',
    });
  }
  await deployment.host.escalations.advance(tenantId, requestId, 'closed', {
    actor: 'arena',
  });

  // Bounded-session replay — observational, visibly labelled (the C006
  // replay trace over the session's own event log).
  const replay = buildReplayTrace(
    input.sessionId,
    capsule.digest,
    session.events,
    at(),
  );

  return Object.freeze({
    sessionRef: capsule.sessionId,
    capsuleDigest: capsule.digest,
    session,
    modeAuthorization: { allowed: modeAuthorization.allowed, mode: modeAuthorization.mode },
    expertActions: Object.freeze([...expertActions]),
    result,
    costFields,
    learningCaptured,
    replay,
  });
}
