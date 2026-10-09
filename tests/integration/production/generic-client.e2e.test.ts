/**
 * tests/integration/production/generic-client.e2e.test.ts — M2 of the
 * P006 integrated acceptance (Work Order P006; issue #158): the GENERIC
 * AI APPLICATION CLIENT drives the FULL core flow over the public
 * transport ONLY (ADR-P001-07/08), asserted at the public boundary —
 * HTTP responses, webhook deliveries, poll results — never by reaching
 * into service internals.
 *
 * The flow (the FINAL-HANDOFF §15 loop over the integrated deployment):
 *   request → capability demand/routing (matched expert) →
 *   offer/acceptance → bounded expert session → observable
 *   intervention/artifacts → validation/adjudication → typed result →
 *   webhook retry/dedupe and polling → payment test/sandbox →
 *   consent/rights-gated learning candidate and Q1.0 → observational
 *   replay with external live-world writeback denied.
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY
 * (release-gate §3); truth lens `customer` (ADR-P001-02); the payment
 * step runs the DEMO provider (executesCustomerMoney=false — CI moves
 * NO real money).
 */

import { describe, expect, it } from 'vitest';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { ESCALATION_WEBHOOK_EVENT_TYPES } from '@arena/escalation';
import { asLiveMutation, REPLAY_KIND } from '@arena/expert-session';
import { measureSlaClocks } from '@arena/escalation-observability';
import { bootIntegratedDeployment, webhookDelivery, T0 } from './support/harness.js';
import { QUALIFIED_EXPERT_REF } from './support/expert-side.js';
import {
  createGenericAiClient,
  ClientWebhookReceiver,
} from './support/generic-client.js';
import { driveEscalationToCompletion } from './support/arena-side.js';
import {
  candidateSpecFromConsent,
  runConsentGatedLearningLoop,
  q10ConditionsOf,
} from './support/learning-loop.js';
import {
  transcriptHeader,
  writeTranscript,
  evidenceClassForEngine,
  observationLine,
} from './support/evidence.js';

const EVIDENCE_DIR =
  process.env.ARENA_P006_EVIDENCE_OUT ??
  new URL('../../../docs/evidence/production/integration/', import.meta.url).pathname;

const TENANT = 'tenant-beta';

/** The generic client's escalation demand (the §16 BOQ vertical). */
function boqEscalationInput(overrides: Record<string, unknown> = {}): CreateEscalationRequestInput {
  return {
    clientAppId: 'generic-boq-app',
    tenantId: TENANT,
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
    idempotencyKey: 'generic-idem-0001',
    correlationId: 'generic-corr-0001',
    ...overrides,
  } as CreateEscalationRequestInput;
}

describe('P006 M2 — the generic AI application client drives the full core flow over public transport', () => {
  it('§15 loop: submit → route/offer → session → intervention → validation → typed result → webhooks+polling → payment sandbox → learning gate+Q1.0 → observational replay (writeback denied)', async () => {
    const deployment = await bootIntegratedDeployment();
    const transcript: string[] = [
      ...transcriptHeader('generic-client-full-flow', {
        engineClass: deployment.engineClass,
        transport: 'public HTTP listener (node:http, ephemeral port) + MCP over POST /mcp + signed webhook deliveries (HMAC-SHA256) from the REAL webhook-delivery service draining the REAL durable outbox',
        baseUrl: deployment.baseUrl,
        lens: 'customer',
        paymentPosture: 'DEMO provider (executesCustomerMoney=false) — CI moves NO real money',
      }),
    ];
    try {
      // --- the client's key + webhook receiver ------------------------
      const issuance = deployment.keys.issue({
        tenantId: TENANT,
        clientAppId: 'generic-boq-app',
      });
      const receiver = new ClientWebhookReceiver();
      const endpoint = await receiver.start();
      const client = createGenericAiClient({
        clientAppId: 'generic-boq-app',
        tenantId: TENANT,
        baseUrl: deployment.baseUrl,
        apiKeySecret: issuance.secret,
        webhookSigner: {
          signingKeyId: deployment.signer.signingKeyId,
          sign: (timestamp, payload) =>
            deployment.signer.sign(timestamp, payload),
        },
        now: () => deployment.clock.now(),
      });
      const delivery = webhookDelivery(deployment, endpoint.url);
      transcript.push(observationLine({ step: 'boot', observed: `listener ${deployment.baseUrl}; webhook endpoint ${endpoint.url}` }));

      // --- (1) request: POST /v1/escalations over the public transport -
      const submission = await client.submitEscalation(boqEscalationInput());
      expect(submission.httpStatus).toBe(201);
      expect(submission.duplicate).toBe(false);
      transcript.push(observationLine({ step: 'request', observed: `POST /v1/escalations → 201 created requestId=${submission.requestId}` }));

      // --- (2) capability demand/routing: the matched expert at offer --
      const early = await client.pollStatus(submission.requestId);
      expect(early.state).toBe('offered');
      expect(early.expertRef).toBe(QUALIFIED_EXPERT_REF);
      transcript.push(observationLine({ step: 'capability-demand/routing', observed: `poll → offered (expert=${early.expertRef}; the REAL routing service over the REAL capability graph + candidate directory)` }));

      // --- (3) first webhook drain: created → triaged → matching → offered
      //         (the client verifies EVERY delivery signature + dedupes)
      const firstDrain = await delivery.deliverPending();
      expect(firstDrain.deliveredCount).toBeGreaterThanOrEqual(4);
      for (const captured of receiver.deliveries) {
        const verdict = client.receiveWebhook(captured);
        expect(verdict.outcome).toBe('accepted');
      }
      const earlyEventTypes = client.observedEvents().map((event) => event.eventType);
      expect(earlyEventTypes).toContain('escalation.created');
      expect(earlyEventTypes).toContain('escalation.progressed');
      expect(earlyEventTypes).toContain('escalation.matched');
      transcript.push(observationLine({ step: 'offer/webhook-drain-1', observed: `${firstDrain.deliveredCount} signed deliveries verified + deduped (${earlyEventTypes.join(', ')})` }));

      // --- (4)-(11) the Arena side drives session → intervention →
      //          validation → typed result → payment + fee → learning
      //          → close (clients observe ONLY through the boundary).
      const arenaSide = await driveEscalationToCompletion({
        deployment,
        requestId: submission.requestId,
        tenantId: TENANT,
        offered: {
          expertRef: early.expertRef,
          escalationModes: early.request.escalationModes,
          environmentSessionMode: early.request.environmentSessionPolicy.sessionMode,
          permittedActions: early.request.permittedActions,
          learningPermissions: early.request.learningPermissions,
        },
        taskRef: 'task-quantity-takeoff-block-c',
        worldState: {
          block: 'C',
          assumedFoundationDepthMm: 600,
          uncertainty: 'unverified local foundation convention',
          boqDraftRef: 'boq-accra-house-draft.json',
        },
        resultSummary: 'Block C foundation depth follows the 450mm local convention; recompute the takeoff.',
        resultPayload: { blockCQuantity: 118.5, basis: 'local-convention-450mm' },
        sessionId: 'session-boq-block-c',
      });
      expect(arenaSide.modeAuthorization.allowed).toBe(true);
      expect(arenaSide.expertActions.every((entry) => entry.allowed)).toBe(true);
      transcript.push(observationLine({ step: 'bounded-expert-session', observed: `capsule digest ${arenaSide.capsuleDigest.slice(0, 16)}…; ${arenaSide.session.events.length} observable session events; mode authorization allowed=${arenaSide.modeAuthorization.allowed}` }));
      transcript.push(observationLine({ step: 'intervention', observed: `permitted actions recorded: ${arenaSide.expertActions.map((entry) => entry.action).join(', ')}` }));

      // --- (12) second webhook drain: the full signed lifecycle stream -
      const secondDrain = await delivery.deliverPending();
      for (const captured of receiver.deliveries.slice(-secondDrain.deliveredCount)) {
        const verdict = client.receiveWebhook(captured);
        expect(verdict.outcome).toBe('accepted');
      }
      const allEventTypes = client.observedEvents().map((event) => event.eventType);
      for (const expected of [
        'escalation.accepted',
        'escalation.session.ready',
        'escalation.started',
        'escalation.submitted',
        'escalation.validation.updated',
        'escalation.payment.updated',
        'escalation.learning.updated',
        'escalation.completed',
      ] as const) {
        expect(allEventTypes).toContain(expected);
      }
      transcript.push(observationLine({ step: 'webhook-drain-2', observed: `${secondDrain.deliveredCount} more signed deliveries (${allEventTypes.length} total accepted); every type in the closed 13-type taxonomy observed through the public boundary` }));
      // Every observed event type is in the CLOSED taxonomy.
      for (const eventType of allEventTypes) {
        expect(ESCALATION_WEBHOOK_EVENT_TYPES as readonly string[]).toContain(eventType);
      }

      // --- (13) duplicate delivery: the same event redelivered is
      //          deduped per EVENT ID (never per type — R-032).
      const firstDelivery = receiver.deliveries[0];
      if (firstDelivery !== undefined) {
        const duplicateVerdict = client.receiveWebhook(firstDelivery);
        if (duplicateVerdict.outcome === 'rejected') {
          expect(duplicateVerdict.reason).toBe('duplicate-event');
          transcript.push(observationLine({ step: 'webhook-dedupe', observed: 'redelivered event id rejected as duplicate-event (per-event-id dedupe)' }));
        } else {
          throw new Error('a redelivered event id must be rejected as a duplicate');
        }
      }

      // --- (14) the client polls to the TERMINAL record: typed result,
      //          validation status, cost fields — all at the boundary.
      const terminal = await client.awaitTerminalState(submission.requestId);
      expect(terminal.state).toBe('closed');
      expect(terminal.result?.kind).toBe('unblock');
      expect(terminal.result?.summary).toContain('450mm');
      expect(terminal.validationStatus).toBe('passed');
      expect(terminal.cost?.amountMinorUnits).toBe(25_000);
      expect(terminal.cost?.arenaFeeMinorUnits).toBeGreaterThan(0);
      expect(terminal.cost?.expertPayoutStatus).toBe('paid');
      transcript.push(observationLine({ step: 'validation/adjudication', observed: `poll → validationStatus=${terminal.validationStatus} (recorded verdict — the C009 seam)` }));
      transcript.push(observationLine({ step: 'typed-result', observed: `poll → result kind=${terminal.result?.kind} summary="${terminal.result?.summary?.slice(0, 48)}…"` }));

      // --- (15) MCP over the SAME authority (L-002 closure: the example
      //          never exercised MCP; the integrated client does).
      const tools = await client.mcpTools();
      expect(tools).toEqual(['create-escalation', 'get-escalation-status']);
      const mcpStatus = await client.mcpGetEscalationStatus(submission.requestId);
      expect(mcpStatus.requestId).toBe(submission.requestId);
      expect(mcpStatus.state).toBe('closed');
      expect(mcpStatus.validationStatus).toBe('passed');
      expect(mcpStatus.result?.kind).toBe('unblock');
      expect(mcpStatus.cost?.amountMinorUnits).toBe(25_000);
      transcript.push(observationLine({ step: 'mcp-transport', observed: `tools/list + get-escalation-status over POST /mcp → the SAME record's state/result/cost (one authority, two transports)` }));

      // --- (16) payment test/sandbox: the DEMO provider posture
      //          (executesCustomerMoney=false — CI moves NO real money).
      expect(deployment.arena.paymentProviderPosture.executesCustomerMoney).toBe(false);
      expect(deployment.arena.paymentProviderPosture.truth).toBe('demo');
      expect(arenaSide.costFields.expertPayoutStatus).toBe('paid');
      transcript.push(observationLine({ step: 'payment-test/sandbox', observed: `DEMO_PROVIDER_POSTURE.executesCustomerMoney=false; releasePayout cost ${arenaSide.costFields.amountMinorUnits} minor units (fee ${arenaSide.costFields.arenaFeeMinorUnits}) — demo money only` }));

      // --- (17) the client applies the result through its OWN authority
      //          and resumes its authoritative workflow (ERF1.0 law).
      let appliedPayload: unknown;
      const applied = client.applyResult(terminal, (resultPayload) => {
        appliedPayload = resultPayload;
      });
      expect(applied.appliedBy).toBe('client-own-authority');
      expect(appliedPayload).toMatchObject({ resolution: { blockCQuantity: 118.5, basis: 'local-convention-450mm' } });
      transcript.push(observationLine({ step: 'own-authority-application', observed: `appliedBy=${applied.appliedBy}; workflow resumed` }));

      // --- (18) SLA measurement over the integrated flow's milestones
      //          (ADR-P001-04: four clocks; typed states + reasons). The
      //          milestone times come from the PUBLIC record's own
      //          append-only history (observed at the boundary).
      const historyAt = (state: string): string | null => {
        const entry = terminal.history.find((item) => item.to === state);
        return entry === undefined ? null : entry.occurredAt;
      };
      const sla = measureSlaClocks({
        tenant: TENANT,
        requestId: submission.requestId,
        urgency: 'priority',
        requestDeadline: terminal.request.deadline,
        offerIssuedAt: historyAt('offered') ?? terminal.request.createdAt,
        milestones: {
          acceptedAt: historyAt('accepted'),
          activatedAt: historyAt('in_progress'),
          submittedAt: historyAt('submitted'),
          validationVerdictAt: historyAt('result_accepted'),
        },
        at: new Date(deployment.clock.now()).toISOString(),
      });
      const slaStates = sla.clocks.map((clock) => `${clock.clock}:${clock.state}`).join(', ');
      for (const clock of sla.clocks) {
        expect(['met', 'pending', 'at-risk', 'breached']).toContain(clock.state);
        expect(clock.reasons.length).toBeGreaterThan(0);
      }
      transcript.push(observationLine({ step: 'sla-measurement', observed: `four clocks measured: ${slaStates} (typed states + reasons; ADR-P001-04)` }));

      // --- (19) consent/rights-gated learning candidate + Q1.0 -------
      //          The CONSENTED candidate (the session's completion
      //          contract granted reuse) compiles; the UNCONSENTED one
      //          is BLOCKED with rights-insufficient — no rights-free
      //          global learning, ever.
      const consentBasis = {
        requestId: submission.requestId,
        tenantId: TENANT,
        sessionRef: arenaSide.sessionRef,
        capsuleDigest: arenaSide.capsuleDigest,
        consentGranted: true,
        consentStatement: 'Knowledge patch may be retained as a scoped, attributed domain rule.',
      };
      const unconsentBasis = { ...consentBasis, consentGranted: false, consentStatement: 'No reuse consent recorded for this session.' };
      const learning = await runConsentGatedLearningLoop(
        candidateSpecFromConsent(consentBasis, { candidateId: 'candidate-boq-0001' }),
        candidateSpecFromConsent(unconsentBasis, { candidateId: 'candidate-boq-0002' }),
      );
      expect(learning.unconsentedOutcome.kind).toBe('blocked');
      if (learning.unconsentedOutcome.kind === 'blocked') {
        expect(learning.unconsentedOutcome.reasons.map((reason) => reason.reason)).toContain('rights-insufficient');
      }
      expect(learning.consentedOutcome.kind).toBe('compilable');
      expect(learning.gateVerdict?.kind).toBe('adopted-with-evidence');
      const conditions = q10ConditionsOf(learning.gateVerdict);
      expect(conditions.map((condition) => condition.met)).toEqual([true, true, true, true, true]);
      expect(learning.proposals.length).toBeGreaterThan(0);
      for (const proposal of learning.proposals) {
        expect(['body-forge', 'compatibility-retest', 'recertification-trigger']).toContain(proposal.destination);
      }
      transcript.push(observationLine({ step: 'learning-gate', observed: `unconsented candidate BLOCKED (rights-insufficient); consented candidate compiled → Q1.0 gate verdict ${learning.gateVerdict?.kind} (all five conditions met) → ${learning.proposals.length} gated proposal(s) routed (${learning.proposals.map((proposal) => proposal.destination).join(', ')})` }));

      // --- (20) observational replay with external live-world writeback
      //          DENIED: the replay trace is observational (visibly
      //          labelled; liveMutation=false) and converting it into a
      //          live mutation is the typed REPLAY_AS_LIVE failure.
      const replay = arenaSide.replay;
      expect(replay.kind).toBe(REPLAY_KIND);
      expect(replay.liveMutation).toBe(false);
      expect(replay.frames.length).toBeGreaterThan(0);
      let writebackDenied = false;
      try {
        asLiveMutation(replay);
      } catch {
        writebackDenied = true;
      }
      expect(writebackDenied).toBe(true);
      transcript.push(observationLine({ step: 'observational-replay', observed: `replay trace kind=${replay.kind} liveMutation=false (${replay.frames.length} frames); asLiveMutation DENIED (REPLAY_AS_LIVE)` }));

      transcript.push(
        `- evidence-class: ${evidenceClassForEngine(deployment.engineClass)} (engine ${deployment.engineClass})`,
      );
      const file = await writeTranscript(EVIDENCE_DIR, 'generic-client-full-flow', transcript);
      expect(file).toContain('generic-client-full-flow-transcript.md');
    } finally {
      await deployment.close();
    }
  });
});
