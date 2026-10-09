/**
 * The developer-portal write runtime (P005/S-03): the HOST-side
 * composition the portal's interactive write routes call — the REAL
 * `DeveloperPlatformService` over the REAL escalation seam, exactly the
 * wiring `apps/web/src/developers`' own `createDevelopersRuntime`
 * composes for the demo corpus, but as a PROCESS-SINGLETON with a LIVE
 * clock so console writes stamp real time and persist for the life of
 * the server process.
 *
 * Posture (honest, disclosed):
 *   - LOCAL PARITY: the key store is the in-memory reference fabric —
 *     the durable control-plane store is P002's work order; when it
 *     lands, this composition swaps the store, not the routes.
 *   - The write functions themselves are the service's own public API
 *     (registerClientApp / issueKey / rotateKey / revokeKey /
 *     runSandboxEscalation) — no domain surface is invented here
 *     (ADR-P001-09's constraint; the append-only key lifecycle and the
 *     `keys:manage` non-delegation law stay in the domain).
 *   - Session-authority: key MANAGEMENT is console authority (the
 *     tenant comes from the VALIDATED session, never the request
 *     body); SANDBOX RUNS authorize with a presented key secret, the
 *     same seam P003's public transport binds (ADR-P001-08).
 */

import {
  adaptEscalationApiService,
  DeveloperPlatformService,
  InMemoryDeveloperKeyStore,
} from '../../../../../../services/developer-platform/src/index.js';
import {
  EscalationApiService,
  REFERENCE_EXPERTS,
} from '../../../../../../services/escalation-api/src/index.js';
import {
  constantSandboxCapacity,
  createNodeSecretHasher,
  createNodeSecretMaterialGenerator,
} from '../../../../../../packages/developer-platform/src/index.js';

/** Compose the host write runtime (the B2 adapter seam is host-owned). */
export function composePortalRuntime(): DeveloperPlatformService {
  const clock = { now: () => Date.now() };
  const escalation = new EscalationApiService({
    clock,
    directory: { listQualifiedExperts: async () => REFERENCE_EXPERTS },
  });
  return new DeveloperPlatformService({
    clock,
    store: new InMemoryDeveloperKeyStore(),
    escalation: adaptEscalationApiService(escalation),
    capacity: constantSandboxCapacity('AVAILABLE'),
    hasher: createNodeSecretHasher(),
    material: createNodeSecretMaterialGenerator(),
  });
}

let runtime: DeveloperPlatformService | undefined;

/** The process-local portal write runtime (lazily composed; resettable for tests). */
export function getPortalRuntime(): DeveloperPlatformService {
  runtime ??= composePortalRuntime();
  return runtime;
}

/** Reset the runtime (the test seam; drops the in-memory key store). */
export function resetPortalRuntime(): void {
  runtime = undefined;
}
