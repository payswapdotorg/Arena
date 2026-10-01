/**
 * @arena/auth-service — the auth service for Arena (Work Order B004;
 * issue #69; docs/LLM-ARCHITECT-HANDOFF.md §11 B004 acceptance block).
 *
 * Public surface (dependency order):
 *   shared                  — the versioned contract surface B005/B007
 *                             consume (AuthenticatedSession view +
 *                             SessionIssuance envelope + the fail-closed
 *                             parser; spec/service-boundaries.md)
 *   ports                   — CredentialVerifier (the provider-neutral
 *                             credential seam) + StaticCredentialVerifier
 *                             (the caller-registered local/Demo seam) +
 *                             sessionSecretFromEnv (env-lookup injection)
 *   service                 — AuthService: authenticate / issueSession /
 *                             validateSession / rotateSession /
 *                             revokeSession / revokeAll (tenant-scoped,
 *                             fail-closed typed outcomes; authorization
 *                             stays OUT — the B003 PermissionPolicy rides
 *                             inside the workspace context, opaque)
 *   control-plane-session-store — the durable SessionStore over the
 *                             injected B002 ports (control-plane records +
 *                             bounded/rebuildable coordination state)
 *   local                   — createLocalAuthStack (FT2.0 local parity:
 *                             the full session lifecycle with zero
 *                             providers)
 *
 * Workspace dependencies: @arena/auth (the session protocol),
 * @arena/persistence (the B002 ports + fakes), @arena/protocol-core,
 * @arena/role-context, @arena/security. ZERO Next.js imports (the Next.js
 * session boundary lives in apps/web/src/auth); ZERO provider names.
 */

export * from './shared.js';
export * from './ports.js';
export * from './service.js';
export * from './control-plane-session-store.js';
export * from './local.js';

import { AUTH_SERVICE_RECORD_VERSION } from './shared.js';

/** Version of this package's contract surface. */
export const AUTH_SERVICE_VERSION = AUTH_SERVICE_RECORD_VERSION;
