/**
 * tests/resilience/production/support/resilience-harness.ts — the P007
 * resilience battery's composition boot (Work Order P007; issue #159).
 *
 * Boots the REAL production composition over the embedded real Postgres
 * engine with the REAL public transport — the same discipline as
 * tests/security/production/support/adversarial-harness.ts, trimmed to
 * the resilience scenarios (webhook delivery behavior, restart sweeps,
 * provider outage windows).
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ManualClock } from '@arena/persistence';
import { EscalationApiService } from '@arena/escalation-api';
import { EscalationRoutingService } from '@arena/escalation-routing-service';
import { JobOrchestrator } from '@arena/job-orchestrator';
import {
  createDurableRuntimeComponents,
  createRuntimeHost,
} from '@arena/runtime-host-service';
import type { DurableRuntimeComponents, RuntimeHostService } from '@arena/runtime-host-service';
import { referenceCreateInput } from '@arena/runtime-host-service/test-support';
import {
  createNodeSecretHasher,
  createNodeSecretMaterialGenerator,
  issueDeveloperKey,
  authorizeDeveloperKey,
} from '@arena/developer-platform';
import type {
  DeveloperKeyRecord,
  DeveloperKeySecretBinding,
  SecretHasher,
  SecretMaterialGenerator,
} from '@arena/developer-platform';
import { startEscalationHttpHost } from '@arena/escalation-api/http-host';
import type { ApiKeyAuthenticator, HostHealthProvider } from '@arena/escalation-api/http-host';
import {
  createWebhookDeliveryService,
  createNodeWebhookHttpTransport,
  WebhookDeliveryLoop,
} from '@arena/webhook-delivery';
import type { WebhookDeliveryService } from '@arena/webhook-delivery';
import { hmacSha256WebhookSigner } from '@arena/escalation-adapters';
import type { WebhookSigner } from '@arena/escalation-adapters';
import type { SqlTransport } from '@arena/hosted-neon-postgres';
import { createPgliteSqlTransport } from './pglite-transport.js';
import type { PgliteTransportHandle } from './pglite-transport.js';

/** The battery's pinned clock origin (A015 law — injected, deterministic). */
export const T0 = Date.parse('2026-10-09T12:00:00.000Z');

/** The battery's signing material (host-injected at composition time). */
export const SIGNING_KEY_ID = 'p007-resilience-signer';
export const SIGNING_HMAC_INPUT = 'whsec_' + 'e'.repeat(64);

/** The REAL developer-platform key registry backing the authenticator. */
export class DeveloperKeyRegistry {
  readonly #hasher: SecretHasher = createNodeSecretHasher();
  readonly #material: SecretMaterialGenerator = createNodeSecretMaterialGenerator();
  readonly #clock: ManualClock;
  #entries: readonly {
    readonly record: DeveloperKeyRecord;
    readonly binding: DeveloperKeySecretBinding;
    readonly secret: string;
  }[] = [];

  constructor(clock: ManualClock) {
    this.#clock = clock;
  }

  issue(tenantId: string): { secret: string } {
    const issuance = issueDeveloperKey(
      {
        clientAppId: 'resilience-client',
        tenantId,
        environment: 'live',
        scopes: ['escalations:create', 'escalations:read'],
        label: 'p007 resilience battery key',
        now: this.#clock.now(),
      },
      { hasher: this.#hasher, material: this.#material },
    );
    this.#entries = [
      ...this.#entries,
      { record: issuance.record, binding: issuance.binding, secret: issuance.secret },
    ];
    return { secret: issuance.secret };
  }

  authenticator(): ApiKeyAuthenticator {
    return {
      authenticate: async (input) => {
        let resolved:
          | { readonly record: DeveloperKeyRecord; readonly binding: DeveloperKeySecretBinding }
          | undefined;
        for (const entry of this.#entries) {
          if (this.#hasher.matches(input.presentedSecret, entry.binding.secretHash)) {
            resolved = entry;
            break;
          }
        }
        const verdict = authorizeDeveloperKey(
          {
            record: resolved?.record,
            binding: resolved?.binding,
            presentedSecret: input.presentedSecret,
            tenantId: resolved?.record.tenantId ?? '',
            environment: input.environment,
            scope: input.scope,
          },
          { hasher: this.#hasher },
        );
        if (verdict.outcome === 'denied') {
          return { outcome: 'denied', reason: verdict.reason };
        }
        return {
          outcome: 'authorized',
          identity: {
            keyId: verdict.record.keyId,
            clientAppId: verdict.record.clientAppId,
            tenantId: verdict.record.tenantId,
            environment: verdict.record.environment,
            scopes: verdict.record.scopes,
          },
        };
      },
    };
  }
}

/** One booted resilience battery instance. */
export interface ResilienceBattery {
  readonly clock: ManualClock;
  readonly host: RuntimeHostService;
  readonly durable: DurableRuntimeComponents;
  readonly keys: DeveloperKeyRegistry;
  readonly baseUrl: string;
  readonly signer: WebhookSigner;
  readonly twinTransport: SqlTransport;
  close(): Promise<void>;
}

/** Boot the full real stack on an ephemeral port over embedded Postgres. */
export async function bootResilienceBattery(): Promise<ResilienceBattery> {
  const clock = new ManualClock(T0);
  const handle: PgliteTransportHandle = await createPgliteSqlTransport();
  const durable = createDurableRuntimeComponents({ transport: handle.transport, clock });
  const escalations = new EscalationApiService({
    clock,
    store: durable.escalationStore,
    outbox: durable.webhookOutbox,
    routing: new EscalationRoutingService({ clock }),
  });
  const runner = new JobOrchestrator({
    clock,
    store: durable.jobStore,
    sink: durable.eventSink,
  });
  const host = await createRuntimeHost({
    transport: handle.transport,
    clock,
    engines: { escalations, runner },
    durable,
  }).then((service) => service.start().then(() => service));
  const keys = new DeveloperKeyRegistry(clock);
  const health: HostHealthProvider = async () => {
    const snapshot = await host.health();
    return {
      state: snapshot.state,
      capacityStatus: snapshot.capacity.status,
      components: snapshot.components.map((component) => ({
        component: component.component,
        state: component.state,
        reasons: component.reasons.map((reason) => ({ code: reason.code })),
      })),
      ready: snapshot.ready,
      checkedAt: snapshot.checkedAt,
    };
  };
  const running = await startEscalationHttpHost(
    {
      surface: host.escalations,
      health,
      authenticator: keys.authenticator(),
      clock,
    },
    { port: 0, host: '127.0.0.1' },
  );
  return {
    clock,
    host,
    durable,
    keys,
    baseUrl: running.url,
    signer: hmacSha256WebhookSigner({
      signingKeyId: SIGNING_KEY_ID,
      hmacInput: SIGNING_HMAC_INPUT,
    }),
    twinTransport: handle.twin,
    close: async () => {
      await running.close();
      await host.stop();
      await handle.close();
    },
  };
}

/** Compose a SECOND host over the SAME durable stores (hard restart). */
export async function composeRestartedHost(
  battery: ResilienceBattery,
): Promise<RuntimeHostService> {
  const clock = battery.clock;
  const durable = createDurableRuntimeComponents({
    transport: battery.twinTransport,
    clock,
  });
  const escalations = new EscalationApiService({
    clock,
    store: durable.escalationStore,
    outbox: durable.webhookOutbox,
    routing: new EscalationRoutingService({ clock }),
  });
  const runner = new JobOrchestrator({
    clock,
    store: durable.jobStore,
    sink: durable.eventSink,
  });
  const host = await createRuntimeHost({
    transport: battery.twinTransport,
    clock,
    engines: { escalations, runner },
    durable,
  });
  await host.start();
  return host;
}

/** POST JSON to an ACTUAL URL. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

/** Build an ES1.0 create body (the reference input, overridable). */
export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...referenceCreateInput(), ...overrides };
}

/** Parse a JSON body. */
export function json(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

/** A REAL HTTP webhook receiver with failure injection. */
export class WebhookReceiver {
  readonly deliveries: { headers: Record<string, string | string[] | undefined>; body: string; at: number }[] = [];
  #responder: (request: IncomingMessage, response: ServerResponse, body: string) => void;
  readonly #server: ReturnType<typeof createServer>;
  #started: Promise<{ readonly url: string; readonly close: () => Promise<void> }> | null = null;

  constructor(
    responder: (
      request: IncomingMessage,
      response: ServerResponse,
      body: string,
    ) => void = (_request, response) => {
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
        capture.push({ headers: { ...request.headers }, body, at: Date.now() });
        this.#responder(request, response, body);
      });
    });
  }

  setResponder(
    responder: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  ): void {
    this.#responder = responder;
  }

  async start(): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
    if (this.#started === null) {
      this.#started = new Promise((resolve, reject) => {
        this.#server.once('error', reject);
        this.#server.listen(0, '127.0.0.1', () => {
          const address = this.#server.address();
          const port = typeof address === 'object' && address !== null ? address.port : 0;
          resolve({
            url: `http://127.0.0.1:${port}/hook`,
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

/** Compose the webhook delivery service over the battery's REAL outbox. */
export function webhookDelivery(
  battery: ResilienceBattery,
  endpointUrl: string,
  options: {
    readonly timeoutMs?: number;
    readonly backoff?: {
      readonly maxAttempts: number;
      readonly baseDelayMs: number;
      readonly multiplier: number;
    };
  } = {},
): WebhookDeliveryService {
  return createWebhookDeliveryService({
    outbox: {
      listPending: () => battery.durable.webhookOutbox.listPending(),
      markDelivered: (eventId, at) => battery.durable.webhookOutbox.markDelivered(eventId, at),
    },
    endpoint: { url: endpointUrl },
    signer: battery.signer,
    clock: battery.clock,
    ...(options.timeoutMs !== undefined
      ? { transport: createNodeWebhookHttpTransport({ timeoutMs: options.timeoutMs }) }
      : {}),
    ...(options.backoff !== undefined ? { backoff: options.backoff } : {}),
  });
}

/** Create the dedicated drain loop over a delivery service. */
export function deliveryLoop(
  battery: ResilienceBattery,
  endpointUrl: string,
  options: Parameters<typeof webhookDelivery>[2] & {
    readonly intervalMs?: number;
    readonly keepAlive?: boolean;
  } = {},
): { service: WebhookDeliveryService; loop: WebhookDeliveryLoop } {
  const service = webhookDelivery(battery, endpointUrl, options);
  const loop = service.createLoop({
    ...(options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    ...(options.keepAlive !== undefined ? { keepAlive: options.keepAlive } : {}),
    clock: battery.clock,
  });
  return { service, loop };
}
