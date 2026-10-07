/**
 * The GENERIC AI APPLICATION REFERENCE CLIENT (Work Order C019;
 * FINAL-HANDOFF §14/§15; spec/expert-escalation-api.md ES1.0).
 *
 * A provider-neutral, third-party-shaped client that drives the
 * COMPLETE escalation loop through Arena's PUBLIC contracts ONLY:
 *
 *   register/authorize (developer-platform key + client app)
 *   → POST /v1/escalations (the trivial first path — durable request id)
 *   → follow the durable lifecycle by IDEMPOTENT status polling
 *   → receive SIGNED webhook events (signature verification + event-id
 *     dedupe — at-least-once delivery discipline)
 *   → receive the TYPED result, evidence refs, validation status and
 *     cost/fee fields
 *   → apply the result through the client's OWN authority (the
 *     escalation-reference-flow boundary law: Arena never silently
 *     modifies the application's live state)
 *   → resume the application's own authoritative workflow.
 *
 * The client speaks EXACTLY the C001 wire forms: create inputs in,
 * escalation-response envelopes out (parsed with the REAL C001
 * parser), escalation-webhook-event envelopes from the signed webhook
 * channel. Nothing internal to Arena is imported here — only the
 * public contract vocabulary (@arena/escalation re-exports).
 */

import type { Envelope } from '@arena/protocol-core';
import {
  isEscalationRecord,
  isTerminalEscalationState,
  parseEscalationResponse,
  parseEscalationWebhookEventEnvelope,
} from '@arena/escalation';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationWebhookEvent,
} from '@arena/escalation';

// ---------------------------------------------------------------------------
// Ports — the public-contract transport + webhook channel
// ---------------------------------------------------------------------------

/** One HTTP-shaped response exactly as it arrives off the wire. */
export interface WireResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * The client-side REST transport port over the escalation API:
 * POST /v1/escalations and GET /v1/escalations/{request_id}. A host
 * wires this to fetch/undici against the real deployment; the example
 * wires the in-process reference fabric (fabric.ts).
 */
export interface ArenaEscalationTransport {
  postEscalation(createInput: CreateEscalationRequestInput): Promise<WireResponse>;
  getEscalationStatus(requestId: string, tenantId: string): Promise<WireResponse>;
}

/** The signature-verification port (HMAC-SHA256, `v1=<hex>` scheme). */
export interface ClientWebhookSigner {
  readonly signingKeyId: string;
  sign(timestamp: number, payload: string): string;
}

/** One received webhook (headers + raw body, exactly as delivered). */
export interface ReceivedWebhook {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export const CLIENT_WEBHOOK_HEADERS = Object.freeze({
  eventId: 'x-arena-event-id',
  timestamp: 'x-arena-webhook-timestamp',
  signature: 'x-arena-signature',
  signingKeyId: 'x-arena-signing-key-id',
} as const);

export const CLIENT_WEBHOOK_REJECTION_REASONS = Object.freeze([
  'missing-event-id',
  'missing-timestamp',
  'missing-signature',
  'malformed-signature',
  'timestamp-outside-tolerance',
  'signature-mismatch',
  'signing-key-mismatch',
  'invalid-event-envelope',
  'duplicate-event',
] as const);
export type ClientWebhookRejectionReason = (typeof CLIENT_WEBHOOK_REJECTION_REASONS)[number];

export type ClientWebhookVerdict =
  | { readonly outcome: 'accepted'; readonly event: EscalationWebhookEvent }
  | {
      readonly outcome: 'rejected';
      readonly reason: ClientWebhookRejectionReason;
      readonly eventId: string | null;
    };

/** A typed client error (machine-readable code; never a bare boolean). */
export const GENERIC_CLIENT_ERROR_CODES = Object.freeze({
  TRANSPORT_FAILURE: 'GENERIC_CLIENT_TRANSPORT_FAILURE',
  INVALID_RESPONSE: 'GENERIC_CLIENT_INVALID_RESPONSE',
  WEBHOOK_REJECTED: 'GENERIC_CLIENT_WEBHOOK_REJECTED',
  NOT_TERMINAL: 'GENERIC_CLIENT_NOT_TERMINAL',
} as const);
export type GenericClientErrorCode = (typeof GENERIC_CLIENT_ERROR_CODES)[keyof typeof GENERIC_CLIENT_ERROR_CODES];

export class GenericClientError extends Error {
  readonly code: GenericClientErrorCode;
  constructor(code: GenericClientErrorCode, message: string) {
    super(message);
    this.name = 'GenericClientError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface GenericAiApplicationClientConfig {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly transport: ArenaEscalationTransport;
  readonly webhookSigner: ClientWebhookSigner;
  /** Signature freshness tolerance (ms). */
  readonly toleranceMs?: number;
  /** Injected time for webhook freshness checks (never a wall clock). */
  readonly now: () => number;
}

/** The machine-readable record that the client APPLIED a result itself. */
export interface AppliedResultRecord {
  readonly requestId: string;
  readonly resultKind: string;
  readonly appliedBy: 'client-own-authority';
  readonly appliedAt: number;
}

export interface GenericAiApplicationClient {
  readonly clientAppId: string;
  readonly tenantId: string;

  /** POST /v1/escalations — returns the durable request id. */
  submitEscalation(input: CreateEscalationRequestInput): Promise<{
    requestId: string;
    duplicate: boolean;
    responseBody: string;
  }>;

  /** GET /v1/escalations/{request_id} — idempotent status polling. */
  pollStatus(requestId: string): Promise<EscalationRecord>;

  /** Poll until a TERMINAL state (bounded; typed failure on exhaustion). */
  awaitTerminalState(
    requestId: string,
    options?: { readonly maxPolls?: number },
  ): Promise<EscalationRecord>;

  /** Verify + dedupe one received webhook (at-least-once discipline). */
  receiveWebhook(received: ReceivedWebhook): ClientWebhookVerdict;

  /** Every accepted webhook event, in acceptance order (observability). */
  observedEvents(): readonly EscalationWebhookEvent[];

  /**
   * Apply a terminal result THROUGH THE CLIENT'S OWN AUTHORITY: the
   * host supplies the apply callback; Arena is never a party to it
   * (escalation-reference-flow boundary law).
   */
  applyResult(
    record: EscalationRecord,
    apply: (result: EscalationRecord['result']) => void,
  ): AppliedResultRecord;
}

export function createGenericAiApplicationClient(
  config: GenericAiApplicationClientConfig,
): GenericAiApplicationClient {
  const toleranceMs = config.toleranceMs ?? 300_000;
  const seenEventIds = new Set<string>();
  const accepted: EscalationWebhookEvent[] = [];

  async function submitEscalation(input: CreateEscalationRequestInput) {
    let response: WireResponse;
    try {
      response = await config.transport.postEscalation(input);
    } catch (error) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.TRANSPORT_FAILURE,
        `escalation submission transport failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let envelope: Envelope<unknown>;
    try {
      envelope = parseEscalationResponse(response.body);
    } catch (error) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.INVALID_RESPONSE,
        `POST /v1/escalations answered with an invalid escalation-response envelope: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const payload = envelope.payload as { kind: string; requestId?: string; duplicate?: boolean };
    if (
      (payload.kind !== 'escalation-created' && payload.kind !== 'escalation-replayed') ||
      typeof payload.requestId !== 'string'
    ) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.INVALID_RESPONSE,
        `unexpected escalation-response kind: ${JSON.stringify(payload.kind)}`,
      );
    }
    return {
      requestId: payload.requestId,
      duplicate: payload.duplicate === true,
      responseBody: response.body,
    };
  }

  async function pollStatus(requestId: string): Promise<EscalationRecord> {
    let response: WireResponse;
    try {
      response = await config.transport.getEscalationStatus(requestId, config.tenantId);
    } catch (error) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.TRANSPORT_FAILURE,
        `status poll transport failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let envelope: Envelope<unknown>;
    try {
      envelope = parseEscalationResponse(response.body);
    } catch (error) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.INVALID_RESPONSE,
        `GET /v1/escalations/${requestId} answered with an invalid escalation-response envelope: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const payload = envelope.payload as { kind: string; record?: unknown };
    if (payload.kind !== 'escalation-status' || !isEscalationRecord(payload.record)) {
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.INVALID_RESPONSE,
        `escalation-status response did not carry a valid record for ${requestId}`,
      );
    }
    return payload.record;
  }

  function receiveWebhook(received: ReceivedWebhook): ClientWebhookVerdict {
    const header = (name: string): string | null => {
      const direct = received.headers[name];
      if (typeof direct === 'string') return direct;
      for (const [key, value] of Object.entries(received.headers)) {
        if (key.toLowerCase() === name) return value;
      }
      return null;
    };
    const eventId = header(CLIENT_WEBHOOK_HEADERS.eventId);
    if (eventId === null || eventId.length === 0) {
      return { outcome: 'rejected', reason: 'missing-event-id', eventId: null };
    }
    const timestampHeader = header(CLIENT_WEBHOOK_HEADERS.timestamp);
    if (timestampHeader === null) {
      return { outcome: 'rejected', reason: 'missing-timestamp', eventId };
    }
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      return { outcome: 'rejected', reason: 'missing-timestamp', eventId };
    }
    const signatureHeader = header(CLIENT_WEBHOOK_HEADERS.signature);
    if (signatureHeader === null) {
      return { outcome: 'rejected', reason: 'missing-signature', eventId };
    }
    const signingKeyId = header(CLIENT_WEBHOOK_HEADERS.signingKeyId);
    if (signingKeyId !== null && signingKeyId !== config.webhookSigner.signingKeyId) {
      return { outcome: 'rejected', reason: 'signing-key-mismatch', eventId };
    }
    const prefix = 'v1=';
    if (!signatureHeader.startsWith(prefix) || signatureHeader.length <= prefix.length) {
      return { outcome: 'rejected', reason: 'malformed-signature', eventId };
    }
    const expected = config.webhookSigner.sign(timestamp, received.body);
    if (signatureHeader.slice(prefix.length) !== expected) {
      return { outcome: 'rejected', reason: 'signature-mismatch', eventId };
    }
    if (toleranceMs > 0 && Math.abs(config.now() - timestamp) > toleranceMs) {
      return { outcome: 'rejected', reason: 'timestamp-outside-tolerance', eventId };
    }
    let event: EscalationWebhookEvent;
    try {
      event = parseEscalationWebhookEventEnvelope(received.body).payload;
    } catch {
      return { outcome: 'rejected', reason: 'invalid-event-envelope', eventId };
    }
    if (seenEventIds.has(event.eventId)) {
      return { outcome: 'rejected', reason: 'duplicate-event', eventId };
    }
    seenEventIds.add(event.eventId);
    accepted.push(event);
    return { outcome: 'accepted', event };
  }

  return {
    clientAppId: config.clientAppId,
    tenantId: config.tenantId,
    submitEscalation,
    pollStatus,
    async awaitTerminalState(requestId: string, options?: { readonly maxPolls?: number }) {
      const maxPolls = options?.maxPolls ?? 50;
      let last: EscalationRecord | undefined;
      for (let poll = 0; poll < maxPolls; poll += 1) {
        last = await pollStatus(requestId);
        if (isTerminalEscalationState(last.state)) return last;
      }
      throw new GenericClientError(
        GENERIC_CLIENT_ERROR_CODES.NOT_TERMINAL,
        `escalation ${requestId} did not reach a terminal state within ${maxPolls} idempotent polls (last state: ${last?.state ?? 'unknown'})`,
      );
    },
    receiveWebhook,
    observedEvents: () => Object.freeze([...accepted]),
    applyResult(record: EscalationRecord, apply: (result: EscalationRecord['result']) => void) {
      if (!isTerminalEscalationState(record.state)) {
        throw new GenericClientError(
          GENERIC_CLIENT_ERROR_CODES.NOT_TERMINAL,
          `refusing to apply a non-terminal escalation result (state: ${record.state}) — the client applies results only from terminal records`,
        );
      }
      apply(record.result);
      return Object.freeze({
        requestId: record.request.requestId,
        resultKind: record.result?.kind ?? 'none',
        appliedBy: 'client-own-authority',
        appliedAt: config.now(),
      });
    },
  };
}
