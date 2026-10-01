/**
 * Cockpit runtime composition (Work Order B007; issue #78;
 * apps/web/src/cockpit). SERVER-ONLY surface.
 *
 * Two compositions feed the cockpit, both reading THROUGH versioned
 * boundaries — the cockpit never talks to a repository directly and never
 * invents a second data model:
 *
 *   SESSION composition — the authenticated `/` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous session);
 *     2. the tenant/workspace/role facts come from the VALIDATED session's
 *        B003 workspace context (tenant from the session, never the
 *        client);
 *     3. every canonical read goes through the B005 read-API boundary
 *        (`ReadApiService.handleReadRequest(cookieValue, request)`) — the
 *        versioned, auth-gated, tenant-scoped envelope protocol.
 *
 *   DEMO composition — the B006 demo posture: the shared demo runtime
 *     (zero credentials, deterministic corpus, reserved demo tenant) with
 *     reads through the SAME canonical read path (`DemoReadSession` over
 *     the B005 read model), visibly labelled per the demo labelling
 *     contract. Demo state is never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/auth and apps/web/src/demo).
 */

import {
  createReadApiService,
  parseReadApiEnvelope,
} from '../../../../services/api-read/src/index.js';
import type { ReadApiService } from '../../../../services/api-read/src/index.js';
import { ReadModelService } from '../../../../services/read-model/src/index.js';
import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';
import type {
  CanonicalRead,
  KindInventory,
  ReadPage,
  ReadModelKind,
} from '../../../../packages/read-model/src/index.js';
import {
  ROLE_IDS,
  createPermissionPolicy,
  createWorkspaceContext,
  grantRole,
  grantedRoleIds,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId, WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import {
  FakeControlPlaneRepository,
  SystemClock,
} from '../../../../packages/persistence/src/index.js';
import { DEMO_NARRATIVE_TIME_ISO, isDemoTenant } from '@arena/demo';
import type { AuthenticatedSession } from '../../../../services/auth/src/index.js';
import {
  readSessionCookieValue,
  sessionBoundary,
} from '../auth/session.js';
import { getDemoRuntime } from '../demo/runtime.js';

// ---------------------------------------------------------------------------
// The cockpit read port (narrow, boundary-backed)
// ---------------------------------------------------------------------------

/**
 * The read operations the cockpit performs. Structurally satisfied by the
 * B006 `DemoReadSession`; the session composition adapts the B005
 * `ReadApiService` onto it.
 */
export interface CockpitReadPort {
  read(recordId: string): Promise<CanonicalRead>;
  scroll(kind: ReadModelKind): Promise<ReadPage>;
  inventory(): Promise<KindInventory>;
}

/** Fail-closed unwrap of a read-API envelope (typed error on any failure). */
function unwrapEnvelope(kind: string, envelope: unknown): unknown {
  const parsed = parseReadApiEnvelope(envelope);
  if (parsed.ok) return parsed.result;
  const error = parsed.error;
  throw new Error(
    `cockpit read failed (fail closed) [${kind}]: ${String(error.code)} — ${error.message}`,
  );
}

/** Adapt the B005 read-API boundary onto the cockpit read port. */
export function createReadApiPort(deps: {
  readonly api: ReadApiService;
  readonly sessionToken: string;
}): CockpitReadPort {
  const { api, sessionToken } = deps;
  return {
    async read(recordId: string): Promise<CanonicalRead> {
      const outcome = await api.handleReadRequest(sessionToken, {
        kind: 'read-canonical',
        recordId,
      });
      return unwrapEnvelope('read-canonical', outcome.envelope) as CanonicalRead;
    },
    async scroll(kind: ReadModelKind): Promise<ReadPage> {
      const outcome = await api.handleReadRequest(sessionToken, {
        kind: 'scroll-by-kind',
        recordKind: kind,
      });
      return unwrapEnvelope('scroll-by-kind', outcome.envelope) as ReadPage;
    },
    async inventory(): Promise<KindInventory> {
      const outcome = await api.handleReadRequest(sessionToken, { kind: 'list-kinds' });
      return unwrapEnvelope('list-kinds', outcome.envelope) as KindInventory;
    },
  };
}

// ---------------------------------------------------------------------------
// Session facts (from the VALIDATED session — never from the client)
// ---------------------------------------------------------------------------

/** The session facts the cockpit lens needs (no permission interpretation). */
export interface CockpitSessionFacts {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly grantedRoleIds: readonly RoleId[];
}

/**
 * Project the B003 workspace context of a validated session into cockpit
 * facts. The permission policy is carried, never interpreted; the granted
 * role ids are read from the grant chain (identity → tenant → policy →
 * granted roles → active role context).
 */
export function sessionFacts(session: AuthenticatedSession): CockpitSessionFacts {
  const workspace: WorkspaceContext = session.workspaceContext;
  if (String(workspace.tenantId) !== String(session.tenantId)) {
    throw new Error(
      `session tenant ${String(session.tenantId)} does not match workspace tenant ${String(workspace.tenantId)} (fail closed)`,
    );
  }
  const label =
    session.principal.label !== undefined && session.principal.label !== null
      ? String(session.principal.label)
      : String(session.principal.principalId);
  return Object.freeze({
    tenantId: String(session.tenantId),
    workspaceId: String(workspace.workspaceId),
    principalLabel: label,
    grantedRoleIds: Object.freeze([...grantedRoleIds(workspace)]),
  });
}

/**
 * The session probe: how the cockpit reads + validates the browser
 * session. The default uses the B004 boundary (cookie value +
 * `sessionBoundary().service.validateSession`); tests inject their own.
 */
export interface SessionProbe {
  /** The sealed session cookie value from the request, or null when absent. */
  cookieValue(): Promise<string | null>;
  /** Validate a sealed cookie value through the B004 boundary (typed AUTH_* failures). */
  validate(token: string): Promise<AuthenticatedSession>;
}

/** The outcome of probing the browser session for the cockpit home. */
export type SessionCockpitOutcome =
  | {
      readonly status: 'authenticated';
      readonly facts: CockpitSessionFacts;
      readonly port: CockpitReadPort;
    }
  | {
      /** Fail closed: no authenticated session — the caller renders the first-run landing, never an anonymous cockpit. */
      readonly status: 'unauthenticated';
      /** The typed AUTH_* code that closed the door (observability, never customer data). */
      readonly code: string;
    };

export interface ResolveSessionCockpitOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /** Read-model override (composition seam); default: local-parity fake-backed service. */
  readonly readModel?: CanonicalReadModel;
}

/** True iff a thrown value carries a typed AUTH_* code (the B004 fail-closed vocabulary). */
function isTypedAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('AUTH_');
}

/**
 * Resolve the session cockpit: read the session cookie, validate it
 * THROUGH the B004 boundary (fail closed on every typed AUTH_* outcome —
 * the home route then shows the first-run landing), then expose the
 * session facts + a read port THROUGH the B005 read-API boundary, sealed
 * with the validated cookie value.
 */
export async function resolveSessionCockpit(
  options: ResolveSessionCockpitOptions = {},
): Promise<SessionCockpitOutcome> {
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
  const readModel: CanonicalReadModel =
    options.readModel ??
    new ReadModelService({
      repository: new FakeControlPlaneRepository(),
      clock: new SystemClock(),
    });
  const api = createReadApiService({
    auth: {
      // The SAME B004 validation the probe performed — the boundary never
      // trusts a token it did not validate itself.
      validateSession: (token: string) => probe.validate(token),
    },
    readModel,
  });
  const port = createReadApiPort({ api, sessionToken: cookieValue });
  return { status: 'authenticated', facts, port };
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; demo labelling)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo cockpit context: facts + reads + the determinism stamp. */
export interface DemoCockpitContext {
  readonly facts: CockpitSessionFacts;
  readonly port: CockpitReadPort;
  readonly corpusHash: string;
}

/**
 * Build the demo workspace context: the reserved demo tenant, an opaque
 * demo lens policy, and one demo-provenance grant per reference role.
 * These are DEMO LENS grants in the reserved demo tenant — deterministic
 * narrative state, never customer authorization.
 */
function buildDemoWorkspaceContext(): WorkspaceContext {
  const grants = ROLE_IDS.map((roleId) =>
    grantRole({
      grantId: `demo-grant-${roleId}`,
      identityId: 'demo-visitor',
      tenantId: 'arena-demo',
      roleId,
      policyId: 'demo-lens-policy',
      grantedBy: 'arena-demo-mode',
      grantedAt: DEMO_NARRATIVE_TIME_ISO,
      note: 'deterministic demo lens grant — never customer authorization',
      validFrom: DEMO_NARRATIVE_TIME_ISO,
    }),
  );
  return createWorkspaceContext({
    identityId: 'demo-visitor',
    tenantId: 'arena-demo',
    workspaceId: DEMO_WORKSPACE_ID,
    permissionPolicy: createPermissionPolicy({
      policyId: 'demo-lens-policy',
      tenantId: 'arena-demo',
      descriptor: {
        kind: 'demo-lens-policy',
        note: 'opaque demo descriptor — carried, never interpreted',
      },
      issuedAt: DEMO_NARRATIVE_TIME_ISO,
    }),
    grantedRoles: grants,
  });
}

let demoContext: Promise<DemoCockpitContext> | undefined;

/**
 * The demo cockpit context over the SHARED B006 demo runtime (module
 * singleton — deterministic, resettable through /demo/reset). Reads go
 * through the canonical read path (DemoReadSession over the B005 read
 * model), scoped to the reserved demo tenant.
 */
export function getDemoCockpitContext(): Promise<DemoCockpitContext> {
  demoContext ??= (async () => {
    const runtime = await getDemoRuntime();
    if (!isDemoTenant(runtime.session.tenantId)) {
      throw new Error('demo cockpit context requires the reserved demo tenant (fail closed)');
    }
    const workspace = buildDemoWorkspaceContext();
    return Object.freeze({
      facts: Object.freeze({
        tenantId: String(runtime.session.tenantId),
        workspaceId: DEMO_WORKSPACE_ID,
        principalLabel: 'demo-visitor',
        grantedRoleIds: Object.freeze([...grantedRoleIds(workspace)]),
      }),
      port: runtime.reads,
      corpusHash: runtime.corpusHash,
    });
  })();
  return demoContext;
}

/** Hard reset of the cached demo cockpit context (test seam; /demo/reset re-seeds the runtime itself). */
export function resetDemoCockpitContext(): void {
  demoContext = undefined;
}
