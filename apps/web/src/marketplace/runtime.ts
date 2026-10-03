/**
 * Marketplace runtime composition (Work Order B013; issue #88;
 * apps/web/src/marketplace). SERVER-ONLY surface.
 *
 * Two compositions feed the marketplace UX, both reading through versioned
 * boundaries — the marketplace never talks to a repository for RENDER reads
 * of its listings and never invents a second data model:
 *
 *   SESSION composition — the authenticated `/marketplace` experience:
 *     1. the B004 session boundary validates FIRST (fail closed: typed
 *        AUTH_* outcomes, never an anonymous marketplace);
 *     2. the tenant/workspace/principal facts come from the VALIDATED
 *        session's B003 workspace context (tenant from the session, never
 *        the client);
 *     3. certification records — the ONLY canonical read-model kind the
 *        marketplace renders — flow through the B005 read-API boundary
 *        (`ReadApiService.handleReadRequest(cookieValue, request)`); the
 *        read-model kind vocabulary is B005-owned and NOT extended here;
 *     4. listing data (expert services, artifacts, entitlements) is read
 *        server-side through the PUBLIC APIs of the A031/A032/A033
 *        packages over a process-local deterministic corpus (the same
 *        posture as the expert work repository: ONE in-memory seed per
 *        server process; the customer-hosted marketplace fabric is out of
 *        B-series scope). The corpus is a READ source, never an authority:
 *        prices, entitlements and certification are projected, never
 *        computed client-side.
 *
 *   DEMO composition — the B006 demo posture (`/demo/marketplace`): the
 *     shared demo runtime (zero credentials, reserved demo tenant,
 *     ManualClock frozen at the narrative epoch) with certification reads
 *     through the SAME canonical read path (`DemoReadSession` over the B005
 *     read model) and listing data over a deterministic demo-seeded corpus,
 *     visibly labelled per the demo labelling contract. Demo state is never
 *     customer state: no real pricing, no real purchase.
 *
 * Workspace imports are RELATIVE (../../../../{packages,services}/...)
 * because apps/web's package manifest is B001-owned and stays untouched
 * (the same posture as apps/web/src/auth, apps/web/src/demo,
 * apps/web/src/cockpit and apps/web/src/expert).
 */

import { sha256Hex } from '@arena/protocol-core';
import { isDemoTenant } from '@arena/demo';
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
  grantedRoleIds,
  ROLE_IDS,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId, WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import {
  FakeControlPlaneRepository,
  SystemClock,
} from '../../../../packages/persistence/src/index.js';
import type { AuthenticatedSession } from '../../../../services/auth/src/index.js';
import {
  readSessionCookieValue,
  sessionBoundary,
} from '../auth/session.js';
import { getDemoRuntime } from '../demo/runtime.js';
import { buildMarketplaceCorpus } from './corpus.js';
import type { MarketplaceCorpus } from './corpus.js';

// ---------------------------------------------------------------------------
// The marketplace read port (narrow, boundary-backed, render reads ONLY)
// ---------------------------------------------------------------------------

/**
 * The canonical read operations the marketplace performs for RENDERING
 * (certification records only — the marketplace never extends the B005
 * kind vocabulary). Structurally satisfied by the B006 `DemoReadSession`;
 * the session composition adapts the B005 `ReadApiService` onto it.
 */
export interface MarketplaceReadPort {
  read(recordId: string): Promise<CanonicalRead>;
  scroll(kind: ReadModelKind): Promise<ReadPage>;
  inventory(): Promise<KindInventory>;
}

/** Fail-closed typed read failure (carries the boundary's own error code). */
export class MarketplaceReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarketplaceReadError';
    this.code = code;
  }
}

/** Fail-closed unwrap of a read-API envelope (typed error on any failure). */
function unwrapEnvelope(kind: string, envelope: unknown): unknown {
  const parsed = parseReadApiEnvelope(envelope);
  if (parsed.ok) return parsed.result;
  const error = parsed.error;
  throw new MarketplaceReadError(
    String(error.code),
    `marketplace read failed (fail closed) [${kind}]: ${String(error.code)} — ${error.message}`,
  );
}

/** Adapt the B005 read-API boundary onto the marketplace read port. */
export function createReadApiPort(deps: {
  readonly api: ReadApiService;
  readonly sessionToken: string;
}): MarketplaceReadPort {
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

/** The session facts the marketplace needs (no permission interpretation). */
export interface MarketplaceSessionFacts {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly principalLabel: string;
  readonly grantedRoleIds: readonly RoleId[];
}

/** Project the B003 workspace context of a validated session into marketplace facts. */
export function marketplaceSessionFacts(session: AuthenticatedSession): MarketplaceSessionFacts {
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
 * The session probe: how the marketplace reads + validates the browser
 * session. The default uses the B004 boundary (cookie value +
 * `sessionBoundary().service.validateSession`); tests inject their own.
 */
export interface MarketplaceSessionProbe {
  /** The sealed session cookie value from the request, or null when absent. */
  cookieValue(): Promise<string | null>;
  /** Validate a sealed cookie value through the B004 boundary (typed AUTH_* failures). */
  validate(token: string): Promise<AuthenticatedSession>;
}

/** The outcome of probing the browser session for the marketplace. */
export type SessionMarketplaceOutcome =
  | {
      readonly status: 'authenticated';
      readonly facts: MarketplaceSessionFacts;
      readonly port: MarketplaceReadPort;
      /** The process-local deterministic marketplace corpus (READ source). */
      readonly corpus: MarketplaceCorpus;
    }
  | {
      /** Fail closed: no authenticated session — the caller renders the denied state. */
      readonly status: 'unauthenticated';
      /** The typed AUTH_* code that closed the door (observability, never customer data). */
      readonly code: string;
    };

export interface ResolveMarketplaceSessionOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: MarketplaceSessionProbe;
  /** Corpus override (composition seam); default: the process-local seed. */
  readonly corpus?: MarketplaceCorpus;
}

/** True iff a thrown value carries a typed AUTH_* code (the B004 fail-closed vocabulary). */
function isTypedAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('AUTH_');
}

// ---------------------------------------------------------------------------
// The local session-posture marketplace corpus (ONE in-memory seed per process)
// ---------------------------------------------------------------------------

/** The local dev seed tenants (the corpus reads back tenant-scoped). */
const SESSION_SEED_TENANT = 'tenant-a';
const SESSION_SECONDARY_TENANT = 'tenant-b';
/** The fixed evaluation time (deterministic; the demo narrative epoch). */
const EVALUATED_AT = '2026-10-01T08:00:00.000Z';

let sessionCorpus: Promise<MarketplaceCorpus> | undefined;

/**
 * The process-local marketplace corpus for the session posture: seeded ONCE
 * per server process through the A031/A032/A033 public APIs (deterministic,
 * deep-frozen). A READ source only — pricing, entitlements and
 * certification are projected in the view-model layer, never computed here.
 */
export function getSessionMarketplaceCorpus(): Promise<MarketplaceCorpus> {
  sessionCorpus ??= buildMarketplaceCorpus({
    tenant: SESSION_SEED_TENANT,
    secondaryTenant: SESSION_SECONDARY_TENANT,
    evaluatedAt: EVALUATED_AT,
    mode: 'session',
  });
  return sessionCorpus;
}

/** Hard reset of the cached session corpus (test seam). */
export function resetSessionMarketplaceCorpus(): void {
  sessionCorpus = undefined;
}

/**
 * Resolve the session marketplace: read the session cookie, validate it
 * THROUGH the B004 boundary (fail closed on every typed AUTH_* outcome —
 * the routes then render the denied state), then expose the session facts,
 * a certification read port THROUGH the B005 read-API boundary (sealed with
 * the validated cookie value, over the process-local B002 repository) and
 * the deterministic marketplace corpus.
 */
export async function resolveMarketplaceSession(
  options: ResolveMarketplaceSessionOptions = {},
): Promise<SessionMarketplaceOutcome> {
  const probe: MarketplaceSessionProbe =
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
  const facts = marketplaceSessionFacts(session);
  // The certification read path: the B005 read model over the SAME
  // process-local in-memory fake the expert posture holds (empty locally —
  // the honest "no certification record" rendering).
  const readModel: CanonicalReadModel = new ReadModelService({
    repository: getSessionMarketplaceReadRepository(),
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
  const corpus = options.corpus ?? (await getSessionMarketplaceCorpus());
  return { status: 'authenticated', facts, port, corpus };
}

let readRepository: FakeControlPlaneRepository | undefined;

/** The process-local read repository for the session certification reads. */
export function getSessionMarketplaceReadRepository(): FakeControlPlaneRepository {
  readRepository ??= new FakeControlPlaneRepository({ clock: new SystemClock() });
  return readRepository;
}

/** Hard reset of the cached read repository (test seam). */
export function resetSessionMarketplaceReadRepository(): void {
  readRepository = undefined;
}

// ---------------------------------------------------------------------------
// Demo composition (B006 runtime; canonical certification reads; labelling)
// ---------------------------------------------------------------------------

/** The reserved demo workspace id (the demo tenant has exactly one). */
export const DEMO_MARKETPLACE_WORKSPACE_ID = 'demo-workspace' as const;

/** The demo marketplace context: facts + read port + corpus + stamps. */
export interface DemoMarketplaceContext {
  readonly facts: MarketplaceSessionFacts;
  readonly port: MarketplaceReadPort;
  readonly corpus: MarketplaceCorpus;
  readonly corpusHash: string;
  readonly marketplaceCorpusHash: string;
}

let demoCorpus: Promise<MarketplaceCorpus> | undefined;

/**
 * The demo marketplace corpus: seeded ONCE per process for the reserved
 * demo tenant through the SAME public APIs (deterministic, read-only —
 * `/demo/reset` recomposes the demo store; this corpus is content-addressed
 * and reproducible, so it never needs resetting).
 */
export function getDemoMarketplaceCorpus(): Promise<MarketplaceCorpus> {
  demoCorpus ??= buildMarketplaceCorpus({
    tenant: 'arena-demo',
    secondaryTenant: 'arena-demo-partner',
    evaluatedAt: EVALUATED_AT,
    mode: 'demo',
  });
  return demoCorpus;
}

/** Hard reset of the cached demo corpus (test seam). */
export function resetDemoMarketplaceCorpus(): void {
  demoCorpus = undefined;
}

/**
 * Build the demo marketplace context over the SHARED B006 demo runtime
 * (the expert-posture shape): the reserved demo tenant facts, certification
 * reads through the canonical `DemoReadSession`, and the deterministic
 * demo-seeded marketplace corpus with its content hash.
 */
export async function getDemoMarketplaceContext(): Promise<DemoMarketplaceContext> {
  const runtime = await getDemoRuntime();
  if (!isDemoTenant(runtime.session.tenantId)) {
    throw new Error('demo marketplace context requires the reserved demo tenant (fail closed)');
  }
  const corpus = await getDemoMarketplaceCorpus();
  // Demo LENS grants in the reserved demo tenant — deterministic narrative
  // state, never customer authorization (the B006 demo posture).
  const granted: readonly RoleId[] = Object.freeze([...ROLE_IDS]);
  return Object.freeze({
    facts: Object.freeze({
      tenantId: String(runtime.session.tenantId),
      workspaceId: DEMO_MARKETPLACE_WORKSPACE_ID,
      principalId: 'demo-visitor',
      principalLabel: 'demo-visitor',
      grantedRoleIds: granted,
    }),
    port: runtime.reads,
    corpus,
    corpusHash: runtime.corpusHash,
    marketplaceCorpusHash: await sha256Hex(JSON.stringify(corpus)),
  });
}
