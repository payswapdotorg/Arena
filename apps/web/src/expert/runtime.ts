/**
 * Expert Workbench runtime composition (Work Order B009; issue #81;
 * apps/web/src/expert). SERVER-ONLY surface.
 *
 * Two compositions feed the expert workbench, both reading THROUGH
 * versioned boundaries — the workbench never talks to a repository for
 * RENDER reads and never invents a second data model:
 *
 *   SESSION composition — the authenticated `/expert` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous workbench);
 *     2. the tenant/workspace/principal facts come from the VALIDATED
 *        session's B003 workspace context (tenant from the session, never
 *        the client);
 *     3. every canonical RENDER read goes through the B005 read-API
 *        boundary (`ReadApiService.handleReadRequest(cookieValue,
 *        request)`) — the versioned, auth-gated, tenant-scoped envelope
 *        protocol;
 *     4. the WRITE path (evidence submission, M3) goes through the B002
 *        `ControlPlaneRepository` port — the canonical append-only write
 *        path. The local/demo posture holds ONE in-memory fake per server
 *        process (the customer-hosted write boundary is out of B-series
 *        scope; B015/B016 wire a hosted adapter through the SAME port).
 *
 *   DEMO composition — the B006 demo posture (`/demo/expert`): the shared
 *     demo runtime (zero credentials, deterministic corpus, reserved demo
 *     tenant, ManualClock frozen at the narrative epoch) with reads
 *     through the SAME canonical read path (`DemoReadSession` over the
 *     B005 read model) and writes through the demo store's OWN B002
 *     repository, visibly labelled per the demo labelling contract. Demo
 *     state is never customer state.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/auth, apps/web/src/demo and
 * apps/web/src/cockpit).
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
import { READ_MODEL_ERROR_CODES } from '../../../../packages/read-model/src/index.js';
import {
  ROLE_IDS,
  grantedRoleIds,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId, WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import {
  FakeControlPlaneRepository,
  SystemClock,
} from '../../../../packages/persistence/src/index.js';
import type { ControlPlaneRepository } from '../../../../packages/persistence/src/index.js';
import { isDemoTenant } from '@arena/demo';
import type { AuthenticatedSession } from '../../../../services/auth/src/index.js';
import {
  readSessionCookieValue,
  sessionBoundary,
} from '../auth/session.js';
import { getDemoRuntime } from '../demo/runtime.js';

// ---------------------------------------------------------------------------
// The expert read port (narrow, boundary-backed, render reads ONLY)
// ---------------------------------------------------------------------------

/**
 * The read operations the expert workbench performs for RENDERING.
 * Structurally satisfied by the B006 `DemoReadSession`; the session
 * composition adapts the B005 `ReadApiService` onto it. Writes live on
 * the B002 repository port, never here.
 */
export interface ExpertReadPort {
  read(recordId: string): Promise<CanonicalRead>;
  scroll(kind: ReadModelKind): Promise<ReadPage>;
  inventory(): Promise<KindInventory>;
}

/** Fail-closed typed read failure (carries the boundary's own error code). */
export class ExpertReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExpertReadError';
    this.code = code;
  }
}

/** Fail-closed unwrap of a read-API envelope (typed error on any failure). */
function unwrapEnvelope(kind: string, envelope: unknown): unknown {
  const parsed = parseReadApiEnvelope(envelope);
  if (parsed.ok) return parsed.result;
  const error = parsed.error;
  throw new ExpertReadError(
    String(error.code),
    `expert workbench read failed (fail closed) [${kind}]: ${String(error.code)} — ${error.message}`,
  );
}

/** Adapt the B005 read-API boundary onto the expert read port. */
export function createReadApiPort(deps: {
  readonly api: ReadApiService;
  readonly sessionToken: string;
}): ExpertReadPort {
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

/** The session facts the expert workbench needs (no permission interpretation). */
export interface ExpertSessionFacts {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly principalLabel: string;
  readonly grantedRoleIds: readonly RoleId[];
}

/**
 * Project the B003 workspace context of a validated session into expert
 * workbench facts. The permission policy is carried, never interpreted;
 * the granted role ids are read from the grant chain (identity → tenant →
 * policy → granted roles → active role context).
 */
export function expertSessionFacts(session: AuthenticatedSession): ExpertSessionFacts {
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
    principalId: String(session.principal.principalId),
    principalLabel: label,
    grantedRoleIds: Object.freeze([...grantedRoleIds(workspace)]),
  });
}

/**
 * The session probe: how the expert workbench reads + validates the
 * browser session. The default uses the B004 boundary (cookie value +
 * `sessionBoundary().service.validateSession`); tests inject their own.
 */
export interface SessionProbe {
  /** The sealed session cookie value from the request, or null when absent. */
  cookieValue(): Promise<string | null>;
  /** Validate a sealed cookie value through the B004 boundary (typed AUTH_* failures). */
  validate(token: string): Promise<AuthenticatedSession>;
}

/** The outcome of probing the browser session for the expert workbench. */
export type SessionExpertOutcome =
  | {
      readonly status: 'authenticated';
      readonly facts: ExpertSessionFacts;
      readonly port: ExpertReadPort;
      /** The B002 repository port for the WRITE path (evidence submission). */
      readonly repository: ControlPlaneRepository;
    }
  | {
      /** Fail closed: no authenticated session — the caller renders the denied state, never an anonymous workbench. */
      readonly status: 'unauthenticated';
      /** The typed AUTH_* code that closed the door (observability, never customer data). */
      readonly code: string;
    };

export interface ResolveExpertSessionOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: SessionProbe;
  /**
   * Control-plane repository override (composition seam); default: the
   * process-local in-memory fake (the B002 port's local-parity posture).
   */
  readonly repository?: ControlPlaneRepository;
}

/** True iff a thrown value carries a typed AUTH_* code (the B004 fail-closed vocabulary). */
function isTypedAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('AUTH_');
}

// ---------------------------------------------------------------------------
// The local session-posture control plane (ONE in-memory fake per process)
// ---------------------------------------------------------------------------

let workRepository: FakeControlPlaneRepository | undefined;

/**
 * The process-local control-plane repository for the authenticated
 * session posture: the B002 port's in-memory fake. Evidence appended
 * through the workbench lands HERE — the canonical control plane, never a
 * parallel store — and every later request reads it back through the B005
 * read path over the SAME repository. (A hosted adapter replaces this
 * through the same port in the deployment work orders.)
 */
export function getExpertWorkRepository(): FakeControlPlaneRepository {
  workRepository ??= new FakeControlPlaneRepository({ clock: new SystemClock() });
  return workRepository;
}

/** Hard reset of the cached local repository (test seam). */
export function resetExpertWorkRepository(): void {
  workRepository = undefined;
}

/**
 * Resolve the session expert workbench: read the session cookie, validate
 * it THROUGH the B004 boundary (fail closed on every typed AUTH_* outcome
 * — the routes then render the denied state), then expose the session
 * facts + a render-read port THROUGH the B005 read-API boundary (sealed
 * with the validated cookie value) + the B002 repository port for writes.
 */
export async function resolveExpertSession(
  options: ResolveExpertSessionOptions = {},
): Promise<SessionExpertOutcome> {
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
  const facts = expertSessionFacts(session);
  const repository: ControlPlaneRepository = options.repository ?? getExpertWorkRepository();
  const readModel: CanonicalReadModel = new ReadModelService({
    repository,
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
  return { status: 'authenticated', facts, port, repository };
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical reads; demo labelling)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_EXPERT_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo expert workbench context: facts + reads + write port + determinism stamp. */
export interface DemoExpertContext {
  readonly facts: ExpertSessionFacts;
  readonly port: ExpertReadPort;
  /** The demo store's B002 repository — the demo WRITE path for evidence submission. */
  readonly repository: ControlPlaneRepository;
  readonly corpusHash: string;
}

/**
 * Build the demo expert workbench context over the SHARED B006 demo
 * runtime. Composed PER REQUEST (never cached here): the shared runtime
 * singleton is the only cache, so `/demo/reset` (which recomposes the
 * runtime) automatically hands this surface a fresh, reseeded repository —
 * demo workbench activity resets with the demo itself. Reads go through
 * the canonical read path (DemoReadSession over the B005 read model),
 * scoped to the reserved demo tenant; writes go through the demo store's
 * B002 repository, stamped by the frozen narrative clock (deterministic).
 */
export async function getDemoExpertContext(): Promise<DemoExpertContext> {
  const runtime = await getDemoRuntime();
  if (!isDemoTenant(runtime.session.tenantId)) {
    throw new Error('demo expert context requires the reserved demo tenant (fail closed)');
  }
  // Demo LENS grants in the reserved demo tenant — deterministic narrative
  // state, never customer authorization (the B006 demo posture).
  const granted: readonly RoleId[] = Object.freeze([...ROLE_IDS]);
  return Object.freeze({
    facts: Object.freeze({
      tenantId: String(runtime.session.tenantId),
      workspaceId: DEMO_EXPERT_WORKSPACE_ID,
      principalId: 'demo-visitor',
      principalLabel: 'demo-visitor',
      grantedRoleIds: granted,
    }),
    port: runtime.reads,
    repository: runtime.store.repository,
    corpusHash: runtime.corpusHash,
  });
}

/** Re-export the read-model not-found code the evidence ledger probes on (fail-closed stop condition). */
export const EXPERT_READ_NOT_FOUND_CODE = READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND;

/**
 * True iff a thrown value is the read boundary's typed record-not-found
 * failure — as EITHER the session posture's wrapped `ExpertReadError`
 * (the B005 read-API envelope adapter) or the read model's own
 * `ReadModelError` (the demo read session throws it directly). Both carry
 * the SAME canonical code; anything else propagates (fail closed).
 */
export function isExpertReadNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === EXPERT_READ_NOT_FOUND_CODE;
}
