/**
 * @arena/auth — the session protocol and primitives package for Arena
 * (Work Order B004; issue #69; docs/LLM-ARCHITECT-HANDOFF.md §11 B004
 * acceptance block).
 *
 * Public surface (dependency order):
 *   errors     — closed AUTH_* error taxonomy (fail-closed parser)
 *   shared     — branded session ids, cross-vocabulary tenant comparison,
 *                the injected AuthClock seam, bounds, deep freeze
 *   secret     — the ARENA_SESSION_SECRET contract (missing/short secret
 *                => DISABLED; a factory that refuses to construct beats a
 *                weak default key — there is no default key anywhere)
 *   token      — the sealed session token protocol (opaque session id +
 *                HMAC-SHA256 seal over a canonical serialization;
 *                node:crypto only — ZERO external dependencies)
 *   session    — the versioned SessionRecord (A034 SecurityPrincipal +
 *                TenantScopedRef provenance + B003 WorkspaceContext
 *                SNAPSHOT + opaque auth-method provenance + revocation
 *                epoch) with fail-closed construction and strict parsing
 *   cookie     — the arena_session cookie contract (name + flags +
 *                serialization + parsing; pure string handling)
 *   store      — the SessionStore port with typed closed-vocabulary
 *                validation outcomes (issue/validate/rotate/revoke/
 *                revokeAllForPrincipal)
 *   fakes      — FakeSessionStore + ManualAuthClock/SystemAuthClock (FT2.0
 *                local parity)
 *   testing    — defineSessionContractSuite (the shared behavioral suite
 *                every SessionStore implementation must pass)
 *
 * The package's workspace dependencies are @arena/protocol-core,
 * @arena/security (the A034 identity/tenancy primitives) and
 * @arena/role-context (the B003 workspace context). ZERO Next.js imports
 * (enforced by the hygiene suite — the Next.js session boundary lives in
 * apps/web/src/auth); ZERO provider names (enforced by the hygiene suite);
 * node:crypto is the only runtime import beyond the workspace.
 */

export * from './errors.js';
export * from './shared.js';
export * from './secret.js';
export * from './token.js';
export * from './session.js';
export * from './cookie.js';
export * from './store.js';
export * from './fakes/index.js';
export * from './testing/contract-suite.js';

import { AUTH_SCHEMA_VERSION } from './version.js';

/** Version of this package's protocol surface. */
export const AUTH_VERSION = AUTH_SCHEMA_VERSION;
