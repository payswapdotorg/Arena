/**
 * tests/integration/production/support/epoch-client.ts — the EPOCH ADAPTER
 * CLIENT harness (Work Order P006; issue #158; ADR-P001-08: Epoch consumes
 * through adapters/epoch-escalation over the PUBLIC transport — no
 * Epoch-specific Arena API exists or is used).
 *
 * Models what the Epoch-side host integration DOES (the C019 reference
 * adapter's consumer discipline), over the SAME integrated deployment the
 * generic client uses:
 *
 *   - DECLARES its integration posture (parseEpochIntegrationPosture —
 *     closed shape, fail-closed) and binds ONE EpochEscalationAdapter to
 *     it;
 *   - RAISES its escalation as an EpochEscalationTrigger on the WIRE
 *     (closed shape, fail-closed) and maps it through the adapter onto
 *     the ES1.0 CreateEscalationRequestInput (mapTriggerToCreateInput;
 *     the domain construction is validated through the adapter's own
 *     buildEscalationRequestFromWire path — the REAL @arena/escalation
 *     constructor);
 *   - FILES the escalation over the PUBLIC transport only (POST
 *     /v1/escalations with a scoped developer key; GET
 *     /v1/escalations/{id} polling; POST /mcp tools) — plain fetch, never
 *     an in-process service reference;
 *   - CONSUMES signed webhook deliveries through the adapter's
 *     consumeEpochWebhook (HMAC-SHA256 verify, tenant check against the
 *     declared posture, per-EVENT-ID dedupe over host-owned state) and
 *     projects each consumed event into the READ-ONLY
 *     EpochEscalationDelivery (epochDeliveryFromEvent);
 *   - APPLIES the terminal result through Epoch's OWN authority: the
 *     adapter's delivery projection of the terminal record
 *     (deliveryFromRecord) is read, and the application is Epoch's own
 *     recorded act — Arena never writes Epoch state (authority.ts).
 */

import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import { isEscalationRecord, isTerminalEscalationState } from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';
import {
  consumeEpochWebhook,
  epochDeliveryFromEvent,
  mapTriggerToCreateInput,
  parseEpochEscalationTrigger,
  parseEpochIntegrationPosture,
  EpochEscalationAdapter,
} from '@arena/epoch-escalation-adapter';
import type {
  EpochEscalationDelivery,
  EpochIntegrationPosture,
  EpochWebhookSigner,
} from '@arena/epoch-escalation-adapter';
import type { CapturedWebhook } from './generic-client.js';

/** One normalized Epoch-side webhook consumption observation. */
export interface EpochWebhookConsumptionSummary {
  readonly accepted: number;
  readonly rejectionReasons: readonly string[];
}

/** The Epoch-side own-authority application receipt (ERF1.0 law). */
export interface EpochAppliedResultRecord {
  readonly requestId: string;
  readonly resultKind: string;
  readonly appliedBy: 'client-own-authority';
  readonly appliedAt: number;
}

export interface EpochAdapterClientConfig {
  /** Epoch's declared posture ON THE WIRE (closed shape, fail-closed). */
  readonly postureWire: unknown;
  /** The ACTUAL local URL (public transport only). */
  readonly baseUrl: string;
  /** The scoped developer-key secret (Authorization: Bearer). */
  readonly apiKeySecret: string;
  /**
   * The webhook signing MATERIAL, host-injected at composition time —
   * satisfies the adapter's structural EpochWebhookSigner port (the same
   * HMAC input bytes Arena signs with; no adapter-to-adapter import).
   */
  readonly webhookSigner: EpochWebhookSigner;
  /** Injected clock (tolerance check; never a wall clock). */
  now(): number;
  /** The EPI1.0 job id back-linked onto every delivery. */
  readonly epochJobId: string;
}

/**
 * The Epoch adapter client: one declared posture + one adapter instance,
 * filing escalations and consuming deliveries over the public transport
 * through the adapter's public surface ONLY.
 */
export class EpochAdapterClient {
  readonly posture: EpochIntegrationPosture;
  readonly adapter: EpochEscalationAdapter;
  readonly epochJobId: string;
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly #baseUrl: string;
  readonly #apiKeySecret: string;
  readonly #signer: EpochWebhookSigner;
  readonly #now: () => number;
  readonly #seenEventIds = new Set<string>();
  readonly #consumedEvents: EscalationWebhookEvent[] = [];
  readonly #deliveries: EpochEscalationDelivery[] = [];
  readonly #applied: EpochAppliedResultRecord[] = [];

  constructor(config: EpochAdapterClientConfig) {
    this.posture = parseEpochIntegrationPosture(config.postureWire);
    this.adapter = new EpochEscalationAdapter(this.posture);
    this.epochJobId = config.epochJobId;
    this.tenantId = this.posture.tenantId;
    this.clientAppId = this.posture.clientAppId;
    this.#baseUrl = config.baseUrl;
    this.#apiKeySecret = config.apiKeySecret;
    this.#signer = config.webhookSigner;
    this.#now = config.now;
  }

  /**
   * Map an Epoch escalation TRIGGER (on the wire) onto the ES1.0 create
   * input: closed-shape parse → the adapter's domain-validated
   * construction (buildEscalationRequestFromWire — the REAL constructor)
   * → the pure mapping the public transport carries (mapTriggerToCreateInput).
   */
  async createRequestInputFromTrigger(triggerWire: unknown): Promise<CreateEscalationRequestInput> {
    const trigger = parseEpochEscalationTrigger(triggerWire);
    // The adapter's own path first: the trigger must construct a VALID
    // ES1.0 EscalationRequest under the declared posture (typed failures
    // otherwise — the authorization-mismatch and mapping-failure walls).
    await this.adapter.buildEscalationRequestFromWire(triggerWire);
    return mapTriggerToCreateInput(trigger, this.posture);
  }

  /** POST /v1/escalations over the public transport (scoped key). */
  async submit(requestInput: CreateEscalationRequestInput): Promise<{
    readonly requestId: string;
    readonly duplicate: boolean;
    readonly httpStatus: number;
  }> {
    // The posture's authorization identity is the ONLY identity this
    // client may file under (the adapter enforced it at mapping; the
    // client re-checks before filing — fail closed).
    if (
      requestInput.tenantId !== this.tenantId ||
      requestInput.clientAppId !== this.clientAppId
    ) {
      throw new Error(
        `refusing to file an escalation outside the declared posture identity (tenant ${JSON.stringify(requestInput.tenantId)} / app ${JSON.stringify(requestInput.clientAppId)})`,
      );
    }
    const response = await fetch(`${this.#baseUrl}/v1/escalations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#apiKeySecret}`,
      },
      body: JSON.stringify(requestInput),
    });
    const text = await response.text();
    let payload: { kind?: string; requestId?: string; duplicate?: boolean };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new Error(
        `POST /v1/escalations answered with an unparseable body (status ${String(response.status)})`,
      );
    }
    if (
      (payload.kind !== 'escalation-created' && payload.kind !== 'escalation-replayed') ||
      typeof payload.requestId !== 'string'
    ) {
      throw new Error(
        `POST /v1/escalations answered with an unexpected payload: ${text}`,
      );
    }
    return {
      requestId: payload.requestId,
      duplicate: payload.duplicate === true,
      httpStatus: response.status,
    };
  }

  /** GET /v1/escalations/{request_id} (idempotent polling). */
  async pollStatus(requestId: string): Promise<EscalationRecord> {
    const response = await fetch(`${this.#baseUrl}/v1/escalations/${requestId}`, {
      headers: { authorization: `Bearer ${this.#apiKeySecret}` },
    });
    const text = await response.text();
    let payload: { kind?: string; record?: unknown };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new Error(
        `GET /v1/escalations/${requestId} answered with an unparseable body (status ${String(response.status)})`,
      );
    }
    if (payload.kind !== 'escalation-status' || !isEscalationRecord(payload.record)) {
      throw new Error(
        `GET /v1/escalations/${requestId} did not carry a valid record: ${text}`,
      );
    }
    return payload.record;
  }

  /** Poll until a terminal state arrives. */
  async awaitTerminalState(
    requestId: string,
    options?: { readonly maxPolls?: number },
  ): Promise<EscalationRecord> {
    const maxPolls = options?.maxPolls ?? 50;
    let last: EscalationRecord | undefined;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      last = await this.pollStatus(requestId);
      if (isTerminalEscalationState(last.state)) return last;
    }
    throw new Error(
      `escalation ${requestId} did not reach a terminal state within ${String(maxPolls)} polls (last: ${last?.state ?? 'unknown'})`,
    );
  }

  /**
   * Consume captured webhook deliveries through the adapter's
   * consumeEpochWebhook: signature verify + tenant check against the
   * declared posture + per-EVENT-ID dedupe over this client's own state;
   * each consumed event is projected into the READ-ONLY delivery shape.
   */
  acceptWebhookDeliveries(
    captured: readonly CapturedWebhook[],
  ): EpochWebhookConsumptionSummary {
    let accepted = 0;
    const rejectionReasons: string[] = [];
    for (const one of captured) {
      const verdict = consumeEpochWebhook({
        received: { headers: normalizeHeaders(one.headers), body: one.body },
        signer: this.#signer,
        expectedTenantId: this.tenantId,
        now: this.#now(),
        seenEventIds: this.#seenEventIds,
      });
      if (verdict.outcome === 'rejected') {
        rejectionReasons.push(verdict.reason);
        continue;
      }
      // The host-owned dedupe set records the consumed id (at-least-once
      // delivery ⇒ idempotent consumption).
      this.#seenEventIds.add(verdict.eventId);
      this.#consumedEvents.push(verdict.event);
      this.#deliveries.push(epochDeliveryFromEvent(verdict.event, this.epochJobId));
      accepted += 1;
    }
    return { accepted, rejectionReasons: Object.freeze(rejectionReasons) };
  }

  /** A REDELIVERED event id must be rejected (per-event-id dedupe). */
  rejectRedelivery(captured: CapturedWebhook): string {
    const verdict = consumeEpochWebhook({
      received: { headers: normalizeHeaders(captured.headers), body: captured.body },
      signer: this.#signer,
      expectedTenantId: this.tenantId,
      now: this.#now(),
      seenEventIds: this.#seenEventIds,
    });
    if (verdict.outcome === 'consumed') {
      throw new Error('the Epoch consumer accepted a redelivered event id (dedupe broken)');
    }
    return verdict.reason;
  }

  /** Every consumed webhook event, in consumption order. */
  consumedEvents(): readonly EscalationWebhookEvent[] {
    return Object.freeze([...this.#consumedEvents]);
  }

  /** Every consumed event's type, in consumption order. */
  observedEventTypes(): readonly string[] {
    return this.#consumedEvents.map((event) => event.eventType);
  }

  /** The projected read-only deliveries (event projections, in order). */
  observedDeliveries(): readonly EpochEscalationDelivery[] {
    return Object.freeze([...this.#deliveries]);
  }

  /** The adapter's READ-ONLY delivery projection of a record. */
  deliveryFor(record: EscalationRecord): EpochEscalationDelivery {
    return this.adapter.deliveryFromRecord(record, this.epochJobId);
  }

  /**
   * Apply a terminal result through Epoch's OWN authority: project the
   * terminal record into the delivery, verify it is deep-frozen
   * (read-only), and record Epoch's own application act. Arena never
   * writes Epoch state — the application is entirely this client's.
   */
  applyTerminalResult(record: EscalationRecord): {
    readonly appliedBy: 'client-own-authority';
    readonly resultKind: string;
    readonly frozen: boolean;
  } {
    if (!isTerminalEscalationState(record.state)) {
      throw new Error(
        `refusing to apply a non-terminal escalation result (state: ${record.state})`,
      );
    }
    const delivery = this.adapter.deliveryFromRecord(record, this.epochJobId);
    // The delivery is deep-frozen: a mutation attempt must NOT take hold.
    const probe = delivery as { state?: string };
    const before = delivery.state;
    try {
      probe.state = 'mutated';
    } catch {
      // strict-mode freeze denial — the expected outcome
    }
    const frozen = delivery.state === before;
    this.#applied.push(
      Object.freeze({
        requestId: record.request.requestId,
        resultKind: delivery.resultKind ?? 'none',
        appliedBy: 'client-own-authority' as const,
        appliedAt: this.#now(),
      }),
    );
    return { appliedBy: 'client-own-authority', resultKind: delivery.resultKind ?? 'none', frozen };
  }

  /** Every own-authority application receipt, in order. */
  appliedResults(): readonly EpochAppliedResultRecord[] {
    return Object.freeze([...this.#applied]);
  }

  // -- MCP over the SAME authority (the second public transport) -------

  private async mcpCall(method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#apiKeySecret}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    });
    const text = await response.text();
    let parsed: { result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`POST /mcp ${method} answered with an unparseable body: ${text}`);
    }
    if (parsed.error !== undefined) {
      throw new Error(`POST /mcp ${method} failed: ${JSON.stringify(parsed.error)}`);
    }
    const result = parsed.result as { content?: { text?: string }[] } | undefined;
    const contentText = result?.content?.find((entry) => typeof entry.text === 'string')?.text;
    if (contentText === undefined) return result;
    try {
      return JSON.parse(contentText) as unknown;
    } catch {
      return result;
    }
  }

  /** MCP tools/list over POST /mcp. */
  async mcpTools(): Promise<readonly string[]> {
    const result = (await this.mcpCall('tools/list')) as
      | { name?: string }[]
      | { content?: { text?: string }[] }
      | undefined;
    if (Array.isArray(result)) {
      return result.map((tool) => String(tool.name));
    }
    return [];
  }

  /** MCP get-escalation-status over POST /mcp. */
  async mcpStatusView(requestId: string): Promise<{
    readonly state: string;
    readonly validationStatus: string | null;
    readonly resultKind: string | null;
  }> {
    const result = (await this.mcpCall('tools/call', {
      name: 'get-escalation-status',
      arguments: { requestId, tenantId: this.tenantId },
    })) as {
      state?: string;
      validationStatus?: string | null;
      result?: { kind?: string } | null;
    };
    if (typeof result.state !== 'string') {
      throw new Error(
        `MCP get-escalation-status did not carry a status view: ${JSON.stringify(result)}`,
      );
    }
    return {
      state: result.state,
      validationStatus: result.validationStatus ?? null,
      resultKind: result.result?.kind ?? null,
    };
  }
}

/** Normalize node's IncomingHttpHeaders into the adapter's header shape. */
function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      normalized[key] = value[0];
    }
  }
  return normalized;
}
