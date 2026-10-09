/**
 * tests/integration/production/support/public-flow.ts — the IDENTICAL
 * PUBLIC-FLOW acceptance contract (Work Order P006; issue #158; the
 * mission's acceptance row: "both clients pass the identical public
 * flow").
 *
 * One driver, TWO clients: the generic AI application client
 * (support/generic-client.ts) and the Epoch adapter client
 * (support/epoch-client.ts — the adapters/epoch-escalation public surface
 * driven over the SAME public transport). Both are bound to ONE neutral
 * client port (below) and driven through the SAME full §15 core loop —
 * request → capability demand/routing → offer/acceptance → bounded expert
 * session → observable intervention/artifacts → validation/adjudication
 * → typed result → webhook retry/dedupe + polling → payment sandbox →
 * consent/rights-gated learning candidate + Q1.0 → observational replay
 * with live-world writeback denied.
 *
 * Every observation the driver records arrives at the PUBLIC boundary
 * (HTTP responses, signed webhook deliveries, poll results) — never
 * through in-process service references (ADR-P001-07/08). The driver
 * normalizes those observations into a PublicFlowReceipt; the identical
 * acceptance is the machine-check that the two clients' receipts are
 * EQUAL on every public-flow field (client identity fields excepted).
 */

import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import { asLiveMutation, REPLAY_KIND } from '@arena/expert-session';
import type { PlainJsonValue } from '@arena/expert-session';
import { measureSlaClocks } from '@arena/escalation-observability';
import type { WebhookDeliveryService } from '@arena/webhook-delivery';
import type { IntegratedDeployment } from './harness.js';
import type { CapturedWebhook, GenericAiClient } from './generic-client.js';
import type { EpochAdapterClient } from './epoch-client.js';
import { driveEscalationToCompletion } from './arena-side.js';
import {
  candidateSpecFromConsent,
  runConsentGatedLearningLoop,
  q10ConditionsOf,
} from './learning-loop.js';

// ---------------------------------------------------------------------------
// The neutral client port both clients satisfy
// ---------------------------------------------------------------------------

/** The two P006 clients (identity only — never behavior). */
export type PublicFlowClientKind = 'generic-ai-app' | 'epoch-adapter';

/** One public-boundary submission observation. */
export interface PublicFlowSubmission {
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly httpStatus: number;
}

/** The normalized webhook-consumption observation. */
export interface WebhookConsumptionSummary {
  readonly accepted: number;
  readonly rejectionReasons: readonly string[];
}

/** The MCP status-tool view of the SAME record (the second transport). */
export interface McpStatusView {
  readonly state: string;
  readonly validationStatus: string | null;
  readonly resultKind: string | null;
}

/**
 * The neutral public-flow client port. BOTH P006 clients implement this
 * over the public transport only — the generic client through plain
 * fetch + its own webhook verify/dedupe, the Epoch client through the
 * adapters/epoch-escalation public surface (trigger mapping +
 * consumeEpochWebhook + the delivery projection).
 */
export interface PublicFlowClientPort {
  readonly clientKind: PublicFlowClientKind;
  readonly tenantId: string;
  /** POST /v1/escalations (scoped key; 201 created / 200 replay). */
  submit(requestInput: CreateEscalationRequestInput): Promise<PublicFlowSubmission>;
  /** GET /v1/escalations/{request_id} (idempotent polling). */
  pollStatus(requestId: string): Promise<EscalationRecord>;
  /** Poll until a terminal state arrives. */
  awaitTerminalState(requestId: string): Promise<EscalationRecord>;
  /** Verify + dedupe captured deliveries (each client's own discipline). */
  acceptWebhookDeliveries(captured: readonly CapturedWebhook[]): WebhookConsumptionSummary;
  /** A REDELIVERED (already-consumed) event must be rejected — the reason. */
  rejectRedelivery(captured: CapturedWebhook): string;
  /** Every accepted/consumed webhook event type, in acceptance order. */
  observedEventTypes(): readonly string[];
  /** MCP tools/list over POST /mcp (the same authority). */
  mcpTools(): Promise<readonly string[]>;
  /** MCP get-escalation-status over POST /mcp. */
  mcpStatusView(requestId: string): Promise<McpStatusView>;
  /** Apply a terminal result through the client's OWN authority (ERF1.0). */
  applyTerminalResult(record: EscalationRecord): {
    readonly appliedBy: 'client-own-authority';
    readonly resultKind: string;
  };
}

// ---------------------------------------------------------------------------
// The driver scenario + receipt
// ---------------------------------------------------------------------------

/** One client's scenario inputs (the §16 BOQ reference vertical). */
export interface PublicFlowScenario {
  /** The request body the client submits (client-specific construction). */
  readonly requestInput: CreateEscalationRequestInput;
  readonly taskRef: string;
  readonly worldState: Record<string, PlainJsonValue>;
  readonly resultSummary: string;
  readonly resultPayload: Record<string, PlainJsonValue>;
  readonly sessionId: string;
  readonly consentStatement: string;
}

/**
 * The normalized public-flow receipt — every field an OBSERVATION at the
 * public boundary, identical for both clients by construction of the
 * driver. clientKind/tenantId/requestId are identity fields.
 */
export interface PublicFlowReceipt {
  readonly clientKind: PublicFlowClientKind;
  readonly tenantId: string;
  readonly requestId: string;
  readonly submissionStatus: number;
  readonly submissionDuplicate: boolean;
  readonly offeredState: string;
  readonly offeredExpert: string;
  readonly earlyEventTypes: readonly string[];
  readonly allEventTypes: readonly string[];
  readonly duplicateRejection: string;
  readonly mcpTools: readonly string[];
  readonly mcpState: string;
  readonly mcpValidationStatus: string | null;
  readonly mcpResultKind: string | null;
  readonly terminalState: string;
  readonly resultKind: string;
  readonly resultSummaryMarker: string;
  readonly validationStatus: string;
  readonly costAmountMinorUnits: number;
  readonly costCurrency: string;
  readonly costHasFee: boolean;
  readonly payoutStatus: string;
  readonly paymentExecutesCustomerMoney: boolean;
  readonly paymentTruth: string;
  readonly appliedBy: string;
  readonly learningBlockedReason: string;
  readonly learningGateVerdict: string;
  readonly q10AllConditionsMet: boolean;
  readonly learningProposalDestinations: readonly string[];
  readonly replayKind: string;
  readonly replayLiveMutation: boolean;
  readonly replayHasFrames: boolean;
  readonly writebackDenied: boolean;
  readonly slaClockCount: number;
  readonly slaStatesInVocabulary: boolean;
  readonly slaReasonsNonEmpty: boolean;
}

/** The driver's wiring (client + receiver + delivery over one deployment). */
export interface PublicFlowDriveOptions {
  readonly deployment: IntegratedDeployment;
  readonly client: PublicFlowClientPort;
  /** The delivery service composed over the deployment's durable outbox. */
  readonly delivery: WebhookDeliveryService;
  /** The receiver's captured deliveries (in arrival order). */
  readonly receiverDeliveries: () => readonly CapturedWebhook[];
  readonly scenario: PublicFlowScenario;
  /** Transcript lines (evidence capture; optional). */
  readonly transcript?: string[];
}

/**
 * Drive ONE client through the FULL §15 core loop over the public
 * transport, asserting every stage at the public boundary, and return the
 * normalized receipt. The Arena-side half (bounded session → intervention
 * → validation → payment → learning → close) rides the same
 * driveEscalationToCompletion operator driver for every client — clients
 * observe ONLY through the boundary.
 */
export async function driveFullPublicFlow(options: PublicFlowDriveOptions): Promise<PublicFlowReceipt> {
  const { deployment, client, delivery, scenario } = options;
  const transcript = options.transcript ?? [];
  const line = (text: string) => {
    transcript.push(text);
  };

  // --- (1) request over the public transport --------------------------
  const submission = await client.submit(scenario.requestInput);
  const created = submission.httpStatus === 201 && submission.duplicate === false;
  if (!created) {
    throw new Error(
      `${client.clientKind}: expected a fresh 201 creation, got ${String(submission.httpStatus)} duplicate=${String(submission.duplicate)}`,
    );
  }

  // --- (2) capability demand/routing: the matched expert at offer -----
  const early = await client.pollStatus(submission.requestId);
  if (early.state !== 'offered' || early.expertRef === undefined) {
    throw new Error(
      `${client.clientKind}: expected the matched-offer posture, got state=${early.state}`,
    );
  }
  line(`- request: POST /v1/escalations → 201 requestId=${submission.requestId}`);
  line(
    `- capability-demand/routing: poll → ${early.state} (expert=${early.expertRef}; the REAL routing service over the REAL capability graph + candidate directory)`,
  );

  // --- (3) first webhook drain: created → triaged → matching → offered
  let consumed = 0;
  const drainAndConsume = async (stage: string): Promise<WebhookConsumptionSummary> => {
    const before = options.receiverDeliveries().length;
    const report = await delivery.deliverPending();
    const fresh = options.receiverDeliveries().slice(before);
    const summary = client.acceptWebhookDeliveries(fresh);
    consumed += summary.accepted;
    if (summary.rejectionReasons.length > 0) {
      throw new Error(
        `${client.clientKind}: a fresh signed delivery was rejected at ${stage}: ${summary.rejectionReasons.join(', ')}`,
      );
    }
    line(
      `- webhook-drain/${stage}: ${String(report.deliveredCount)} signed deliveries → ${String(summary.accepted)} consumed (cumulative ${String(consumed)}); dead-lettered=${String(report.deadLetteredCount)}`,
    );
    return summary;
  };
  await drainAndConsume('offer');
  const earlyEventTypes = unique(client.observedEventTypes());
  for (const expected of ['escalation.created', 'escalation.progressed', 'escalation.matched'] as const) {
    if (!earlyEventTypes.includes(expected)) {
      throw new Error(`${client.clientKind}: the early event stream missed ${expected}`);
    }
  }

  // --- (4)-(11) the Arena side drives the flow to completion ---------
  const arenaSide = await driveEscalationToCompletion({
    deployment,
    requestId: submission.requestId,
    tenantId: client.tenantId,
    offered: {
      expertRef: early.expertRef,
      escalationModes: early.request.escalationModes,
      environmentSessionMode: early.request.environmentSessionPolicy.sessionMode,
      permittedActions: early.request.permittedActions,
      learningPermissions: early.request.learningPermissions,
    },
    taskRef: scenario.taskRef,
    worldState: scenario.worldState,
    resultSummary: scenario.resultSummary,
    resultPayload: scenario.resultPayload,
    sessionId: scenario.sessionId,
  });
  if (!arenaSide.modeAuthorization.allowed) {
    throw new Error(`${client.clientKind}: mode authorization was denied`);
  }
  if (!arenaSide.expertActions.every((entry) => entry.allowed)) {
    throw new Error(`${client.clientKind}: a permitted expert action was denied`);
  }
  line(
    `- bounded-expert-session: capsule ${arenaSide.capsuleDigest.slice(0, 12)}…; ${String(arenaSide.session.events.length)} observable events; intervention actions recorded (${arenaSide.expertActions.map((entry) => entry.action).join(', ')})`,
  );

  // --- (12) second webhook drain: the full signed lifecycle stream ----
  await drainAndConsume('completion');
  const allEventTypes = unique(client.observedEventTypes());
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
    if (!allEventTypes.includes(expected)) {
      throw new Error(`${client.clientKind}: the lifecycle event stream missed ${expected}`);
    }
  }

  // --- (13) duplicate delivery: per-EVENT-ID dedupe -------------------
  const firstDelivery = options.receiverDeliveries()[0];
  if (firstDelivery === undefined) {
    throw new Error(`${client.clientKind}: no webhook delivery captured to replay`);
  }
  const duplicateRejection = client.rejectRedelivery(firstDelivery);

  // --- (14) the TERMINAL record at the public boundary ----------------
  const terminal = await client.awaitTerminalState(submission.requestId);
  line(
    `- validation/adjudication: poll → state=${terminal.state} validationStatus=${String(terminal.validationStatus)}`,
  );
  line(`- typed-result: poll → result kind=${String(terminal.result?.kind)}`);

  // --- (15) MCP over the SAME authority (the second transport) -------
  const tools = unique(await client.mcpTools());
  const mcpView = await client.mcpStatusView(submission.requestId);
  line(
    `- mcp-transport: tools/list + get-escalation-status over POST /mcp → state=${mcpView.state} (one authority, two transports)`,
  );

  // --- (16) payment sandbox posture (CI moves NO real money) ---------
  const posture = deployment.arena.paymentProviderPosture;
  line(
    `- payment-test/sandbox: provider truth=${posture.truth} executesCustomerMoney=${String(posture.executesCustomerMoney)}; release cost ${String(arenaSide.costFields.amountMinorUnits)} minor units (fee ${String(arenaSide.costFields.arenaFeeMinorUnits)}) — demo money only`,
  );

  // --- (17) the client applies the result through its OWN authority -
  const applied = client.applyTerminalResult(terminal);
  line(`- own-authority-application: appliedBy=${applied.appliedBy}; workflow resumed`);

  // --- (18) SLA measurement over the PUBLIC record's own history -----
  const historyAt = (state: string): string | null => {
    const entry = terminal.history.find((item) => item.to === state);
    return entry === undefined ? null : entry.occurredAt;
  };
  const sla = measureSlaClocks({
    tenant: client.tenantId,
    requestId: submission.requestId,
    urgency: terminal.request.urgency,
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
  const slaStatesInVocabulary = sla.clocks.every((clock) =>
    ['met', 'pending', 'at-risk', 'breached'].includes(clock.state),
  );
  const slaReasonsNonEmpty = sla.clocks.every((clock) => clock.reasons.length > 0);
  line(
    `- sla-measurement: ${String(sla.clocks.length)} clocks (${sla.clocks.map((clock) => `${clock.clock}:${clock.state}`).join(', ')}); typed states + reasons (ADR-P001-04)`,
  );

  // --- (19) consent/rights-gated learning candidate + Q1.0 ----------
  const consentBasis = {
    requestId: submission.requestId,
    tenantId: client.tenantId,
    sessionRef: arenaSide.sessionRef,
    capsuleDigest: arenaSide.capsuleDigest,
    consentGranted: true,
    consentStatement: scenario.consentStatement,
  };
  const unconsentBasis = {
    ...consentBasis,
    consentGranted: false,
    consentStatement: 'No reuse consent recorded for this session.',
  };
  const learning = await runConsentGatedLearningLoop(
    candidateSpecFromConsent(consentBasis, { candidateId: `candidate-${client.clientKind}-0001` }),
    candidateSpecFromConsent(unconsentBasis, { candidateId: `candidate-${client.clientKind}-0002` }),
  );
  let learningBlockedReason = 'not-blocked';
  if (learning.unconsentedOutcome.kind === 'blocked') {
    learningBlockedReason = learning.unconsentedOutcome.reasons
      .map((reason) => reason.reason)
      .sort()
      .join(',');
  }
  const conditions = q10ConditionsOf(learning.gateVerdict);
  const q10AllConditionsMet = conditions.every((condition) => condition.met);
  const proposalDestinations = learning.proposals.map((proposal) => proposal.destination).sort();
  line(
    `- learning-gate: unconsented BLOCKED (${learningBlockedReason}); consented ${learning.consentedOutcome.kind} → gate ${String(learning.gateVerdict?.kind)} (Q1.0 ${conditions.map((condition) => (condition.met ? '✓' : '✗')).join('')}) → ${String(learning.proposals.length)} gated proposal(s)`,
  );

  // --- (20) observational replay with live-world writeback DENIED ---
  const replay = arenaSide.replay;
  let writebackDenied = false;
  try {
    asLiveMutation(replay);
  } catch {
    writebackDenied = true;
  }
  line(
    `- observational-replay: kind=${replay.kind} liveMutation=${String(replay.liveMutation)} (${String(replay.frames.length)} frames); asLiveMutation DENIED (REPLAY_AS_LIVE)`,
  );

  return Object.freeze({
    clientKind: client.clientKind,
    tenantId: client.tenantId,
    requestId: submission.requestId,
    submissionStatus: submission.httpStatus,
    submissionDuplicate: submission.duplicate,
    offeredState: early.state,
    offeredExpert: early.expertRef,
    earlyEventTypes,
    allEventTypes,
    duplicateRejection,
    mcpTools: tools,
    mcpState: mcpView.state,
    mcpValidationStatus: mcpView.validationStatus,
    mcpResultKind: mcpView.resultKind,
    terminalState: terminal.state,
    resultKind: terminal.result?.kind ?? 'none',
    resultSummaryMarker: terminal.result?.summary?.includes('450mm') === true ? '450mm' : 'absent',
    validationStatus: terminal.validationStatus ?? 'none',
    costAmountMinorUnits: terminal.cost?.amountMinorUnits ?? -1,
    costCurrency: terminal.cost?.currency ?? 'none',
    costHasFee: (terminal.cost?.arenaFeeMinorUnits ?? 0) > 0,
    payoutStatus: terminal.cost?.expertPayoutStatus ?? 'none',
    paymentExecutesCustomerMoney: posture.executesCustomerMoney,
    paymentTruth: posture.truth,
    appliedBy: applied.appliedBy,
    learningBlockedReason,
    learningGateVerdict: learning.gateVerdict?.kind ?? 'none',
    q10AllConditionsMet,
    learningProposalDestinations: proposalDestinations,
    replayKind: replay.kind,
    replayLiveMutation: replay.liveMutation,
    replayHasFrames: replay.frames.length > 0,
    writebackDenied,
    slaClockCount: sla.clocks.length,
    slaStatesInVocabulary,
    slaReasonsNonEmpty,
  });
}

/**
 * The IDENTICAL acceptance: both clients' receipts are EQUAL on every
 * public-flow field (the identity fields — clientKind, tenantId,
 * requestId — are the only permitted differences).
 */
export function assertIdenticalPublicFlowReceipts(a: PublicFlowReceipt, b: PublicFlowReceipt): void {
  const compare: readonly (keyof PublicFlowReceipt)[] = [
    'submissionStatus',
    'submissionDuplicate',
    'offeredState',
    'offeredExpert',
    'earlyEventTypes',
    'allEventTypes',
    'duplicateRejection',
    'mcpTools',
    'mcpState',
    'mcpValidationStatus',
    'mcpResultKind',
    'terminalState',
    'resultKind',
    'resultSummaryMarker',
    'validationStatus',
    'costAmountMinorUnits',
    'costCurrency',
    'costHasFee',
    'payoutStatus',
    'paymentExecutesCustomerMoney',
    'paymentTruth',
    'appliedBy',
    'learningBlockedReason',
    'learningGateVerdict',
    'q10AllConditionsMet',
    'learningProposalDestinations',
    'replayKind',
    'replayLiveMutation',
    'replayHasFrames',
    'writebackDenied',
    'slaClockCount',
    'slaStatesInVocabulary',
    'slaReasonsNonEmpty',
  ];
  for (const field of compare) {
    const left = JSON.stringify(a[field]);
    const right = JSON.stringify(b[field]);
    if (left !== right) {
      throw new Error(
        `IDENTICAL PUBLIC FLOW violated at "${String(field)}": ${a.clientKind}=${left} vs ${b.clientKind}=${right}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The generic client shim (session 1's client satisfies the port)
// ---------------------------------------------------------------------------

/**
 * Bind session 1's generic AI application client to the neutral public
 * flow port (a pure shim — the client's own behavior is untouched).
 */
export function genericClientAsFlowClient(client: GenericAiClient): PublicFlowClientPort {
  return {
    clientKind: 'generic-ai-app',
    tenantId: client.tenantId,
    async submit(requestInput) {
      return client.submitEscalation(requestInput);
    },
    async pollStatus(requestId) {
      return client.pollStatus(requestId);
    },
    async awaitTerminalState(requestId) {
      return client.awaitTerminalState(requestId);
    },
    acceptWebhookDeliveries(captured) {
      let accepted = 0;
      const rejectionReasons: string[] = [];
      for (const one of captured) {
        const verdict = client.receiveWebhook(one);
        if (verdict.outcome === 'accepted') {
          accepted += 1;
        } else {
          rejectionReasons.push(verdict.reason);
        }
      }
      return { accepted, rejectionReasons: Object.freeze(rejectionReasons) };
    },
    rejectRedelivery(captured) {
      const verdict = client.receiveWebhook(captured);
      if (verdict.outcome === 'accepted') {
        throw new Error('the generic client accepted a redelivered event id (dedupe broken)');
      }
      return verdict.reason;
    },
    observedEventTypes() {
      return client.observedEvents().map((event) => event.eventType);
    },
    async mcpTools() {
      return client.mcpTools();
    },
    async mcpStatusView(requestId) {
      const view = await client.mcpGetEscalationStatus(requestId);
      return {
        state: view.state,
        validationStatus: view.validationStatus,
        resultKind: view.result?.kind ?? null,
      };
    },
    applyTerminalResult(record) {
      const applied = client.applyResult(record, () => {
        // The generic client resumes its authoritative workflow (the
        // applied payload is the client's own state; the receipt records
        // the authority marker only).
      });
      return { appliedBy: applied.appliedBy, resultKind: applied.resultKind };
    },
  };
}

/** Sorted-unique strings (receipt normalization). */
function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

// ---------------------------------------------------------------------------
// The Epoch adapter client shim (the adapter surface satisfies the port)
// ---------------------------------------------------------------------------

/**
 * Bind the Epoch adapter client to the neutral public-flow port (a pure
 * shim — the Epoch client's own behavior is untouched).
 */
export function epochClientAsFlowClient(client: EpochAdapterClient): PublicFlowClientPort {
  return {
    clientKind: 'epoch-adapter',
    tenantId: client.tenantId,
    async submit(requestInput) {
      return client.submit(requestInput);
    },
    async pollStatus(requestId) {
      return client.pollStatus(requestId);
    },
    async awaitTerminalState(requestId) {
      return client.awaitTerminalState(requestId);
    },
    acceptWebhookDeliveries(captured) {
      return client.acceptWebhookDeliveries(captured);
    },
    rejectRedelivery(captured) {
      return client.rejectRedelivery(captured);
    },
    observedEventTypes() {
      return client.observedEventTypes();
    },
    async mcpTools() {
      return client.mcpTools();
    },
    async mcpStatusView(requestId) {
      return client.mcpStatusView(requestId);
    },
    applyTerminalResult(record) {
      const applied = client.applyTerminalResult(record);
      return { appliedBy: applied.appliedBy, resultKind: applied.resultKind };
    },
  };
}

/** The replay-kind constant re-export (receipt comparability). */
export const PUBLIC_FLOW_REPLAY_KIND = REPLAY_KIND;
