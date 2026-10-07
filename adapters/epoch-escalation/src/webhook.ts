/**
 * Signed escalation-webhook consumption for the Epoch side (Work Order
 * C019; ES1.0 "webhook/event delivery").
 *
 * The delivery wire scheme is the C001 escalation webhook scheme:
 *   - HMAC-SHA256 over `<timestamp>.<payload>`, header
 *     `x-arena-signature: v1=<hex>`;
 *   - the event id header IS the webhook eventId — the idempotent
 *     consumer key (at-least-once delivery ⇒ consumer dedupe);
 *   - payloads are `escalation/escalation-webhook-event` envelopes.
 *
 * The signing MATERIAL arrives through a PURELY STRUCTURAL port
 * (EpochWebhookSigner) — satisfied at composition time by the host with
 * the same HMAC input bytes Arena signs with (boundary rule B3: an
 * adapter never imports another adapter; adapters/escalation's
 * hmacSha256WebhookSigner satisfies this interface structurally, as do
 * third-party consumers). No signing material ever lives in this
 * package.
 *
 * Every outcome is a machine-readable verdict (never a bare boolean):
 * verified + parsed + deduped, or a closed-vocabulary rejection.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  parseEscalationWebhookEventEnvelope,
} from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';
import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError } from './errors.js';

/** Wire header names (mirror of the C001 delivery scheme; provider-neutral). */
export const EPOCH_WEBHOOK_HEADER_NAMES = Object.freeze({
  eventId: 'x-arena-event-id',
  timestamp: 'x-arena-webhook-timestamp',
  signature: 'x-arena-signature',
  signingKeyId: 'x-arena-signing-key-id',
  attempt: 'x-arena-delivery-attempt',
  requestId: 'x-arena-request-id',
  tenantId: 'x-arena-tenant-id',
  sequence: 'x-arena-sequence',
} as const);

/** The signature scheme version prefix. */
export const EPOCH_WEBHOOK_SIGNATURE_VERSION = 'v1' as const;

/** Default replay-tolerance window for the timestamp check. */
export const EPOCH_WEBHOOK_DEFAULT_TOLERANCE_MS = 300_000;

/**
 * STRUCTURAL signing-material port (satisfied by the host — e.g. the
 * C001 adapters/escalation reference signer — without any
 * adapter-to-adapter import).
 */
export interface EpochWebhookSigner {
  readonly signingKeyId: string;
  /** Hex HMAC-SHA256 digest over `<timestamp>.<payload>`. */
  sign(timestamp: number, payload: string): string;
}

/** Deterministic HMAC-SHA256 signer over host-supplied input bytes. */
export function hmacEpochWebhookSigner(config: {
  readonly signingKeyId: string;
  readonly hmacInput: string;
}): EpochWebhookSigner {
  const { signingKeyId, hmacInput } = config;
  return {
    signingKeyId,
    sign(timestamp: number, payload: string): string {
      return createHmac('sha256', hmacInput).update(`${timestamp}.${payload}`).digest('hex');
    },
  };
}

/** One received webhook (headers + raw body, exactly as delivered). */
export interface ReceivedEpochWebhook {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export const EPOCH_WEBHOOK_REJECTION_REASONS = Object.freeze([
  'missing-event-id-header',
  'missing-timestamp-header',
  'missing-signature-header',
  'malformed-signature-header',
  'timestamp-mismatch',
  'signature-mismatch',
  'signing-key-mismatch',
  'invalid-event-envelope',
  'tenant-mismatch',
  'duplicate-event',
] as const);
export type EpochWebhookRejectionReason = (typeof EPOCH_WEBHOOK_REJECTION_REASONS)[number];

/** Machine-readable consumption verdict (never a bare boolean). */
export type EpochWebhookConsumption =
  | {
      readonly outcome: 'consumed';
      readonly event: EscalationWebhookEvent;
      readonly eventId: string;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: EpochWebhookRejectionReason;
      readonly eventId: string | null;
    };

function header(headers: Readonly<Record<string, string>>, name: string): string | null {
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  // HTTP headers arrive case-insensitively on real wires.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

/**
 * Verify the signature header (constant-time digest comparison; the
 * timestamp freshness check uses the INJECTED `now`, never a wall clock).
 */
export function verifyEpochWebhookSignature(input: {
  readonly signer: EpochWebhookSigner;
  readonly timestamp: number;
  readonly payload: string;
  readonly signatureHeader: string;
  readonly now: number;
  readonly toleranceMs?: number;
}): EpochWebhookRejectionReason | null {
  const prefix = `${EPOCH_WEBHOOK_SIGNATURE_VERSION}=`;
  if (
    typeof input.signatureHeader !== 'string' ||
    !input.signatureHeader.startsWith(prefix) ||
    input.signatureHeader.length <= prefix.length
  ) {
    return 'malformed-signature-header';
  }
  const claimed = input.signatureHeader.slice(prefix.length);
  const expected = input.signer.sign(input.timestamp, input.payload);
  const a = Buffer.from(claimed, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return 'signature-mismatch';
  }
  const tolerance = input.toleranceMs ?? EPOCH_WEBHOOK_DEFAULT_TOLERANCE_MS;
  if (tolerance > 0 && Math.abs(input.now - input.timestamp) > tolerance) {
    return 'timestamp-mismatch';
  }
  return null;
}

/**
 * Consume one received webhook: verify the signature, parse the strict
 * event envelope, check the tenant against the declared posture tenant,
 * and dedupe on the event id (at-least-once delivery ⇒ idempotent
 * consumption). The `seenEventIds` set is host-owned state.
 */
export function consumeEpochWebhook(input: {
  readonly received: ReceivedEpochWebhook;
  readonly signer: EpochWebhookSigner;
  readonly expectedTenantId: string;
  readonly now: number;
  readonly seenEventIds: ReadonlySet<string>;
  readonly toleranceMs?: number;
}): EpochWebhookConsumption {
  const { received, signer, expectedTenantId, now, seenEventIds } = input;
  const eventId = header(received.headers, EPOCH_WEBHOOK_HEADER_NAMES.eventId);
  if (eventId === null || eventId.length === 0) {
    return { outcome: 'rejected', reason: 'missing-event-id-header', eventId: null };
  }
  const timestampHeader = header(received.headers, EPOCH_WEBHOOK_HEADER_NAMES.timestamp);
  if (timestampHeader === null) {
    return { outcome: 'rejected', reason: 'missing-timestamp-header', eventId };
  }
  const signatureHeader = header(received.headers, EPOCH_WEBHOOK_HEADER_NAMES.signature);
  if (signatureHeader === null) {
    return { outcome: 'rejected', reason: 'missing-signature-header', eventId };
  }
  const signingKeyId = header(received.headers, EPOCH_WEBHOOK_HEADER_NAMES.signingKeyId);
  if (signingKeyId !== null && signingKeyId !== signer.signingKeyId) {
    return { outcome: 'rejected', reason: 'signing-key-mismatch', eventId };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { outcome: 'rejected', reason: 'missing-timestamp-header', eventId };
  }
  const signatureRejection = verifyEpochWebhookSignature({
    signer,
    timestamp,
    payload: received.body,
    signatureHeader,
    now,
    ...(input.toleranceMs !== undefined ? { toleranceMs: input.toleranceMs } : {}),
  });
  if (signatureRejection !== null) {
    return { outcome: 'rejected', reason: signatureRejection, eventId };
  }
  let event: EscalationWebhookEvent;
  try {
    event = parseEscalationWebhookEventEnvelope(received.body).payload;
  } catch {
    return {
      outcome: 'rejected',
      reason: 'invalid-event-envelope',
      eventId,
    };
  }
  if (event.tenantId !== expectedTenantId) {
    return { outcome: 'rejected', reason: 'tenant-mismatch', eventId };
  }
  if (seenEventIds.has(event.eventId)) {
    return { outcome: 'rejected', reason: 'duplicate-event', eventId };
  }
  return { outcome: 'consumed', event, eventId };
}

/**
 * Throwing variant for hosts that prefer typed errors over verdicts
 * (the verdict form above remains the canonical machine-readable one).
 */
export function consumeEpochWebhookOrThrow(
  input: Parameters<typeof consumeEpochWebhook>[0],
): EscalationWebhookEvent {
  const verdict = consumeEpochWebhook(input);
  if (verdict.outcome === 'rejected') {
    const code =
      verdict.reason === 'duplicate-event'
        ? EPOCH_ESCALATION_ERROR_CODES.WEBHOOK_DUPLICATE_EVENT
        : verdict.reason === 'invalid-event-envelope'
          ? EPOCH_ESCALATION_ERROR_CODES.WEBHOOK_EVENT_REJECTED
          : EPOCH_ESCALATION_ERROR_CODES.WEBHOOK_SIGNATURE_REJECTED;
    throw new EpochEscalationError(code, {
      message: `escalation webhook rejected (${verdict.reason})`,
      details: { reason: verdict.reason, eventId: verdict.eventId },
    });
  }
  return verdict.event;
}
