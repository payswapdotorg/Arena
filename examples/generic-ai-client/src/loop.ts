/**
 * The C019 DETERMINISTIC BOQ WALKTHROUGH (Work Order C019;
 * docs/LLM-ARCHITECT-FINAL-HANDOFF.md §15 + §16; the Accra-house BOQ
 * reference vertical of spec/escalation-reference-flow.md ERF1.0).
 *
 * One deterministic function walks the COMPLETE §15 loop, driven by a
 * provider-neutral GENERIC AI application client through Arena's
 * PUBLIC contracts only:
 *
 *   third-party AI application
 *   → Arena API (POST /v1/escalations — authorized by a C017 developer key)
 *   → capability demand (triage → matching → offered: qualified expert)
 *   → bounded expert session (privacy-sanitized environment capsule)
 *   → intervention (SOLVE/UNBLOCK work inside the replica)
 *   → validation (recorded verdict — the C009 seam)
 *   → structured result (the typed ES1.0 result taxonomy)
 *   → payment (C010 hold/offer/acceptance/capture/release)
 *   → Arena fee (the deterministic fee split)
 *   → optional learning artifacts (knowledge capture, consent-gated)
 *   → the application RESUMES its own authoritative workflow
 *   → bounded-session replay (observational, visibly labelled).
 *
 * The client follows the durable lifecycle by IDEMPOTENT POLLING and
 * through the SIGNED webhook channel (at-least-once + event-id dedupe).
 * Arena never writes the application's state: the client applies the
 * result through its OWN authority (ERF1.0 boundary law).
 *
 * No live model calls; every timestamp/seed/key is a fixed input.
 */

import { createHmac } from 'node:crypto';
import type { CreateEscalationRequestInput, EscalationResult } from '@arena/escalation';
import { buildReplayTrace } from '@arena/expert-session';
import type { ExpertSessionRecord, ReplayTrace } from '@arena/expert-session';
import type { PaymentCostFields } from '@arena/payments-service';
import { createGenericAiApplicationClient } from './client.js';
import type { AppliedResultRecord, GenericAiApplicationClient } from './client.js';
import { createReferenceArena } from './fabric.js';
import type { ReferenceArena } from './fabric.js';
import { driveEscalationToCompletion } from './arena-side.js';
import type { DriveCompletionReceipt } from './arena-side.js';

// ---------------------------------------------------------------------------
// The reference scenario (ERF1.0 / §16 — the Accra house BOQ)
// ---------------------------------------------------------------------------

export const SCENARIO = Object.freeze({
  clientAppId: 'generic-boq-app',
  tenantId: 'tenant-beta',
  webhookUrl: 'https://boq.example.org/arena/webhooks',
  startedAtMs: Date.parse('2026-10-07T10:00:00.000Z'),
  workflowRef: 'workflow-boq-accra-house',
  runRef: 'run-2026-10-07-007',
  taskRef: 'task-quantity-takeoff-block-c',
  capabilityNeed: 'boq-estimation.quantity-takeoff',
  idempotencyKey: 'generic-idem-0001',
  correlationId: 'generic-corr-0001',
  budgetMinorUnits: 25_000,
  currency: 'USD',
  requestId: 'esc_c019aaaa000000000000000000000000',
});

/** The BOQ uncertainty the generic agent hit (the §16 vertical). */
export const BOQ_UNCERTAINTY =
  'Block C foundation depth follows an unverified local convention; the BOQ quantity assumption is questionable.';

/** The generic client's escalation demand (the §14 POST /v1/escalations body). */
export function boqEscalationInput(): CreateEscalationRequestInput {
  return {
    clientAppId: SCENARIO.clientAppId,
    tenantId: SCENARIO.tenantId,
    sourceWorkflowRef: SCENARIO.workflowRef,
    sourceRunRef: SCENARIO.runRef,
    taskRef: SCENARIO.taskRef,
    capabilityNeed: SCENARIO.capabilityNeed,
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    now: new Date(SCENARIO.startedAtMs).toISOString(),
    deadlineInMs: 2 * 3_600_000,
    budget: { amountMinorUnits: SCENARIO.budgetMinorUnits, currency: SCENARIO.currency },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: {
      type: 'object',
      required: ['blockCQuantity', 'basis'],
      properties: {
        blockCQuantity: { type: 'number' },
        basis: { type: 'string' },
      },
    },
    contextReferences: [
      { kind: 'task-ref', ref: SCENARIO.taskRef },
      { kind: 'artifact-ref', ref: 'boq-draft-v3.json' },
    ],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'annotate-evidence', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: SCENARIO.idempotencyKey,
    correlationId: SCENARIO.correlationId,
    // Fixed request id (deterministic walkthrough; generated server-side
    // in real deployments).
    requestId: SCENARIO.requestId,
  };
}

// ---------------------------------------------------------------------------
// The receipt (typed artifact at every stage of the §15 loop)
// ---------------------------------------------------------------------------

export interface BoqWalkthroughReceipt {
  readonly authorization: { readonly outcome: 'authorized'; readonly keyId: string };
  readonly requestId: string;
  readonly duplicate: boolean;
  /** States the CLIENT observed by idempotent polling. */
  readonly polledStates: readonly string[];
  /** Webhook events the client accepted (signature-verified + deduped). */
  readonly acceptedEventTypes: readonly string[];
  readonly matchedExpertRef: string;
  readonly client: GenericAiApplicationClient;
  readonly arena: ReferenceArena;
  readonly arenaSide: DriveCompletionReceipt;
  readonly result: EscalationResult;
  readonly session: ExpertSessionRecord;
  readonly validationStatus: string;
  readonly costFields: PaymentCostFields;
  readonly terminalState: string;
  readonly applied: AppliedResultRecord;
  readonly workflowResumed: boolean;
  readonly replay: ReplayTrace;
}

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

export async function runBoqEscalationLoop(
  arenaConfig: Partial<Parameters<typeof createReferenceArena>[0]> = {},
): Promise<BoqWalkthroughReceipt> {
  const arena: ReferenceArena = createReferenceArena({
    clientAppId: SCENARIO.clientAppId,
    tenantId: SCENARIO.tenantId,
    webhookUrl: SCENARIO.webhookUrl,
    startedAtMs: SCENARIO.startedAtMs,
    ...arenaConfig,
  });

  // (1) Register/authorize: the C017 developer key must authorize the
  // client BEFORE it may write escalations.
  const authorization = arena.authorizeKey(arena.developerKeySecret);
  if (authorization.outcome !== 'authorized') {
    throw new Error(`developer key authorization failed: ${JSON.stringify(authorization)}`);
  }

  // The GENERIC client: REST transport + the webhook verification key
  // (the endpoint signing secret, delivered exactly once at registration).
  const client: GenericAiApplicationClient = createGenericAiApplicationClient({
    clientAppId: SCENARIO.clientAppId,
    tenantId: SCENARIO.tenantId,
    transport: arena.transport,
    webhookSigner: {
      signingKeyId: arena.webhookSigningKeyId,
      sign: (timestamp: number, payload: string) =>
        createHmac('sha256', arena.webhookSigningSecret)
          .update(`${timestamp}.${payload}`)
          .digest('hex'),
    },
    now: () => arena.clock.now(),
  });

  // (2) The agent hits the BOQ uncertainty boundary → POST /v1/escalations.
  const submission = await client.submitEscalation(boqEscalationInput());

  // (3) The client follows the durable lifecycle by IDEMPOTENT POLLING…
  const early = await client.pollStatus(submission.requestId);
  if (early.state !== 'offered' || early.expertRef === undefined) {
    throw new Error(`reference routing did not match an expert (state: ${early.state})`);
  }
  const matchedExpertRef = early.expertRef;

  // …and through the SIGNED webhook channel (first drain: the created →
  // triaged → matching → offered events). The sink IS the client's
  // webhook receiver (verify + dedupe on every delivery).
  const sink = {
    receive: (received: { headers: Readonly<Record<string, string>>; body: string }) => {
      const verdict = client.receiveWebhook(received);
      if (verdict.outcome === 'rejected' && verdict.reason === 'signature-mismatch') {
        throw new Error(`webhook signature rejected on first drain: ${verdict.reason}`);
      }
    },
  };
  await arena.deliverPendingWebhooks(sink);

  // (4)-(11) The Arena side: session → intervention → validation →
  // typed result → payment + fee → learning → close (arena-side.ts).
  const arenaSide = await driveEscalationToCompletion({
    arena,
    requestId: submission.requestId,
    tenantId: SCENARIO.tenantId,
    offered: {
      expertRef: matchedExpertRef,
      escalationModes: early.request.escalationModes,
      environmentSessionMode: early.request.environmentSessionPolicy.sessionMode,
      permittedActions: early.request.permittedActions,
      learningPermissions: early.request.learningPermissions,
    },
    taskRef: SCENARIO.taskRef,
    worldState: {
      block: 'C',
      assumedFoundationDepthMm: 600,
      uncertainty: BOQ_UNCERTAINTY,
      boqDraftRef: 'boq-draft-v3.json',
    },
    resultSummary:
      'Block C foundation depth follows the 450mm local convention; recompute the takeoff.',
    resultPayload: { blockCQuantity: 118.5, basis: 'local-convention-450mm' },
    sessionId: 'session-boq-block-c',
  });

  // (12) Second webhook drain: the full signed lifecycle event stream.
  await arena.deliverPendingWebhooks(sink);

  // (13) The client polls to the TERMINAL record and receives the
  // typed result + evidence refs + validation status + cost fields.
  const terminal = await client.awaitTerminalState(submission.requestId);

  // (14) The client applies the result through its OWN authority and
  // RESUMES its authoritative workflow (the ERF1.0 boundary law).
  let appliedResult: unknown;
  const applied = client.applyResult(terminal, (resultPayload) => {
    appliedResult = resultPayload;
  });
  const workflowResumed = applied.appliedBy === 'client-own-authority' && appliedResult !== undefined;

  // (15) Bounded-session replay — observational, visibly labelled.
  const replay = buildReplayTrace(
    arenaSide.sessionRef,
    arenaSide.capsuleDigest,
    arenaSide.session.events,
    arena.clock.now(),
  );

  return Object.freeze({
    authorization: { outcome: 'authorized' as const, keyId: arena.developerKeyRecord.keyId },
    requestId: submission.requestId,
    duplicate: submission.duplicate,
    polledStates: Object.freeze([early.state, terminal.state]),
    acceptedEventTypes: Object.freeze(client.observedEvents().map((event) => event.eventType)),
    matchedExpertRef,
    client,
    arena,
    arenaSide,
    result: arenaSide.result,
    session: arenaSide.session,
    validationStatus: terminal.validationStatus ?? 'pending',
    costFields: arenaSide.costFields,
    terminalState: terminal.state,
    applied,
    workflowResumed,
    replay,
  });
}
