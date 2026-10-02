# @arena/deploy — Deployment Descriptors & Hosted-Preview Wiring

Typed, versioned deployment descriptors for the Arena v1 service topology
(A036, DEP1.0) **plus** the hosted-preview production provider wiring and
deployment automation (B015).

## B015 surface — hosted provider wiring (`src/hosted/`)

Env-driven, placeholder-safe, free-tier-compatible by construction,
fail-closed on quota exhaustion. Composes the B002 hosted adapters
(`@arena/hosted-neon-postgres`, `@arena/hosted-r2-object-store`,
`@arena/hosted-upstash-redis`) and the persistence composition fabric
(`@arena/persistence-service`) — **no new adapter code**.

| Module | Responsibility |
|---|---|
| `quotas.ts` | Free-tier quota ceilings (normative: `docs/deployment/free-tier-architecture.md`) + declared-allowance builders |
| `env-contract.ts` | The hosted env-var registry (single source of truth) + the committed template renderer |
| `vercel.ts` | Vercel Hobby project profile + CI deploy-credential resolution (names only) |
| `apify.ts` | Optional Apify wiring (disabled is a passing posture) |
| `wiring.ts` | Strict fail-fast / dry-run resolution + adapter instantiation glue + deterministic hosted bootstrap (marker seed) |
| `fail-closed.ts` | The fail-closed quota guard (composes `CapacityService.guard()` / `assertCapacityUsable`) — no paid fallback is representable |
| `fakes.ts` | Re-exports the B002 local fake transports (dry-run seams) |
| `dry-run.ts` | `runHostedWiringDryRun(env)` — the credential-free wiring self-test |

Artifacts next to the code:

- `env/hosted-preview.env.example` — the runtime env contract template
  (EMPTY placeholders only; byte-equality with the renderer is tested).
- `scripts/secret-scan.mjs` — zero-dependency committed-secret scanner
  (wired into `.github/workflows/deploy-preview.yml`).

## Battery

```bash
pnpm install --frozen-lockfile --ignore-workspace   # standalone project (not in the workspace)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm dryrun        # credential-free wiring dry run only
pnpm secret-scan   # committed-secret scanner
```

Notes:

- `--ignore-workspace`: this directory is a standalone pnpm project next
  to the monorepo workspace (A036 layout); without the flag pnpm
  installs the workspace root instead.
- The battery composes WORKSPACE SOURCE through tsconfig/vitest path
  aliases (`@arena/persistence`, the hosted adapters,
  `@arena/persistence-service`) — run the root `pnpm install` first so
  the adapters' SDK dependencies resolve.
- The same battery + dry run + secret scan run in CI on every push to
  main (`.github/workflows/deploy-preview.yml`), before any deploy.

## Runbooks

Operational documentation lives in `ops/deployment/` (B015 surface):
provider setup + secret injection, free-tier limits, rollback, quota
exhaustion. See `ops/deployment/README.md`.

## A036 surface (pre-existing)

`src/shared.ts`, `src/model.ts`, `src/slo-catalog.ts`,
`src/health-gates.ts`, `src/reference.ts` — typed deployment topologies,
health gates wired to the A035 SLO catalog, security gates reflecting
A034, reference production manifest. Public surface is re-exported
additively from `src/index.ts` (B015 appended `export *
from './hosted/index.js'`).
