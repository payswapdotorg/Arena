/**
 * The session-boundary middleware EXPORT (Work Order B004; BRIEF.md §4.3).
 *
 * POSTURE (disclosed in the PR): this module EXPORTS a boundary-guard
 * factory — it is NOT mounted, because the middleware mount point
 * (`apps/web/src/middleware.ts` + root config) is B001-owned. Mount
 * instructions live in this directory's README.
 *
 * What the guard does: a CHEAP cookie-PRESENCE gate for browser
 * navigation (redirect cookie-less requests to a login route). The FULL
 * validation (HMAC seal, lifecycle, tenant scope) stays server-side in
 * the session helpers / route handlers — the middleware edge runtime
 * cannot run the node:crypto HMAC seal, and a presence gate must never
 * be mistaken for validation (defense stays in the fail-closed server
 * path; the guard only avoids rendering protected shells for anonymous
 * navigation).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '../../../../packages/auth/src/index.js';

export interface SessionBoundaryMiddlewareOptions {
  /** Where cookie-less navigation is redirected (an app-tree route). */
  readonly redirectTo: string;
}

/** True when the request carries an arena_session cookie (presence only). */
export function sessionCookiePresent(request: NextRequest): boolean {
  return request.cookies.has(SESSION_COOKIE_NAME);
}

/**
 * The boundary-guard middleware factory. Cookie PRESENCE passes through;
 * absence redirects. Never validates — validation is the server-side
 * boundary's job (session.ts / handlers.ts), which fails closed.
 */
export function createSessionBoundaryMiddleware(
  options: SessionBoundaryMiddlewareOptions,
): (request: NextRequest) => NextResponse {
  const redirectTo = options.redirectTo;
  return (request: NextRequest): NextResponse => {
    if (sessionCookiePresent(request)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(redirectTo, request.url));
  };
}
