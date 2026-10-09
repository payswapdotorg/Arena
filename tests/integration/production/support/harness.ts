/**
 * tests/integration/production/support/harness.ts — the P006 integrated
 * acceptance deployment boot (Work Order P006; issue #158; ADR-P001-01/
 * 02/03/04/07/08).
 *
 * Boots the REAL integrated deployment the P006 mission names — "the
 * REAL composition (deploy/runtime/src/composition.ts pattern or
 * services/runtime-host) + the REAL public transport
 * (services/escalation-api/src/http-host listener on a real port) over
 * the durable stores":
 *
 *   - the durable stores: the REAL `createDurableRuntimeComponents`
 *     over ONE shared SqlTransport — the embedded real PostgreSQL 17
 *     engine (@electric-sql/pglite) for the zero-credential CI path
 *     (the P002 battery's engine precedent; the live-Neon optional path
 *     is env-gated in composition.e2e.test.ts, not here);
 *   - the REAL service engines, injected through the frozen host seam
 *     `createRuntimeHost` — mirroring deploy/runtime/src/composition.ts
 *     VERBATIM (EscalationApiService over durable.escalationStore +
 *     durable.webhookOutbox with the REAL routing service; the ONE
 *     shared durable JobOrchestrator over durable.jobStore +
 *     durable.eventSink). TWO deliberate, disclosed differences from
 *     the verbatim composition call (the accepted tests/api-host
 *     battery precedent):
 *       1. the routing option wires the REAL EscalationRoutingService
 *          over a REAL capability graph + routing-candidate directory
 *          (support/expert-side.ts — the A004/A006 host wiring the
 *          composition's `routing` option exists for; the composition's
 *          zero-config default is the honest empty-pool no-match
 *          posture, which composition.e2e.test.ts proves verbatim);
 *       2. the battery KEEPS the engine + durable handles so the
 *          ARENA-side driver (operators/experts — never a client) can
 *          drive recordExpertAction / sweepTimeouts and compose the
 *          payment service over the same durable stores. CLIENTS never
 *          see these handles — they talk to the ACTUAL local URL only.
 *   - the REAL public transport: startEscalationHttpHost on an
 *     ephemeral port over the frozen host surface (host.escalations +
 *     host.health) + the REAL developer-platform key model behind the
 *     authenticator port + the REAL webhook-delivery service
 *     (createWebhookDeliveryService) draining the REAL durable outbox
 *     over real HTTP once a client registers its webhook receiver;
 *   - the Arena-side payment service (services/payments' REAL
 *     PaymentService over the frozen host surface reads + the REAL
 *     DemoPaymentProvider from adapters/payments — the
 *     executesCustomerMoney=false sandbox posture).
 *
 * DISCLOSURE (evidence classes): the persistence engine class per run
 * is the EMBEDDED real Postgres (PGlite) — AUTOMATED-TEST-ONLY per
 * spec/post-roadmap-release-gate.md §3 unless a live-Neon URL is
 * provided (composition.e2e.test.ts). The payment provider is the DEMO
 * provider (demo money only; executesCustomerMoney=false). The payment
 * event outbox is the payments service's in-process reference outbox
 * (P002's durable component set carries the escalation/job/event/
 * projection stores; a durable payment outbox is not among them —
 * clients observe payment truth through the public record's cost
 * fields and the escalation.payment.updated lifecycle event).
 */

import { ManualClock } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { EscalationApiService } from '@arena/escalation-api';
import { JobOrchestrator } from '@arena/job-orchestrator';
import {
  createDurableRuntimeComponents,
  createRuntimeHost,
} from '@arena/runtime-host-service';
import type {
  DurableRuntimeComponents,
  RuntimeHostService,
} from '@arena/runtime-host-service';
import type { SqlTransport } from '@arena/hosted-neon-postgres';
import { startEscalationHttpHost } from '@arena/escalation-api/http-host';
import type { HostHealthProvider } from '@arena/escalation-api/http-host';
import {
  createWebhookDeliveryService,
  createNodeWebhookHttpTransport,
} from '@arena/webhook-delivery';
import type { WebhookDeliveryService } from '@arena/webhook-delivery';
import { hmacSha256WebhookSigner } from '@arena/escalation-adapters';
import type { WebhookSigner } from '@arena/escalation-adapters';
import {
  InMemoryPaymentEventOutbox,
  InMemoryPaymentLedgerStore,
  PaymentService,
} from '@arena/payments-service';
import type { PaymentService as ArenaPaymentService } from '@arena/payments-service';
import { DemoPaymentProvider, DEMO_PROVIDER_POSTURE } from '@arena/payments-adapters';
import {
  authorizeDeveloperKey,
  createNodeSecretHasher,
  createNodeSecretMaterialGenerator,
  issueDeveloperKey,
  revokeDeveloperKey,
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
import { createEmbeddedPostgresTransport } from './embedded-postgres.js';
import type { EmbeddedPostgresHandle } from './embedded-postgres.js';
import { buildRoutingPort } from './expert-side.js';

/** The battery's pinned clock origin (A015 law — injected, deterministic). */
export const T0 = Date.parse('2026-10-09T12:00:00.000Z');

/** The battery's webhook signing material (host-injected at composition). */
export const SIGNING_KEY_ID = 'p006-integrated-signer';
export const SIGNING_HMAC_INPUT = 'whsec_' + 'b'.repeat(64);

// ---------------------------------------------------------------------------
// The developer-platform key registry (the REAL key model)
// ---------------------------------------------------------------------------

/** A live-tenant key request for the registry. */
export interface KeyRequest {
  readonly tenantId: string;
  readonly environment?: DeveloperKeyEnvironment;
  readonly scopes?: readonly DeveloperKeyScope[];
  readonly label?: string;
  readonly clientAppId?: string;
}

/**
 * The REAL developer-platform key registry backing the public
 * transport's authenticator port (issueDeveloperKey /
 * authorizeDeveloperKey over the real node secret hasher + material
 * generator — a real key registry with real secret hashes, never a
 * stub verdict).
 */
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

  /** Issue a key through the REAL issuance path (secret shown once). */
  issue(request: KeyRequest): DeveloperKeyIssuance {
    const issuance = issueDeveloperKey(
      {
        clientAppId: request.clientAppId ?? 'generic-ai-app',
        tenantId: request.tenantId,
        environment: request.environment ?? 'live',
        scopes: request.scopes ?? ['escalations:create', 'escalations:read'],
        label: request.label ?? 'P006 integrated battery key',
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

  /** The authenticator port over the REAL authorization function. */
  authenticator() {
    return {
      authenticate: async (input: {
        readonly presentedSecret: string;
        readonly scope: 'escalations:create' | 'escalations:read' | 'sandbox:run' | 'webhooks:manage' | 'observability:read';
        readonly environment: 'sandbox' | 'live';
      }) => {
        // Resolve the key by secret hash across the registry (the real
        // model's secret-hash lookup; the boundary DERIVES the tenant
        // from the resolved key — never from a client-claimed field).
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
          return { outcome: 'denied' as const, reason: verdict.reason };
        }
        return {
          outcome: 'authorized' as const,
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
// The integrated deployment
// ---------------------------------------------------------------------------

/** One booted integrated deployment (the ACTUAL local URL stack). */
export interface IntegratedDeployment {
  readonly engineClass: 'embedded-postgres' | 'live-neon';
  readonly clock: ManualClock;
  readonly transport: SqlTransport;
  readonly host: RuntimeHostService;
  readonly durable: DurableRuntimeComponents;
  /**
   * The ARENA-side operator handles (engine + payment service). These
   * are the composition-root handles a deployed host's operators use —
   * they are NEVER handed to a client; both P006 clients observe the
   * flow ONLY through the public transport (ADR-P001-07/08).
   */
  readonly arena: {
    readonly escalations: EscalationApiService;
    readonly runner: JobOrchestrator;
    readonly payments: ArenaPaymentService;
    readonly paymentProviderPosture: typeof DEMO_PROVIDER_POSTURE;
  };
  readonly keys: DeveloperKeyRegistry;
  /** The ACTUAL local URL both clients talk to (public transport only). */
  readonly baseUrl: string;
  readonly signer: WebhookSigner;
  /**
   * HARD PROCESS RESTART: stop the host + close the listener, then boot
   * a FRESH host + listener over the SAME durable transport (the
   * database survives the process; nothing else does). Returns the new
   * deployment; this object is dead afterwards.
   */
  restartHard(): Promise<IntegratedDeployment>;
  close(): Promise<void>;
}

export interface BootIntegratedDeploymentOptions {
  /** Injected durable transport (the restart test reuses the engine). */
  readonly transport?: SqlTransport;
  /** An already-open embedded engine handle to close on close(). */
  readonly engineHandle?: EmbeddedPostgresHandle;
  /** Clock origin (default T0). */
  readonly clockStart?: number;
  /** The engine class recorded on the deployment (evidence honesty). */
  readonly engineClass?: 'embedded-postgres' | 'live-neon';
}

/**
 * Boot the full integrated deployment: durable stores + REAL engines
 * through the frozen host seam + the REAL public HTTP listener + the
 * REAL key model + the Arena-side payment service over the demo
 * provider. `start()` applies the durable migrations from zero and runs
 * the restart-recovery sweep (the P002 semantics).
 */
export async function bootIntegratedDeployment(
  options: BootIntegratedDeploymentOptions = {},
): Promise<IntegratedDeployment> {
  const clock = new ManualClock(options.clockStart ?? T0);
  const engineHandle =
    options.engineHandle ?? (await createEmbeddedPostgresTransport());
  const transport =
    options.transport ?? options.engineHandle?.transport ?? engineHandle.transport;
  const engineClass = options.engineClass ?? 'embedded-postgres';

  // The ONE durable component set (shared: engines + host core read the
  // same stores, the same DurableEventSink — one audit-chain cache) —
  // the deploy/runtime/src/composition.ts wiring.
  const durable = createDurableRuntimeComponents({ transport, clock });

  // The REAL routing service over the wired expert read surface (the
  // composition's `routing` option — support/expert-side.ts).
  const routing = await buildRoutingPort(clock);

  // The production engine wiring (deploy/runtime/src/composition.ts
  // verbatim): the REAL EscalationApiService over the durable
  // escalation store + webhook outbox, and the ONE shared durable job
  // runner (ADR-P001-01).
  const escalations = new EscalationApiService({
    clock,
    store: durable.escalationStore,
    outbox: durable.webhookOutbox,
    routing,
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

  // The Arena-side payment service: the REAL PaymentService over the
  // frozen host surface reads (lifecycle port) + the REAL demo provider
  // (executesCustomerMoney=false — CI moves NO real money).
  const paymentProvider = new DemoPaymentProvider({ clock });
  const payments = new PaymentService({
    clock,
    store: new InMemoryPaymentLedgerStore(),
    outbox: new InMemoryPaymentEventOutbox(),
    lifecycle: {
      get: async (requestId: string, tenantId: string) => {
        try {
          const status = await host.escalations.status(tenantId, requestId);
          const record = status.record;
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
        } catch {
          return undefined;
        }
      },
    },
    provider: paymentProvider,
  });

  // The REAL public transport: HTTP listener on an ephemeral port over
  // the frozen host surface + health + the REAL key model.
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

  const signer = hmacSha256WebhookSigner({
    signingKeyId: SIGNING_KEY_ID,
    hmacInput: SIGNING_HMAC_INPUT,
  });

  let closed = false;
  const deployment: IntegratedDeployment = {
    engineClass,
    clock,
    transport,
    host,
    durable,
    arena: {
      escalations,
      runner,
      payments,
      paymentProviderPosture: DEMO_PROVIDER_POSTURE,
    },
    keys,
    baseUrl: running.url,
    signer,
    async restartHard(): Promise<IntegratedDeployment> {
      if (closed) {
        throw new Error('restartHard() on a closed deployment');
      }
      // The process dies: the listener and the host stop; the durable
      // transport (the database) survives.
      await running.close();
      await host.stop();
      closed = true;
      return bootIntegratedDeployment({
        transport,
        engineHandle,
        engineClass,
        clockStart: clock.now(),
      });
    },
    async close(): Promise<void> {
      if (closed) {
        await engineHandle.close();
        return;
      }
      closed = true;
      await running.close();
      await host.stop();
      await engineHandle.close();
    },
  };
  return deployment;
}

// ---------------------------------------------------------------------------
// The webhook delivery composition (the REAL service over the REAL outbox)
// ---------------------------------------------------------------------------

/**
 * Compose the REAL webhook-delivery service over the deployment's REAL
 * durable outbox, delivering signed events to the client's endpoint.
 * `startWebhookDelivery` returns the service plus the drain helper the
 * Arena side (never the client) pumps.
 */
export function webhookDelivery(
  deployment: IntegratedDeployment,
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
      listPending: () => deployment.durable.webhookOutbox.listPending(),
      markDelivered: (eventId, at) =>
        deployment.durable.webhookOutbox.markDelivered(eventId, at),
    },
    endpoint: { url: endpointUrl },
    signer: deployment.signer,
    clock: deployment.clock,
    ...(options.timeoutMs !== undefined
      ? { transport: createNodeWebhookHttpTransport({ timeoutMs: options.timeoutMs }) }
      : {}),
    ...(options.backoff !== undefined ? { backoff: options.backoff } : {}),
  });
}
