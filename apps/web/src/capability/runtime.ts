/**
 * Capability-flow runtime composition (Work Order B008; issue #80;
 * apps/web/src/capability). SERVER-ONLY surface.
 *
 * Two compositions feed the capability surfaces, mirroring the B007
 * cockpit wiring exactly:
 *
 *   SESSION composition — the authenticated `/cases`/`/tasks` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous surface);
 *     2. tenant/role facts come from the VALIDATED session's B003
 *        workspace context;
 *     3. ALL rendering reads go through the B005 read-API boundary
 *        (ReadApiService.handleReadRequest — tenant from the session);
 *     4. start/continue ACTIONS go through the @arena/product-flows
 *        runtime over the LOCAL control-plane posture (a server-process
 *        singleton FakeControlPlaneRepository — the B002 port; the
 *        customer-hosted write boundary is out of B-series scope).
 *
 *   DEMO composition — the B006 demo posture: the shared demo runtime
 *     (zero credentials, deterministic corpus, reserved demo tenant),
 *     reads through the SAME canonical read path (reusing the B007 demo
 *     cockpit context facts), flow writes through the demo store's own
 *     repository port, visibly labelled. Demo state is never customer
 *     state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched.
 */

import { ReadModelService } from '../../../../services/read-model/src/index.js';
import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';
import { createReadApiService } from '../../../../services/api-read/src/index.js';
import {
  FakeControlPlaneRepository,
  SystemClock,
} from '../../../../packages/persistence/src/index.js';
import type { ControlPlaneRepository } from '../../../../packages/persistence/src/index.js';
import { compileTarget } from '../../../../services/task-compiler/src/index.js';
import { createCompilationPolicy } from '../../../../packages/task-spec/src/index.js';
import { createProductFlowRuntime } from '../../../../packages/product-flows/src/index.js';
import type {
  ProductFlowRuntimeDeps,
  TaskComposerPort,
} from '../../../../packages/product-flows/src/index.js';
import type { AuthenticatedSession } from '../../../../services/auth/src/index.js';
import {
  readSessionCookieValue,
  sessionBoundary,
} from '../auth/session.js';
import { getDemoRuntime } from '../demo/runtime.js';
import {
  createReadApiPort,
  getDemoCockpitContext,
  sessionFacts,
} from '../cockpit/runtime.js';
import type { CockpitReadPort, CockpitSessionFacts, SessionProbe } from '../cockpit/runtime.js';

// ---------------------------------------------------------------------------
// The capability read port (same boundary-backed shape as the cockpit)
// ---------------------------------------------------------------------------

/** The read operations the capability surfaces perform (structural with the cockpit port). */
export type CapabilityReadPort = CockpitReadPort;

export type { CockpitSessionFacts as CapabilitySessionFacts };

// ---------------------------------------------------------------------------
// The guided task composer (A008 pure compiler, adapted at the app boundary)
// ---------------------------------------------------------------------------

/** The reference guided-flow compilation policy id (deterministic, disclosed). */
export const GUIDED_POLICY_ID = 'guided-flow-reference-policy' as const;

/**
 * The task composer the guided compose-task step uses: the A008 PURE
 * compiler (`compileTarget`) under a deterministic reference policy.
 * App→service→domain layering holds (the app adapts the service onto the
 * domain-pure product-flows port).
 */
async function guidedTaskComposer(): Promise<TaskComposerPort> {
  const policy = await createCompilationPolicy({
    policyId: GUIDED_POLICY_ID,
    version: '1.0.0',
    description: 'the deterministic reference policy the guided capability flow composes tasks under',
    eligibility: {
      compilableStatuses: ['triaged', 'active'],
      minimumEvidenceCount: 1,
    },
    classSelection: [
      { matcher: 'tools-present', class: 'tool-use' },
      { matcher: 'shortcuts-present', class: 'adversarial' },
      { matcher: 'always', class: 'correction' },
    ],
    difficulty: { mode: 'from-case', scale: 'arena:task-difficulty@1' },
    fieldMapping: {
      objectives: { mode: 'pass-through' },
      constraints: { mode: 'union', additional: ['attempt must be reproducible'] },
      prohibitedShortcuts: { mode: 'union', additional: ['no skipping the environment'] },
      permittedTools: { mode: 'pass-through' },
      expectedOutputs: { mode: 'from-success-conditions' },
      instructions: {
        mode: 'template',
        template:
          'Work the case {caseId} for capability {capability} in domain {domain} (difficulty {difficulty}); objectives: {objectives}.',
      },
    },
    environment: { selection: 'first', seed: 'guided-flow-seed-1', note: null },
    identity: { taskIdPrefix: 'task-', initialVersion: '1.0.0' },
    expertQualification: {
      mode: 'from-target-capability',
      expectations: ['qualified in the target capability within the last 180 days'],
      qualificationPolicy: {
        policyId: 'guided-flow-qualification-policy',
        version: '1.0.0',
        digest: '5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
      },
    },
    quality: [
      'realistic-context',
      'discriminative-difficulty',
      'observable-success',
      'reproducible-evaluation',
      'low-leakage',
      'clear-provenance',
      'declared-limitations',
    ].map((dimension) => ({
      dimension,
      satisfied: true,
      justification: `declared posture for ${dimension} under the guided reference policy`,
    })),
    longHorizon: null,
    dataRights: { classification: 'private-tenant', licensing: null, privacyNotes: null },
  });
  return (target) => compileTarget(target, policy);
}

/** The product-flows runtime type (start/continue/getCase over the B002 port). */
export type CapabilityFlowRuntime = ReturnType<typeof createProductFlowRuntime>;

/** Compose the product-flows runtime over a repository port (with the A008 composer). */
export async function createCapabilityFlowRuntime(deps: {
  readonly repository: ControlPlaneRepository;
}): Promise<CapabilityFlowRuntime> {
  const runtimeDeps: ProductFlowRuntimeDeps = {
    repository: deps.repository,
    composeTask: await guidedTaskComposer(),
  };
  return createProductFlowRuntime(runtimeDeps);
}

// ---------------------------------------------------------------------------
// SESSION composition (fail-closed B004 probe → B005 reads + flow runtime)
// ---------------------------------------------------------------------------

/**
 * The LOCAL control-plane posture for the authenticated session surface:
 * a server-process singleton FakeControlPlaneRepository over the B002
 * port. This is the disclosed LOCAL posture (the hosted write boundary is
 * out of B-series scope): it is not a cache of anything — it IS the store
 * the local posture writes through, empty per process.
 */
let localControlPlane: FakeControlPlaneRepository | undefined;

/** Get (or lazily compose) the local control-plane posture. */
export function getLocalControlPlane(): FakeControlPlaneRepository {
  localControlPlane ??= new FakeControlPlaneRepository({ clock: new SystemClock() });
  return localControlPlane;
}

/** Hard reset of the local posture (test seam; a process restart is the product reset). */
export function resetLocalControlPlane(): void {
  localControlPlane = undefined;
}

/** The outcome of probing the browser session for the capability surfaces. */
export type SessionCapabilityOutcome =
  | {
      readonly status: 'authenticated';
      readonly facts: CockpitSessionFacts;
      readonly port: CapabilityReadPort;
      /** The flow runtime over the LOCAL posture (start/continue actions). */
      readonly flow: CapabilityFlowRuntime;
    }
  | {
      /** Fail closed: no authenticated session — the surface renders the sign-in gate, never anonymous state. */
      readonly status: 'unauthenticated';
      readonly code: string;
    };

/** True iff a thrown value carries a typed AUTH_* code (the B004 fail-closed vocabulary). */
function isTypedAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('AUTH_');
}

export interface ResolveSessionCapabilityOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  /** Repository override for the flow runtime (composition seam). */
  readonly repository?: ControlPlaneRepository;
}

/**
 * Resolve the session capability composition: probe the browser session
 * THROUGH the B004 boundary (fail closed), then expose the session
 * facts + the B005 read port + the product-flows runtime over the local
 * posture repository.
 */
export async function resolveSessionCapability(
  options: ResolveSessionCapabilityOptions = {},
): Promise<SessionCapabilityOutcome> {
  const probe: SessionProbe =
    options.probe ?? {
      cookieValue: () => readSessionCookieValue(),
      validate: (token: string) => sessionBoundary().service.validateSession(token),
    };
  let cookieValue: string | null;
  try {
    cookieValue = await probe.cookieValue();
  } catch (error) {
    if (isTypedAuthFailure(error)) {
      return { status: 'unauthenticated', code: String((error as { code: string }).code) };
    }
    throw error;
  }
  if (cookieValue === null) {
    return { status: 'unauthenticated', code: 'AUTH_SESSION_NOT_FOUND' };
  }
  let session: AuthenticatedSession;
  try {
    session = await probe.validate(cookieValue);
  } catch (error) {
    if (isTypedAuthFailure(error)) {
      return { status: 'unauthenticated', code: String((error as { code: string }).code) };
    }
    throw error;
  }
  const facts = sessionFacts(session);
  const repository = options.repository ?? getLocalControlPlane();
  const readModel: CanonicalReadModel =
    options.readModel ?? new ReadModelService({ repository, clock: new SystemClock() });
  // The B005 read-API boundary, sealed with the validated cookie value
  // (tenant from the session, never the client — the cockpit posture).
  const api = createReadApiService({
    auth: {
      // The SAME B004 validation the probe performed — the boundary never
      // trusts a token it did not validate itself.
      validateSession: (token: string) => probe.validate(token),
    },
    readModel,
  });
  const port = createReadApiPort({ api, sessionToken: cookieValue });
  const flow = await createCapabilityFlowRuntime({ repository });
  return { status: 'authenticated', facts, port, flow };
}

// ---------------------------------------------------------------------------
// DEMO composition (B006 runtime; canonical reads; demo labelling)
// ---------------------------------------------------------------------------

/** The demo capability context: facts + reads + flow + the determinism stamp. */
export interface DemoCapabilityContext {
  readonly facts: CockpitSessionFacts;
  readonly port: CapabilityReadPort;
  readonly flow: CapabilityFlowRuntime;
  readonly corpusHash: string;
}

let demoContext: Promise<DemoCapabilityContext> | undefined;

/**
 * The demo capability context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset + process
 * restart). Reads go through the canonical read path (reusing the B007
 * demo cockpit context); flow writes go through the demo store's own B002
 * repository port under the reserved demo tenant — visibly labelled,
 * never customer state.
 */
export function getDemoCapabilityContext(): Promise<DemoCapabilityContext> {
  demoContext ??= (async () => {
    const runtime = await getDemoRuntime();
    const cockpit = await getDemoCockpitContext();
    const flow = await createCapabilityFlowRuntime({ repository: runtime.store.repository });
    return Object.freeze({
      facts: cockpit.facts,
      port: cockpit.port,
      flow,
      corpusHash: cockpit.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo capability context (test seam). */
export function resetDemoCapabilityContext(): void {
  demoContext = undefined;
}
