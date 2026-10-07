/**
 * In-memory reference fabric for the payments service (Work Order C010)
 * — the services-layer house pattern (C001/A013/A015/A025): injected
 * ports with an in-process, zero-external-dependency reference
 * implementation. Hosts swap the fabric for real persistence (Neon/R2/
 * Upstash adapters live in adapters/*, never here).
 *
 *   - InMemoryPaymentLedgerStore — tenant-scoped escrow ledger store;
 *   - InMemoryPaymentEventOutbox — durable, at-least-once
 *     escalation.payment.updated delivery records keyed by eventId;
 *   - FixedClock — deterministic injected time;
 *   - EscalationRecordLifecyclePort — the reference C001 binding: real
 *     @arena/escalation records supplied by the host composition root
 *     (the escalation-api service itself is NEVER imported here —
 *     boundary rule B2).
 */

import { serializeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import type { PaymentLedger } from '@arena/payments';
import type {
  EscalationLifecyclePort,
  EscalationLifecycleSnapshot,
  PaymentEventDeliveryRecord,
  PaymentEventOutbox,
  PaymentLedgerStore,
} from './ports.js';

export class InMemoryPaymentLedgerStore implements PaymentLedgerStore {
  private readonly byRequestId = new Map<string, PaymentLedger>();

  async insert(ledger: PaymentLedger): Promise<void> {
    if (this.byRequestId.has(ledger.requestId)) {
      throw new Error(`duplicate escrow ledger request id: ${ledger.requestId}`);
    }
    this.byRequestId.set(ledger.requestId, ledger);
  }

  async update(ledger: PaymentLedger): Promise<void> {
    if (!this.byRequestId.has(ledger.requestId)) {
      throw new Error(`unknown escrow ledger request id: ${ledger.requestId}`);
    }
    this.byRequestId.set(ledger.requestId, ledger);
  }

  async get(requestId: string, tenantId: string): Promise<PaymentLedger | undefined> {
    // TENANT SCOPING: a ledger is only visible to its owning tenant.
    const ledger = this.byRequestId.get(requestId);
    if (ledger === undefined || ledger.tenantId !== tenantId) return undefined;
    return ledger;
  }

  async findById(requestId: string): Promise<PaymentLedger | undefined> {
    return this.byRequestId.get(requestId);
  }

  async list(): Promise<readonly PaymentLedger[]> {
    return [...this.byRequestId.values()];
  }
}

export class InMemoryPaymentEventOutbox implements PaymentEventOutbox {
  private readonly deliveries = new Map<string, PaymentEventDeliveryRecord>();

  async append(event: EscalationWebhookEvent, envelope: Envelope<EscalationWebhookEvent>): Promise<void> {
    if (this.deliveries.has(event.eventId)) {
      throw new Error(`duplicate payment event id: ${event.eventId}`);
    }
    this.deliveries.set(event.eventId, {
      eventId: event.eventId,
      requestId: event.requestId,
      tenantId: event.tenantId,
      sequence: event.sequence,
      payload: serializeEnvelope(envelope),
      createdAt: Date.parse(event.occurredAt),
      deliveredAt: null,
    });
  }

  async listPending(): Promise<readonly PaymentEventDeliveryRecord[]> {
    return [...this.deliveries.values()].filter((entry) => entry.deliveredAt === null);
  }

  async listAll(): Promise<readonly PaymentEventDeliveryRecord[]> {
    return [...this.deliveries.values()];
  }

  async markDelivered(eventId: string, at: number): Promise<void> {
    const entry = this.deliveries.get(eventId);
    if (entry === undefined) return;
    this.deliveries.set(eventId, { ...entry, deliveredAt: at });
  }
}

/** Fixed-clock reference implementation (deterministic tests / replays). */
export class FixedClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
  advanceBy(ms: number): void {
    this.current += ms;
  }
}

/**
 * The reference C001 binding: a tenant-scoped directory of REAL
 * @arena/escalation records (the host composition root keeps them
 * current; the escalation-api service is the production source but is
 * never imported here — B2).
 */
export class EscalationRecordLifecyclePort implements EscalationLifecyclePort {
  constructor(private readonly records: Map<string, EscalationRecord>) {}

  async get(requestId: string, tenantId: string): Promise<EscalationLifecycleSnapshot | undefined> {
    const record = this.records.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return {
      requestId: record.request.requestId,
      tenantId: record.request.tenantId,
      correlationId: record.request.correlationId,
      state: record.state,
      budget: {
        amountMinorUnits: record.request.budget.amountMinorUnits,
        currency: record.request.budget.currency,
      },
    };
  }
}
