# apps/web/src/auth — the Next.js session boundary (B004)

Server-only session helpers, route-handler factory, CSRF origin-check posture and the middleware boundary-guard **EXPORT** for the Arena product host (Work Order B004; issue #69). Everything here validates BEFORE returning — a missing cookie is a typed `AUTH_SESSION_NOT_FOUND`, never a silent anonymous session. This directory is B004-owned; the app tree (`src/app/*`) and the apps/web root configs are B001-owned and are **not** modified by B004 — the boundary is exported for later mounting.

## Files

- `session.ts` — server-side session helpers over Next's `cookies()` API (`readSession` / `issueSession` / `rotateCurrentSession` / `revokeCurrentSession`), the composition root (`configureSessionBoundary`, `createEnvSessionBoundary`) and the cookie materialization (the exact `@arena/auth` contract: `arena_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, bounded `Max-Age`).
- `handlers.ts` — the route-handler factory: `createLoginRouteHandler` / `createLogoutRouteHandler` / `createSessionRouteHandler` returning `(request: Request) => Promise<Response>`, with the closed `AUTH_*`-code → HTTP-status map and the injected `resolveWorkspaceContext` port (the web boundary never invents roles or memberships).
- `csrf.ts` — the origin-check posture for state-changing handlers (see below).
- `middleware.ts` — the boundary-guard **factory export** (see below).
- `index.ts` — server-only barrel.

Workspace imports are RELATIVE (`../../../../services/auth/src/index.js`, `../../../../packages/auth/src/index.js`, …) because apps/web's `package.json` is B001-owned and stays untouched; the layer direction (app → service → domain) stays satisfied for the boundary checker. No new dependency is introduced anywhere.

## Composition (server startup)

```ts
import { configureSessionBoundary, createEnvSessionBoundary } from '@/auth/index.js';
// or a custom composition:
configureSessionBoundary({
  service: myAuthService,           // e.g. over the durable ControlPlaneSessionStore
  cookieSecure: process.env.NODE_ENV === 'production',
});
// env-driven default (FakeSessionStore + empty credential seam):
configureSessionBoundary(createEnvSessionBoundary());
```

`createEnvSessionBoundary()` resolves `ARENA_SESSION_SECRET` through `process.env`; a missing/short secret (min 32 chars) makes the `AuthService` factory throw the typed `AUTH_DISABLED` error — the boundary refuses to start, there is no weak default key.

## Mounting the route handlers (B005/B007, inside `src/app/**/route.ts`)

```ts
import { createLoginRouteHandler, createLogoutRouteHandler, createSessionRouteHandler } from '@/auth/index.js';

const options = { /* service, allowedOrigins, cookieSecure, resolveWorkspaceContext */ };
export const POST   = createLoginRouteHandler(options);   // e.g. src/app/api/auth/login/route.ts
export const POST   = createLogoutRouteHandler(options);  // e.g. src/app/api/auth/logout/route.ts
export const GET    = createSessionRouteHandler(options); // e.g. src/app/api/auth/session/route.ts
```

## Mounting the middleware (B001 or later work order — B004 does not edit root configs)

Create `apps/web/src/middleware.ts` (the Next.js App Router mount point):

```ts
import { createSessionBoundaryMiddleware } from './auth/middleware.js';

export default createSessionBoundaryMiddleware({ redirectTo: '/login' });

export const config = { matcher: ['/console/:path*', '/workbench/:path*'] };
```

No `next.config.ts` change is required (middleware mounting is file-location based). The guard performs a cookie-PRESENCE check only — the HMAC seal, lifecycle and tenant-scope validation stay in the server-side boundary (the edge runtime cannot run the `node:crypto` HMAC), which fails closed everywhere.

## CSRF posture

Chosen approach: **origin-check** (not double-submit). Every state-changing handler requires `POST` and an `Origin` header that is same-origin or explicitly allowlisted (`allowedOrigins`); absent/opaque (`null`) Origins are rejected with the closed boundary-level `BOUNDARY_ORIGIN_REJECTED` code (HTTP 403). The `SameSite=Lax` cookie contract provides the second line of defense. Safe reads (`session` GET) skip the origin check but still validate fail-closed.

## Demo/preview posture

B006 owns Demo mode. The seam here is the injected `CredentialVerifier` (e.g. `StaticCredentialVerifier` over caller-registered entries) and the injected session store — no demo users are hardcoded in this directory.
