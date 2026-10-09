/**
 * tests/integration/production/support/generic-client.ts — the GENERIC
 * AI APPLICATION CLIENT harness (Work Order P006; issue #158; the
 * FINAL-HANDOFF §15 loop; ADR-P001-07/08: public transport ONLY).
 *
 * A plain, provider-neutral HTTP + MCP client — the same shape as
 * examples/generic-ai-client/src/client.ts (the C019 reference client)
 * but bound to an ACTUAL local URL through node's built-in fetch:
 *
 *   - REST: POST /v1/escalations + GET /v1/escalations/{request_id}
 *     with scoped developer-key authorization (Authorization: Bearer);
 *   - MCP: POST /mcp (JSON-RPC 2.0) — tools/list, tools/call
 *     create-escalation, tools/call get-escalation-status — over the
 *     SAME authority (one authority, two transports; the L-002
 *     "MCP not exercised by the example" closure);
 *   - SIGNED webhook consumption: HMAC-SHA256 verification over
 *     `<timestamp>.<payload>`, per-event-id dedupe, tolerance check
 *     against the injected clock — at a REAL webhook receiver this
 *     harness owns (node:http on an ephemeral port);
 *   - own-authority result application (the ERF1.0 boundary law: Arena
 *     never writes the application's state).
 *
 * No test doubles, no in-process service references: every observation
 * arrives as an HTTP response, a webhook delivery, or a poll result.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CreateEscalationRequestInput, EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import { isEscalationRecord, isTerminalEscalationState, parseEscalationWebhookEventEnvelope } from '@arena/escalation';

/** Wire header names for webhook consumption (the C001 delivery scheme). */
export const CLIENT_WEBHOOK_HEADERS = Object.freeze({
  eventId: 'x-arena-event-id',
  timestamp: 'x-arena-webhook-timestamp',
  signature: 'x-arena-signature',
  signingKeyId: 'x-arena-signing-key-id',
} as const);

/** One raw HTTP exchange (status + body text + selected headers). */
export interface HttpExchange {
  readonly status: number;
  readonly body: string;
  readonly requestIdHeader: string | null;
}

/** One captured webhook delivery at the client's receiver. */
export interface CapturedWebhook {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** The client's webhook verification material (delivered exactly once). */
export interface ClientWebhookSigner {
  readonly signingKeyId: string;
  /** Hex HMAC-SHA256 digest over `<timestamp>.<payload>`. */
  sign(timestamp: number, payload: string): string;
}

/** Machine-readable webhook consumption verdict (never a bare boolean). */
export type ClientWebhookVerdict =
  | { readonly outcome: 'accepted'; readonly event: EscalationWebhookEvent }
  | { readonly outcome: 'rejected'; readonly reason: string; readonly eventId: string | null };

/** The applied-result receipt (the client's OWN authority). */
export interface AppliedResultRecord {
  readonly requestId: string;
  readonly resultKind: string;
  readonly appliedBy: 'client-own-authority';
  readonly appliedAt: number;
}

/** The generic AI application client (public transport only). */
export interface GenericAiClient {
  readonly clientAppId: string;
  readonly tenantId: string;
  /** REST: POST /v1/escalations (scoped key; 201 created / 200 replay). */
  submitEscalation(input: CreateEscalationRequestInput): Promise<{
    readonly requestId: string;
    readonly duplicate: boolean;
    readonly httpStatus: number;
  }>;
  /** REST: GET /v1/escalations/{request_id} (idempotent polling). */
  pollStatus(requestId: string): Promise<EscalationRecord>;
  /** MCP: tools/list + the two tool calls over POST /mcp. */
  mcpTools(): Promise<readonly string[]>;
  mcpCreateEscalation(input: CreateEscalationRequestInput): Promise<{ readonly requestId: string; readonly duplicate: boolean }>;
  /** The MCP status tool's summarized view of the SAME record. */
  mcpGetEscalationStatus(requestId: string): Promise<{
    readonly requestId: string;
    readonly state: string;
    readonly validationStatus: string | null;
    readonly result: EscalationRecord['result'] | null;
    readonly cost: EscalationRecord['cost'] | null;
  }>;
  /** Poll until a terminal state arrives (idempotent polling). */
  awaitTerminalState(requestId: string, options?: { readonly maxPolls?: number }): Promise<EscalationRecord>;
  /** Verify + dedupe one received webhook (at-least-once discipline). */
  receiveWebhook(received: CapturedWebhook): ClientWebhookVerdict;
  /** Every accepted webhook event, in acceptance order. */
  observedEvents(): readonly EscalationWebhookEvent[];
  /** Apply a terminal result through the client's OWN authority. */
  applyResult(
    record: EscalationRecord,
    apply: (result: EscalationRecord['result']) => void,
  ): AppliedResultRecord;
}

export interface GenericAiClientConfig {
  readonly clientAppId: string;
  readonly tenantId: string;
  /** The ACTUAL local URL (public transport only). */
  readonly baseUrl: string;
  /** The scoped developer-key secret (Authorization: Bearer). */
  readonly apiKeySecret: string;
  /** The webhook verification material (the endpoint signing secret). */
  readonly webhookSigner: ClientWebhookSigner;
  /** Injected clock (tolerance check; never a wall clock). */
  now(): number;
  readonly toleranceMs?: number;
}

/** Build the generic AI application client over the real URL. */
export function createGenericAiClient(config: GenericAiClientConfig): GenericAiClient {
  const toleranceMs = config.toleranceMs ?? 300_000;
  const seenEventIds = new Set<string>();
  const accepted: EscalationWebhookEvent[] = [];

  async function exchange(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<HttpExchange> {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${config.apiKeySecret}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text,
      requestIdHeader: response.headers.get('x-arena-request-id'),
    };
  }

  async function submitEscalation(input: CreateEscalationRequestInput) {
    const response = await exchange('POST', '/v1/escalations', input);
    let payload: { kind?: string; requestId?: string; duplicate?: boolean };
    try {
      payload = JSON.parse(response.body) as typeof payload;
    } catch {
      throw new Error(
        `POST /v1/escalations answered with an unparseable body (status ${response.status})`,
      );
    }
    if (
      (payload.kind !== 'escalation-created' && payload.kind !== 'escalation-replayed') ||
      typeof payload.requestId !== 'string'
    ) {
      throw new Error(
        `POST /v1/escalations answered with an unexpected payload: ${response.body}`,
      );
    }
    return {
      requestId: payload.requestId,
      duplicate: payload.duplicate === true,
      httpStatus: response.status,
    };
  }

  async function pollStatus(requestId: string): Promise<EscalationRecord> {
    const response = await exchange('GET', `/v1/escalations/${requestId}`);
    let payload: { kind?: string; record?: unknown };
    try {
      payload = JSON.parse(response.body) as typeof payload;
    } catch {
      throw new Error(
        `GET /v1/escalations/${requestId} answered with an unparseable body (status ${response.status})`,
      );
    }
    if (payload.kind !== 'escalation-status' || !isEscalationRecord(payload.record)) {
      throw new Error(
        `GET /v1/escalations/${requestId} did not carry a valid record: ${response.body}`,
      );
    }
    return payload.record;
  }

  async function mcpCall(method: string, params?: unknown): Promise<unknown> {
    const response = await exchange('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    let parsed: { result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(response.body) as typeof parsed;
    } catch {
      throw new Error(`POST /mcp ${method} answered with an unparseable body: ${response.body}`);
    }
    if (parsed.error !== undefined) {
      throw new Error(`POST /mcp ${method} failed: ${JSON.stringify(parsed.error)}`);
    }
    // The MCP result renders its payload as content text (JSON) — the
    // C001 MCP tool-layer convention.
    const result = parsed.result as { content?: { text?: string }[] } | undefined;
    const text = result?.content?.find((entry) => typeof entry.text === 'string')?.text;
    if (text === undefined) {
      return result;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return result;
    }
  }

  function receiveWebhook(received: CapturedWebhook): ClientWebhookVerdict {
    const header = (name: string): string | null => {
      const direct = received.headers[name];
      if (typeof direct === 'string') return direct;
      if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0];
      for (const [key, value] of Object.entries(received.headers)) {
        if (key.toLowerCase() === name && typeof value === 'string') return value;
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
    async mcpTools(): Promise<readonly string[]> {
      const result = (await mcpCall('tools/list')) as { name?: string }[] | { content?: { text?: string }[] } | undefined;
      if (Array.isArray(result)) {
        return result.map((tool) => String(tool.name));
      }
      return [];
    },
    async mcpCreateEscalation(input: CreateEscalationRequestInput) {
      const result = (await mcpCall('tools/call', {
        name: 'create-escalation',
        arguments: { ...input },
      })) as { requestId?: string; duplicate?: boolean; outcome?: string };
      if (typeof result.requestId !== 'string') {
        throw new Error(`MCP create-escalation did not carry a requestId: ${JSON.stringify(result)}`);
      }
      return { requestId: result.requestId, duplicate: result.duplicate === true };
    },
    async mcpGetEscalationStatus(requestId: string) {
      const result = (await mcpCall('tools/call', {
        name: 'get-escalation-status',
        arguments: { requestId, tenantId: config.tenantId },
      })) as {
        requestId?: string;
        state?: string;
        validationStatus?: string | null;
        result?: EscalationRecord['result'] | null;
        cost?: EscalationRecord['cost'] | null;
      };
      if (typeof result.requestId !== 'string' || typeof result.state !== 'string') {
        throw new Error(`MCP get-escalation-status did not carry a status view: ${JSON.stringify(result)}`);
      }
      return {
        requestId: result.requestId,
        state: result.state,
        validationStatus: result.validationStatus ?? null,
        result: result.result ?? null,
        cost: result.cost ?? null,
      };
    },
    async awaitTerminalState(requestId: string, options?: { readonly maxPolls?: number }) {
      const maxPolls = options?.maxPolls ?? 50;
      let last: EscalationRecord | undefined;
      for (let poll = 0; poll < maxPolls; poll += 1) {
        last = await pollStatus(requestId);
        if (isTerminalEscalationState(last.state)) return last;
      }
      throw new Error(
        `escalation ${requestId} did not reach a terminal state within ${maxPolls} polls (last: ${last?.state ?? 'unknown'})`,
      );
    },
    receiveWebhook,
    observedEvents: () => Object.freeze([...accepted]),
    applyResult(record: EscalationRecord, apply: (result: EscalationRecord['result']) => void) {
      if (!isTerminalEscalationState(record.state)) {
        throw new Error(
          `refusing to apply a non-terminal escalation result (state: ${record.state})`,
        );
      }
      apply(record.result);
      return Object.freeze({
        requestId: record.request.requestId,
        resultKind: record.result?.kind ?? 'none',
        appliedBy: 'client-own-authority' as const,
        appliedAt: config.now(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The client's REAL webhook receiver (node:http on an ephemeral port)
// ---------------------------------------------------------------------------

/**
 * The client's webhook endpoint: a REAL HTTP receiver on an ephemeral
 * port. The `consume` hook runs on every delivery (the client's
 * verify/dedupe); the responder is injectable for failure scenarios.
 */
export class ClientWebhookReceiver {
  readonly deliveries: CapturedWebhook[] = [];
  #responder: (request: IncomingMessage, response: ServerResponse, body: string) => void;
  readonly #server: ReturnType<typeof createServer>;
  #started: Promise<{ readonly url: string; readonly close: () => Promise<void> }> | null = null;

  constructor(
    responder: (request: IncomingMessage, response: ServerResponse, body: string) => void = (
      _request,
      response,
    ) => {
      response.statusCode = 200;
      response.end('ok');
    },
  ) {
    this.#responder = responder;
    const capture = this.deliveries;
    this.#server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        capture.push({ headers: { ...request.headers }, body });
        this.#responder(request, response, body);
      });
    });
  }

  /** Swap the responder (per-scenario failure injection). */
  setResponder(
    responder: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  ): void {
    this.#responder = responder;
  }

  /** Start listening on an ephemeral port (idempotent). */
  async start(): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
    if (this.#started === null) {
      this.#started = new Promise((resolve, reject) => {
        this.#server.once('error', reject);
        this.#server.listen(0, '127.0.0.1', () => {
          const address = this.#server.address();
          const port = typeof address === 'object' && address !== null ? address.port : 0;
          resolve({
            url: `http://127.0.0.1:${port}/webhooks`,
            close: () =>
              new Promise<void>((resolveClose) => {
                this.#server.close(() => resolveClose());
              }),
          });
        });
      });
    }
    return this.#started;
  }
}
