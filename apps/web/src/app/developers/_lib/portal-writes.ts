/**
 * The developer-portal interactive write composition (P005/S-03, the
 * R-028 disposition): server-side API-route handlers for key
 * issue/rotate/revoke and console-triggered sandbox runs, over the
 * developer-platform service's own append-only key lifecycle.
 *
 * Posture (the CSRF + idempotency contract PR #135 Q4 asked for):
 *
 *   AUTH     — the session is resolved FIRST through the B004 boundary
 *   (fail closed: an unauthenticated POST is a typed 401 and never
 *   writes). The tenant comes from the VALIDATED session, never the
 *   request body.
 *
 *   DEMO     — the reserved demo tenant is READ-ONLY here (typed 403):
 *   the demo corpus is deterministic and visibly labelled; a console
 *   write would mutate demo state into non-determinism. Demo state is
 *   never customer state (ADR-P001-02).
 *
 *   CSRF     — every portal write is POST-only and performs the house
 *   ORIGIN CHECK (`apps/web/src/auth/csrf.ts`, the B004 posture) before
 *   any state is touched; the allowlist is empty (same-origin only).
 *
 *   IDEMPOTENCY — the C001 law applied at the portal boundary: a
 *   REQUIRED `x-arena-idempotency-key` header keyed per tenant + action;
 *   replaying a key returns the RECORDED outcome verbatim with a replay
 *   marker; pairing a key with a DIFFERENT body is the typed
 *   PORTAL_IDENTITY_CONFLICT (409). The memo is process-local (the
 *   durable idempotency store is P002's work order — disclosed).
 *
 *   ERRORS   — every failure is a typed JSON envelope: the closed
 *   PORTAL_* boundary vocabulary below, the AUTH_* and BOUNDARY_* codes
 *   passed through, and the developer-platform's own DEVELOPER_* codes
 *   with their categories (toWire(); never secret material).
 */

import { isDemoTenant } from '@arena/demo';

import { checkOriginAllowed } from '../../../auth/csrf.js';
import type { BoundaryRejection } from '../../../auth/csrf.js';
import { resolveSessionDevelopers } from '../../../developers/index.js';
import type { ResolveSessionCockpitOptions } from '../../../developers/runtime.js';
import {
  DEVELOPER_PLATFORM_ERROR_CODES,
  DeveloperPlatformError,
  developerKeyWire,
  isDeveloperKeyScope,
} from '../../../../../../packages/developer-platform/src/index.js';
import type {
  DeveloperKeyEnvironment,
  DeveloperPlatformErrorCategory,
} from '../../../../../../packages/developer-platform/src/index.js';
import type { DeveloperPlatformService } from '../../../../../../services/developer-platform/src/index.js';

import { getPortalRuntime } from './portal-runtime.js';

// ---------------------------------------------------------------------------
// The closed portal boundary vocabulary
// ---------------------------------------------------------------------------

export const PORTAL_WRITE_ERROR_CODES = Object.freeze({
  DEMO_READ_ONLY: 'PORTAL_DEMO_READ_ONLY',
  IDEMPOTENCY_KEY_REQUIRED: 'PORTAL_IDEMPOTENCY_KEY_REQUIRED',
  IDENTITY_CONFLICT: 'PORTAL_IDENTITY_CONFLICT',
  INVALID_REQUEST: 'PORTAL_INVALID_REQUEST',
  UNKNOWN_ERROR: 'PORTAL_UNKNOWN_ERROR',
} as const);
export type PortalWriteErrorCode =
  (typeof PORTAL_WRITE_ERROR_CODES)[keyof typeof PORTAL_WRITE_ERROR_CODES];

/** The actions the portal write surface exposes (one route each). */
export const PORTAL_WRITE_ACTIONS = Object.freeze([
  'register-client-app',
  'issue-key',
  'rotate-key',
  'revoke-key',
  'run-sandbox-escalation',
] as const);
export type PortalWriteAction = (typeof PORTAL_WRITE_ACTIONS)[number];

/** The required idempotency header (the C001 law at the portal boundary). */
export const PORTAL_IDEMPOTENCY_HEADER = 'x-arena-idempotency-key';

// ---------------------------------------------------------------------------
// Typed JSON envelopes (never a bare string, never secret leakage)
// ---------------------------------------------------------------------------

const NO_STORE = { 'cache-control': 'no-store' } as const;

function portalJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...NO_STORE },
  });
}

function portalFailure(
  status: number,
  error: {
    readonly code: string;
    readonly category: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  },
): Response {
  return portalJson(status, { ok: false, error });
}

// ---------------------------------------------------------------------------
// Idempotency memo (the C001 replay/conflict law, process-local)
// ---------------------------------------------------------------------------

interface RecordedWrite {
  readonly fingerprint: string;
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Deterministic canonical JSON (sorted keys) for body fingerprints. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A process-local idempotency memo (bounded; oldest entries evicted). */
export class PortalIdempotencyMemo {
  private readonly entries = new Map<string, RecordedWrite>();
  private readonly capacity: number;

  constructor(capacity = 1024) {
    this.capacity = capacity;
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) return;
      this.entries.delete(oldest.value);
    }
  }

  record(key: string, fingerprint: string, status: number, body: Record<string, unknown>): void {
    this.entries.set(key, { fingerprint, status, body });
    this.evict();
  }

  lookup(key: string, fingerprint: string): RecordedWrite | 'conflict' | undefined {
    const recorded = this.entries.get(key);
    if (recorded === undefined) return undefined;
    return recorded.fingerprint === fingerprint ? recorded : 'conflict';
  }

  clear(): void {
    this.entries.clear();
  }
}

const sharedMemo = new PortalIdempotencyMemo();

// ---------------------------------------------------------------------------
// Request parsing (closed shapes; the tenant NEVER comes from the body)
// ---------------------------------------------------------------------------

function readString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readEnvironment(
  body: Record<string, unknown>,
): DeveloperKeyEnvironment | undefined {
  const value = body['environment'];
  return value === 'live' || value === 'sandbox' ? value : undefined;
}

function readScopes(body: Record<string, unknown>): readonly string[] | undefined {
  const value = body['scopes'];
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry) => typeof entry === 'string')) return undefined;
  const scopes = value as readonly string[];
  return scopes.every((scope) => isDeveloperKeyScope(scope)) ? scopes : undefined;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The write composition (auth facts + service; everything above is shared)
// ---------------------------------------------------------------------------

export interface PortalWriterFacts {
  readonly tenantId: string;
  readonly principalLabel: string;
}

export interface PortalWriteDeps {
  /** The host write runtime; defaults to the process singleton. */
  readonly runtime?: DeveloperPlatformService;
  /** The idempotency memo; defaults to the shared process memo. */
  readonly memo?: PortalIdempotencyMemo;
  /** Extra allowed origins for the CSRF check (same-origin is always allowed). */
  readonly allowedOrigins?: readonly string[];
}

/** HTTP status for a developer-platform error category (closed map). */
function statusForCategory(category: DeveloperPlatformErrorCategory): number {
  switch (category) {
    case 'validation':
      return 400;
    case 'scope':
    case 'tenancy':
      return 403;
    case 'state':
      return 409;
    case 'capacity':
      return 503;
    case 'unknown':
      return 500;
  }
}

async function executeWrite(
  action: PortalWriteAction,
  body: Record<string, unknown>,
  facts: PortalWriterFacts,
  runtime: DeveloperPlatformService,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  switch (action) {
    case 'register-client-app': {
      const displayName = readString(body, 'displayName');
      const environment = readEnvironment(body);
      if (displayName === undefined || environment === undefined) {
        throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
          message: 'register-client-app requires { displayName, environment: live|sandbox }',
        });
      }
      const app = await runtime.registerClientApp({ tenantId: facts.tenantId, displayName, environment });
      return { status: 201, body: { clientApp: app } };
    }
    case 'issue-key': {
      const clientAppId = readString(body, 'clientAppId');
      const environment = readEnvironment(body);
      const scopes = readScopes(body);
      const label = readString(body, 'label');
      if (clientAppId === undefined || environment === undefined || scopes === undefined || label === undefined) {
        throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
          message:
            'issue-key requires { clientAppId, environment: live|sandbox, scopes: closed vocabulary, label }',
        });
      }
      const issuance = await runtime.issueKey({
        tenantId: facts.tenantId,
        clientAppId,
        environment,
        scopes,
        label,
      });
      return {
        status: 201,
        body: {
          key: developerKeyWire(issuance.record),
          secret: issuance.secret,
          secretNotice: 'shown exactly once — store it now; it is never retrievable again',
        },
      };
    }
    case 'rotate-key': {
      const keyId = readString(body, 'keyId');
      if (keyId === undefined) {
        throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
          message: 'rotate-key requires { keyId }',
        });
      }
      const issuance = await runtime.rotateKey({ keyId, tenantId: facts.tenantId });
      return {
        status: 200,
        body: {
          key: developerKeyWire(issuance.record),
          secret: issuance.secret,
          secretNotice: 'shown exactly once — store it now; it is never retrievable again',
        },
      };
    }
    case 'revoke-key': {
      const keyId = readString(body, 'keyId');
      if (keyId === undefined) {
        throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
          message: 'revoke-key requires { keyId }',
        });
      }
      const revoked = await runtime.revokeKey({ keyId, tenantId: facts.tenantId });
      return { status: 200, body: { key: developerKeyWire(revoked) } };
    }
    case 'run-sandbox-escalation': {
      const scenarioId = readString(body, 'scenarioId');
      const presentedSecret = readString(body, 'presentedSecret');
      if (scenarioId === undefined || presentedSecret === undefined) {
        throw new DeveloperPlatformError(DEVELOPER_PLATFORM_ERROR_CODES.INVALID_REQUEST, {
          message: 'run-sandbox-escalation requires { scenarioId, presentedSecret }',
        });
      }
      const run = await runtime.runSandboxEscalation({
        presentedSecret,
        tenantId: facts.tenantId,
        scenarioId,
      });
      return {
        status: 200,
        body: {
          run: {
            runId: run.run.runId,
            keyId: run.run.keyId,
            clientAppId: run.run.clientAppId,
            tenantId: run.run.tenantId,
            requestId: run.run.requestId,
            scenarioId: run.run.scenarioId,
            createdAt: run.run.createdAt,
            environment: run.run.environment,
            truthLabel: run.run.truthLabel,
          },
          projection: run.projection,
          emittedEvents: run.emittedEvents,
          truth: 'sandbox — deterministic canned escalation; sandbox truth, never customer truth',
        },
      };
    }
  }
}

/**
 * Handle one authenticated portal write: origin check → body parse →
 * idempotency replay/conflict → the service call → the typed envelope.
 */
export async function handlePortalWrite(
  request: Request,
  action: PortalWriteAction,
  facts: PortalWriterFacts,
  deps: PortalWriteDeps = {},
): Promise<Response> {
  const originRejection: BoundaryRejection | null = checkOriginAllowed(
    request,
    deps.allowedOrigins ?? [],
  );
  if (originRejection !== null) {
    return portalFailure(403, {
      code: originRejection.code,
      category: 'csrf',
      message: originRejection.message,
    });
  }
  const body = await readJsonBody(request);
  if (body === null) {
    return portalFailure(400, {
      code: PORTAL_WRITE_ERROR_CODES.INVALID_REQUEST,
      category: 'validation',
      message: 'the request body must be a JSON object',
    });
  }
  const idempotencyKey = request.headers.get(PORTAL_IDEMPOTENCY_HEADER);
  if (idempotencyKey === null || idempotencyKey.length === 0) {
    return portalFailure(400, {
      code: PORTAL_WRITE_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      category: 'validation',
      message: `portal writes require the ${PORTAL_IDEMPOTENCY_HEADER} header (the C001 idempotency law at the portal boundary)`,
    });
  }
  const memo = deps.memo ?? sharedMemo;
  const memoKey = `${facts.tenantId}:${action}:${idempotencyKey}`;
  const fingerprint = canonicalJson(body);
  const recorded = memo.lookup(memoKey, fingerprint);
  if (recorded === 'conflict') {
    return portalFailure(409, {
      code: PORTAL_WRITE_ERROR_CODES.IDENTITY_CONFLICT,
      category: 'state',
      message:
        'this idempotency key was already used with a DIFFERENT body — the typed conflict, never a silent overwrite',
    });
  }
  if (recorded !== undefined) {
    // Replay: the recorded outcome, verbatim, with the replay marker.
    return portalJson(recorded.status, { ...recorded.body, replayed: true });
  }
  const runtime = deps.runtime ?? getPortalRuntime();
  try {
    const outcome = await executeWrite(action, body, facts, runtime);
    memo.record(memoKey, fingerprint, outcome.status, outcome.body);
    return portalJson(outcome.status, { ok: true, action, ...outcome.body });
  } catch (error) {
    if (error instanceof DeveloperPlatformError) {
      return portalFailure(statusForCategory(error.category), {
        code: error.code,
        category: error.category,
        message: error.message,
        ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
      });
    }
    return portalFailure(500, {
      code: PORTAL_WRITE_ERROR_CODES.UNKNOWN_ERROR,
      category: 'unknown',
      message: 'the portal write failed (fail closed; no details leaked)',
    });
  }
}

// ---------------------------------------------------------------------------
// The route-level composition (session FIRST, then demo denial, then the write)
// ---------------------------------------------------------------------------

export interface PortalWriteRequestDeps extends PortalWriteDeps {
  /** Session resolution options (test seam: inject a probe); default: the real B004 boundary. */
  readonly session?: ResolveSessionCockpitOptions;
}

/**
 * The full route composition one POST mounts: fail-closed session →
 * demo read-only denial → the write composition. Route files stay thin.
 */
export async function handlePortalWriteRequest(
  request: Request,
  action: PortalWriteAction,
  deps: PortalWriteRequestDeps = {},
): Promise<Response> {
  try {
    const session = await resolveSessionDevelopers(deps.session ?? {});
    if (session.status !== 'authenticated') {
      return portalFailure(401, {
        code: session.code,
        category: 'auth',
        message: 'an authenticated workspace session is required — portal writes never run anonymously',
      });
    }
    const facts: PortalWriterFacts = {
      tenantId: session.facts.tenantId,
      principalLabel: session.facts.principalLabel,
    };
    if (isDemoTenant(facts.tenantId)) {
      return portalFailure(403, {
        code: PORTAL_WRITE_ERROR_CODES.DEMO_READ_ONLY,
        category: 'tenancy',
        message:
          'the demo portal is read-only: the demo corpus is deterministic and visibly labelled, and demo state is never customer state',
      });
    }
    return await handlePortalWrite(request, action, facts, deps);
  } catch {
    return portalFailure(500, {
      code: PORTAL_WRITE_ERROR_CODES.UNKNOWN_ERROR,
      category: 'unknown',
      message: 'the portal write composition failed (fail closed; no details leaked)',
    });
  }
}
