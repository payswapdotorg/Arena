/**
 * Route-handler factory for the session boundary (Work Order B004;
 * BRIEF.md §4.3): exportable login/logout/session handlers that
 * apps/web/src/app can mount LATER — B001 owns the app tree, so this
 * module only EXPORTS the factory; no route file is modified here.
 *
 * Mounting (for B005/B007, from a route.ts the app tree owns):
 *   export const POST = createLoginRouteHandler({ ...options });
 *   export const POST = createLogoutRouteHandler({ ...options });
 *   export const GET = createSessionRouteHandler({ ...options });
 *
 * CSRF posture: login/logout are STATE-CHANGING — both require POST and
 * pass the Origin check (csrf.ts) before any session state is touched;
 * the session read handler is a safe GET (validation still fail-closed).
 *
 * Every failure maps onto a typed outcome: AUTH_* codes carry their
 * category/message via toAuthErrorStruct with an HTTP status from the
 * closed map below; boundary-level origin rejections carry the closed
 * BOUNDARY_ORIGIN_REJECTED code (403). Nothing about the response ever
 * echoes cookie seals or session ids.
 */

import {
  AUTH_ERROR_CODES,
  createAuthMethodDescriptor,
  isAuthError,
  normalizeToAuthError,
  parseSessionCookieHeader,
  serializeSessionCookie,
  clearedSessionCookieSpec,
  toAuthErrorStruct,
} from '../../../../packages/auth/src/index.js';
import type { AuthErrorCode, AuthErrorStruct } from '../../../../packages/auth/src/index.js';
import type { SecurityPrincipal } from '../../../../packages/security/src/index.js';
import type { WorkspaceContext } from '../../../../packages/role-context/src/index.js';
import { AuthService } from '../../../../services/auth/src/index.js';
import { checkOriginAllowed } from './csrf.js';
import type { BoundaryRejection } from './csrf.js';

/** The login body contract (the credential descriptor + tenant expectation). */
export interface LoginRequestBody {
  readonly credential: {
    readonly method: string;
    readonly claims?: Readonly<Record<string, unknown>>;
  };
  readonly expectedTenantId?: string;
}

/** Everything the route-handler factory needs at composition time. */
export interface AuthRouteHandlerOptions {
  /** The composed auth service (identity + workspace context, never permissions). */
  readonly service: AuthService;
  /**
   * Explicit origin allowlist for the state-changing handlers (in
   * addition to same-origin). Empty is a valid strict posture.
   */
  readonly allowedOrigins: readonly string[];
  /** Whether the session cookie carries the Secure flag (production). */
  readonly cookieSecure: boolean;
  /**
   * Resolve the B003 workspace context for an authenticated principal.
   * INJECTED PORT: the web boundary never invents roles or memberships —
   * B005/B007 wire the real resolution (local/Demo mode wires the B003
   * fixture chain through the same seam).
   */
  readonly resolveWorkspaceContext: (
    principal: SecurityPrincipal,
  ) => Promise<WorkspaceContext>;
}

/** The closed AUTH_* code -> HTTP status map (single authority). */
const STATUS_BY_CODE: Readonly<Record<AuthErrorCode, number>> = Object.freeze({
  AUTH_INVALID_SESSION_ID: 400,
  AUTH_INVALID_SESSION_RECORD: 400,
  AUTH_INVALID_PRINCIPAL: 400,
  AUTH_INVALID_WORKSPACE_CONTEXT: 400,
  AUTH_INVALID_TENANT_REF: 400,
  AUTH_INVALID_AUTH_METHOD: 400,
  AUTH_INVALID_COOKIE: 400,
  AUTH_INVALID_TTL: 400,
  AUTH_INVALID_WINDOW: 400,
  AUTH_INVALID_SECRET: 500,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_MALFORMED_TOKEN: 400,
  AUTH_TOKEN_TAMPERED: 400,
  AUTH_TOKEN_VERSION_UNSUPPORTED: 400,
  AUTH_SESSION_NOT_FOUND: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_SESSION_REVOKED: 401,
  AUTH_SESSION_ROTATED: 401,
  AUTH_SESSION_EXISTS: 409,
  AUTH_ROTATION_CONFLICT: 409,
  AUTH_TENANT_SCOPE_VIOLATION: 403,
  AUTH_DISABLED: 503,
  AUTH_STORE_FAILED: 503,
  AUTH_UNKNOWN_ERROR: 500,
});

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json',
  'cache-control': 'no-store',
});

function jsonResponse(status: number, body: unknown, headers?: Headers): Response {
  const merged = new Headers(JSON_HEADERS);
  for (const [name, value] of headers ?? []) merged.set(name, value);
  return new Response(JSON.stringify(body), { status, headers: merged });
}

/** Map any thrown value onto the typed error response contract. */
function authErrorResponse(error: unknown): Response {
  const authError = isAuthError(error) ? error : normalizeToAuthError(error);
  const struct: AuthErrorStruct = toAuthErrorStruct(authError);
  const status = STATUS_BY_CODE[authError.code] ?? 500;
  return jsonResponse(status, { error: struct });
}

function methodNotAllowed(allowed: string): Response {
  return jsonResponse(405, {
    error: {
      code: AUTH_ERROR_CODES.UNKNOWN_ERROR,
      category: 'unknown',
      message: `method not allowed — this handler accepts ${allowed} only`,
    },
  });
}

function originRejectionResponse(rejection: BoundaryRejection): Response {
  return jsonResponse(403, { error: rejection });
}

function requireOrigin(request: Request, options: AuthRouteHandlerOptions): Response | null {
  const rejection = checkOriginAllowed(request, options.allowedOrigins);
  return rejection === null ? null : originRejectionResponse(rejection);
}

// ---------------------------------------------------------------------------
// login (POST — state-changing: origin-checked, fail-closed)
// ---------------------------------------------------------------------------

/**
 * The login route handler: credential -> principal -> workspace context
 * -> session issuance + Set-Cookie. Fail-closed typed outcomes for every
 * failure (never an anonymous session).
 */
export function createLoginRouteHandler(
  options: AuthRouteHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const originFailure = requireOrigin(request, options);
    if (originFailure !== null) return originFailure;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, {
        error: {
          code: AUTH_ERROR_CODES.INVALID_AUTH_METHOD,
          category: 'validation',
          message: 'the login body must be a JSON credential descriptor',
        },
      });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return jsonResponse(400, {
        error: {
          code: AUTH_ERROR_CODES.INVALID_AUTH_METHOD,
          category: 'validation',
          message: 'the login body must be a JSON object',
        },
      });
    }
    const credential = (body as Record<string, unknown>)['credential'];
    if (
      typeof credential !== 'object' ||
      credential === null ||
      Array.isArray(credential) ||
      typeof (credential as Record<string, unknown>)['method'] !== 'string'
    ) {
      return jsonResponse(400, {
        error: {
          code: AUTH_ERROR_CODES.INVALID_AUTH_METHOD,
          category: 'validation',
          message: 'the login body must carry a credential descriptor with a method',
        },
      });
    }
    const descriptorInput = credential as Record<string, unknown>;
    const claims = descriptorInput['claims'];

    try {
      const principal = await options.service.authenticate({
        method: descriptorInput['method'] as string,
        ...(typeof claims === 'object' && claims !== null && !Array.isArray(claims)
          ? { claims: claims as Record<string, unknown> }
          : {}),
      });
      const workspaceContext = await options.resolveWorkspaceContext(principal);
      const issuance = await options.service.issueSession({
        principal,
        tenantId: String(principal.tenantScope),
        workspaceContext,
        authMethod: createAuthMethodDescriptor({
          method: descriptorInput['method'] as string,
          ...(typeof claims === 'object' && claims !== null && !Array.isArray(claims)
            ? { claims: claims as Record<string, unknown> }
            : {}),
        }),
      });
      const headers = new Headers();
      headers.set('set-cookie', serializeSessionCookie(issuance.cookie));
      return jsonResponse(200, { session: issuance.session }, headers);
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

// ---------------------------------------------------------------------------
// logout (POST — state-changing: origin-checked, idempotent)
// ---------------------------------------------------------------------------

/**
 * The logout route handler: revokes the session addressed by the request
 * cookie (when present) and ALWAYS clears the cookie. Idempotent.
 */
export function createLogoutRouteHandler(
  options: AuthRouteHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const originFailure = requireOrigin(request, options);
    if (originFailure !== null) return originFailure;

    const cookieValue = parseSessionCookieHeader(request.headers.get('cookie'));
    let revoked = false;
    if (cookieValue !== null) {
      try {
        revoked = await options.service.revokeSession(cookieValue);
      } catch (error) {
        // A malformed/tampered cookie on logout still clears the cookie —
        // but a typed STORE failure is reported, never swallowed silently.
        if (
          isAuthError(error) &&
          (error.code === AUTH_ERROR_CODES.MALFORMED_TOKEN ||
            error.code === AUTH_ERROR_CODES.TOKEN_TAMPERED ||
            error.code === AUTH_ERROR_CODES.TOKEN_VERSION_UNSUPPORTED ||
            error.code === AUTH_ERROR_CODES.SESSION_NOT_FOUND ||
            error.code === AUTH_ERROR_CODES.SESSION_EXPIRED ||
            error.code === AUTH_ERROR_CODES.SESSION_REVOKED ||
            error.code === AUTH_ERROR_CODES.SESSION_ROTATED)
        ) {
          revoked = false;
        } else {
          return authErrorResponse(error);
        }
      }
    }
    const cleared = clearedSessionCookieSpec({ secure: options.cookieSecure });
    const headers = new Headers();
    headers.set('set-cookie', serializeSessionCookie(cleared));
    return jsonResponse(200, { revoked }, headers);
  };
}

// ---------------------------------------------------------------------------
// session (GET — safe read, validation still fail-closed)
// ---------------------------------------------------------------------------

/**
 * The session read route handler: validates the request cookie and
 * returns the session view (identity + workspace context). A missing,
 * expired, revoked, rotated, tampered or cross-tenant session is a typed
 * 401/400/403 — never an anonymous body.
 */
export function createSessionRouteHandler(
  options: AuthRouteHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    const cookieValue = parseSessionCookieHeader(request.headers.get('cookie'));
    if (cookieValue === null) {
      return jsonResponse(401, {
        error: {
          code: AUTH_ERROR_CODES.SESSION_NOT_FOUND,
          category: 'access',
          message: 'no session cookie is present (fail closed)',
        },
      });
    }
    try {
      const session = await options.service.validateSession(cookieValue);
      return jsonResponse(200, { session });
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}
