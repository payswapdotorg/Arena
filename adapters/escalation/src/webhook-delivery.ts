/**
 * Signed webhook delivery adapter (Work Order C001; ES1.0 "webhook/event
 * delivery"; architecture-lock rule 10 — adapters never enter domain
 * packages, boundary rule B4 — adapters never import services).
 *
 * Drains the durable at-least-once webhook outbox maintained by
 * services/escalation-api through a PURELY STRUCTURAL source port (the
 * host composition root wires the real outbox instance; the shapes below
 * are satisfied by the service's WebhookOutbox/InMemoryWebhookOutbox
 * without any workspace import — asserted at compile time by
 * services/escalation-api/src/wiring.test.ts).
 *
 * Delivery semantics (ES1.0):
 *   - payloads are SIGNED (HMAC-SHA256 over `<timestamp>.<payload>`);
 *   - delivery is at-least-once: the consumer dedupes on the event id
 *     header, which IS the webhook eventId (the idempotent consumer key
 *     produced by the domain event taxonomy);
 *   - failed deliveries RETRY with deterministic exponential backoff
 *     derived from the injected clock (never a wall clock);
 *   - after `maxAttempts` the delivery moves to the EXPLICIT dead-letter
 *     state (auditable, never silently dropped, never crashes a sweep);
 *   - every outcome is machine-readable (house verdict style — never a
 *     bare boolean).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** One pending webhook delivery in the outbox (structural mirror). */
export interface WebhookPendingDelivery {
  /** The idempotent consumer key — the escalation webhook eventId. */
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  /** The serialized event envelope (canonical JSON wire form). */
  readonly payload: string;
  readonly createdAt: number;
}

/**
 * The outbox the adapter drains (structural port — satisfied by
 * services/escalation-api's WebhookOutbox without importing it).
 */
export interface WebhookOutboxSource {
  /** Pending (undelivered) deliveries in append order. */
  listPending(): Promise<readonly WebhookPendingDelivery[]>;
  /** Mark a delivery delivered (idempotent). */
  markDelivered(eventId: string, at: number): Promise<void>;
}

/** The HTTP wire the adapter POSTs signed payloads over (injected). */
export interface WebhookHttpTransport {
  /**
   * POST one signed payload. 2xx → ok; anything else (non-2xx status or a
   * thrown transport error) is a FAILED attempt — the adapter never
   * crashes on transport failures.
   */
  post(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
  ): Promise<{ readonly ok: boolean; readonly status: number }>;
}

/**
 * Signing port. The signing MATERIAL (the HMAC input bytes) is supplied
 * by the host at composition time and never lives in this package
 * (provider neutrality: no host signing material is committed or encoded
 * into adapter contracts).
 */
export interface WebhookSigner {
  /** Identifier of the signing material used (echoed in delivery headers). */
  readonly signingKeyId: string;
  /** Hex HMAC-SHA256 digest over `<timestamp>.<payload>`. */
  sign(timestamp: number, payload: string): string;
}

/** Deterministic reference signer: HMAC-SHA256 with host-injected bytes. */
export function hmacSha256WebhookSigner(config: {
  readonly signingKeyId: string;
  readonly hmacInput: string;
}): WebhookSigner {
  const { signingKeyId, hmacInput } = config;
  return {
    signingKeyId,
    sign(timestamp: number, payload: string): string {
      return createHmac('sha256', hmacInput).update(`${timestamp}.${payload}`).digest('hex');
    },
  };
}

/** Wire header names (provider-neutral, lowercase). */
export const WEBHOOK_HEADER_NAMES = Object.freeze({
  eventId: 'x-arena-event-id',
  timestamp: 'x-arena-webhook-timestamp',
  signature: 'x-arena-signature',
  signingKeyId: 'x-arena-signing-key-id',
  attempt: 'x-arena-delivery-attempt',
  requestId: 'x-arena-request-id',
  tenantId: 'x-arena-tenant-id',
  sequence: 'x-arena-sequence',
} as const);

/** The signature scheme version prefix (`v1=<hex digest>`). */
export const WEBHOOK_SIGNATURE_VERSION = 'v1' as const;

/** Deterministic exponential backoff policy. */
export interface WebhookBackoffPolicy {
  /** Total delivery attempts per event before dead-lettering. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly multiplier: number;
}

export const DEFAULT_WEBHOOK_BACKOFF: Readonly<WebhookBackoffPolicy> = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1_000,
  multiplier: 2,
});

/** One recorded delivery attempt (append-only audit trail). */
export interface WebhookDeliveryAttemptRecord {
  readonly eventId: string;
  readonly attempt: number;
  readonly attemptedAt: number;
  readonly outcome: 'delivered' | 'failed';
  readonly httpStatus: number | null;
  /** When the next attempt is scheduled (deterministic backoff); null if none. */
  readonly scheduledRetryAt: number | null;
}

/** The EXPLICIT dead-letter state an exhausted delivery moves to. */
export interface WebhookDeadLetterRecord {
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly url: string;
  readonly attempts: number;
  readonly lastHttpStatus: number | null;
  readonly deadLetteredAt: number;
}

/** Durable delivery ledger port (attempt log + dead-letter state). */
export interface WebhookDeliveryLedger {
  recordAttempt(attempt: WebhookDeliveryAttemptRecord): Promise<void>;
  recordDeadLetter(record: WebhookDeadLetterRecord): Promise<void>;
  listDeadLetters(): Promise<readonly WebhookDeadLetterRecord[]>;
  attemptsFor(eventId: string): Promise<readonly WebhookDeliveryAttemptRecord[]>;
}

/** The webhook endpoint the adapter delivers to. */
export interface WebhookEndpointConfig {
  readonly url: string;
}

/** Machine-readable result of one full outbox drain. */
export interface WebhookDeliverySweepReport {
  readonly outcome: 'swept';
  readonly pendingConsidered: number;
  readonly deliveredCount: number;
  readonly deadLetteredCount: number;
  readonly skippedCount: number;
  readonly attempts: readonly WebhookDeliveryAttemptRecord[];
}

export interface WebhookDeliveryAdapterConfig {
  /** The durable outbox this adapter drains (structural port). */
  readonly source: WebhookOutboxSource;
  readonly endpoint: WebhookEndpointConfig;
  readonly signer: WebhookSigner;
  readonly transport: WebhookHttpTransport;
  readonly clock: Clock;
  readonly ledger: WebhookDeliveryLedger;
  readonly backoff?: Partial<WebhookBackoffPolicy>;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The signed webhook delivery adapter. One instance per endpoint; hosts
 * run `deliverPending()` on their drain schedule (cron/worker/loop — a
 * host concern, never an adapter-owned thread).
 */
export class WebhookDeliveryAdapter {
  readonly source: WebhookOutboxSource;
  readonly endpoint: WebhookEndpointConfig;
  readonly signer: WebhookSigner;
  readonly transport: WebhookHttpTransport;
  readonly clock: Clock;
  readonly ledger: WebhookDeliveryLedger;
  readonly backoff: Readonly<WebhookBackoffPolicy>;

  constructor(config: WebhookDeliveryAdapterConfig) {
    if (typeof config.source?.listPending !== 'function') {
      throw new Error('WebhookDeliveryAdapter requires an outbox source');
    }
    if (typeof config.endpoint?.url !== 'string' || config.endpoint.url.length === 0) {
      throw new Error('WebhookDeliveryAdapter requires an endpoint url');
    }
    if (typeof config.signer?.sign !== 'function' || typeof config.signer.signingKeyId !== 'string') {
      throw new Error('WebhookDeliveryAdapter requires a signer');
    }
    if (typeof config.transport?.post !== 'function') {
      throw new Error('WebhookDeliveryAdapter requires an HTTP transport');
    }
    if (typeof config.clock?.now !== 'function') {
      throw new Error('WebhookDeliveryAdapter requires an injected clock');
    }
    if (typeof config.ledger?.recordAttempt !== 'function') {
      throw new Error('WebhookDeliveryAdapter requires a delivery ledger');
    }
    this.source = config.source;
    this.endpoint = config.endpoint;
    this.signer = config.signer;
    this.transport = config.transport;
    this.clock = config.clock;
    this.ledger = config.ledger;
    this.backoff = Object.freeze({
      maxAttempts: positiveInt(config.backoff?.maxAttempts, DEFAULT_WEBHOOK_BACKOFF.maxAttempts),
      baseDelayMs: nonNegativeNumber(config.backoff?.baseDelayMs, DEFAULT_WEBHOOK_BACKOFF.baseDelayMs),
      multiplier: nonNegativeNumber(config.backoff?.multiplier, DEFAULT_WEBHOOK_BACKOFF.multiplier),
    });
  }

  /** Deterministic backoff delay before attempt `attempt` (1-based). */
  delayForAttempt(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    return Math.round(this.backoff.baseDelayMs * Math.pow(this.backoff.multiplier, exponent));
  }

  /** Signed wire headers for one delivery attempt. */
  headersFor(
    delivery: WebhookPendingDelivery,
    attempt: number,
    timestamp: number,
    signature: string,
  ): Record<string, string> {
    return {
      'content-type': 'application/json',
      [WEBHOOK_HEADER_NAMES.eventId]: delivery.eventId,
      [WEBHOOK_HEADER_NAMES.timestamp]: String(timestamp),
      [WEBHOOK_HEADER_NAMES.signature]: `${WEBHOOK_SIGNATURE_VERSION}=${signature}`,
      [WEBHOOK_HEADER_NAMES.signingKeyId]: this.signer.signingKeyId,
      [WEBHOOK_HEADER_NAMES.attempt]: String(attempt),
      [WEBHOOK_HEADER_NAMES.requestId]: delivery.requestId,
      [WEBHOOK_HEADER_NAMES.tenantId]: delivery.tenantId,
      [WEBHOOK_HEADER_NAMES.sequence]: String(delivery.sequence),
    };
  }

  /**
   * Drain the outbox: every pending delivery is POSTed (signed) with
   * bounded retries on deterministic backoff; exhausted deliveries move
   * to the explicit dead-letter state. Safe to re-run (idempotent).
   */
  async deliverPending(): Promise<WebhookDeliverySweepReport> {
    const pending = await this.source.listPending();
    const deadLetters = new Set((await this.ledger.listDeadLetters()).map((d) => d.eventId));
    const attempts: WebhookDeliveryAttemptRecord[] = [];
    let deliveredCount = 0;
    let deadLetteredCount = 0;
    let skippedCount = 0;

    for (const delivery of pending) {
      if (deadLetters.has(delivery.eventId)) {
        skippedCount += 1;
        continue;
      }
      const prior = await this.ledger.attemptsFor(delivery.eventId);
      let attemptNo = prior.length;
      let delivered = false;
      let lastStatus: number | null = null;

      while (attemptNo < this.backoff.maxAttempts && !delivered) {
        attemptNo += 1;
        const timestamp = this.clock.now();
        const signature = this.signer.sign(timestamp, delivery.payload);
        const headers = this.headersFor(delivery, attemptNo, timestamp, signature);
        let ok = false;
        let status: number | null = null;
        try {
          const result = await this.transport.post(this.endpoint.url, headers, delivery.payload);
          ok = result.ok;
          status = result.status;
        } catch {
          ok = false; // transport failure — one failed attempt, never a crash
        }
        lastStatus = status;
        const scheduledRetryAt =
          !ok && attemptNo < this.backoff.maxAttempts ? timestamp + this.delayForAttempt(attemptNo) : null;
        const record: WebhookDeliveryAttemptRecord = Object.freeze({
          eventId: delivery.eventId,
          attempt: attemptNo,
          attemptedAt: timestamp,
          outcome: ok ? 'delivered' : 'failed',
          httpStatus: status,
          scheduledRetryAt,
        });
        await this.ledger.recordAttempt(record);
        attempts.push(record);
        if (ok) {
          delivered = true;
          await this.source.markDelivered(delivery.eventId, timestamp);
        }
      }

      if (!delivered) {
        // EXPLICIT dead-letter state (never a silent drop).
        await this.ledger.recordDeadLetter(
          Object.freeze({
            eventId: delivery.eventId,
            requestId: delivery.requestId,
            tenantId: delivery.tenantId,
            url: this.endpoint.url,
            attempts: Math.max(attemptNo, prior.length),
            lastHttpStatus: lastStatus,
            deadLetteredAt: this.clock.now(),
          }),
        );
        deadLetteredCount += 1;
      } else {
        deliveredCount += 1;
      }
    }

    return Object.freeze({
      outcome: 'swept' as const,
      pendingConsidered: pending.length,
      deliveredCount,
      deadLetteredCount,
      skippedCount,
      attempts: Object.freeze([...attempts]),
    });
  }
}

/**
 * Consumer-side signature verification (machine-readable verdict — never
 * a bare boolean). Mirrors the adapter's signing scheme so hosts and
 * THIRD-PARTY consumers can verify deliveries.
 */
export type WebhookSignatureVerification =
  | { readonly outcome: 'verified' }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'malformed-signature-header' | 'timestamp-mismatch' | 'signature-mismatch';
    };

export function verifyWebhookSignature(input: {
  readonly signer: WebhookSigner;
  readonly timestamp: number;
  readonly payload: string;
  readonly signatureHeader: string;
  readonly toleranceMs?: number;
  readonly now?: number;
}): WebhookSignatureVerification {
  const prefix = `${WEBHOOK_SIGNATURE_VERSION}=`;
  if (
    typeof input.signatureHeader !== 'string' ||
    !input.signatureHeader.startsWith(prefix) ||
    input.signatureHeader.length <= prefix.length
  ) {
    return { outcome: 'rejected', reason: 'malformed-signature-header' };
  }
  const claimed = input.signatureHeader.slice(prefix.length);
  const expected = input.signer.sign(input.timestamp, input.payload);
  const a = Buffer.from(claimed, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { outcome: 'rejected', reason: 'signature-mismatch' };
  }
  const tolerance = input.toleranceMs ?? 300_000;
  const now = input.now ?? 0;
  if (tolerance > 0 && Math.abs(now - input.timestamp) > tolerance) {
    return { outcome: 'rejected', reason: 'timestamp-mismatch' };
  }
  return { outcome: 'verified' };
}
