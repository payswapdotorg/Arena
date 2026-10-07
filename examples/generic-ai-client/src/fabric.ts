/**
 * The C019 REFERENCE FABRIC (Work Order C019): the Arena side of the
 * E2E proof, wired from the REAL merged C-era seams —
 *
 *   - services/escalation-api (C001): EscalationApiService over the
 *     in-memory durable store + webhook outbox + routing stub with the
 *     reference expert directory;
 *   - adapters/escalation (C001): WebhookDeliveryAdapter — the SIGNED
 *     at-least-once webhook delivery that drains the outbox to the
 *     client's endpoint over an in-process HTTP transport;
 *   - services/payments (C010): PaymentService — hold → offer →
 *     acceptance → capture → release with the deterministic fee split;
 *   - packages/developer-platform (C017): client-app registration,
 *     developer-key issuance/authorization, webhook-endpoint
 *     registration (the signing secret is returned exactly once and
 *     becomes the CLIENT's verification key).
 *
 * The fabric exposes ONLY public-contract-shaped surfaces to the
 * clients (REST-shaped transport + the webhook channel): responses are
 * REAL serialized escalation-response envelopes; webhook bodies are
 * REAL serialized escalation-webhook-event envelopes, SIGNED with the
 * C001 scheme. The create path additionally round-trips the request
 * through the create-escalation-command envelope (the ES1.0 command
 * wire form).
 *
 * Deterministic: fixed clock, fixed ids, no network, no wall time.
 */

import { serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  makeCreateEscalationCommand,
  makeEscalationResponse,
  parseCreateEscalationCommand,
} from '@arena/escalation';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { EscalationApiService, FixedClock, REFERENCE_EXPERTS } from '@arena/escalation-api';
import { hmacSha256WebhookSigner, WebhookDeliveryAdapter } from '@arena/escalation-adapters';
import {
  InMemoryPaymentEventOutbox,
  InMemoryPaymentLedgerStore,
  PaymentService,
} from '@arena/payments-service';
import {
  authorizeDeveloperKey,
  createNodeSecretHasher,
  issueDeveloperKey,
  registerClientApp,
  registerWebhookEndpoint,
} from '@arena/developer-platform';
import type {
  ClientAppRecord,
  DeveloperKeyAuthorization,
  DeveloperKeyRecord,
  DeveloperKeySecretBinding,
  WebhookEndpointRecord,
} from '@arena/developer-platform';
import type { ArenaEscalationTransport, ReceivedWebhook, WireResponse } from './client.js';

/** Deterministic key material generator (reference; NEVER production). */
class SequentialMaterial {
  private counter = 0;
  constructor(private readonly prefix = 'c019a1b2c3d4e5f6') {}
  bytes32Hex(): string {
    this.counter += 1;
    const suffix = String(this.counter).padStart(6, '0');
    return `${this.prefix}${suffix}${'0'.repeat(Math.max(0, 64 - this.prefix.length - suffix.length))}`;
  }
}

/** The webhook endpoint the fabric delivers to (in-process, no network). */
export interface WebhookSink {
  receive(received: ReceivedWebhook): void;
}

export interface ReferenceArena {
  readonly escalationService: EscalationApiService;
  readonly paymentService: PaymentService;
  readonly clock: FixedClock;
  readonly clientApp: ClientAppRecord;
  readonly webhookEndpoint: WebhookEndpointRecord;
  readonly webhookSigningSecret: string;
  readonly webhookSigningKeyId: string;
  readonly developerKeyRecord: DeveloperKeyRecord;
  readonly developerKeyBinding: DeveloperKeySecretBinding;
  readonly developerKeySecret: string;
  /** C017 authorize proof: verify a presented secret against the issued key. */
  authorizeKey(presentedSecret: string): DeveloperKeyAuthorization;
  /** The REST-shaped public transport clients call. */
  readonly transport: ArenaEscalationTransport;
  /** Drain the durable outbox: signed webhook delivery to the sink. */
  deliverPendingWebhooks(sink: WebhookSink): Promise<{ delivered: number; deadLettered: number }>;
  /** The captured deliveries of the last drain (headers + bodies). */
  readonly lastDeliveries: readonly ReceivedWebhook[];
}

export interface ReferenceArenaConfig {
  readonly clientAppId: string;
  readonly tenantId: string;
  readonly webhookUrl: string;
  readonly startedAtMs?: number;
}

export function createReferenceArena(config: ReferenceArenaConfig): ReferenceArena {
  const startedAt = config.startedAtMs ?? Date.parse('2026-10-07T10:00:00.000Z');
  const clock = new FixedClock(startedAt);
  const material = new SequentialMaterial();
  const hasher = createNodeSecretHasher();

  // --- C017: register the client app + webhook endpoint + API key ----
  let clientApp = registerClientApp({
    clientAppId: config.clientAppId,
    tenantId: config.tenantId,
    displayName: 'Generic AI Application (C019 reference client)',
    environment: 'live',
    now: startedAt,
  });
  const registration = registerWebhookEndpoint(
    clientApp,
    { url: config.webhookUrl, now: startedAt },
    { hasher, material },
  );
  clientApp = registration.app;

  const issuance = issueDeveloperKey(
    {
      clientAppId: config.clientAppId,
      tenantId: config.tenantId,
      environment: 'live',
      scopes: ['escalations:create', 'escalations:read'],
      label: 'c019-generic-client',
      now: startedAt,
    },
    { hasher, material },
  );

  // --- C001: the escalation API service on the reference fabric -----
  const escalationService = new EscalationApiService({
    clock,
    directory: { listQualifiedExperts: async () => REFERENCE_EXPERTS },
  });

  // --- C010: the payments service over the escalation lifecycle -----
  const ledgerStore = new InMemoryPaymentLedgerStore();
  const paymentOutbox = new InMemoryPaymentEventOutbox();
  const paymentService = new PaymentService({
    clock,
    store: ledgerStore,
    outbox: paymentOutbox,
    lifecycle: {
      get: async (requestId: string, tenantId: string) => {
        let record: import('@arena/escalation').EscalationRecord | undefined;
        try {
          const outcome = await escalationService.getEscalationStatus({ requestId, tenantId });
          record = outcome.record;
        } catch {
          record = undefined;
        }
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
      },
    },
  });

  // --- C001: the signed webhook delivery adapter ---------------------
  // The signing input is the webhook endpoint's signing secret (shown
  // exactly once at registration; the CLIENT keeps it for verification).
  const signer = hmacSha256WebhookSigner({
    signingKeyId: registration.endpoint.signingKeyId,
    hmacInput: registration.signingSecret,
  });
  const lastDeliveries: ReceivedWebhook[] = [];
  const attempts = new Map<string, { outcome: string; httpStatus: number | null }[]>();
  const deadLetters: { eventId: string }[] = [];

  async function deliverPendingWebhooks(sink: WebhookSink) {
    const adapter = new WebhookDeliveryAdapter({
      source: {
        listPending: () => escalationService.outbox.listPending(),
        markDelivered: (eventId: string, at: number) =>
          escalationService.outbox.markDelivered(eventId, at),
      },
      endpoint: { url: config.webhookUrl },
      signer,
      transport: {
        async post(url: string, headers: Readonly<Record<string, string>>, body: string) {
          void url;
          const received: ReceivedWebhook = { headers: { ...headers }, body };
          lastDeliveries.push(received);
          try {
            sink.receive(received);
            return { ok: true, status: 200 };
          } catch {
            return { ok: false, status: 500 };
          }
        },
      },
      clock,
      ledger: {
        async recordAttempt(attempt) {
          const prior = attempts.get(attempt.eventId) ?? [];
          attempts.set(attempt.eventId, [
            ...prior,
            { outcome: attempt.outcome, httpStatus: attempt.httpStatus },
          ]);
        },
        async recordDeadLetter(record) {
          deadLetters.push({ eventId: record.eventId });
        },
        async listDeadLetters() {
          return deadLetters.map((entry) => ({
            eventId: entry.eventId,
            requestId: '',
            tenantId: '',
            url: config.webhookUrl,
            attempts: 1,
            lastHttpStatus: null,
            deadLetteredAt: clock.now(),
          }));
        },
        async attemptsFor(eventId: string) {
          return (attempts.get(eventId) ?? []).map((entry, index) => ({
            eventId,
            attempt: index + 1,
            attemptedAt: clock.now(),
            outcome: entry.outcome as 'delivered' | 'failed',
            httpStatus: entry.httpStatus,
            scheduledRetryAt: null,
          }));
        },
      },
      backoff: { maxAttempts: 2, baseDelayMs: 0, multiplier: 1 },
    });
    const report = await adapter.deliverPending();
    return { delivered: report.deliveredCount, deadLettered: report.deadLetteredCount };
  }

  // --- The public-contract REST transport -----------------------------
  const transport: ArenaEscalationTransport = {
    async postEscalation(createInput: CreateEscalationRequestInput): Promise<WireResponse> {
      // The service validates + constructs the REAL request; the wire
      // response is the REAL serialized escalation-response envelope.
      const outcome = await escalationService.createEscalation(createInput);
      // Contract proof: the created request round-trips through the
      // create-escalation-command envelope (parse + re-serialize).
      const command = makeCreateEscalationCommand(
        outcome.record.request,
        toCorrelationId(outcome.record.request.correlationId),
        toIdempotencyKey(outcome.record.request.idempotencyKey),
      );
      const parsed = parseCreateEscalationCommand(serializeEnvelope(command));
      if (parsed.payload.requestId !== outcome.requestId) {
        throw new Error('create-escalation-command round-trip diverged');
      }
      const response = makeEscalationResponse(
        {
          responseVersion: 1,
          kind: outcome.outcome === 'created' ? 'escalation-created' : 'escalation-replayed',
          requestId: outcome.requestId,
          correlationId: outcome.record.request.correlationId,
          duplicate: outcome.duplicate,
        },
        toCorrelationId(outcome.record.request.correlationId),
      );
      return { status: 200, body: serializeEnvelope(response) };
    },
    async getEscalationStatus(requestId: string, tenantId: string): Promise<WireResponse> {
      try {
        const { record } = await escalationService.getEscalationStatus({ requestId, tenantId });
        const response = makeEscalationResponse(
          { responseVersion: 1, kind: 'escalation-status', record },
          toCorrelationId(record.request.correlationId),
        );
        return { status: 200, body: serializeEnvelope(response) };
      } catch {
        return { status: 404, body: JSON.stringify({ error: 'not-found' }) };
      }
    },
  };

  return {
    escalationService,
    paymentService,
    clock,
    clientApp,
    webhookEndpoint: registration.endpoint,
    webhookSigningSecret: registration.signingSecret,
    webhookSigningKeyId: registration.endpoint.signingKeyId,
    developerKeyRecord: issuance.record,
    developerKeyBinding: issuance.binding,
    developerKeySecret: issuance.secret,
    authorizeKey(presentedSecret: string): DeveloperKeyAuthorization {
      return authorizeDeveloperKey(
        {
          record: issuance.record,
          binding: issuance.binding,
          presentedSecret,
          tenantId: config.tenantId,
          environment: 'live',
          scope: 'escalations:create',
        },
        { hasher },
      );
    },
    transport,
    deliverPendingWebhooks,
    lastDeliveries,
  };
}
