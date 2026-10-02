# Provider Setup — Hosted Preview (B015)

Per-provider setup for the Arena hosted preview (Vercel Hobby + Neon Free
+ Cloudflare R2 free tier + Upstash Redis Free; optional Apify Free). The
default profile is free-tier-compatible BY CONSTRUCTION: every provider
below has a documented free tier, and the wiring fails closed when a
quota is exhausted — there is no automatic paid fallback, ever.

> **Secret injection is Tech-Lead-owned.** Live credentials are injected
> at the launch gate (B019), never committed to git. The committed
> template `deploy/env/hosted-preview.env.example` carries EMPTY
> placeholders by design; `deploy/scripts/secret-scan.mjs` fails the
> deploy workflow if a secret-shaped value is ever committed.

## 1. Environment variable contract (runtime — server-side only)

Source of truth: `deploy/src/hosted/env-contract.ts` (`HOSTED_ENV_VARS`);
the committed template is its rendered artifact (byte-equality is tested).

| Name | Required | Secret | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | yes | Neon PostgreSQL connection string (`postgres://` or `postgresql://` only; other schemes leave the adapter DISABLED) |
| `NEON_CONNECTION_STRING` | alternative | yes | Same rules; `DATABASE_URL` wins when both are set |
| `R2_ACCESS_KEY_ID` | yes | yes | Cloudflare R2 access key id |
| `R2_SECRET_ACCESS_KEY` | yes | yes | Cloudflare R2 secret access key |
| `R2_BUCKET` | yes | no | R2 bucket for trajectories/datasets/evidence/releases |
| `R2_S3_ENDPOINT` | alternative | no | Explicit S3 endpoint; takes precedence over `R2_ACCOUNT_ID` |
| `R2_ACCOUNT_ID` | alternative | no | Account id — endpoint derived as `https://<account-id>.r2.cloudflarestorage.com` |
| `UPSTASH_REDIS_REST_URL` | yes | no | Upstash Redis REST endpoint (http/https) |
| `UPSTASH_REDIS_REST_TOKEN` | yes | yes | Upstash REST bearer token |
| `APIFY_TOKEN` | no | yes | Optional Apify platform token; absent = disabled (passing posture) |
| `ARENA_SESSION_SECRET` | yes | yes | Session signing secret, minimum 32 characters (shorter fails closed with `AUTH_DISABLED`) |

CI deploy credentials (NOT runtime env — GitHub repository secrets):

| Name | Meaning |
|---|---|
| `VERCEL_TOKEN` | Vercel deploy token |
| `VERCEL_ORG_ID` | Vercel org/team id |
| `VERCEL_PROJECT_ID` | Vercel project id (project root directory: `apps/web`) |

## 2. Provider setup steps

### Vercel (Hobby) — web/control plane

1. Create a Vercel account/team on the Hobby plan ($0/month).
2. Create a project: framework preset **Next.js**, **Root Directory
   `apps/web`**, Node 22, install command `corepack pnpm install
   --frozen-lockfile` (the repo pins pnpm via `packageManager`).
3. Do NOT set `VERCEL_TOKEN`/runtime secrets as workflow file content —
   add the three CI secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID`) as GitHub repository secrets (Settings → Secrets
   and variables → Actions). This is the TL-owned B019 injection step.
4. Runtime env vars for the deployed app (`DATABASE_URL`, R2/Upstash/Apify
   values, `ARENA_SESSION_SECRET`) are set as **Vercel project
   environment variables** (Production), server-side only.

### Neon (Free) — authoritative control-plane store

1. Create a Neon account; create one project (Free: 100 projects, 10
   branches/project — `deploy/src/hosted/quotas.ts` encodes the ceilings).
2. Create the database; copy the pooled connection string
   (`postgres://...`).
3. Inject it as the Vercel project env var `DATABASE_URL`
   (`NEON_CONNECTION_STRING` is the accepted alternative name).
4. Migrations: versioned and reproducible — `SQL_MIGRATION_SOURCES`
   (B002) are bound by the wiring's bootstrap composition
   (`composeHostedBootstrap` in `deploy/src/hosted/wiring.ts`); the
   dry-run proves the migration path against local fakes.

### Cloudflare R2 (Standard free tier) — object store

1. Create a Cloudflare account; enable R2 (billing requires a payment
   method on file even for the free tier — the ALLOWANCE stays free-tier:
   10 GB-month storage, 1M Class A + 10M Class B operations/month, free
   egress; exceeding them fails closed, it does not bill the preview).
2. Create a bucket for preview artifacts (trajectories, datasets,
   evidence bundles, releases).
3. Create an R2 API token (S3 credentials): access key id + secret
   access key.
4. Inject `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and
   EITHER `R2_S3_ENDPOINT` OR `R2_ACCOUNT_ID` as Vercel project env vars.

### Upstash Redis (Free) — coordination store

1. Create an Upstash account; create a Redis database on the Free plan
   (256 MB data, 10 GB monthly bandwidth, 500K monthly commands).
2. Copy the REST endpoint (`https://...upstash.io`) and the REST token.
3. Inject `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as
   Vercel project env vars. Redis holds ONLY bounded/rebuildable state
   (caches, idempotency windows, rate limits, leases) — authoritative
   facts live in Neon/R2.

### Apify (Free) — optional data acquisition

1. Optional: create an Apify account ($5 monthly platform spend; the
   platform blocks usage after the allowance is exhausted until the next
   cycle).
2. Create a platform token; inject as `APIFY_TOKEN`.
3. Absence is a PASSING posture — Apify must never be required for the
   primary capability-development lifecycle (FT2.0).

## 3. Verifying the wiring without live credentials

```bash
# full deploy battery (typecheck/lint/103 tests/build) — includes the
# credential-free dry run and the fail-closed proofs:
cd deploy && pnpm install --frozen-lockfile --ignore-workspace && pnpm test

# just the dry run (full wiring path against local fakes):
pnpm --dir deploy dryrun

# committed-secret scanner:
node deploy/scripts/secret-scan.mjs
```

The GitHub workflow `.github/workflows/deploy-preview.yml` runs the same
checks on every push to main (wiring self-test job) before any deploy.

## 4. Deploying / re-deploying

- **Automatic**: every push to `main` triggers `deploy-preview.yml`:
  wiring self-test → (fail-closed secret guard) → `vercel pull` →
  `vercel build --prod` (prebuilt, from `apps/web`) → `vercel deploy
  --prebuilt --prod` → HTTP smoke check.
- **Until B019**: the deploy job intentionally reports FAILURE when the
  three CI secrets are absent (fail closed, actionable message pointing
  here) — the wiring self-test job is the one that must stay green.
- **Manual re-run**: the workflow also exposes `workflow_dispatch`.
