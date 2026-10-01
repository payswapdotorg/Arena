# @arena/auth-service

Auth service for Arena (Work Order B004; issue #69; governing acceptance block `docs/LLM-ARCHITECT-HANDOFF.md` §11 B004).

Composes the `@arena/auth` sealed session-token protocol with the injected B002 persistence ports into the secure server-side session boundary: `AuthService` (`authenticate` via an injected credential-verifier port, `issueSession`/`validateSession`/`rotateSession`/`revokeSession`/`revokeAll` over the `arena_session` cookie contract, tenant-scope fail-closed on every validation), the durable `ControlPlaneSessionStore` over `ControlPlaneRepository` + `CoordinationStore`, and `createLocalAuthStack` for FT2.0 local parity. Authorization stays OUT: the service returns identity + the B003 workspace context and never interprets the opaque permission policy. Zero external dependencies; workspace dependencies only (`@arena/auth`, `@arena/persistence`, `@arena/protocol-core`, `@arena/role-context`, `@arena/security`).

## Law

- **Fail closed, always.** Authentication failures are typed `AUTH_*` errors — expired/revoked/rotated/unknown sessions, malformed/tampered seals, cross-tenant expectations and malformed inputs each carry their typed code; there is NO parameter, return path or fallback that yields an anonymous session.
- **The factory refuses to construct when DISABLED.** A missing or short `ARENA_SESSION_SECRET` (min 32 chars — a 256-bit entropy floor) resolves the DISABLED posture and `new AuthService(...)` throws typed `AUTH_DISABLED`. No weak default key exists anywhere.
- **The cookie carries ONLY the opaque sealed session id.** The `arena_session` cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production; principal/tenant/role data never leaves the server-side record.
- **Tenant scope is structural.** A session issued for tenant A cannot validate in a tenant-B context (`AUTH_TENANT_SCOPE_VIOLATION` on every validation with an expectation).
- **Authorization stays OUT.** The B003 `PermissionPolicy` rides inside the workspace-context snapshot, opaque and unread.
- **Storage posture (disclosed).** Sessions are versioned control-plane records (kind `arena-session`, recordId = session id, optimistic revisions; tombstones persist as record state, never deletes) plus a per-principal revocation-epoch counter record (kind `arena-session-epoch`). The coordination store holds ONLY bounded, rebuildable state: a short-TTL read-through epoch cache (invalidated on every bump; `epochCacheTtlMs: 0` disables it) and the one-time rotation lease (concurrent rotations → typed `AUTH_ROTATION_CONFLICT`).

## Surfaces

- `service.ts` — `AuthService` (the operations B005/B007 consume)
- `shared.ts` — the versioned contract surface (`AuthenticatedSession` view, `SessionIssuance` envelope, fail-closed `toAuthenticatedSession`)
- `ports.ts` — `CredentialVerifier` (provider-neutral seam), `StaticCredentialVerifier` (caller-registered local/Demo seam — no users are hardcoded; B006 owns Demo mode), `sessionSecretFromEnv`
- `control-plane-session-store.ts` — the durable `SessionStore` over the injected B002 ports
- `local.ts` — `createLocalAuthStack` (FT2.0: full session lifecycle with zero providers)

## Env contract

`ARENA_SESSION_SECRET` (name only; never committed, never logged) — min 32 chars. Generate with:
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`

## Tests

`pnpm --filter @arena/auth-service test` — service lifecycle + typed fail-closed outcomes (`service.test.ts`), the executed session-store contract suite over the B002 fakes (`parity.test.ts` — the same `defineSessionContractSuite` that validates `FakeSessionStore` in `@arena/auth`), and the purity/workspace hygiene suite (`hygiene.test.ts`). No live credentials anywhere; the local stack composes the in-memory fakes only.
