/**
 * PaymentService — the envelope-wired reference service facade for
 * Arena human-expert payments (Work Order C010; issue #77; handoff §8
 * commercial model; mirrors the C001 EscalationApiService pattern:
 * injected ports, fail-closed error normalization, NO network/HTTP
 * layer — adapters own the wire transports).
 *
 * Money surfaces (REST-shaped, envelope-conformant):
 *   - holdBudget            → budget HOLD at escalation creation
 *     (idempotent on the operation key; truth-labelled);
 *   - recordOffer /
 *     recordAcceptance      → the commercial offer/acceptance markers;
 *   - captureBudget         → CAPTURE at ACCEPTED (full budget commit);
 *   - releasePayout         → RELEASE on completion: the deterministic
 *     platform-fee + expert-payout split, executed through the
 *     provider-neutral PaymentProviderPort (caller-supplied splits are
 *     tamper-checked against the schedule), emitting
 *     escalation.payment.updated with the ES1.0 cost fields;
 *   - refund                → REFUND on REVISION_REQUIRED / REJECTED /
 *     cancellation / timeout — explicit state, never a silent reversal;
 *   - openDispute / resolveDispute → the explicit dispute/refund
 *     request surface (decisions are recorded states; money movement
 *     still rides the guarded refund path).
 *
 * Every applied money operation appends exactly ONE
 * escalation.payment.updated event to the durable at-least-once outbox
 * (eventId = the idempotent consumer key; duplicate operations append
 * nothing — they replay the recorded outcome verbatim).
 *
 * The service NEVER judges validation outcomes (the C001 lifecycle
 * snapshot carries recorded facts) and NEVER touches a payment provider
 * type beyond the provider-neutral port (lock rules 16/33).
 */

import { toCorrelationId } from '@arena/protocol-core';
import {
  createEscalationWebhookEvent,
  makeEscalationWebhookEventEnvelope,
} from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';
import type { CorrelationId as EscalationCorrelationId } from '@arena/protocol-core';
import type { EscalationId, TenantId as EscalationTenantId } from '@arena/escalation';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  PAYMENTS_ERROR_CODES,
  PaymentError,
  applyAcceptanceOperation,
  applyCaptureOperation,
  applyHoldOperation,
  applyOfferOperation,
  applyRefundOperation,
  applyReleaseOperation,
  assertFeeSplit,
  assertTruthLabelLaw,
  availableForRefund,
  committedFunds,
  computeFeeSplit,
  ledgerBalances,
  moneyToNumber,
  openPaymentLedger,
  toMoney,
} from '@arena/payments';
import type {
  BoundLifecycleState,
  CommercialAuditEvent,
  FeeSchedule,
  FeeSplit,
  LedgerOperationPayload,
  LedgerOperationResult,
  Money,
  MoneyTruth,
  PaymentLedger,
  PaymentProviderPort,
  ProviderTransferInstruction,
  ProviderTransferRecord,
  RefundReason,
} from '@arena/payments';
import type {
  Clock,
  EscalationLifecyclePort,
  EscalationLifecycleSnapshot,
  PaymentEventOutbox,
  PaymentLedgerStore,
} from './ports.js';
import { InMemoryPaymentEventOutbox, InMemoryPaymentLedgerStore } from './fabric.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PaymentServiceConfig {
  readonly clock?: Clock;
  readonly store?: PaymentLedgerStore;
  readonly outbox?: PaymentEventOutbox;
  readonly lifecycle?: EscalationLifecyclePort;
  /** The provider-neutral payment seam (adapters/payments owns the DEMO reference). */
  readonly provider?: PaymentProviderPort;
  /** The deterministic fee rule (defaults to the arena-reference schedule). */
  readonly feeSchedule?: FeeSchedule;
}

/** ES1.0 Response commercial fields (cost, Arena fee, expert payout status). */
export interface PaymentCostFields {
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly arenaFeeMinorUnits: number;
  readonly expertPayoutStatus: 'pending' | 'paid';
}

/** The outcome of one money surface call (machine-readable tri-state). */
export interface PaymentOperationOutcome {
  readonly outcome: 'applied' | 'duplicate';
  readonly duplicate: boolean;
  readonly ledger: PaymentLedger;
  readonly entry: LedgerOperationResult['entry'];
  readonly auditEvent: CommercialAuditEvent;
  /** The escalation.payment.updated events appended by this call. */
  readonly emittedEvents: readonly EscalationWebhookEvent[];
  /** The ES1.0 cost-field projection (cost, Arena fee, payout status). */
  readonly costFields: PaymentCostFields;
}

// ---------------------------------------------------------------------------
// Disputes (explicit states — never silent reversals)
// ---------------------------------------------------------------------------

export const DISPUTE_STATES = Object.freeze([
  'open',
  'resolved_refund',
  'resolved_no_refund',
  'withdrawn',
] as const);
export type DisputeState = (typeof DISPUTE_STATES)[number];

export const DISPUTE_REASONS = Object.freeze([
  'quality',
  'validity',
  'timeliness',
  'professional-conduct',
  'billing',
] as const);
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export interface DisputeRecord {
  readonly disputeId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly reason: DisputeReason;
  readonly state: DisputeState;
  readonly openedAt: number;
  readonly resolvedAt: number | null;
  readonly resolutionNote?: string;
}

function newDisputeId(): string {
  return `dis_${crypto.randomUUID().replaceAll('-', '')}`;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export class PaymentService {
  readonly clock: Clock;
  readonly store: PaymentLedgerStore;
  readonly outbox: PaymentEventOutbox;
  readonly lifecycle: EscalationLifecyclePort;
  readonly provider: PaymentProviderPort | undefined;
  readonly feeSchedule: FeeSchedule;
  private readonly disputes = new Map<string, DisputeRecord>();

  constructor(config: PaymentServiceConfig = {}) {
    this.clock = config.clock ?? { now: () => 0 };
    this.store = config.store ?? new InMemoryPaymentLedgerStore();
    this.outbox = config.outbox ?? new InMemoryPaymentEventOutbox();
    this.lifecycle = config.lifecycle ?? { get: async () => undefined };
    this.provider = config.provider;
    this.feeSchedule = config.feeSchedule ?? ARENA_REFERENCE_FEE_SCHEDULE;
  }

  // -------------------------------------------------------------------------
  // Budget HOLD at creation (idempotent)
  // -------------------------------------------------------------------------

  async holdBudget(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly operationKey: string;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const snapshot = await this.requireSnapshot(input.requestId, input.tenantId);
    const budget = toMoney({
      amount: snapshot.budget.amountMinorUnits,
      currency: snapshot.budget.currency,
    });
    if (budget.minorUnits === '0') {
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
        message: `escalation ${input.requestId} declares a zero budget (no monetary cap) — no escrow ledger is opened`,
        details: { requestId: input.requestId },
      });
    }
    const existing = await this.store.findById(input.requestId);
    const truth: MoneyTruth = this.providerTruth();
    const ledger =
      existing ??
      openPaymentLedger({
        requestId: snapshot.requestId,
        tenantId: snapshot.tenantId,
        correlationId: snapshot.correlationId,
        currency: snapshot.budget.currency,
        truth,
        now: this.clock.now(),
      });
    if (existing !== undefined && existing.tenantId !== input.tenantId) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `ledger ${input.requestId} belongs to tenant ${existing.tenantId}; tenant ${input.tenantId} may not touch it`,
        details: { requestId: input.requestId, ledgerTenant: existing.tenantId },
      });
    }
    const result = await applyHoldOperation(ledger, {
      amount: budget,
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  // -------------------------------------------------------------------------
  // Commercial offer / acceptance markers
  // -------------------------------------------------------------------------

  async recordOffer(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly operationKey: string;
    /** Defaults to the full held budget. */
    readonly amountMinorUnits?: number;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const { ledger, snapshot } = await this.requireLedger(input.requestId, input.tenantId);
    const held = ledgerBalances(ledger).escrow;
    const amount = toMoney({
      amount: input.amountMinorUnits ?? held,
      currency: ledger.currency,
    });
    const result = await applyOfferOperation(ledger, {
      amount,
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  async recordAcceptance(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly operationKey: string;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const { ledger, snapshot } = await this.requireLedger(input.requestId, input.tenantId);
    const result = await applyAcceptanceOperation(ledger, {
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  // -------------------------------------------------------------------------
  // CAPTURE at ACCEPTED (full budget commit)
  // -------------------------------------------------------------------------

  async captureBudget(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly operationKey: string;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const { ledger, snapshot } = await this.requireLedger(input.requestId, input.tenantId);
    // Duplicate capture instruction: replay the recorded outcome (the
    // derived amount is post-state-unstable after the first application).
    const duplicate = await this.replayDerivedDuplicate(ledger, snapshot, input);
    if (duplicate !== undefined) return duplicate;
    const result = await applyCaptureOperation(ledger, {
      amount: toMoney({ amount: ledgerBalances(ledger).escrow, currency: ledger.currency }),
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  // -------------------------------------------------------------------------
  // RELEASE on completion — the fee-split payout
  // -------------------------------------------------------------------------

  async releasePayout(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly operationKey: string;
    /** Optional CALLER-DECLARED split — recomputed and tamper-checked. */
    readonly declaredSplit?: FeeSplit;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const { ledger, snapshot } = await this.requireLedger(input.requestId, input.tenantId);
    // Duplicate payout instruction (same operation key): replay the
    // recorded outcome — the provider legs already executed under their
    // idempotent instruction keys, and nothing new is recorded or emitted.
    const duplicate = await this.replayDerivedDuplicate(ledger, snapshot, input, (payload) => {
      if (payload.kind !== 'release') return true;
      if (input.declaredSplit === undefined) return false;
      // The duplicate's declared split must still BE the recorded
      // deterministic computation (structural conflict otherwise).
      return (
        payload.split.scheduleId !== input.declaredSplit.scheduleId ||
        payload.split.scheduleVersion !== input.declaredSplit.scheduleVersion ||
        payload.split.currency !== input.declaredSplit.currency ||
        payload.split.grossMinorUnits !== input.declaredSplit.grossMinorUnits ||
        payload.split.platformFeeMinorUnits !== input.declaredSplit.platformFeeMinorUnits ||
        payload.split.expertPayoutMinorUnits !== input.declaredSplit.expertPayoutMinorUnits
      );
    });
    if (duplicate !== undefined) return duplicate;
    const gross = toMoney({ amount: committedFunds(ledger), currency: ledger.currency });
    const split = computeFeeSplit(this.feeSchedule, gross);
    if (input.declaredSplit !== undefined) {
      // Fee-split tampering guard: the declared split must BE the
      // deterministic computation (typed refusal otherwise).
      assertFeeSplit(this.feeSchedule, gross, input.declaredSplit);
    }

    // Provider execution happens BEFORE the ledger append: a provider
    // failure leaves the ledger untouched (no half-settled money).
    const providerTransferIds: string[] = [];
    const provider = this.provider;
    if (provider !== undefined) {
      assertTruthLabelLaw(ledger.truth, provider.truth);
      const legs: readonly { destination: 'platform' | 'expert'; minorUnits: string }[] = [
        { destination: 'platform', minorUnits: split.platformFeeMinorUnits },
        { destination: 'expert', minorUnits: split.expertPayoutMinorUnits },
      ];
      for (const leg of legs) {
        if (leg.minorUnits === '0') continue;
        const instruction: ProviderTransferInstruction = {
          instructionKey: `${input.operationKey}:${leg.destination}`,
          requestId: ledger.requestId,
          tenantId: ledger.tenantId,
          amount: toMoney({ amount: leg.minorUnits, currency: ledger.currency }),
          destination: leg.destination,
          truth: ledger.truth,
          correlationId: ledger.correlationId,
        };
        const record = await this.executeProviderTransfer(provider, instruction);
        providerTransferIds.push(record.providerTransferId);
      }
    }

    const result = await applyReleaseOperation(ledger, {
      schedule: this.feeSchedule,
      split,
      providerTransferIds,
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  // -------------------------------------------------------------------------
  // REFUND — explicit states, never silent reversals
  // -------------------------------------------------------------------------

  async refund(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly reason: RefundReason;
    readonly operationKey: string;
    /** Defaults to the full refundable amount (held + committed). */
    readonly amountMinorUnits?: number;
    readonly actor?: string;
  }): Promise<PaymentOperationOutcome> {
    const { ledger, snapshot } = await this.requireLedger(input.requestId, input.tenantId);
    // Duplicate refund instruction: replay the recorded outcome; a
    // same-key body that differs (reason / explicit amount) is a typed
    // idempotency conflict, never a silent rebind (the fresh path's
    // domain check produces it).
    const duplicate = await this.replayDerivedDuplicate(ledger, snapshot, input, (payload) => {
      if (payload.kind !== 'refund') return true;
      if (payload.reason !== input.reason) return true;
      if (input.amountMinorUnits === undefined) return false;
      return payload.amountMinorUnits !== toMoney({ amount: input.amountMinorUnits, currency: ledger.currency }).minorUnits;
    });
    if (duplicate !== undefined) return duplicate;
    const available = availableForRefund(ledger);
    const amount: Money = toMoney({
      amount: input.amountMinorUnits ?? available,
      currency: ledger.currency,
    });
    const result = await applyRefundOperation(ledger, {
      amount,
      reason: input.reason,
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
    });
    return this.persistAndEmit(result, input.tenantId);
  }

  // -------------------------------------------------------------------------
  // Dispute/refund request surface (explicit states)
  // -------------------------------------------------------------------------

  async openDispute(input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly reason: DisputeReason;
  }): Promise<DisputeRecord> {
    const { ledger } = await this.requireLedger(input.requestId, input.tenantId);
    if (!(DISPUTE_REASONS as readonly string[]).includes(input.reason)) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
        message: `dispute reason is not in the closed vocabulary: ${JSON.stringify(input.reason)}`,
        details: { disputeReasons: DISPUTE_REASONS },
      });
    }
    const dispute: DisputeRecord = Object.freeze({
      disputeId: newDisputeId(),
      requestId: ledger.requestId,
      tenantId: ledger.tenantId,
      reason: input.reason,
      state: 'open',
      openedAt: this.clock.now(),
      resolvedAt: null,
    });
    this.disputes.set(dispute.disputeId, dispute);
    return dispute;
  }

  /**
   * Resolve an open dispute. `resolved_refund` triggers the GUARDED
   * refund path (dispute_resolved reason): if the money state does not
   * permit a refund (e.g. the ledger is already released/terminal, or
   * the lifecycle state does not allow refunds), the resolution FAILS
   * CLOSED with the typed denial and the dispute stays open — a
   * dispute decision is never a silent reversal.
   */
  async resolveDispute(input: {
    readonly disputeId: string;
    readonly tenantId: string;
    readonly resolution: 'refund' | 'no_refund' | 'withdraw';
    readonly operationKey: string;
    readonly note?: string;
    readonly actor?: string;
  }): Promise<{ dispute: DisputeRecord; refund?: PaymentOperationOutcome }> {
    const dispute = this.disputes.get(input.disputeId);
    if (dispute === undefined || dispute.tenantId !== input.tenantId) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
        message: `dispute ${input.disputeId} not found for tenant ${input.tenantId}`,
        details: { disputeId: input.disputeId, tenantId: input.tenantId },
      });
    }
    if (dispute.state !== 'open') {
      throw new PaymentError(PAYMENTS_ERROR_CODES.TERMINAL_STATE, {
        message: `dispute ${input.disputeId} is already ${dispute.state} — disputes resolve once`,
        details: { disputeId: input.disputeId, state: dispute.state },
      });
    }
    if (input.resolution === 'refund') {
      const refundOutcome = await this.refund({
        requestId: dispute.requestId,
        tenantId: dispute.tenantId,
        reason: 'dispute_resolved',
        operationKey: input.operationKey,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
      });
      const resolved = Object.freeze({
        ...dispute,
        state: 'resolved_refund' as const,
        resolvedAt: this.clock.now(),
        ...(input.note !== undefined ? { resolutionNote: input.note } : {}),
      });
      this.disputes.set(input.disputeId, resolved);
      return { dispute: resolved, refund: refundOutcome };
    }
    if (input.resolution === 'no_refund') {
      const resolved = Object.freeze({
        ...dispute,
        state: 'resolved_no_refund' as const,
        resolvedAt: this.clock.now(),
        ...(input.note !== undefined ? { resolutionNote: input.note } : {}),
      });
      this.disputes.set(input.disputeId, resolved);
      return { dispute: resolved };
    }
    const withdrawn = Object.freeze({
      ...dispute,
      state: 'withdrawn' as const,
      resolvedAt: this.clock.now(),
    });
    this.disputes.set(input.disputeId, withdrawn);
    return { dispute: withdrawn };
  }

  /** The dispute log for one escalation (tenant-scoped audit surface). */
  listDisputes(requestId: string, tenantId: string): readonly DisputeRecord[] {
    return [...this.disputes.values()].filter(
      (dispute) => dispute.requestId === requestId && dispute.tenantId === tenantId,
    );
  }

  // -------------------------------------------------------------------------
  // Reads (tenant-scoped, idempotent)
  // -------------------------------------------------------------------------

  async getLedger(requestId: string, tenantId: string): Promise<PaymentLedger> {
    const { ledger } = await this.requireLedger(requestId, tenantId);
    return ledger;
  }

  async listAuditEvents(requestId: string, tenantId: string): Promise<readonly CommercialAuditEvent[]> {
    const { ledger } = await this.requireLedger(requestId, tenantId);
    return ledger.auditEvents;
  }

  /** The ES1.0 cost-field projection for an escalation. */
  costFields(ledger: PaymentLedger): PaymentCostFields {
    const balances = ledgerBalances(ledger);
    return {
      amountMinorUnits: moneyToNumber(toMoney({ amount: balances['customer-source'], currency: ledger.currency })),
      currency: ledger.currency,
      arenaFeeMinorUnits: moneyToNumber(toMoney({ amount: balances['platform-fee'], currency: ledger.currency })),
      expertPayoutStatus: ledger.state === 'released' ? 'paid' : 'pending',
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Service-level duplicate replay for the amount-DERIVING operations
   * (capture / release / refund): their bodies are derived from the
   * CURRENT ledger state, which the first application has already moved
   * — so a same-key duplicate is replayed from the RECORDED entry (the
   * domain idempotency index verifies the payload digest and returns
   * the recorded outcome verbatim; no provider legs re-execute, no
   * event is emitted). Hold / offer / acceptance derive stable bodies
   * and replay through the natural path. A caller-body that CONFLICTS
   * (validator returns true) falls through to the fresh path, where the
   * domain throws the typed IDENTITY_CONFLICT.
   */
  private async replayDerivedDuplicate(
    ledger: PaymentLedger,
    snapshot: EscalationLifecycleSnapshot,
    input: { readonly operationKey: string; readonly tenantId: string },
    callerBodyConflicts?: (payload: LedgerOperationPayload) => boolean,
  ): Promise<PaymentOperationOutcome | undefined> {
    const recorded = ledger.operations.find((operation) => operation.operationKey === input.operationKey);
    if (recorded === undefined) return undefined;
    const entry = ledger.entries[recorded.sequence - 1];
    if (entry === undefined) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.TAMPERED, {
        message: `ledger ${ledger.requestId} idempotency index references a missing entry — integrity failure`,
        details: { requestId: ledger.requestId, operationKey: input.operationKey, sequence: recorded.sequence },
      });
    }
    const payload = entry.payload;
    if (
      (payload.kind !== 'capture' && payload.kind !== 'release' && payload.kind !== 'refund') ||
      callerBodyConflicts?.(payload) === true
    ) {
      return undefined;
    }
    const base = {
      operationKey: input.operationKey,
      lifecycleState: this.boundState(snapshot.state),
      now: this.clock.now(),
    } as const;
    if (payload.kind === 'capture') {
      return this.persistAndEmit(
        await applyCaptureOperation(ledger, {
          amount: toMoney({ amount: payload.amountMinorUnits, currency: ledger.currency }),
          ...base,
        }),
        input.tenantId,
      );
    }
    if (payload.kind === 'release') {
      return this.persistAndEmit(
        await applyReleaseOperation(ledger, { schedule: payload.schedule, split: payload.split, ...base }),
        input.tenantId,
      );
    }
    return this.persistAndEmit(
      await applyRefundOperation(ledger, {
        amount: toMoney({ amount: payload.amountMinorUnits, currency: ledger.currency }),
        reason: payload.reason,
        ...base,
      }),
      input.tenantId,
    );
  }

  private providerTruth(): MoneyTruth {
    return this.provider?.truth ?? 'demo';
  }

  private boundState(state: string): BoundLifecycleState {
    if (!isBoundLifecycleStateValue(state)) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED, {
        message: `escalation lifecycle state ${JSON.stringify(state)} is not part of the bound C010 commercial-state vocabulary`,
        details: { state },
      });
    }
    return state;
  }

  private async requireSnapshot(requestId: string, tenantId: string): Promise<EscalationLifecycleSnapshot> {
    const snapshot = await this.lifecycle.get(requestId, tenantId);
    if (snapshot === undefined) {
      // Cross-tenant probe: produce the TYPED failure, not a plain miss.
      const ledger = await this.store.findById(requestId);
      if (ledger !== undefined && ledger.tenantId !== tenantId) {
        throw new PaymentError(PAYMENTS_ERROR_CODES.CROSS_TENANT_ACCESS, {
          message: `escalation ${requestId} belongs to tenant ${ledger.tenantId}; tenant ${tenantId} may not touch it`,
          details: { requestId, ledgerTenant: ledger.tenantId },
        });
      }
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
        message: `escalation ${requestId} not found for tenant ${tenantId} — money operations bind to the C001 lifecycle`,
        details: { requestId, tenantId },
      });
    }
    return snapshot;
  }

  private async requireLedger(
    requestId: string,
    tenantId: string,
  ): Promise<{ ledger: PaymentLedger; snapshot: EscalationLifecycleSnapshot }> {
    const snapshot = await this.requireSnapshot(requestId, tenantId);
    const ledger = await this.store.get(requestId, tenantId);
    if (ledger === undefined) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
        message: `no escrow ledger opened for escalation ${requestId} (hold the budget first)`,
        details: { requestId, tenantId },
      });
    }
    return { ledger, snapshot };
  }

  private async executeProviderTransfer(
    provider: PaymentProviderPort,
    instruction: ProviderTransferInstruction,
  ): Promise<ProviderTransferRecord> {
    assertTruthLabelLaw(instruction.truth, provider.truth, instruction.truth);
    const record = await provider.transfer(instruction);
    if (record.status !== 'succeeded') {
      throw new PaymentError(PAYMENTS_ERROR_CODES.PROVIDER_FAILURE, {
        message: `provider ${record.providerId} failed the ${instruction.destination} transfer for escalation ${instruction.requestId}: ${record.failureReason ?? 'unknown failure'}`,
        details: { requestId: instruction.requestId, destination: instruction.destination },
      });
    }
    return record;
  }

  private async persistAndEmit(
    result: LedgerOperationResult,
    _tenantId: string,
  ): Promise<PaymentOperationOutcome> {
    if (result.outcome === 'applied') {
      const isNew = (await this.store.findById(result.ledger.requestId)) === undefined;
      if (isNew) {
        await this.store.insert(result.ledger);
      } else {
        await this.store.update(result.ledger);
      }
    }
    const emittedEvents: EscalationWebhookEvent[] = [];
    if (result.outcome === 'applied') {
      emittedEvents.push(await this.emitPaymentUpdated(result.ledger));
    }
    return {
      outcome: result.outcome,
      duplicate: result.duplicate,
      ledger: result.ledger,
      entry: result.entry,
      auditEvent: result.auditEvent,
      emittedEvents,
      costFields: this.costFields(result.ledger),
    };
  }

  private async emitPaymentUpdated(ledger: PaymentLedger): Promise<EscalationWebhookEvent> {
    const event = createEscalationWebhookEvent({
      eventType: 'escalation.payment.updated',
      request: {
        // The C001 event factory's branded pick — the ledger's plain
        // string ids are structurally identical (same patterns).
        requestId: ledger.requestId as unknown as EscalationId,
        tenantId: ledger.tenantId as unknown as EscalationTenantId,
        correlationId: ledger.correlationId as unknown as EscalationCorrelationId,
      },
      sequence: ledger.entries.length,
      now: ledger.updatedAt,
      state: null,
      data: {
        ledgerState: ledger.state,
        truth: ledger.truth,
        cost: this.costFields(ledger),
        balances: ledgerBalances(ledger),
      },
    });
    const envelope = makeEscalationWebhookEventEnvelope(
      event,
      toCorrelationId(ledger.correlationId),
    );
    await this.outbox.append(event, envelope);
    return event;
  }
}

function isBoundLifecycleStateValue(value: string): value is BoundLifecycleState {
  return (
    value === 'created' ||
    value === 'triaged' ||
    value === 'matching' ||
    value === 'offered' ||
    value === 'accepted' ||
    value === 'session_ready' ||
    value === 'in_progress' ||
    value === 'submitted' ||
    value === 'validating' ||
    value === 'result_accepted' ||
    value === 'revision_required' ||
    value === 'result_rejected' ||
    value === 'paid' ||
    value === 'learning_captured' ||
    value === 'expert_replaced' ||
    value === 'closed' ||
    value === 'cancelled' ||
    value === 'timed_out'
  );
}
