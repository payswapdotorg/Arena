/**
 * The durable host runtime PRODUCTION COMPOSITION (Work Order P002;
 * issue #154; ADR-P001-01/02/07) — the M1-designated composition site
 * (packages/runtime-host/src/surfaces.ts: "the REAL classes satisfy
 * these interfaces structurally at the composition site (deploy/runtime
 * wiring); the parity is pinned by tests/runtime-host against the real
 * classes").
 *
 * This is where cross-SERVICE composition is legal: deploy/ is not a
 * boundary-checked workspace layer (scripts/boundary-check.mjs scans
 * apps/packages/services/adapters/bodies/environments — B2 forbids a
 * service importing another service, so the composition root that wires
 * services together lives HERE, the @arena/deploy standalone package,
 * through source-level aliases exactly like deploy/src/hosted).
 *
 * Composition (ADR-P001-07 — the host is the single composition root):
 *   - persistence: createDurableRuntimeComponents over ONE shared
 *     SqlTransport (injected, or the Neon HTTP driver discovered from
 *     DATABASE_URL / NEON_CONNECTION_STRING) — migrations 0001-0005 +
 *     the named durable-runtime statement set;
 *   - escalation lifecycle: services/escalation-api's REAL
 *     EscalationApiService over the durable escalation store + webhook
 *     outbox (the in-memory fabric stays test-only — L-001 closure),
 *     with the REAL routing service (services/escalation-routing)
 *     composed by default per R-007 and the labelled zero-dependency
 *     round-robin stub as the explicit fallback;
 *   - jobs: the ONE shared durable job runner (ADR-P001-01) —
 *     services/job-orchestrator's REAL JobOrchestrator over the durable
 *     job store + event sink (ONE DurableEventSink shared with the host
 *     core, so the audit-chain cache stays singular);
 *   - the host core: services/runtime-host's createRuntimeHost with the
 *     engines injected through the frozen package's structural surfaces.
 */

import { EscalationApiService, RoundRobinRoutingStub } from '@arena/escalation-api';
import type { RoutingPort } from '@arena/escalation-api';
import { EscalationRoutingService } from '@arena/escalation-routing-service';
import { JobOrchestrator } from '@arena/job-orchestrator';
import { SystemClock } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { createDurableRuntimeComponents, createRuntimeHost } from '@arena/runtime-host-service';
import type { RuntimeHostService } from '@arena/runtime-host-service';
import { createNeonHttpSqlTransport, readNeonConfigFromEnv } from '@arena/hosted-neon-postgres';
import type { SqlTransport } from '@arena/hosted-neon-postgres';

/** The routing composition (R-007: real service by default; stub fallback). */
export type RuntimeHostRoutingMode = 'escalation-routing' | 'reference-stub' | RoutingPort;

/** Options for `composeRuntimeHost` (the production composition). */
export interface ComposeRuntimeHostOptions {
  /** Env source (DATABASE_URL / NEON_CONNECTION_STRING); defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Injected SqlTransport — the ONLY infrastructure touchpoint. Overrides
   * env discovery (the acceptance battery injects an embedded real
   * Postgres transport; production composes the Neon HTTP driver).
   */
  readonly transport?: SqlTransport;
  /** Injected clock (A015 law; SystemClock default). */
  readonly clock?: Clock;
  /** Routing composition: the real service (default) or the labelled stub. */
  readonly routing?: RuntimeHostRoutingMode;
  /** Claim-lease duration for host-side job claiming (default 60s). */
  readonly leaseDurationMs?: number;
  /** The host instance identity recorded on leases (default 'arena-runtime-host'). */
  readonly hostInstanceId?: string;
}

/**
 * Compose the durable host runtime: durable ports + the REAL service
 * engines + the host core, over ONE shared transport. The returned host
 * is in the `constructed` state — call `start()` to apply migrations,
 * hydrate the audit tail and run the restart-recovery sweep.
 *
 * Without a usable transport (no injected transport, no
 * DATABASE_URL/NEON_CONNECTION_STRING) the composition still constructs,
 * but `start()` fails closed (state `failed` — never a partially-started
 * host; the zero-credential posture the hosted batteries prove).
 */
export async function composeRuntimeHost(
  options: ComposeRuntimeHostOptions = {},
): Promise<RuntimeHostService> {
  const clock = options.clock ?? new SystemClock();
  const envConfig = readNeonConfigFromEnv(options.env ?? process.env);
  const transport: SqlTransport | null =
    options.transport !== undefined
      ? options.transport
      : envConfig !== null
        ? createNeonHttpSqlTransport(envConfig.connectionString)
        : null;

  // The ONE durable component set (shared: engines + host core read the
  // same stores, the same DurableEventSink — one audit-chain cache).
  const durable =
    transport !== null
      ? createDurableRuntimeComponents({ transport, clock })
      : createDurableRuntimeComponents({
          ...(options.env !== undefined ? { env: options.env } : {}),
          clock,
        });

  const routing = resolveRouting(options.routing, clock);
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

  return createRuntimeHost({
    ...(transport !== null ? { transport } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    clock,
    engines: { escalations, runner },
    durable,
    ...(options.leaseDurationMs !== undefined
      ? { leaseDurationMs: options.leaseDurationMs }
      : {}),
    ...(options.hostInstanceId !== undefined
      ? { hostInstanceId: options.hostInstanceId }
      : {}),
  });
}

function resolveRouting(mode: RuntimeHostRoutingMode | undefined, clock: Clock): RoutingPort {
  if (mode === undefined || mode === 'escalation-routing') {
    // R-007: the host composes the REAL routing service; its own reference
    // fabric defaults are the zero-config composition surface.
    return new EscalationRoutingService({ clock });
  }
  if (mode === 'reference-stub') {
    // The labelled zero-dependency fallback (the escalation-api stub over
    // an empty qualified-expert directory — every escalation stays
    // `matching`, the honest no-match posture).
    return new RoundRobinRoutingStub({
      directory: { listQualifiedExperts: async () => [] },
    });
  }
  return mode;
}
