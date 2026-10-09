/**
 * services/webhook-delivery/src/service.ts — the webhook delivery service
 * composition (Work Order P003; issue #155; ADR-P001-08 rule 4).
 *
 * Binds the THREE pieces the ADR names:
 *   1. the DURABLE at-least-once outbox — the frozen
 *      @arena/runtime-host `WebhookOutboxPort` (the P002 durable
 *      components supply the real Postgres implementation at the
 *      composition site — apps/api); dedupe is per EVENT ID (the outbox
 *      rejects duplicate event ids; consumers dedupe on x-arena-event-id)
 *      — NEVER per type (R-032: types legitimately recur across
 *      transitions);
 *   2. the EXISTING delivery contract — adapters/escalation's
 *      WebhookDeliveryAdapter: HMAC-SHA256 over `<timestamp>.<payload>`,
 *      `x-arena-signature: v1=<hex>`, the stable `x-arena-event-id`
 *      consumer key, deterministic exponential backoff retry, and the
 *      EXPLICIT dead-letter state;
 *   3. the REAL HTTP transport (./http-transport — node fetch with a
 *      bounded timeout) plus the reference delivery ledger (./ledger —
 *      process-local, disclosed) and the dedicated drain loop (./loop —
 *      disclosed: the frozen host job-kind registry cannot register
 *      webhook-delivery kinds).
 */

import {
  WebhookDeliveryAdapter,
  DEFAULT_WEBHOOK_BACKOFF,
} from '@arena/escalation-adapters';
import type {
  WebhookBackoffPolicy,
  WebhookDeliveryLedger,
  WebhookDeliverySweepReport,
  WebhookDeliveryAttemptRecord,
  WebhookDeadLetterRecord,
  WebhookHttpTransport,
  WebhookPendingDelivery,
  WebhookSigner,
} from '@arena/escalation-adapters';
import type { RuntimeClock, WebhookOutboxPort } from '@arena/runtime-host';
import { InMemoryWebhookDeliveryLedger } from './ledger.js';
import { createNodeWebhookHttpTransport } from './http-transport.js';
import { WebhookDeliveryLoop } from './loop.js';
import type { WebhookDeliveryLoopOptions } from './loop.js';

// Compile-time pin: the FROZEN host outbox port (the P002 durable
// substrate) satisfies the drain seam below — the real
// DurableWebhookOutbox IS what this service drains.
const _frozenOutboxSatisfiesDrain: WebhookOutboxDrainPort =
  null as unknown as WebhookOutboxPort;
void _frozenOutboxSatisfiesDrain;

/**
 * The durable outbox DRAIN seam — the structural subset of the frozen
 * `@arena/runtime-host` `WebhookOutboxPort` the delivery service needs
 * (`listPending` + `markDelivered`; the append/listAll sides belong to the
 * escalation engine, never to the drain). Satisfied structurally by the
 * frozen port (the compile-time pin above) and by any test outbox.
 */
export interface WebhookOutboxDrainPort {
  /** Pending (undelivered) deliveries in append order. */
  listPending(): Promise<readonly WebhookPendingDelivery[]>;
  /** Mark a delivery delivered (idempotent). */
  markDelivered(eventId: string, at: number): Promise<void>;
}

/** Configuration for `createWebhookDeliveryService` (all infrastructure injected). */
export interface WebhookDeliveryServiceConfig {
  /** The DURABLE at-least-once webhook outbox drain seam (the frozen host port). */
  readonly outbox: WebhookOutboxDrainPort;
  /** The endpoint signed deliveries are POSTed to (host configuration). */
  readonly endpoint: { readonly url: string };
  /** The signing port (host-injected material — never in this package). */
  readonly signer: WebhookSigner;
  /** Injected clock (A015 law — never a wall clock). */
  readonly clock: RuntimeClock;
  /** The HTTP wire transport (default: node fetch with bounded timeout). */
  readonly transport?: WebhookHttpTransport;
  /** The delivery ledger (default: the in-memory reference ledger). */
  readonly ledger?: WebhookDeliveryLedger;
  /** Backoff overrides (deterministic exponential; defaults 5×1s×2). */
  readonly backoff?: Partial<WebhookBackoffPolicy>;
}

/** The composed webhook delivery service (the drain surface + audit views). */
export interface WebhookDeliveryService {
  /** The delivery adapter (the existing contract instance). */
  readonly adapter: WebhookDeliveryAdapter;
  /** The delivery ledger (attempt log + dead-letter lot). */
  readonly ledger: WebhookDeliveryLedger;
  /** The endpoint the service delivers to. */
  readonly endpoint: { readonly url: string };
  /** The signing port in use (identifier echoes in delivery headers). */
  readonly signer: WebhookSigner;
  /** The effective backoff policy. */
  readonly backoff: Readonly<WebhookBackoffPolicy>;
  /** Drain the durable outbox once (signed, retried, dead-lettered). */
  deliverPending(): Promise<WebhookDeliverySweepReport>;
  /** The dead-letter lot (operator surface). */
  deadLetters(): Promise<readonly WebhookDeadLetterRecord[]>;
  /** The recorded attempts for one event id (audit view). */
  attemptsFor(eventId: string): Promise<readonly WebhookDeliveryAttemptRecord[]>;
  /** Create a dedicated drain loop over this service (see ./loop.ts). */
  createLoop(options?: WebhookDeliveryLoopOptions): WebhookDeliveryLoop;
}

/** Compose the webhook delivery service over the injected pieces. */
export function createWebhookDeliveryService(
  config: WebhookDeliveryServiceConfig,
): WebhookDeliveryService {
  const transport = config.transport ?? createNodeWebhookHttpTransport();
  const ledger = config.ledger ?? new InMemoryWebhookDeliveryLedger();
  const adapter = new WebhookDeliveryAdapter({
    source: {
      // The durable outbox already lists only pending (undelivered)
      // deliveries in append order; markDelivered is idempotent.
      listPending: () => config.outbox.listPending(),
      markDelivered: (eventId, at) => config.outbox.markDelivered(eventId, at),
    },
    endpoint: config.endpoint,
    signer: config.signer,
    transport,
    clock: config.clock,
    ledger,
    ...(config.backoff !== undefined ? { backoff: config.backoff } : {}),
  });
  return {
    adapter,
    ledger,
    endpoint: config.endpoint,
    signer: config.signer,
    backoff: adapter.backoff ?? DEFAULT_WEBHOOK_BACKOFF,
    deliverPending: () => adapter.deliverPending(),
    deadLetters: () => ledger.listDeadLetters(),
    attemptsFor: (eventId) => ledger.attemptsFor(eventId),
    createLoop: (options) =>
      new WebhookDeliveryLoop(() => adapter.deliverPending(), {
        clock: config.clock,
        ...options,
      }),
  };
}
