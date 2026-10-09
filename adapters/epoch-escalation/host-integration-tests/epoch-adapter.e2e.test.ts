/**
 * adapters/epoch-escalation/host-integration-tests/epoch-adapter.e2e.test.ts
 * — M2(b) of the P006 integrated acceptance (Work Order P006; issue
 * #158): the EPOCH ADAPTER drives the SAME full core flow as the generic
 * client — over the PUBLIC transport, against the SAME integrated
 * deployment composition (the tests/integration/production battery's
 * harness, imported not replicated).
 *
 * ADR-P001-08 (the rule this surface exists for): Epoch consumes through
 * adapters/epoch-escalation over the PUBLIC transport — there is NO
 * Epoch-specific Arena API, and none is used here. The Epoch client:
 *
 *   - declares its posture + raises its trigger on the WIRE (closed
 *     shapes, fail-closed) and maps them through the ADAPTER onto the
 *     ES1.0 create input;
 *   - files, polls and MCP-queries over the SAME public routes the
 *     generic client uses (POST /v1/escalations, GET
 *     /v1/escalations/{id}, POST /mcp) with a scoped developer key;
 *   - consumes signed webhook deliveries through the adapter's
 *     consumeEpochWebhook (verify + tenant guard + per-event-id dedupe)
 *     and projects them into the READ-ONLY EpochEscalationDelivery;
 *   - applies the terminal result through Epoch's OWN authority over the
 *     adapter's delivery projection.
 *
 * The IDENTICAL public-flow acceptance rides the shared driver
 * (tests/integration/production/support/public-flow.ts —
 * driveFullPublicFlow): the same §15 loop, the same public assertions,
 * the same receipt. The generic client's twin run lives in
 * tests/integration/production/identical-flow.e2e.test.ts; the two
 * receipts are asserted EQUAL there. Here the adapter ALSO proves its
 * own fail-closed walls (unknown fields, authorization mismatch, forged
 * signatures, foreign tenants, the write-back denial).
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY per
 * spec/post-roadmap-release-gate.md §3 (the live-Neon optional path is
 * env-gated in the battery's composition suite). Truth lens `customer`
 * (ADR-P001-02). The payment step runs the DEMO provider
 * (executesCustomerMoney=false — CI moves NO real money).
 */

import { describe, expect, it } from 'vitest';
import {
  attemptEpochAuthoritativeWrite,
  checkEpochDeliveryAction,
  EPOCH_AUTHORITATIVE_STORES,
  EPOCH_ESCALATION_ERROR_CODES,
  EpochEscalationError,
  consumeEpochWebhook,
  parseEpochEscalationTrigger,
} from '@arena/epoch-escalation-adapter';
import type { EpochDeliveryActionVerdict } from '@arena/epoch-escalation-adapter';
import { bootIntegratedDeployment, webhookDelivery, T0 } from '../../../tests/integration/production/support/harness.js';
import { ClientWebhookReceiver } from '../../../tests/integration/production/support/generic-client.js';
import { EpochAdapterClient } from '../../../tests/integration/production/support/epoch-client.js';
import {
  driveFullPublicFlow,
  epochClientAsFlowClient,
} from '../../../tests/integration/production/support/public-flow.js';
import type { PublicFlowReceipt } from '../../../tests/integration/production/support/public-flow.js';
import {
  transcriptHeader,
  writeTranscript,
  evidenceClassForEngine,
  observationLine,
} from '../../../tests/integration/production/support/evidence.js';

const EVIDENCE_DIR =
  process.env.ARENA_P006_EVIDENCE_OUT ??
  new URL('../../../docs/evidence/production/integration/', import.meta.url).pathname;

const EPOCH_TENANT = 'tenant-epoch';
const EPOCH_APP = 'epoch-app';
const EPOCH_JOB_ID = 'epoch-job-host-int-0001';

/** Epoch's declared integration posture ON THE WIRE (closed shape). */
function epochPostureWire(): Record<string, unknown> {
  return {
    postureVersion: 1,
    clientAppId: EPOCH_APP,
    tenantId: EPOCH_TENANT,
    locale: 'en',
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: [
      'read-context',
      'run-approved-tools',
      'propose-patch',
      'annotate-evidence',
      'signal-tool-gap',
    ],
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
function epochTriggerWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggerVersion: 1,
    triggerType: 'uncertainty-boundary',
    epochJobId: EPOCH_JOB_ID,
    correlationId: 'epoch-corr-host-int-0001',
    causationId: 'epoch-cause-host-int-0001',
    idempotencyKey: 'epoch-host-int-idem-0001',
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
        digest: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
        ref: 'epoch-trajectory-block-c',
      },
    ],
    ...overrides,
  };
}

describe('P006 M2(b) — the Epoch adapter drives the full core flow over public transport (host-integration surface)', () => {
  it('§15 loop through adapters/epoch-escalation over the public transport: trigger → offer → session → intervention → validation → typed result → webhooks+polling+MCP → payment sandbox → learning gate+Q1.0 → observational replay; write-back DENIED', async () => {
    const deployment = await bootIntegratedDeployment();
    const transcript: string[] = [
      ...transcriptHeader('epoch-adapter-full-flow', {
        engineClass: deployment.engineClass,
        transport: 'public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) consumed through the adapter\u2019s consumeEpochWebhook — the REAL webhook-delivery service draining the REAL durable outbox',
        baseUrl: deployment.baseUrl,
        lens: 'customer',
        paymentPosture: 'DEMO provider (executesCustomerMoney=false) — CI moves NO real money',
      }),
    ];
    try {
      const issuance = deployment.keys.issue({
        tenantId: EPOCH_TENANT,
        clientAppId: EPOCH_APP,
      });
      const receiver = new ClientWebhookReceiver();
      const endpoint = await receiver.start();
      const client = new EpochAdapterClient({
        postureWire: epochPostureWire(),
        baseUrl: deployment.baseUrl,
        apiKeySecret: issuance.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) => deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
        epochJobId: EPOCH_JOB_ID,
      });
      const delivery = webhookDelivery(deployment, endpoint.url);

      // The Epoch request is CONSTRUCTED through the adapter (wire trigger
      // → the REAL ES1.0 construction → the public create input).
      const requestInput = await client.createRequestInputFromTrigger(epochTriggerWire());
      transcript.push(
        observationLine({
          step: 'epoch-trigger-mapping',
          observed: `wire trigger parsed closed-shape; adapter mapped it onto the ES1.0 create input (capabilityNeed=${requestInput.capabilityNeed}; ${String(requestInput.contextReferences?.length ?? 0)} context refs incl. the EPI1.0 trajectory digest)`,
        }),
      );

      // The IDENTICAL public flow (the shared §15 driver — the same loop
      // the generic client passes in identical-flow.e2e.test.ts).
      const receipt: PublicFlowReceipt = await driveFullPublicFlow({
        deployment,
        client: epochClientAsFlowClient(client),
        delivery,
        receiverDeliveries: () => receiver.deliveries,
        scenario: {
          requestInput,
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
          sessionId: 'session-epoch-host-int-block-c',
          consentStatement:
            'Knowledge patch may be retained as a scoped, attributed domain rule.',
        },
        transcript,
      });

      // --- the shared public-flow receipt (identical acceptance) ------
      expect(receipt.clientKind).toBe('epoch-adapter');
      expect(receipt.submissionStatus).toBe(201);
      expect(receipt.terminalState).toBe('closed');
      expect(receipt.resultKind).toBe('unblock');
      expect(receipt.resultSummaryMarker).toBe('450mm');
      expect(receipt.validationStatus).toBe('passed');
      expect(receipt.costAmountMinorUnits).toBe(25_000);
      expect(receipt.costHasFee).toBe(true);
      expect(receipt.payoutStatus).toBe('paid');
      expect(receipt.duplicateRejection).toBe('duplicate-event');
      expect(receipt.mcpTools).toEqual(['create-escalation', 'get-escalation-status']);
      expect(receipt.mcpState).toBe('closed');
      expect(receipt.learningBlockedReason).toContain('rights-insufficient');
      expect(receipt.learningGateVerdict).toBe('adopted-with-evidence');
      expect(receipt.q10AllConditionsMet).toBe(true);
      expect(receipt.paymentExecutesCustomerMoney).toBe(false);
      expect(receipt.paymentTruth).toBe('demo');
      expect(receipt.writebackDenied).toBe(true);
      transcript.push(
        observationLine({
          step: 'identical-public-flow-receipt',
          observed: `the SAME §15 receipt the generic client produces (machine-checked in identical-flow.e2e.test.ts): terminal ${receipt.terminalState}, result ${receipt.resultKind}, validation ${receipt.validationStatus}, cost ${String(receipt.costAmountMinorUnits)}, ${String(receipt.allEventTypes.length)} distinct event types, Q1.0 ${receipt.learningGateVerdict}`,
        }),
      );

      // --- the Epoch-side delivery projections -----------------------
      // Every consumed event projected into the READ-ONLY delivery shape
      // with the EPI1.0 job id back-linked.
      const deliveries = client.observedDeliveries();
      expect(deliveries.length).toBeGreaterThan(0);
      for (const one of deliveries) {
        expect(one.deliveryVersion).toBe(1);
        expect(one.epochJobId).toBe(EPOCH_JOB_ID);
        expect(one.tenantId).toBe(EPOCH_TENANT);
        expect(Object.isFrozen(one)).toBe(true);
      }
      transcript.push(
        observationLine({
          step: 'delivery-projections',
          observed: `${String(deliveries.length)} read-only EpochEscalationDelivery projections from consumed events (deep-frozen; epochJobId back-linked on every one)`,
        }),
      );

      // The TERMINAL delivery: the adapter's projection of the final
      // record carries the typed result, validation status and cost.
      const terminal = await client.pollStatus(receipt.requestId);
      const terminalDelivery = client.deliveryFor(terminal);
      expect(terminalDelivery.state).toBe('closed');
      expect(terminalDelivery.resultKind).toBe('unblock');
      expect(terminalDelivery.result?.kind).toBe('unblock');
      expect(terminalDelivery.validationStatus).toBe('passed');
      expect(terminalDelivery.cost?.amountMinorUnits).toBe(25_000);
      expect(terminalDelivery.cost?.expertPayoutStatus).toBe('paid');
      expect(terminalDelivery.epochJobId).toBe(EPOCH_JOB_ID);
      // The delivery's evidence refs: the request ref (with digest) and
      // the unblock blockage ref.
      const refKinds = terminalDelivery.refs.map((ref) => ref.kind).sort();
      expect(refKinds).toContain('escalation-request-ref');
      expect(refKinds).toContain('evidence-ref');
      // Learning-artifact refs are surfaced ONLY when the request
      // authorized artifact reuse — this posture did NOT (the rights gate
      // at the delivery surface).
      expect(terminalDelivery.learningArtifactRefs).toEqual([]);
      transcript.push(
        observationLine({
          step: 'terminal-delivery',
          observed: `state=${terminalDelivery.state}; resultKind=${String(terminalDelivery.resultKind)}; validation=${String(terminalDelivery.validationStatus)}; cost=${String(terminalDelivery.cost?.amountMinorUnits)} (payout ${String(terminalDelivery.cost?.expertPayoutStatus)}); refs=[${refKinds.join(', ')}]; learningArtifactRefs=none (posture allowArtifactReuse=false — rights-gated)`,
        }),
      );

      // --- Epoch applies the result through its OWN authority --------
      // (The §15 driver already performed ONE own-authority application
      // over the delivery; this surface re-applies to prove the delivery
      // is deep-frozen read-only — both applications are Epoch's own
      // recorded acts on the same request.)
      const applied = client.applyTerminalResult(terminal);
      expect(applied.appliedBy).toBe('client-own-authority');
      expect(applied.frozen).toBe(true);
      expect(client.appliedResults().length).toBe(2);
      expect(
        client.appliedResults().every((record) => record.requestId === receipt.requestId),
      ).toBe(true);
      expect(
        client.appliedResults().every((record) => record.appliedBy === 'client-own-authority'),
      ).toBe(true);
      transcript.push(
        observationLine({
          step: 'own-authority-application',
          observed: `appliedBy=${applied.appliedBy} over the frozen delivery; application recorded on the Epoch side (Arena never writes Epoch state)`,
        }),
      );

      // --- the authority boundary (structural, fail-closed) ----------
      const observe = checkEpochDeliveryAction('observe-delivery') as EpochDeliveryActionVerdict;
      expect(observe.outcome).toBe('permitted');
      const mutate = checkEpochDeliveryAction('mutate-world-model') as EpochDeliveryActionVerdict;
      expect(mutate.outcome).toBe('forbidden');
      let writebackDenied = false;
      let writebackCode = '';
      try {
        attemptEpochAuthoritativeWrite({
          attemptKind: 'epoch-authoritative-write-attempt',
          store: 'world-model',
          requestId: receipt.requestId,
        });
      } catch (error) {
        writebackDenied = true;
        writebackCode =
          error instanceof EpochEscalationError ? error.code : 'unexpected-error-shape';
      }
      expect(writebackDenied).toBe(true);
      expect(writebackCode).toBe(EPOCH_ESCALATION_ERROR_CODES.WRITEBACK_FORBIDDEN);
      for (const store of EPOCH_AUTHORITATIVE_STORES) {
        let denied = false;
        try {
          attemptEpochAuthoritativeWrite({
            attemptKind: 'epoch-authoritative-write-attempt',
            store,
          });
        } catch {
          denied = true;
        }
        expect(denied).toBe(true);
      }
      transcript.push(
        observationLine({
          step: 'authority-boundary',
          observed: `observe-delivery permitted; every other delivery action forbidden; attemptEpochAuthoritativeWrite DENIED for ALL ${String(EPOCH_AUTHORITATIVE_STORES.length)} authoritative stores (${EPOCH_ESCALATION_ERROR_CODES.WRITEBACK_FORBIDDEN} — EPI1.0 Authority, lock rules 13-15/36)`,
        }),
      );

      // --- webhook consumption adversarial (the consumer's walls) ----
      const captured = receiver.deliveries;
      const first = captured[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        const headerOf = (name: string): string => {
          const direct = first.headers[name];
          if (typeof direct === 'string') return direct;
          if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0];
          return '';
        };
        const timestamp = Number(headerOf('x-arena-webhook-timestamp'));

        // (a) FORGED signature: a tampered digest is rejected typed.
        const forged = consumeEpochWebhook({
          received: {
            headers: {
              'x-arena-event-id': headerOf('x-arena-event-id'),
              'x-arena-webhook-timestamp': headerOf('x-arena-webhook-timestamp'),
              'x-arena-signature': 'v1=' + '0'.repeat(64),
            },
            body: first.body,
          },
          signer: {
            signingKeyId: deployment.signer.signingKeyId,
            sign: (t, payload) => deployment.signer.sign(t, payload),
          },
          expectedTenantId: EPOCH_TENANT,
          now: deployment.clock.now(),
          seenEventIds: new Set<string>(),
        });
        expect(forged.outcome).toBe('rejected');
        if (forged.outcome === 'rejected') {
          expect(forged.reason).toBe('signature-mismatch');
        }

        // (b) A CORRECTLY-SIGNED event for a FOREIGN tenant is rejected
        // by the consumer's tenant guard (posture-tenant binding).
        const body = JSON.parse(first.body) as { payload: { tenantId: string } };
        body.payload.tenantId = 'tenant-foreign';
        const foreignBody = JSON.stringify(body);
        const foreign = consumeEpochWebhook({
          received: {
            headers: {
              'x-arena-event-id': 'evt-foreign-tenant-0001',
              'x-arena-webhook-timestamp': String(timestamp),
              'x-arena-signature': `v1=${deployment.signer.sign(timestamp, foreignBody)}`,
            },
            body: foreignBody,
          },
          signer: {
            signingKeyId: deployment.signer.signingKeyId,
            sign: (t, payload) => deployment.signer.sign(t, payload),
          },
          expectedTenantId: EPOCH_TENANT,
          now: deployment.clock.now(),
          seenEventIds: new Set<string>(),
        });
        expect(foreign.outcome).toBe('rejected');
        if (foreign.outcome === 'rejected') {
          expect(foreign.reason).toBe('tenant-mismatch');
        }
        transcript.push(
          observationLine({
            step: 'webhook-consumption-adversarial',
            observed: 'forged signature → rejected signature-mismatch; correctly-signed foreign-tenant event → rejected tenant-mismatch (the consumer walls of consumeEpochWebhook)',
          }),
        );
      }

      transcript.push(
        `- evidence-class: ${evidenceClassForEngine(deployment.engineClass)} (engine ${deployment.engineClass})`,
      );
      const file = await writeTranscript(EVIDENCE_DIR, 'epoch-adapter-full-flow', transcript);
      expect(file).toContain('epoch-adapter-full-flow-transcript.md');
    } finally {
      await deployment.close();
    }
  });

  it('the adapter mapping walls are fail-closed and typed (unknown trigger field, authorization mismatch, malformed posture)', async () => {
    // Unknown field on the trigger wire → typed UNKNOWN_FIELD.
    let unknownFieldCode = '';
    try {
      parseEpochEscalationTrigger({
        ...epochTriggerWire(),
        surpriseField: 'not-in-the-closed-shape',
      });
    } catch (error) {
      unknownFieldCode =
        error instanceof EpochEscalationError ? error.code : 'unexpected-error-shape';
    }
    expect(unknownFieldCode).toBe(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD);

    // A trigger whose authorization identity does not match the declared
    // posture → typed AUTHORIZATION_MISMATCH (the cross-tenant
    // adversarial case) — through the adapter's own request-construction
    // path.
    const foreignTenantClient = new EpochAdapterClient({
      postureWire: epochPostureWire(),
      baseUrl: 'http://127.0.0.1:9', // never contacted — mapping fails first
      apiKeySecret: 'unused',
      webhookSigner: {
        signingKeyId: 'unused',
        sign: () => '0'.repeat(64),
      },
      now: () => T0,
      epochJobId: EPOCH_JOB_ID,
    });
    let authorizationCode = '';
    try {
      await foreignTenantClient.createRequestInputFromTrigger(
        epochTriggerWire({
          authorization: { clientAppId: EPOCH_APP, tenantId: 'tenant-foreign' },
        }),
      );
    } catch (error) {
      authorizationCode =
        error instanceof EpochEscalationError ? error.code : 'unexpected-error-shape';
    }
    expect(authorizationCode).toBe(EPOCH_ESCALATION_ERROR_CODES.AUTHORIZATION_MISMATCH);

    // A malformed posture (unknown field) → typed INVALID_POSTURE /
    // UNKNOWN_FIELD — closed shape, fail-closed.
    let postureCode = '';
    try {
      new EpochAdapterClient({
        postureWire: { ...epochPostureWire(), extraPostureField: true },
        baseUrl: 'http://127.0.0.1:9',
        apiKeySecret: 'unused',
        webhookSigner: { signingKeyId: 'unused', sign: () => '0'.repeat(64) },
        now: () => T0,
        epochJobId: EPOCH_JOB_ID,
      });
    } catch (error) {
      postureCode =
        error instanceof EpochEscalationError ? error.code : 'unexpected-error-shape';
    }
    expect(postureCode).toBe(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD);
  });
});
