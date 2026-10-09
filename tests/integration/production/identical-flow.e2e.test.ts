/**
 * tests/integration/production/identical-flow.e2e.test.ts — the IDENTICAL
 * PUBLIC-FLOW acceptance proof (Work Order P006; issue #158): BOTH P006
 * clients — the generic AI application client AND the Epoch adapter
 * client (adapters/epoch-escalation driven over its public surface) —
 * pass the SAME full §15 core flow over the PUBLIC transport, driven by
 * ONE neutral driver (support/public-flow.ts), on ONE integrated
 * deployment, with machine-checked receipt equality on every public-flow
 * observation (client identity fields excepted).
 *
 * The Epoch client constructs its request through the ADAPTER (wire
 * trigger + declared posture → mapTriggerToCreateInput — no Epoch-specific
 * Arena API; ADR-P001-08) and consumes its deliveries through the
 * adapter's consumeEpochWebhook; the generic client constructs its
 * request directly. Everything AFTER submission is the IDENTICAL public
 * flow: same routes, same signed webhook scheme, same terminal record
 * shape, same payment sandbox posture, same learning gate.
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY
 * (release-gate §3); truth lens `customer` (ADR-P001-02); the payment
 * step runs the DEMO provider (executesCustomerMoney=false — CI moves NO
 * real money).
 */

import { describe, expect, it } from 'vitest';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { bootIntegratedDeployment, webhookDelivery, T0 } from './support/harness.js';
import { ClientWebhookReceiver, createGenericAiClient } from './support/generic-client.js';
import { EpochAdapterClient } from './support/epoch-client.js';
import {
  assertIdenticalPublicFlowReceipts,
  driveFullPublicFlow,
  epochClientAsFlowClient,
  genericClientAsFlowClient,
} from './support/public-flow.js';
import type { PublicFlowReceipt } from './support/public-flow.js';
import {
  transcriptHeader,
  writeTranscript,
  evidenceClassForEngine,
  observationLine,
} from './support/evidence.js';

const EVIDENCE_DIR =
  process.env.ARENA_P006_EVIDENCE_OUT ??
  new URL('../../../docs/evidence/production/integration/', import.meta.url).pathname;

const GENERIC_TENANT = 'tenant-beta';
const EPOCH_TENANT = 'tenant-epoch';
const EPOCH_APP = 'epoch-app';
const EPOCH_JOB_ID = 'epoch-job-block-c-0001';

/** The generic client's escalation demand (the §16 BOQ vertical). */
function genericRequestInput(): CreateEscalationRequestInput {
  return {
    clientAppId: 'generic-boq-app',
    tenantId: GENERIC_TENANT,
    sourceWorkflowRef: 'workflow-boq-accra-house',
    sourceRunRef: 'run-2026-10-09-007',
    taskRef: 'task-quantity-takeoff-block-c',
    capabilityNeed: 'construction.quantity-surveying.boq-verification',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    now: new Date(T0).toISOString(),
    deadlineInMs: 86_400_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['construction.quantity-surveying'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: {
      type: 'object',
      required: ['blockCQuantity', 'basis'],
      properties: { blockCQuantity: { type: 'number' }, basis: { type: 'string' } },
    },
    contextReferences: [
      { kind: 'task-ref', ref: 'task-quantity-takeoff-block-c' },
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
    idempotencyKey: 'identical-generic-0001',
    correlationId: 'identical-generic-corr-0001',
  } as CreateEscalationRequestInput;
}

/** Epoch's declared integration posture ON THE WIRE (closed shape). */
function epochPostureWire(): Record<string, unknown> {
  return {
    postureVersion: 1,
    clientAppId: EPOCH_APP,
    tenantId: EPOCH_TENANT,
    locale: 'en',
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
  };
}

/** Epoch's escalation trigger ON THE WIRE (the EPI1.0 asynchronous contract). */
function epochTriggerWire(): Record<string, unknown> {
  return {
    triggerVersion: 1,
    triggerType: 'uncertainty-boundary',
    epochJobId: EPOCH_JOB_ID,
    correlationId: 'epoch-corr-0001',
    causationId: 'epoch-cause-0001',
    idempotencyKey: 'identical-epoch-0001',
    authorization: { clientAppId: EPOCH_APP, tenantId: EPOCH_TENANT },
    source: {
      workflowRef: 'workflow-epoch-boq-accra',
      runRef: 'run-epoch-2026-10-09-001',
      taskRef: 'task-quantity-takeoff-block-c',
    },
    capabilityNeed: 'construction.quantity-surveying.boq-verification',
    uncertaintyNotes:
      'Block C quantity takeoff assumed a 600mm foundation depth; the local convention is unverified.',
    escalationModes: ['solve', 'unblock'],
    urgency: 'priority',
    deadlineAt: new Date(T0 + 86_400_000).toISOString(),
    occurredAt: new Date(T0).toISOString(),
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    requiredExpertCapabilities: ['construction.quantity-surveying'],
    preferredLocales: ['en-GH'],
    desiredOutputSchema: {
      type: 'object',
      required: ['blockCQuantity', 'basis'],
      properties: { blockCQuantity: { type: 'number' }, basis: { type: 'string' } },
    },
    artifactDigests: [
      {
        kind: 'trajectory',
        digest: 'b7e83a4c1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
        ref: 'epoch-trajectory-block-c',
      },
    ],
  };
}

describe('P006 M2 — both clients pass the IDENTICAL public flow over one integrated deployment', () => {
  it('generic client and Epoch adapter: one driver, one deployment, machine-checked receipt equality on every public-flow observation', async () => {
    const deployment = await bootIntegratedDeployment();
    const transcript: string[] = [
      ...transcriptHeader('identical-public-flow', {
        engineClass: deployment.engineClass,
        transport: 'public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) from the REAL webhook-delivery service draining the REAL durable outbox',
        baseUrl: deployment.baseUrl,
        lens: 'customer',
        paymentPosture: 'DEMO provider (executesCustomerMoney=false) — CI moves NO real money',
      }),
      '## Client A — the generic AI application client',
      '',
    ];
    try {
      // --- Client A: the generic AI application client ----------------
      const genericIssuance = deployment.keys.issue({
        tenantId: GENERIC_TENANT,
        clientAppId: 'generic-boq-app',
      });
      const genericReceiver = new ClientWebhookReceiver();
      const genericEndpoint = await genericReceiver.start();
      const genericClient = createGenericAiClient({
        clientAppId: 'generic-boq-app',
        tenantId: GENERIC_TENANT,
        baseUrl: deployment.baseUrl,
        apiKeySecret: genericIssuance.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) => deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
      });
      const genericDelivery = webhookDelivery(deployment, genericEndpoint.url);
      const genericReceipt: PublicFlowReceipt = await driveFullPublicFlow({
        deployment,
        client: genericClientAsFlowClient(genericClient),
        delivery: genericDelivery,
        receiverDeliveries: () => genericReceiver.deliveries,
        scenario: {
          requestInput: genericRequestInput(),
          taskRef: 'task-quantity-takeoff-block-c',
          worldState: {
            block: 'C',
            assumedFoundationDepthMm: 600,
            uncertainty: 'unverified local foundation convention',
            boqDraftRef: 'boq-accra-house-draft.json',
          },
          resultSummary:
            'Block C foundation depth follows the 450mm local convention; recompute the takeoff.',
          resultPayload: { blockCQuantity: 118.5, basis: 'local-convention-450mm' },
          sessionId: 'session-identical-generic-block-c',
          consentStatement:
            'Knowledge patch may be retained as a scoped, attributed domain rule.',
        },
        transcript,
      });
      transcript.push(
        observationLine({
          step: 'client-a-receipt',
          observed: `terminal ${genericReceipt.terminalState}; result ${genericReceipt.resultKind}; validation ${genericReceipt.validationStatus}; cost ${String(genericReceipt.costAmountMinorUnits)} minor units (${genericReceipt.costHasFee ? 'arena fee present' : 'no fee'}); ${String(genericReceipt.allEventTypes.length)} distinct signed event types observed`,
        }),
      );

      // --- Client B: the EPOCH ADAPTER client -------------------------
      transcript.push('', '## Client B — the Epoch adapter client (adapters/epoch-escalation over the public transport)', '');
      const epochIssuance = deployment.keys.issue({
        tenantId: EPOCH_TENANT,
        clientAppId: EPOCH_APP,
      });
      const epochReceiver = new ClientWebhookReceiver();
      const epochEndpoint = await epochReceiver.start();
      const epochClient = new EpochAdapterClient({
        postureWire: epochPostureWire(),
        baseUrl: deployment.baseUrl,
        apiKeySecret: epochIssuance.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) => deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
        epochJobId: EPOCH_JOB_ID,
      });
      const epochDelivery = webhookDelivery(deployment, epochEndpoint.url);
      // The Epoch request is CONSTRUCTED through the adapter: wire trigger
      // + declared posture → mapTriggerToCreateInput (no Epoch-specific
      // Arena API — the public transport carries the ES1.0 shape).
      const epochRequestInput = await epochClient.createRequestInputFromTrigger(epochTriggerWire());
      const epochReceipt: PublicFlowReceipt = await driveFullPublicFlow({
        deployment,
        client: epochClientAsFlowClient(epochClient),
        delivery: epochDelivery,
        receiverDeliveries: () => epochReceiver.deliveries,
        scenario: {
          requestInput: epochRequestInput,
          taskRef: 'task-quantity-takeoff-block-c',
          worldState: {
            block: 'C',
            assumedFoundationDepthMm: 600,
            uncertainty: 'unverified local foundation convention',
            boqDraftRef: 'boq-accra-house-draft.json',
          },
          resultSummary:
            'Block C foundation depth follows the 450mm local convention; recompute the takeoff.',
          resultPayload: { blockCQuantity: 118.5, basis: 'local-convention-450mm' },
          sessionId: 'session-identical-epoch-block-c',
          consentStatement:
            'Knowledge patch may be retained as a scoped, attributed domain rule.',
        },
        transcript,
      });
      transcript.push(
        observationLine({
          step: 'client-b-receipt',
          observed: `terminal ${epochReceipt.terminalState}; result ${epochReceipt.resultKind}; validation ${epochReceipt.validationStatus}; cost ${String(epochReceipt.costAmountMinorUnits)}; ${String(epochReceipt.allEventTypes.length)} distinct event types; delivery projection frozen (read-only); applied by Epoch's OWN authority`,
        }),
      );

      // --- THE IDENTICAL ACCEPTANCE -----------------------------------
      // Every public-flow observation is EQUAL (identity fields —
      // clientKind, tenantId, requestId — excepted).
      assertIdenticalPublicFlowReceipts(genericReceipt, epochReceipt);
      // Sanity assertions on the SHARED public observations (both clients
      // passed them identically; asserting once more keeps the receipt
      // honest — the driver already threw on any violation).
      expect(genericReceipt.submissionStatus).toBe(201);
      expect(genericReceipt.terminalState).toBe('closed');
      expect(genericReceipt.resultKind).toBe('unblock');
      expect(genericReceipt.validationStatus).toBe('passed');
      expect(genericReceipt.costAmountMinorUnits).toBe(25_000);
      expect(genericReceipt.payoutStatus).toBe('paid');
      expect(genericReceipt.duplicateRejection).toBe('duplicate-event');
      expect(genericReceipt.learningBlockedReason).toContain('rights-insufficient');
      expect(genericReceipt.learningGateVerdict).toBe('adopted-with-evidence');
      expect(genericReceipt.q10AllConditionsMet).toBe(true);
      expect(genericReceipt.paymentExecutesCustomerMoney).toBe(false);
      expect(genericReceipt.writebackDenied).toBe(true);
      transcript.push(
        observationLine({
          step: 'identical-public-flow',
          observed: `receipt equality on every public-flow field (client identity excepted) — generic [lens:${'customer'}] vs epoch [lens:${'customer'}]; both observed ${genericReceipt.allEventTypes.length} distinct signed event types, terminal ${genericReceipt.terminalState}, validation ${genericReceipt.validationStatus}, Q1.0 ${genericReceipt.learningGateVerdict}`,
        }),
      );

      transcript.push(
        `- evidence-class: ${evidenceClassForEngine(deployment.engineClass)} (engine ${deployment.engineClass})`,
      );
      const file = await writeTranscript(EVIDENCE_DIR, 'identical-public-flow', transcript);
      expect(file).toContain('identical-public-flow-transcript.md');
    } finally {
      await deployment.close();
    }
  });
});
