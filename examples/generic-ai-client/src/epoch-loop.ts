/**
 * The C019 EPOCH ESCALATION E2E LOOP (Work Order C019; FINAL-HANDOFF
 * §15: "Epoch and one independent generic client must both prove the
 * public contract").
 *
 * Epoch — the EPI1.0 reference integrator — drives the SAME §15 loop
 * over the SAME reference fabric, through the Epoch escalation adapter
 * (adapters/epoch-escalation):
 *
 *   Epoch capability-failure/uncertainty trigger (EPI1.0 async envelope)
 *   → [adapter] → the REAL ES1.0 EscalationRequest
 *   → POST /v1/escalations (the same public transport)
 *   → idempotent polling + SIGNED webhook consumption (the adapter's
 *     verify/dedupe/tenant-check discipline)
 *   → the Arena side drives session → intervention → validation →
 *     typed result → payment + fee → learning → close (arena-side.ts)
 *   → [adapter] → EpochEscalationDelivery (READ-ONLY typed projection)
 *   → Epoch applies the result through its OWN authority
 *   → write-back attempts against Epoch authoritative stores fail CLOSED.
 */

import { createHmac } from 'node:crypto';
import {
  EpochEscalationAdapter,
  attemptEpochAuthoritativeWrite,
  consumeEpochWebhook,
  deliveryForEpochJob,
  epochDeliveryFromRecord,
  parseEpochEscalationTrigger,
  parseEpochIntegrationPosture,
} from '@arena/epoch-escalation-adapter';
import type { EpochEscalationDelivery } from '@arena/epoch-escalation-adapter';
import type { EscalationRecord } from '@arena/escalation';
import { createReferenceArena } from './fabric.js';
import type { ReferenceArena } from './fabric.js';
import { driveEscalationToCompletion } from './arena-side.js';
import type { DriveCompletionReceipt } from './arena-side.js';

export const EPOCH_SCENARIO = Object.freeze({
  clientAppId: 'epoch-app',
  tenantId: 'tenant-alpha',
  webhookUrl: 'https://epoch.example.org/arena/webhooks',
  startedAtMs: Date.parse('2026-10-07T10:00:00.000Z'),
  epochJobId: 'epoch-job-2026-10-07-001',
  workflowRef: 'boq-accra-house-draft',
  runRef: 'run-2026-10-07-042',
  taskRef: 'quantity-takeoff-block-c',
  idempotencyKey: 'epoch-idem-0001',
  correlationId: 'epoch-corr-0001',
  causationId: 'epoch-cause-0009',
});

/** Epoch's declared integration posture (the authorization identity + policy). */
export const EPOCH_POSTURE = Object.freeze({
  postureVersion: 1,
  clientAppId: 'epoch-app',
  tenantId: 'tenant-alpha',
  locale: 'en',
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
});

/** The Epoch-side uncertainty trigger (EPI1.0 async envelope). */
export function epochTriggerWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggerVersion: 1,
    triggerType: 'uncertainty-boundary',
    epochJobId: EPOCH_SCENARIO.epochJobId,
    correlationId: EPOCH_SCENARIO.correlationId,
    causationId: EPOCH_SCENARIO.causationId,
    idempotencyKey: EPOCH_SCENARIO.idempotencyKey,
    authorization: { clientAppId: 'epoch-app', tenantId: 'tenant-alpha' },
    source: {
      workflowRef: EPOCH_SCENARIO.workflowRef,
      runRef: EPOCH_SCENARIO.runRef,
      taskRef: EPOCH_SCENARIO.taskRef,
    },
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    uncertaintyNotes:
      'Local construction convention for block C foundation depth is unverified; the BOQ quantity assumption is questionable.',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    deadlineAt: '2026-10-07T12:00:00.000Z',
    occurredAt: '2026-10-07T10:00:00.000Z',
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    requiredExpertCapabilities: ['boq-estimation.quantity-takeoff'],
    preferredLocales: ['en-GH'],
    desiredOutputSchema: {
      type: 'object',
      required: ['blockCQuantity'],
      properties: { blockCQuantity: { type: 'number' } },
    },
    artifactDigests: [
      {
        kind: 'trajectory',
        digest: '1111111111111111111111111111111111111111111111111111111111111111',
        ref: 'epoch-traj-042',
      },
      {
        kind: 'environment',
        digest: '2222222222222222222222222222222222222222222222222222222222222222',
        ref: 'epoch-env-block-c',
      },
    ],
    ...overrides,
  };
}

export interface EpochLoopReceipt {
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly triggerIdempotencyKey: string;
  readonly triggerCorrelationId: string;
  /** Webhook events the ADAPTER consumed (verified + deduped + tenant-checked). */
  readonly consumedEventTypes: readonly string[];
  /** Every consumed event id (at-least-once delivery deduped by id). */
  readonly consumedEventIds: readonly string[];
  readonly matchedExpertRef: string;
  readonly arenaSide: DriveCompletionReceipt;
  readonly terminalState: string;
  /** The READ-ONLY typed projection Epoch consumed. */
  readonly delivery: EpochEscalationDelivery;
  /** The final delivery fetched by polling (the ES1.0 response shape). */
  readonly polledDelivery: EpochEscalationDelivery;
  /** Epoch applied the result through its OWN authority. */
  readonly appliedByEpoch: { readonly applied: boolean; readonly authority: 'epoch-own-authority' };
  readonly writeBackDenied: boolean;
}

export async function runEpochEscalationLoop(): Promise<EpochLoopReceipt> {
  const arena: ReferenceArena = createReferenceArena({
    clientAppId: EPOCH_SCENARIO.clientAppId,
    tenantId: EPOCH_SCENARIO.tenantId,
    webhookUrl: EPOCH_SCENARIO.webhookUrl,
    startedAtMs: EPOCH_SCENARIO.startedAtMs,
  });

  // Epoch side: the adapter bound to the declared posture.
  const posture = parseEpochIntegrationPosture(EPOCH_POSTURE);
  const adapter = new EpochEscalationAdapter(posture);
  const trigger = parseEpochEscalationTrigger(epochTriggerWire());

  // Epoch → Arena: the REAL ES1.0 request, mapped by the adapter and
  // submitted over the SAME public REST transport.
  const request = await adapter.buildEscalationRequest(trigger);
  const submission = await arena.transport.postEscalation({
    ...request,
    // The transport feeds the CreateEscalationRequestInput shape; the
    // adapter's request is already the validated canonical object, so
    // spread its plain fields back into the input form. The request id
    // is fixed for the deterministic walkthrough (server-generated in
    // real deployments).
    requestId: 'esc_c019bbbb000000000000000000000000',
    now: request.createdAt,
    deadlineAt: request.deadline,
    budget: { ...request.budget },
  });

  // The durable request id + duplicate marker from the serialized
  // escalation-response envelope (the ES1.0 POST /v1/escalations wire out).
  const submissionPayload = (JSON.parse(submission.body) as {
    payload: { requestId: string; duplicate: boolean };
  }).payload;
  const requestId: string = submissionPayload.requestId;
  const duplicate: boolean = submissionPayload.duplicate;

  // Idempotent polling (the public GET path, tenant-scoped).
  const early = await arena.escalationService.getEscalationStatus({
    requestId,
    tenantId: EPOCH_SCENARIO.tenantId,
  });
  const earlyRecord: EscalationRecord = early.record;
  if (earlyRecord.state !== 'offered' || earlyRecord.expertRef === undefined) {
    throw new Error(`reference routing did not match an expert (state: ${earlyRecord.state})`);
  }

  // The adapter's SIGNED webhook consumption channel (dedupe set owned here).
  const seenEventIds = new Set<string>();
  const consumedEventTypes: string[] = [];
  const consumedEventIds: string[] = [];
  const sink = {
    receive(received: { headers: Readonly<Record<string, string>>; body: string }): void {
      const verdict = consumeEpochWebhook({
        received,
        signer: {
          signingKeyId: arena.webhookSigningKeyId,
          sign: (timestamp: number, payload: string) =>
            createHmac('sha256', arena.webhookSigningSecret)
              .update(`${timestamp}.${payload}`)
              .digest('hex'),
        },
        expectedTenantId: EPOCH_SCENARIO.tenantId,
        now: arena.clock.now(),
        seenEventIds,
      });
      if (verdict.outcome === 'consumed') {
        consumedEventTypes.push(verdict.event.eventType);
        consumedEventIds.push(verdict.event.eventId);
      }
    },
  };
  await arena.deliverPendingWebhooks(sink);

  // The Arena side drives the loop to completion (shared §15 driver).
  const arenaSide = await driveEscalationToCompletion({
    arena,
    requestId: requestId,
    tenantId: EPOCH_SCENARIO.tenantId,
    offered: {
      expertRef: earlyRecord.expertRef,
      escalationModes: earlyRecord.request.escalationModes,
      environmentSessionMode: earlyRecord.request.environmentSessionPolicy.sessionMode,
      permittedActions: earlyRecord.request.permittedActions,
      learningPermissions: earlyRecord.request.learningPermissions,
    },
    taskRef: EPOCH_SCENARIO.taskRef,
    worldState: {
      block: 'C',
      assumedFoundationDepthMm: 600,
      uncertainty: 'unverified local foundation convention',
      boqDraftRef: 'boq-accra-house-draft.json',
    },
    resultSummary: 'Block C foundation depth follows the 450mm local convention.',
    resultPayload: { blockCQuantity: 118.5, basis: 'local-convention-450mm' },
    sessionId: 'session-epoch-block-c',
  });

  // Final webhook drain — the adapter consumes the terminal events.
  await arena.deliverPendingWebhooks(sink);

  // The terminal record, polled through the public GET path.
  const terminal = await arena.escalationService.getEscalationStatus({
    requestId: requestId,
    tenantId: EPOCH_SCENARIO.tenantId,
  });

  // Arena → Epoch: the READ-ONLY delivery projection, bound to the
  // EPI1.0 job id.
  const delivery = adapter.deliveryFromRecord(
    terminal.record,
    EPOCH_SCENARIO.epochJobId,
  );

  // Epoch applies the result through its OWN authority (never Arena).
  let appliedPayload: unknown;
  const appliedByEpoch = {
    applied: delivery.result !== undefined,
    authority: 'epoch-own-authority' as const,
  };
  if (delivery.result !== undefined) {
    appliedPayload = delivery.result;
  }
  void appliedPayload;

  // A write-back attempt against an Epoch authoritative store fails CLOSED.
  let writeBackDenied = false;
  try {
    attemptEpochAuthoritativeWrite({
      attemptKind: 'epoch-authoritative-write-attempt',
      store: 'world-model',
      requestId: requestId,
    });
  } catch {
    writeBackDenied = true;
  }

  return Object.freeze({
    requestId: requestId,
    duplicate,
    triggerIdempotencyKey: trigger.idempotencyKey,
    triggerCorrelationId: trigger.correlationId,
    consumedEventTypes: Object.freeze([...consumedEventTypes]),
    consumedEventIds: Object.freeze([...consumedEventIds]),
    matchedExpertRef: earlyRecord.expertRef,
    arenaSide,
    terminalState: terminal.record.state,
    delivery,
    polledDelivery: deliveryForEpochJob(
      epochDeliveryFromRecord(terminal.record),
      EPOCH_SCENARIO.epochJobId,
    ),
    appliedByEpoch,
    writeBackDenied,
  });
}
