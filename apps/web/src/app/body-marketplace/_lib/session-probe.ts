/**
 * The body-marketplace route-mount session probe (P005/S-02): wires the
 * feature module's `BodyMarketplaceSessionProbe` contract onto the REAL
 * B004 session boundary (`apps/web/src/auth/session.ts`), exactly the
 * way the cockpit composition defaults its own probe
 * (`resolveSessionCockpit`): the cookie is read through
 * `next/headers`, validation goes THROUGH the boundary (never a client
 * claim), and typed AUTH_* failures fail CLOSED to the unauthenticated
 * outcome so the route renders the auth-required experience — never an
 * anonymous marketplace and never a crash on a bad cookie.
 *
 * SERVER-ONLY surface (it touches `next/headers`); the mapping helper
 * below is pure so the mount tests can cover it without a request
 * scope.
 */

import {
  readSessionCookieValue,
  sessionBoundary,
} from '../../../auth/session.js';
import type { AuthenticatedSession } from '../../../../../../services/auth/src/index.js';
import { grantedRoleIds } from '../../../../../../packages/role-context/src/index.js';
import type { BodyMarketplaceSessionProbe, SessionFacts } from '../../../body-marketplace/index.js';

/** True iff a thrown value carries a typed AUTH_* code (the B004 vocabulary). */
function isTypedAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('AUTH_');
}

/** Project the validated session onto the probe's facts (pure). */
export function sessionToFacts(session: AuthenticatedSession): SessionFacts {
  const workspace = session.workspaceContext;
  if (String(workspace.tenantId) !== String(session.tenantId)) {
    throw new Error(
      `session tenant ${String(session.tenantId)} does not match workspace tenant ${String(workspace.tenantId)} (fail closed)`,
    );
  }
  const label =
    session.principal.label !== undefined && session.principal.label !== null
      ? String(session.principal.label)
      : String(session.principal.principalId);
  return {
    tenantId: String(session.tenantId),
    principalLabel: label,
    roles: grantedRoleIds(workspace),
  };
}

/**
 * Validate a session cookie value through an injected validator and
 * project it onto the probe's facts (pure seam — the mount tests cover
 * it without a request scope). Typed AUTH_* failures fail CLOSED to
 * `null` (the unauthenticated outcome → the auth-required experience);
 * any other failure is rethrown so the route renders its honest error
 * state instead of a silent downgrade.
 */
export async function validateSessionToFacts(
  validate: (cookieValue: string) => Promise<AuthenticatedSession>,
  cookieValue: string,
): Promise<SessionFacts | null> {
  try {
    return sessionToFacts(await validate(cookieValue));
  } catch (error) {
    if (isTypedAuthFailure(error)) return null;
    throw error;
  }
}

/**
 * The REAL probe the route mounts pass to the body-marketplace
 * resolvers. The feature module's default probe is deliberately
 * unauthenticated (fail closed); a mount that wants a session must wire
 * the boundary itself — this is that wiring.
 */
export function bodyMarketplaceSessionProbe(): BodyMarketplaceSessionProbe {
  return {
    cookieValue: () => readSessionCookieValue(),
    validate: (cookieValue: string) =>
      validateSessionToFacts(
        (token: string) => sessionBoundary().service.validateSession(token),
        cookieValue,
      ),
  };
}
