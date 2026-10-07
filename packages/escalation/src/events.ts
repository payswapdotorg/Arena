/**
 * Escalation webhook event taxonomy (Work Order C001;
 * spec/expert-escalation-api.md ES1.0 "Webhook events").
 *
 * The CLOSED 13-event minimum vocabulary:
 *
 *   escalation.created · escalation.matched · escalation.accepted ·
 *   escalation.session.ready · escalation.started · escalation.progressed ·
 *   escalation.submitted · escalation.validation.updated ·
 *   escalation.completed · escalation.failed · escalation.cancelled ·
 *   escalation.payment.updated · escalation.learning.updated
 *
 * Delivery semantics owned by the SERVICE layer + adapter (durable,
 * at-least-once, idempotent consumer keys): every event carries a
 * globally-unique `eventId` which IS the idempotent consumer key, plus
 * the escalation's correlation id — consumers dedupe on (eventId) and
 * re-order on (requestId, sequence). Events map 1:1 off the canonical
 * lifecycle (see lifecycleEventForState); the webhook surface is a
 * PROJECTION of the lifecycle, never a second semantic authority.
 */

import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import type { EscalationState } from './lifecycle.js';
import type { EscalationRequest } from './request.js';
import type { EscalationResult } from './results.js';
import type { EventId, EscalationTimestamp, PlainJsonValue, TenantId } from './shared.js';
import { deepFreeze, isEscalationTimestamp, isEventId, isPlainJsonValue, newEventId, toEventId, toEscalationTimestamp } from './shared.js';

/** Wire version of the webhook event payload. */
export const ESCALATION_EVENT_VERSION = 1 as const;

export const ESCALATION_WEBHOOK_EVENT_TYPES = Object.freeze([
  'escalation.created',
  'escalation.matched',
  'escalation.accepted',
  'escalation.session.ready',
  'escalation.started',
  'escalation.progressed',
  'escalation.submitted',
  'escalation.validation.updated',
  'escalation.completed',
  'escalation.failed',
  'escalation.cancelled',
  'escalation.payment.updated',
  'escalation.learning.updated',
] as const);
export type EscalationWebhookEventType =
  (typeof ESCALATION_WEBHOOK_EVENT_TYPES)[number];

export function isEscalationWebhookEventType(value: unknown): value is EscalationWebhookEventType {
  return (
    typeof value === 'string' &&
    (ESCALATION_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/** Terminal webhook event types — nothing follows them on a stream. */
export const ESCALATION_WEBHOOK_TERMINAL_EVENT_TYPES = Object.freeze([
  'escalation.completed',
  'escalation.failed',
  'escalation.cancelled',
] as const);
export type TerminalWebhookEventType =
  (typeof ESCALATION_WEBHOOK_TERMINAL_EVENT_TYPES)[number];

/**
 * Canonical mapping: lifecycle state → webhook event type. The webhook
 * stream is a projection of the append-only lifecycle history — never an
 * independent state authority.
 */
export const STATE_TO_WEBHOOK_EVENT: Readonly<Record<EscalationState, EscalationWebhookEventType | null>> = Object.freeze({
  created: 'escalation.created',
  triaged: 'escalation.progressed',
  matching: 'escalation.progressed',
  offered: 'escalation.matched',
  accepted: 'escalation.accepted',
  session_ready: 'escalation.session.ready',
  in_progress: 'escalation.started',
  submitted: 'escalation.submitted',
  validating: 'escalation.validation.updated',
  result_accepted: 'escalation.validation.updated',
  revision_required: 'escalation.validation.updated',
  result_rejected: 'escalation.failed',
  paid: 'escalation.payment.updated',
  learning_captured: 'escalation.learning.updated',
  expert_replaced: 'escalation.progressed',
  closed: 'escalation.completed',
  cancelled: 'escalation.cancelled',
  timed_out: 'escalation.failed',
});

/** The webhook event type a lifecycle state projects to (null = no event). */
export function lifecycleEventForState(state: EscalationState): EscalationWebhookEventType | null {
  return STATE_TO_WEBHOOK_EVENT[state];
}

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

export interface EscalationWebhookEvent {
  readonly eventVersion: typeof ESCALATION_EVENT_VERSION;
  /** Globally unique — this IS the idempotent consumer key. */
  readonly eventId: EventId;
  readonly eventType: EscalationWebhookEventType;
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  /** Per-escalation webhook sequence (consumers order on this). */
  readonly sequence: number;
  readonly occurredAt: EscalationTimestamp;
  /** The lifecycle state this event projects (nullable for out-of-band updates). */
  readonly state: EscalationState | null;
  /** Structured, kind-dependent data (plain JSON). */
  readonly data: PlainJsonValue;
}

export interface CreateWebhookEventInput {
  readonly eventType: string;
  readonly request: Pick<EscalationRequest, 'requestId' | 'tenantId' | 'correlationId'>;
  readonly sequence: number;
  readonly now: number | string | Date;
  readonly state?: EscalationState | null;
  readonly data?: unknown;
  /** Fixed event id (idempotent replays / tests); generated when omitted. */
  readonly eventId?: string;
}

/** Create and freeze one webhook event (strict, fail-closed). */
export function createEscalationWebhookEvent(input: CreateWebhookEventInput): EscalationWebhookEvent {
  if (!isEscalationWebhookEventType(input.eventType)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
      message: `webhook event type is not in the closed 13-event vocabulary: ${JSON.stringify(input.eventType)}`,
      details: { vocabulary: ESCALATION_WEBHOOK_EVENT_TYPES },
    });
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
      message: `webhook event sequence must be a positive integer: ${JSON.stringify(input.sequence)}`,
    });
  }
  const data = input.data === undefined ? {} : input.data;
  if (!isPlainJsonValue(data)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
      message: 'webhook event data must be a plain-JSON value',
    });
  }
  const event: EscalationWebhookEvent = Object.freeze({
    eventVersion: ESCALATION_EVENT_VERSION,
    eventId: input.eventId === undefined ? newEventId() : toEventId(input.eventId),
    eventType: input.eventType,
    requestId: input.request.requestId,
    tenantId: input.request.tenantId,
    correlationId: input.request.correlationId,
    sequence: input.sequence,
    occurredAt: toEscalationTimestamp(input.now),
    state: input.state === undefined ? null : input.state,
    data: deepFreeze(data),
  });
  return event;
}

/** The idempotent consumer key for an event (duplicates are safe to drop). */
export function webhookConsumerKey(event: EscalationWebhookEvent): string {
  return event.eventId;
}

/** Terminal webhook events are FINAL for a stream. */
export function isTerminalWebhookEvent(event: EscalationWebhookEvent): boolean {
  return (
    (ESCALATION_WEBHOOK_TERMINAL_EVENT_TYPES as readonly string[]).includes(
      event.eventType,
    )
  );
}

/** Structural guard for wire values claiming to be webhook events. */
export function isEscalationWebhookEvent(value: unknown): value is EscalationWebhookEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['eventVersion'] === ESCALATION_EVENT_VERSION &&
    isEventId(candidate['eventId']) &&
    isEscalationWebhookEventType(candidate['eventType']) &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['correlationId'] === 'string' &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isEscalationTimestamp(candidate['occurredAt']) &&
    (candidate['state'] === null || candidate['state'] === undefined || typeof candidate['state'] === 'string') &&
    isPlainJsonValue(candidate['data'])
  );
}

/** Build the structured `data` payload for a result-bearing event. */
export function resultEventData(result: EscalationResult): PlainJsonValue {
  return {
    resultKind: result.kind,
    summary: result.summary,
    producedAt: result.producedAt,
  };
}
