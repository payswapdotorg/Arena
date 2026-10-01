# @arena/auth

The session protocol and primitives for Arena (Work Order B004; issue #69;
`docs/LLM-ARCHITECT-HANDOFF.md` §11 B004 acceptance block; AGENTS.md
"Security": authentication failures fail closed with typed errors).

`@arena/auth` is a DOMAIN package whose workspace imports are exactly
`@arena/protocol-core` (protocol layer), `@arena/security` (the A034
identity/tenancy primitives) and `@arena/role-context` (the B003 workspace
context). It contains **ZERO Next.js imports** (enforced by the hygiene
suite — the Next.js session boundary lives in `apps/web/src/auth`) and
**ZERO provider names** (FT2.0 provider neutrality, enforced by the hygiene
suite). The only non-workspace runtime import is Node's built-in
`node:crypto` (the sanctioned HMAC/UUID primitive — **ZERO external
dependencies**).

## What it owns

- **Sealed session token protocol** (`src/token.ts`): an opaque,
  server-minted session id inside a sealed envelope
  `arena.st1.<base64url(payload)>.<base64url(seal)>`. The payload is
  canonical JSON of `{ recordVersion: 1, sessionId }` — **only that** (the
  cookie contract forbids principal/tenant/role data, and the payload
  shape makes it structural). The seal is HMAC-SHA256
  (`node:crypto`) over the domain-separated canonical serialization,
  compared with `timingSafeEqual`. Unknown versions are a typed
  `AUTH_TOKEN_VERSION_UNSUPPORTED` rejection; tampering is
  `AUTH_TOKEN_TAMPERED`; junk is `AUTH_MALFORMED_TOKEN`.
- **`ARENA_SESSION_SECRET` contract** (`src/secret.ts`): the secret is
  resolved through an INJECTED lookup (this package never reads the
  environment and never logs the value). Missing/empty/whitespace or
  shorter than **32 characters** (the enforced entropy floor — 256 bits
  when generated as 32 random bytes, e.g.
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`)
  resolves to the **DISABLED** posture, and
  `createSessionTokenSealer` REFUSES TO CONSTRUCT with a typed
  `AUTH_DISABLED` error. **There is no default key and no downgrade path
  anywhere in this package.**
- **SessionRecord** (`src/session.ts`): the versioned record — A034
  `SecurityPrincipal`, tenant id + `TenantScopedRef` provenance (defaults
  to the `customer-identity` boundary class),
  `issuedAt`/`expiresAt`/`rotatesAt` (deterministic windows from the
  bounded `SessionPolicy`), the **B003 `WorkspaceContext` SNAPSHOT**
  (disclosed design choice — see below), the OPAQUE
  `AuthMethodDescriptor` issuance provenance (carried, never interpreted —
  like B003's `PermissionPolicy`), and the `revocationEpoch` marker.
  Construction fails closed: the anonymous principal and untenanted
  principals cannot hold sessions; cross-tenant material is a typed
  `AUTH_TENANT_SCOPE_VIOLATION`; `toSessionRecord` re-validates every
  embedded contract through its owner's parser so corrupted storage can
  never yield a usable session.
- **Cookie contract** (`src/cookie.ts`): the single `arena_session` cookie
  — `HttpOnly`, `SameSite=Lax`, `Secure` in production (composition
  supplied), `Path=/`, max-age bounded to the session TTL. Pure spec
  builders + the single serialization authority + raw `Cookie` header
  parsing (no request APIs).
- **SessionStore port** (`src/store.ts`): `issue` (epoch-stamped,
  idempotent replay) / `validate` (typed closed-vocabulary outcome:
  `valid | expired | revoked | rotated | unknown` — **no outcome degrades
  to an anonymous session**) / `rotate` (ONE-TIME: the old id is
  tombstoned `rotated` and superseded) / `revoke` / `revokeAllForPrincipal`
  (epoch bump invalidates every issued session for the principal).
- **Local parity** (`src/fakes/`): `FakeSessionStore` + `ManualAuthClock`
  (deterministic time) — the same port contract the control-plane-backed
  store in `services/auth` implements (FT2.0: local install and Demo mode
  need zero providers).
- **Contract kit** (`src/testing/contract-suite.ts`):
  `defineSessionContractSuite(name, factory)` runs the SAME behavioral
  suite against ANY `SessionStore` implementation — parity is executed,
  not asserted.

## Design disclosures (B004 choices)

- **Workspace context: SNAPSHOT, not a reference.** The session record
  embeds the full frozen B003 `WorkspaceContext`. Rationale: session
  validation must be a single-source, fail-closed decision — no second
  store read can fail open; the snapshot is re-validated structurally on
  every read and re-taken on rotation. Consequence: role switches made
  after issuance become visible only after `rotateSession` (or re-login) —
  the standard sealed-session trade-off, disclosed for B007's cockpit
  design.
- **Sessions are strictly tenant-scoped.** Untenanted principals
  (platform operators) cannot hold browser sessions in B004 — cross-tenant
  operator tooling is B014+ scope. The anonymous principal is rejected by
  construction (fail closed — there is no silent anonymous fallback).
- **`principalId` (A034) and `identityId` (B003) are separate
  vocabularies** and are NOT forced equal: the issuance composition root
  guarantees their linkage; both must independently be tenant-consistent
  with the session's tenant.
- **Sealing is deterministic** (same id + key ⇒ same token): the
  unguessable 128-bit session id is the nonce; the seal exists to reject
  forgery/tampering before any storage read.
- **Revocation epochs** are stamped at issuance and bumped by
  `revokeAllForPrincipal`; per-session revocation/rotation tombstones are
  store-internal state (the domain record stays pure).

## Purity

No Next.js imports, no React imports, no provider names, no `any` types,
no clock reads (the `AuthClock` seam is injected), no I/O, no `.env`
files. All records are deep-frozen; every mutation returns a NEW frozen
record. The only Node builtin used is `node:crypto`.

## Scripts

- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — package battery
