/**
 * tests/security/production/support/adversarial-harness.ts — the P007
 * integrated adversarial battery's composition boot (Work Order P007;
 * issue #159).
 *
 * Boots the REAL production stack the threat model's trust boundaries
 * name (docs/security/post-roadmap/threat-model.md §2):
 *
 *   - the REAL durable components (createDurableRuntimeComponents) over
 *     an EMBEDDED REAL PostgreSQL engine (PGlite — the tests/runtime-host
 *     battery pattern; the same components P002 proved over live Neon);
 *   - the REAL service engines (EscalationApiService with the REAL
 *     routing service + JobOrchestrator) injected through the frozen
 *     host seam (createRuntimeHost) — mirroring
 *     deploy/runtime/src/composition.ts verbatim, with ONE deliberate
 *     difference: the battery keeps the durable component handle so the
 *     webhook/outbox/idempotency attacks can inspect and mutate the REAL
 *     stores (the tests/api-host harness precedent);
 *   - the REAL developer-platform key model (issueDeveloperKey /
 *     authorizeDeveloperKey over createNodeSecretHasher +
 *     createNodeSecretMaterialGenerator) behind the http-host's
 *     ApiKeyAuthenticator port — a real key registry with real secret
 *     hashes and the REAL append-only rotate/revoke lifecycle, never a
 *     stub verdict;
 *   - the REAL HTTP listener (startEscalationHttpHost on an ephemeral
 *     port — the ACTUAL local URL the adversarial client attacks);
 *   - a REAL webhook receiver (node:http on an ephemeral port) for the
 *     forgery/replay attacks, plus the REAL webhook-delivery service
 *     draining the REAL durable outbox.
 *
 * DISCLOSURE (engine class): the persistence layer rides the embedded
 * PGlite engine inside the battery (AUTOMATED-TEST-ONLY evidence class);
 * P002's live-Neon batteries already proved the SAME components over a
 * real hosted database. Everything above the transport — engines, host
 * core, key model, listener, webhook delivery — is the real production
 * code.
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
  authorizeDeveloperKey,
  createNodeSecretHasher,
  createNodeSecretMaterialGenerator,
  issueDeveloperKey,
  revokeDeveloperKey,
  rotateDeveloperKey,
} from '@arena/developer-platform';
import type {
  DeveloperKeyEnvironment,
  DeveloperKeyIssuance,
  DeveloperKeyRecord,
  DeveloperKeyScope,
  DeveloperKeySecretBinding,
  SecretHasher,
  SecretMaterialGenerator,
} from '@arena/developer-platform';
import { startEscalationHttpHost } from '@arena/escalation-api/http-host';
import type { ApiKeyAuthenticator, HostHealthProvider } from '@arena/escalation-api/http-host';
import { createWebhookDeliveryService, createNodeWebhookHttpTransport } from '@arena/webhook-delivery';
import type { WebhookDeliveryService } from '@arena/webhook-delivery';
import { hmacSha256WebhookSigner } from '@arena/escalation-adapters';
import type { WebhookSigner } from '@arena/escalation-adapters';
import type { SqlTransport } from '@arena/hosted-neon-postgres';
import { createPgliteSqlTransport } from './pglite-transport.js';
import type { PgliteTransportHandle } from './pglite-transport.js';

/** The battery's pinned clock origin (A015 law — injected, deterministic). */
export const T0 = Date.parse('2026-10-09T12:00:00.000Z');

/** The battery's signing material (host-injected at composition time). */
export const SIGNING_KEY_ID = 'p007-adversarial-signer';
export const SIGNING_HMAC_INPUT = 'whsec_' + 'c'.repeat(64);

// ---------------------------------------------------------------------------
// The developer-platform key registry (the REAL key model, with rotation)
// ---------------------------------------------------------------------------

/** A live-tenant key request for the battery's registry. */
export interface KeyRequest {
  readonly tenantId: string;
  readonly environment?: DeveloperKeyEnvironment;
  readonly scopes?: readonly DeveloperKeyScope[];
  readonly label?: string;
}

/** One registry entry (record + binding + the one-time secret). */
interface RegistryEntry {
  readonly record: DeveloperKeyRecord;
  readonly binding: DeveloperKeySecretBinding;
  readonly secret: string;
}

/**
 * The REAL developer-platform key registry backing the authenticator —
 * the tests/api-host DeveloperKeyRegistry pattern extended with the REAL
 * rotateDeveloperKey lifecycle transition (the AC-05 attack surface).
 */
export class DeveloperKeyRegistry {
  readonly #hasher: SecretHasher = createNodeSecretHasher();
  readonly #material: SecretMaterialGenerator = createNodeSecretMaterialGenerator();
  readonly #clock: ManualClock;
  #entries: readonly RegistryEntry[] = [];

  constructor(clock: ManualClock) {
    this.#clock = clock;
  }

  /** Issue a key through the REAL issuance path (secret shown once). */
  issue(request: KeyRequest): DeveloperKeyIssuance {
    const issuance = issueDeveloperKey(
      {
        clientAppId: 'adversarial-client',
        tenantId: request.tenantId,
        environment: request.environment ?? 'live',
        scopes: request.scopes ?? ['escalations:create', 'escalations:read'],
        label: request.label ?? 'p007 adversarial battery key',
        now: this.#clock.now(),
      },
      { hasher: this.#hasher, material: this.#material },
    );
    this.#entries = [
      ...this.#entries,
      { record: issuance.record, binding: issuance.binding, secret: issuance.secret },
    ];
    return issuance;
  }

  /** Rotate a key through the REAL append-only lifecycle transition. */
  rotate(record: DeveloperKeyRecord): { successor: DeveloperKeyIssuance; rotated: DeveloperKeyRecord } {
    const { successor, rotated } = rotateDeveloperKey(
      record,
      { hasher: this.#hasher, material: this.#material },
      { now: this.#clock.now() },
    );
    this.#entries = this.#entries.map((entry) =>
      entry.record.keyId === record.keyId
        ? { record: rotated, binding: entry.binding, secret: entry.secret }
        : entry,
    );
    this.#entries = [
      ...this.#entries,
      { record: successor.record, binding: successor.binding, secret: successor.secret },
    ];
    return { successor, rotated };
  }

  /** Revoke a key through the REAL append-only lifecycle transition. */
  revoke(record: DeveloperKeyRecord): DeveloperKeyRecord {
    const revoked = revokeDeveloperKey(record, { now: this.#clock.now() });
    this.#entries = this.#entries.map((entry) =>
      entry.record.keyId === revoked.keyId
        ? { record: revoked, binding: entry.binding, secret: entry.secret }
        : entry,
    );
    return revoked;
  }

  /** Every issued secret (the AC-05 leakage scanner's corpus). */
  issuedSecrets(): readonly string[] {
    return this.#entries.map((entry) => entry.secret);
  }

  /** The ApiKeyAuthenticator port over the REAL authorization function. */
  authenticator(): ApiKeyAuthenticator {
    return {
      authenticate: async (input) => {
        let resolved: RegistryEntry | undefined;
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

// ---------------------------------------------------------------------------
// The battery boot (durable components + engines + host + listener)
// ---------------------------------------------------------------------------

/** One booted adversarial battery instance (the actual local URL stack). */
export interface AdversarialBattery {
  readonly clock: ManualClock;
  readonly host: RuntimeHostService;
  readonly durable: DurableRuntimeComponents;
  readonly engines: {
    readonly escalations: EscalationApiService;
    readonly runner: JobOrchestrator;
  };
  readonly keys: DeveloperKeyRegistry;
  /** The ACTUAL local URL the adversarial client attacks. */
  readonly baseUrl: string;
  readonly signer: WebhookSigner;
  /** A SECOND transport over the same embedded engine (restart proofs). */
  readonly twinTransport: SqlTransport;
  close(): Promise<void>;
}

/**
 * Boot the full real stack on an ephemeral port over the embedded real
 * Postgres engine. The engines + durable components are composed exactly
 * like deploy/runtime/src/composition.ts (the battery keeps the durable
 * handle — the ONE deliberate difference, disclosed above).
 */
export async function bootAdversarialBattery(): Promise<AdversarialBattery> {
  const clock = new ManualClock(T0);
  const handle: PgliteTransportHandle = await createPgliteSqlTransport();
  const transport = handle.transport;
  const durable = createDurableRuntimeComponents({ transport, clock });
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
    transport,
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
    engines: { escalations, runner },
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

/**
 * Compose a SECOND host over the SAME durable stores (the twin
 * transport) — the P002 "hard restart" semantics: a NEW composition with
 * NO graceful stop of the first (process-death approximation; disclosed
 * honestly in the evidence: no OS-level SIGKILL, the composition-level
 * kill the P002 acceptance battery defined).
 */
export async function composeRestartedHost(
  battery: AdversarialBattery,
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

// ---------------------------------------------------------------------------
// The adversarial HTTP client (plain fetch — no test doubles)
// ---------------------------------------------------------------------------

/** One raw HTTP exchange (status + headers + body text). */
export interface HttpExchange {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** POST JSON to an ACTUAL URL (the adversarial client). */
export async function postJson(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpExchange> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: flattenHeaders(response.headers), body: text };
}

/** GET an ACTUAL URL (the adversarial client). */
export async function getJson(
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpExchange> {
  const response = await fetch(url, { method: 'GET', headers: { ...headers } });
  const text = await response.text();
  return { status: response.status, headers: flattenHeaders(response.headers), body: text };
}

function flattenHeaders(headers: Headers): Record<string, string> {
  const flat: Record<string, string> = {};
  headers.forEach((value, name) => {
    flat[name] = value;
  });
  return flat;
}

/** Build an ES1.0 create body (the reference input, overridable). */
export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...referenceCreateInput(), ...overrides };
}

/** Parse a JSON body (the client-side parse — failures fail the test loudly). */
export function json(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The real webhook receiver (node:http on an ephemeral port)
// ---------------------------------------------------------------------------

/** One captured webhook delivery at the receiver. */
export interface CapturedWebhook {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  readonly at: number;
}

/** A configurable REAL HTTP webhook receiver (the consumer endpoint). */
export class WebhookReceiver {
  readonly deliveries: CapturedWebhook[] = [];
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
  battery: AdversarialBattery,
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
