/**
 * Demo-mode server composition (Work Order B006; issue #73;
 * apps/web/src/demo). SERVER-ONLY surface.
 *
 * Composes the zero-credential demo session through B004's local/fake
 * wiring (`createLocalAuthStack` with ONE caller-registered demo
 * credential — no provider, no real secret), the deterministic demo
 * store (in-memory fake over the B002 ports) and the B005
 * `ReadModelService` so every demo read flows THROUGH the canonical read
 * path, scoped to the reserved demo tenant.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/auth; the boundary layer rules stay
 * satisfied: app -> service -> domain).
 *
 * Determinism: the composition uses ONLY fixed constants — the demo
 * session secret is a long fixed demo-only string (never a customer
 * secret; demo sessions are disposable and carry no authority), the
 * clock is a ManualClock frozen at the narrative epoch, and the corpus
 * is the frozen @arena/demo corpus. Two renders are byte-identical.
 */

import {
  DEMO_ERROR_CODES,
  DEMO_NARRATIVE_EPOCH_MS,
  DEMO_TENANT_ID,
  DemoError,
  createDemoReadSession,
  createInMemoryDemoStore,
} from '@arena/demo';
import type { DemoReadSession, DemoStore } from '@arena/demo';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import { createLocalAuthStack } from '../../../../services/auth/src/local.js';
import { createAuthMethodDescriptor } from '../../../../packages/auth/src/index.js';
import { ManualClock } from '../../../../packages/persistence/src/index.js';
import { toSecurityPrincipal } from '../../../../packages/security/src/index.js';

/** The fixed, demo-only session secret (>= 32 chars; NEVER a real secret). */
const DEMO_SESSION_SECRET =
  'arena-demo-mode-fixed-session-secret-0123456789abcdef' as const;

/** The fixed demo credential method (local parity seam; zero providers). */
const DEMO_CREDENTIAL_METHOD = 'demo-local' as const;
/** The fixed demo credential claim (deterministic descriptor match). */
const DEMO_CREDENTIAL_CLAIM = { demo: 'arena-demo-mode' } as const;

/** The authenticated zero-credential demo session view. */
export interface DemoSession {
  readonly tenantId: typeof DEMO_TENANT_ID;
  readonly principalId: string;
  readonly issuedAt: number;
}

/** The composed demo runtime (session + store + canonical read session). */
export interface DemoRuntime {
  readonly session: DemoSession;
  readonly store: DemoStore;
  readonly reads: DemoReadSession;
  /** The corpus hash of the currently-seeded demo state (testable determinism). */
  readonly corpusHash: string;
}

/**
 * Compose a FRESH demo runtime: zero-credential authentication through
 * the B004 local stack, deterministic seeding, and canonical reads.
 */
export async function createDemoRuntime(): Promise<DemoRuntime> {
  // 1) Zero-credential demo session through the B004 local/fake wiring.
  const auth = createLocalAuthStack({
    secret: DEMO_SESSION_SECRET,
    credentials: [
      {
        credential: createAuthMethodDescriptor({
          method: DEMO_CREDENTIAL_METHOD,
          claims: DEMO_CREDENTIAL_CLAIM,
        }),
        principal: toSecurityPrincipal({
          recordVersion: 1,
          principalId: 'principal-demo-001',
          kind: 'customer-identity',
          tenantScope: DEMO_TENANT_ID,
          roles: ['tenant-owner'],
          label: 'demo-visitor',
        }),
      },
    ],
    clock: new ManualClock(DEMO_NARRATIVE_EPOCH_MS),
  });
  const principal = await auth.service.authenticate({
    method: DEMO_CREDENTIAL_METHOD,
    claims: DEMO_CREDENTIAL_CLAIM,
  });
  if (String(principal.tenantScope) !== DEMO_TENANT_ID) {
    throw new DemoError(DEMO_ERROR_CODES.SCOPE_VIOLATION, {
      message: 'the demo principal must be scoped to the reserved demo tenant',
      details: { principalTenant: String(principal.tenantScope) },
    });
  }

  // 2) The deterministic demo store (in-memory fake; B015 may inject a
  //    hosted ControlPlaneRepository through the SAME port later).
  const store = createInMemoryDemoStore();

  // 3) Canonical reads THROUGH the B005 read-model service.
  const readModel = new ReadModelService({
    repository: store.repository,
    clock: store.clock,
  });
  const reads = createDemoReadSession({ readModel });

  // 4) Idempotent seed (re-running produces the identical corpus).
  const report = await store.seed();

  return Object.freeze({
    session: Object.freeze({
      tenantId: DEMO_TENANT_ID,
      principalId: String(principal.principalId),
      issuedAt: DEMO_NARRATIVE_EPOCH_MS,
    }),
    store,
    reads,
    corpusHash: report.corpusHash,
  });
}

/** The fixed demo clock: a ManualClock frozen at the narrative epoch. */
export function demoClock(): ManualClock {
  return new ManualClock(DEMO_NARRATIVE_EPOCH_MS);
}

// ---------------------------------------------------------------------------
// Module singleton: the demo runtime is composed once per server process
// and reset on demand (POST /demo/reset). Seeding is idempotent, so this
// is a determinism-preserving cache, never a second authority.
// ---------------------------------------------------------------------------

let runtime: Promise<DemoRuntime> | undefined;

/** Get (or lazily compose) the shared demo runtime. */
export function getDemoRuntime(): Promise<DemoRuntime> {
  runtime ??= createDemoRuntime();
  return runtime;
}

/** Hard reset: drop the cached runtime so the next access recomposes + reseeds. */
export function resetDemoRuntime(): void {
  runtime = undefined;
}

/** Re-export the labelling contract so demo surfaces import ONE module for it. */
export { DEMO_LABELLING } from '@arena/demo';
