/**
 * Payments service ports (Work Order C010) — the ONLY things
 * services/payments depends on besides the domain packages
 * (@arena/payments, @arena/escalation, @arena/job-protocol,
 * @arena/protocol-core).
 *
 * Mirroring services/escalation-api's ports.ts discipline:
 *   - Clock     — time is INJECTED (the service never reads a wall
 *                 clock; architecture-lock rule 17);
 *   - PaymentLedgerStore — persistence port for escrow ledgers
 *                 (tenant-scoped lookups; cross-tenant reads return
 *                 undefined and lifecycle paths produce the typed
 *                 cross-tenant failure);
 *   - EscalationLifecyclePort — THE C001 SEAM. The escalation lifecycle
 *                 (states, PAID transition, budget/currency) is C001's
 *                 owned semantics; this service only consumes a READ
 *                 snapshot. The reference fabric binds real
 *                 @arena/escalation records; hosts wire the live
 *                 escalation-api service (never imported here —
 *                 boundary rule B2);
 *   - PaymentEventOutbox — the durable at-least-once substrate for
 *                 escalation.payment.updated events (the 13-event ES1.0
 *                 vocabulary's payment event), drained by a delivery
 *                 adapter;
 *   - PaymentProviderPort — re-exported from @arena/payments (the
 *                 provider-neutral seam; adapters/payments owns the
 *                 deterministic DEMO implementation).
 *
 * Authority boundary (lock rule 16): this service OWNS money
 * orchestration (ledger + provider + events); it NEVER judges
 * validation outcomes (the lifecycle snapshot carries recorded facts).
 */

import type { EscalationWebhookEvent } from '@arena/escalation';
import type { Envelope } from '@arena/protocol-core';
import type { PaymentLedger } from '@arena/payments';
import type { PaymentProviderPort } from '@arena/payments';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** The C001 lifecycle READ snapshot the money operations bind to. */
export interface EscalationLifecycleSnapshot {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  /** The recorded C001 lifecycle state (facts, not judgements). */
  readonly state: string;
  /** The request's declared budget (minor units + currency, as declared). */
  readonly budget: { readonly amountMinorUnits: number; readonly currency: string };
}

/** THE C001 SEAM — read-only escalation lifecycle access. */
export interface EscalationLifecyclePort {
  /** Tenant-scoped snapshot lookup (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationLifecycleSnapshot | undefined>;
}

/** Persistence port for escrow ledgers (tenant-scoped lookups). */
export interface PaymentLedgerStore {
  /** Persist a NEW ledger; throws on duplicate request id. */
  insert(ledger: PaymentLedger): Promise<void>;
  /** Replace the latest snapshot of an existing ledger (append-only at the entry level). */
  update(ledger: PaymentLedger): Promise<void>;
  /** Tenant-scoped lookup by escalation request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<PaymentLedger | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on write paths. Never exposed on read
   * surfaces.
   */
  findById(requestId: string): Promise<PaymentLedger | undefined>;
  /** All ledgers (scans / audits). */
  list(): Promise<readonly PaymentLedger[]>;
}

/** One durable escalation.payment.updated delivery attempt. */
export interface PaymentEventDeliveryRecord {
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly payload: string;
  readonly createdAt: number;
  readonly deliveredAt: number | null;
}

/** Durable, at-least-once outbox for payment events (drained by an adapter). */
export interface PaymentEventOutbox {
  /** Append one event envelope; throws on duplicate eventId (dedupe). */
  append(event: EscalationWebhookEvent, envelope: Envelope<EscalationWebhookEvent>): Promise<void>;
  /** Pending (undelivered) deliveries in append order. */
  listPending(): Promise<readonly PaymentEventDeliveryRecord[]>;
  /** All deliveries (audit / tests). */
  listAll(): Promise<readonly PaymentEventDeliveryRecord[]>;
  /** Mark a delivery as delivered (idempotent). */
  markDelivered(eventId: string, at: number): Promise<void>;
}

export type { PaymentProviderPort };
